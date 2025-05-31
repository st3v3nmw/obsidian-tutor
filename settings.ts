export interface GrimoireSettings {
    provider: "openrouter" | "claude";
    apiKey: string;
    openrouterModel: string;
    claudeModel: string;
}

export const DEFAULT_SETTINGS: GrimoireSettings = {
    provider: "openrouter",
    apiKey: "",
    openrouterModel: "anthropic/claude-sonnet-4",
    claudeModel: "claude-sonnet-4-0"
};
