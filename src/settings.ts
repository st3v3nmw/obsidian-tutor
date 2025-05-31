export interface TutorSettings {
    provider: "openrouter" | "claude";
    apiKey: string;
    openrouterModel: string;
    claudeModel: string;
}

export const DEFAULT_SETTINGS: TutorSettings = {
    provider: "openrouter",
    apiKey: "",
    openrouterModel: "anthropic/claude-sonnet-4",
    claudeModel: "claude-sonnet-4-0"
};
