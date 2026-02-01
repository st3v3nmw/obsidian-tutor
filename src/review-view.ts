import { ItemView, MarkdownRenderer, Platform, setIcon, WorkspaceLeaf } from "obsidian";

import { LLMProvider, OpenRouterProvider } from "src/llm-provider";
import TutorPlugin from "src/main";
import { Rating, TopicCard } from "src/types";

export const VIEW_TYPE_REVIEW = "tutor-review";

const TUTOR_RESPONSE_SCHEMA = {
    type: "json_schema",
    json_schema: {
        name: "tutor",
        strict: true,
        schema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "Question, explanation, or feedback in Markdown format. Use LaTeX for math."
                },
                rating: {
                    enum: ["again", "hard", "good", "easy", null],
                    description: "Spaced repetition rating, or null to continue dialogue."
                }
            },
            required: ["message", "rating"],
            additionalProperties: false
        }
    }
};

export class ReviewView extends ItemView {
    private plugin: TutorPlugin;
    private topics: TopicCard[] = [];
    private currentTopicIndex = 0;
    private conversation: { sender: string; content: string }[] = [];
    private conversationEl: HTMLElement;
    private inputEl: HTMLTextAreaElement;
    private sendBtn: HTMLButtonElement;
    private isWaitingForAI = false;
    private llmProvider: LLMProvider;

    constructor(leaf: WorkspaceLeaf, plugin: TutorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_REVIEW;
    }

    getDisplayText() {
        return "Tutor";
    }

    getIcon() {
        return "brain-circuit";
    }

    async setState(state: any, result: any) {
        if (state.topics) {
            await this.loadTopics(state.topics);
        }

        return super.setState(state, result);
    }

    async loadTopics(topics: TopicCard[]) {
        this.topics = topics;
        this.currentTopicIndex = 0;
        this.conversation = [];

        await this.render();

        this.initializeLLMProvider();
        if (this.getCurrentTopic()) {
            await this.startTopicReview();
        }
    }

    private getCurrentTopic(): TopicCard | null {
        return this.topics[this.currentTopicIndex] || null;
    }

    getState() {
        return {
            topics: this.topics,
            currentTopicIndex: this.currentTopicIndex
        };
    }

    private initializeLLMProvider() {
        const { provider, apiKey, model } = this.plugin.settings;
        switch (provider) {
            case "openrouter":
                this.llmProvider = new OpenRouterProvider(apiKey, model);
                break
            default:
                throw new Error("Unsupported provider: " + provider);
        }
    }

    async onOpen() {}

