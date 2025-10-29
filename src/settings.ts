export interface TutorSettings {
    provider: "openrouter";
    apiKey: string;
    model: string;
}

export const DEFAULT_SETTINGS: TutorSettings = {
    provider: "openrouter",
    apiKey: "",
    model: "anthropic/claude-sonnet-4.5",
};
