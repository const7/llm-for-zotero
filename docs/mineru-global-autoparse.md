# MinerU 全局自动解析功能

## 功能概述

本功能为 llm-for-zotero 插件增加了全局自动解析 PDF 的能力，用户可以通过一个开关控制是否自动解析加入到文库中的 PDF 文档。同时支持实时查看每个 PDF 的处理状态。

## 功能特性

### 1. 全局自动解析开关

- **位置**: Zotero 设置 → llm-for-zotero → MinerU
- **选项**: "自动解析新加入文献"
- **功能**: 启用后，所有新添加到 Zotero 文库的 PDF 文件将自动触发 MinerU 解析

### 2. 三种状态指示器

在 MinerU 管理界面的文件列表中，每个 PDF 文件前会显示一个彩色圆点，表示其解析状态：

| 颜色              | 状态   | 含义                          |
| ----------------- | ------ | ----------------------------- |
| 🟢 绿色 (#10b981) | Ready  | MinerU 缓存已就绪，可正常使用 |
| 🟡 黄色 (#f59e0b) | 解析中 | 正在进行 MinerU 解析处理      |
| 🔴 红色 (#ef4444) | Failed | 解析失败                      |
| ⚪ 灰色 (#d1d5db) | 空闲   | 未缓存，尚未处理              |

### 3. 文件夹级别的自动监控

- 在 MinerU 管理界面的左侧文件夹列表中，每个文件夹旁边都有一个 ⚡ 图标
- 点击 ⚡ 图标可以启用/禁用对该文件夹的自动监控
- 被监控的文件夹中的新 PDF 会自动触发解析

### 4. 实时状态更新

- 状态指示器会实时更新，无需手动刷新页面
- 支持批量处理时的状态同步
- 处理队列显示当前正在处理的文件和队列长度

## 技术实现

### 核心文件

1. **src/modules/mineruProcessingStatus.ts**
   - 管理 PDF 处理状态
   - 提供状态变更监听机制
   - 跟踪处理中、已完成、失败的项目

2. **src/modules/mineruAutoWatch.ts**
   - 监听 Zotero 的 item 添加事件
   - 管理处理队列
   - 处理全局自动解析逻辑
   - 显示通知消息

3. **src/utils/mineruConfig.ts**
   - 添加 `mineruGlobalAutoParse` 偏好设置
   - 提供 `isGlobalAutoParseEnabled()` 和 `setGlobalAutoParseEnabled()` 函数

4. **src/modules/mineruBatchProcessor.ts**
   - 集成状态追踪到批处理流程
   - 在解析开始、完成、失败时更新状态

5. **src/modules/mineruManagerScript.ts**
   - 渲染三色状态指示器
   - 订阅状态变更事件
   - 支持手动触发处理

6. **src/hooks.ts**
   - 启动时初始化 auto-watch
   - 关闭时清理资源

7. **addon/content/preferences.xhtml**
   - 添加全局自动解析开关 UI
   - 显示状态指示器图例

### 状态流转

```
新 PDF 添加到文库
       ↓
   [自动解析开启?]
       ↓ 是
   状态: 解析中 (黄色)
       ↓
   解析完成?
   ├─ 是 → 状态: Ready (绿色)
   └─ 否 → 状态: Failed (红色)
```

## 使用说明

### 启用全局自动解析

1. 打开 Zotero
2. 进入 `编辑` → `首选项` → `llm-for-zotero` → `MinerU`
3. 勾选 `自动解析新加入文献`
4. 新添加到文库的 PDF 将自动触发解析

### 查看处理状态

1. 在同一 MinerU 设置页面
2. 查看 `Manage Files` 区域
3. 文件列表前的彩色圆点表示状态

### 文件夹级监控

1. 在 MinerU 管理界面左侧选择文件夹
2. 点击文件夹名称旁的 ⚡ 图标
3. 黄色 ⚡ 表示已启用监控，灰色表示未启用

## 注意事项

- 全局自动解析和文件夹级监控是独立的功能
- 解析过程需要网络连接
- 解析大量 PDF 时可能需要较长时间
- 失败的项目可以手动重新触发解析

## API 说明

### mineruProcessingStatus.ts

```typescript
// 设置项目为处理中状态
setItemProcessing(attachmentId: number): void

// 设置项目为已缓存状态
setItemCached(attachmentId: number): void

// 设置项目为失败状态
setItemFailed(attachmentId: number, errorMessage?: string): void

// 获取项目状态
getMineruStatus(attachmentId: number): Promise<"cached" | "processing" | "failed" | "idle">

// 订阅状态变更
onProcessingStatusChange(listener: () => void): () => void
```

### mineruConfig.ts

```typescript
// 检查全局自动解析是否启用
isGlobalAutoParseEnabled(): boolean

// 设置全局自动解析状态
setGlobalAutoParseEnabled(value: boolean): void

// 获取监控的文件夹 ID 集合
getAutoWatchCollectionIds(): Set<number>

// 添加/移除监控文件夹
addAutoWatchCollection(collectionId: number): void
removeAutoWatchCollection(collectionId: number): void
```

## 更新日志

### 2025-04-08

- 初始实现全局自动解析功能
- 添加三色状态指示器（绿色、黄色、红色）
- 支持实时状态更新
- UI 标签汉化