    async render() {
        const container = this.containerEl.children[1];
        container.empty();

        const currentTopic = this.getCurrentTopic();
        if (!currentTopic) {
            container.createEl("p", { text: "No topics available for review." });
            return;
        }

        // Conversation area
        this.conversationEl = container.createEl("div", { cls: "tutor-conversation" });

        // Input area
        const inputContainer = container.createEl("div", { cls: "tutor-input-area" });

        this.inputEl = inputContainer.createEl("textarea", {
            attr: { rows: 1, placeholder: "Reply\u2026" }
        });

        this.inputEl.addEventListener("input", () => {
            this.inputEl.style.height = "auto";
            this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + "px";
        });

        this.sendBtn = inputContainer.createEl("button", { cls: "tutor-send-btn clickable-icon" });
        setIcon(this.sendBtn, "arrow-up");
        this.sendBtn.onclick = () => this.sendMessage();

        // Desktop only: Enter = send, Shift+Enter = newline
        // Mobile: Enter = newline, tap send button
        if (Platform.isDesktop) {
            this.inputEl.addEventListener("keypress", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        container.addClass("tutor-container");
    }

    private setInputEnabled(enabled: boolean) {
        this.inputEl.disabled = !enabled;
        this.sendBtn.disabled = !enabled;
    }

    private async advanceToNextTopic() {
        this.currentTopicIndex++;
        this.conversation = [];
        await this.startTopicReview();
    }

    private async startTopicReview() {
        this.setInputEnabled(false);
        this.addTopicSeparator(this.getCurrentTopic()!);
        const result = await this.fetchTutorResponse();
        if (result && result.rating !== null) {
            await this.saveRatingAndAdvance(result.rating);
        } else if (result) {
            this.setInputEnabled(true);
        }
    }

    private getSystemPrompt() {
        const currentTopic = this.getCurrentTopic();
        if (!currentTopic) return;

        return `You are conducting a spaced repetition review.
Keep the interaction quick: ask one focused question, get their answer,
then give one complete assessment.

## Context

Topic: ${currentTopic.name}
Their notes:
${currentTopic.content}

Don't reference what's in their notes or ask them to recall specific points
from the notes. Test whether they understand the concept, not whether they
remember what they wrote.

Last rating: ${currentTopic.rating ?? 'new'}

## Question Difficulty

Ask ONE focused question per review to test one concept or connection,
NOT multi-part scenarios.

- After Again/Hard: Easier question. Test prerequisites or fundamentals.
- After Good/Easy: Harder question. Applications, edge cases, novel connections.
- New topic: Gauge-level question that reveals depth of understanding.

## Assessment

Don't accept vague answers. In your response:
- State what's correct in their answer, then what needs correction
- When their answer reveals a misconception, show the gap between
  their mental model and the correct one
- Teach what they missed - give them the actual mental model, not just the fact
- Call out buzzwords used without clear explanations
- Rate their understanding

A "good" rating means they explained the reasoning, not just stated the
conclusion. They should show why something is true or how it works, not
just that it is.

## Ratings

again: Fundamental gaps, couldn't articulate basics
hard: Partial understanding, missing key connections
good: Solid grasp with minor gaps, explained it clearly
easy: Deep understanding, handled edge cases, made connections independently

Rate based only on what they demonstrated in their answer.

## Writing Style

Write like a knowledgeable peer, not documentation. Be direct. Skip:
- Metacommentary about their answer or your teaching ("you've nailed",
  "here's the key point", "the insight you demonstrated")
- Preambles explaining what you're about to do
- Summarizing what you just said
- Bullet points unless they genuinely clarify structure

Be concise but complete. Teach what's necessary to correct their
understanding, then stop. Don't elaborate beyond the gap or pose
follow-up questions.

Don't use em-dashes.
Format in Markdown; use LaTeX for math.

The question must be self-contained and focused on "${currentTopic.name}".
Ask exactly one question. Not multiple questions, not "part A/B", not
"first X, then Y". One question.

Grade immediately after they give you a response, DO NOT ask follow-ups,
take their answer as final - it's what they gave you.`;
    }

    private async fetchTutorResponse(): Promise<{ message: string; rating: Rating | null } | null> {
        try {
            const messages = [{ role: "system", content: this.getSystemPrompt() }];

            for (const msg of this.conversation) {
                const role = msg.sender === "Tutor" ? "assistant" : "user";
                const content = msg.content;
                messages.push({ role, content });
            }

            const response = await this.llmProvider.complete(messages, TUTOR_RESPONSE_SCHEMA);
            const parsed = JSON.parse(response);

            this.conversation.push({
                sender: "Tutor",
                content: parsed.message,
            });
            await this.addMessageToUI("Tutor", parsed.message);

            return { message: parsed.message, rating: parsed.rating?.toLowerCase() as Rating ?? null };
        } catch (error) {
            this.setInputEnabled(false);
            this.addErrorToUI("Error: " + error.message);
            return null;
        }
    }

    private async handleTurn() {
        if (this.isWaitingForAI) return;
        this.isWaitingForAI = true;
        this.setInputEnabled(false);

        try {
            const result = await this.fetchTutorResponse();
            if (result && result.rating !== null) {
                await this.saveRatingAndAdvance(result.rating);
            } else if (result) {
                this.setInputEnabled(true);
            }
        } finally {
            this.isWaitingForAI = false;
        }
    }

    private async saveRatingAndAdvance(rating: Rating) {
        const currentTopic = this.getCurrentTopic();
        await this.plugin.topicManager.updateTopicInNote(currentTopic!, rating);

        if (this.currentTopicIndex < this.topics.length - 1) {
            await this.advanceToNextTopic();
        } else {
            this.setInputEnabled(false);
            await this.addMessageToUI("Tutor", "That's everything for today. Good work!");
        }
    }

    async addMessageToUI(sender: "You" | "Tutor", content: string) {
        const cls = sender === "You" ? "tutor-message tutor-message--user" : "tutor-message tutor-message--tutor";
        const messageEl = this.conversationEl.createEl("div", { cls });

        const headerEl = messageEl.createEl("div", { cls: "tutor-message-header" });
        headerEl.createEl("span", { text: sender, cls: "tutor-message-sender" });

        const copyBtn = headerEl.createEl("button", { cls: "tutor-copy-btn clickable-icon" });
        setIcon(copyBtn, "copy");
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(content);
            setIcon(copyBtn, "check");
            setTimeout(() => setIcon(copyBtn, "copy"), 1500);
        };

        // Render message
        const contentEl = messageEl.createEl("div");
        await MarkdownRenderer.render(this.app, content, contentEl, "", this);

        // Scroll to bottom
        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    private addErrorToUI(message: string) {
        this.conversationEl.createEl("div", { text: message, cls: "tutor-error" });
        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    private addTopicSeparator(topic: TopicCard) {
        this.conversationEl.createEl("div", { cls: "tutor-separator" }, (el) => {
            el.createEl("div", { cls: "tutor-separator-line" });
            el.createEl("span", { text: topic.name });
            el.createEl("div", { cls: "tutor-separator-line" });
        });
    }

    async sendMessage() {
        const message = this.inputEl.value.trim();
        if (!message || this.isWaitingForAI) return;

        // Add user message to conversation
        this.conversation.push({
            sender: "You",
            content: message,
        });
        await this.addMessageToUI("You", message);
        this.inputEl.value = "";
        this.inputEl.style.height = "";

        // Get AI response
        await this.handleTurn();
    }

    async onClose() {}
}
