---
id: note-template
name: Note Template
description: Default note structure — customize this to shape all your notes
version: 1
match: /\b(create|make|write|draft|generate)\b.*\b(note|notes?)\b/i
match: /\b(note|notes?)\b.*\b(for|from|about|on)\b/i
match: /\b(save|write|append|add)\b.*\b(to\s+)?(note|notes?)\b/i
match: /\b(reading notes?|study notes?|literature notes?|research notes?)\b/i
match: /\b(use|apply|with)\b.*\btemplate\b/i
---

<!--
  SKILL: Note Template

  This skill provides a default note structure for the agent to follow
  when creating any kind of note (Zotero notes or file-based notes).

  OUT OF THE BOX: This skill is intentionally minimal. The agent will
  use its own judgment for note structure, just as it always has.

  TO CUSTOMIZE: Replace the "Template" section below with your preferred
  note structure. Once you do, the agent will follow your template for
  ALL notes — whether saved to Zotero or written to files.

  Example customizations:
  - Define sections: ## Summary, ## Methods, ## Key Findings, ## My Notes
  - Set a citation style: "Use [cite:@citekey] for all references"
  - Set a language: "Always write notes in Chinese"
  - Add frontmatter: YAML headers for Obsidian, Logseq, etc.
  - Change format: Org-mode, LaTeX, or any markup language

  Your changes are preserved across plugin updates.
  To reset to default, delete this file — it will be recreated on next restart.
-->

## Note Template

This is the default note template. It has not been customized, so you should use your own judgment to structure notes appropriately for the content and context. Write clear, well-organized notes as you normally would.

**If the user has replaced this section with a custom template below, follow that template exactly for all notes you create — whether using `edit_current_note` (Zotero notes) or `file_io` (file-based notes).**
