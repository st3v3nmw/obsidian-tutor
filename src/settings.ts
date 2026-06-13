export interface TutorSettings {
    apiKey: string;
    model: string;
}

export const DEFAULT_SETTINGS: TutorSettings = {
    apiKey: "",
    model: "anthropic/claude-sonnet-4-6",
};
