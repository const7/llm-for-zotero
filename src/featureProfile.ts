export type FeatureProfileName = "paper-chat-lean";

export type FeatureProfile = {
  name: FeatureProfileName;
  startup: {
    initializeAgentSubsystem: boolean;
    loadUserSkills: boolean;
    initializeAttachmentMaintenance: boolean;
    registerWebChatRelay: boolean;
    startMineruAutoWatch: boolean;
    registerStandaloneShortcut: boolean;
    registerNoteEditingTracking: boolean;
  };
  panel: {
    enableStandaloneWindow: boolean;
    showRuntimeModeToggle: boolean;
  };
  sendFlow: {
    useLeanPaperChatFastPath: boolean;
  };
  preferences: {
    showAgentTab: boolean;
    showMineruTab: boolean;
  };
};

const PAPER_CHAT_LEAN_PROFILE: FeatureProfile = {
  name: "paper-chat-lean",
  startup: {
    initializeAgentSubsystem: false,
    loadUserSkills: false,
    initializeAttachmentMaintenance: false,
    registerWebChatRelay: false,
    startMineruAutoWatch: false,
    registerStandaloneShortcut: false,
    registerNoteEditingTracking: false,
  },
  panel: {
    enableStandaloneWindow: false,
    showRuntimeModeToggle: false,
  },
  sendFlow: {
    useLeanPaperChatFastPath: true,
  },
  preferences: {
    showAgentTab: false,
    showMineruTab: false,
  },
};

export function getFeatureProfile(): FeatureProfile {
  return PAPER_CHAT_LEAN_PROFILE;
}

export function isPaperChatLeanProfile(): boolean {
  return getFeatureProfile().name === "paper-chat-lean";
}
