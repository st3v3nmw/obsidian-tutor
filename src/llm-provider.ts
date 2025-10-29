export interface LLMProvider {
    complete(messages: any[]): Promise<string>;
}

export class OpenRouterProvider implements LLMProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string) {
        this.apiKey = apiKey;
        this.model = model;
    }

    async complete(messages: any[]): Promise<string> {
        if (!this.apiKey) {
            throw new Error("OpenRouter API key not configured");
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "X-Title": "Obsidian Tutor",
                "HTTP-Referer": "https://github.com/st3v3nmw/obsidian-tutor"
            },
            body: JSON.stringify({
                model: this.model,
                messages
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
}
