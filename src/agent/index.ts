import { AgentRuntime } from "./runtime";
import { createBuiltInToolRegistry } from "./tools";
import { ZoteroGateway } from "./services/zoteroGateway";
import { PdfService } from "./services/pdfService";
import { PdfPageService } from "./services/pdfPageService";
import { RetrievalService } from "./services/retrievalService";
import {
  initAgentTraceStore,
  getAgentRunTrace,
} from "./store/traceStore";
import { createAgentModelAdapter } from "./model/factory";
import type {
  AgentEvent,
  AgentRuntimeRequest,
} from "./types";

let runtime: AgentRuntime | null = null;

function createToolRegistry() {
  const zoteroGateway = new ZoteroGateway();
  const pdfService = new PdfService();
  const pdfPageService = new PdfPageService(pdfService, zoteroGateway);
  const retrievalService = new RetrievalService(pdfService);
  return createBuiltInToolRegistry({
    zoteroGateway,
    pdfService,
    pdfPageService,
    retrievalService,
  });
}

export async function initAgentSubsystem(): Promise<AgentRuntime> {
  if (runtime) return runtime;
  await initAgentTraceStore();
  runtime = new AgentRuntime({
    registry: createToolRegistry(),
    adapterFactory: (request) => createAgentModelAdapter(request),
  });
  return runtime;
}

export function getAgentRuntime(): AgentRuntime {
  if (!runtime) {
    throw new Error("Agent subsystem is not initialized");
  }
  return runtime;
}

export function getAgentApi() {
  return {
    runTurn: (
      request: AgentRuntimeRequest,
      onEvent?: (event: AgentEvent) => void | Promise<void>,
    ) => getAgentRuntime().runTurn({ request, onEvent }),
    listTools: () => getAgentRuntime().listTools(),
    getToolDefinition: (name: string) => getAgentRuntime().getToolDefinition(name),
    getCapabilities: (request: AgentRuntimeRequest) =>
      getAgentRuntime().getCapabilities(request),
    getRunTrace: (runId: string) => getAgentRunTrace(runId),
    resolveConfirmation: (
      requestId: string,
      approved: boolean,
      data?: unknown,
    ) => getAgentRuntime().resolveConfirmation(requestId, approved, data),
  };
}
