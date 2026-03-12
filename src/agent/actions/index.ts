import { ActionRegistry } from "./registry";
import { auditLibraryAction } from "./auditLibrary";
import { syncMetadataAction } from "./syncMetadata";
import { organizeUnfiledAction } from "./organizeUnfiled";
import { literatureReviewAction } from "./literatureReview";
import { autoTagAction } from "./autoTag";
import { discoverRelatedAction } from "./discoverRelated";

export function createBuiltInActionRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  registry.register(auditLibraryAction);
  registry.register(syncMetadataAction);
  registry.register(organizeUnfiledAction);
  registry.register(literatureReviewAction);
  registry.register(autoTagAction);
  registry.register(discoverRelatedAction);
  return registry;
}

export { ActionRegistry } from "./registry";
export type {
  AgentAction,
  ActionExecutionContext,
  ActionConfirmationMode,
  ActionProgressEvent,
  ActionResult,
  ActionServices,
} from "./types";
