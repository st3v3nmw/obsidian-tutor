import { ItemView, MarkdownRenderer, Platform, WorkspaceLeaf } from "obsidian";

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
                    description: "Spaced repetition rating, or null to continue dialogue"
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
    private conversation: { sender: string; content: string; rawContent?: string }[] = [];
    private conversationEl: HTMLElement;
    private inputEl: HTMLTextAreaElement;
    private headerEl: HTMLElement;
    private nextBtn: HTMLButtonElement;
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
            await this.callAI();
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

        // Header
        this.headerEl = container.createEl("div", {
            attr: { style: "padding: 20px; border-bottom: 1px solid var(--background-modifier-border);" }
        });

        this.updateHeader();

        // Conversation area
        this.conversationEl = container.createEl("div", {
            cls: "tutor-conversation",
            attr: {
                style: "flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px;"
            }
        });

        // Input area
        const inputContainer = container.createEl("div", {
            attr: {
                style: "padding: 20px; border-top: 1px solid var(--background-modifier-border); display: flex; align-items: flex-end; gap: 10px;"
            }
        });

        this.inputEl = inputContainer.createEl("textarea", {
            placeholder: "Type your response...",
            attr: {
                rows: 4,
                style: "flex: 1; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px;",
            }
        });

        const sendBtn = inputContainer.createEl("button", {
            text: "Send",
            attr: { style: "padding: 8px 16px; border-radius: 4px;" }
        });
        sendBtn.onclick = () => this.sendMessage();

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

        container.setAttribute("style", "display: flex; flex-direction: column; height: 100%;");
    }

    private updateHeader() {
        if (!this.headerEl) return;

        this.headerEl.empty();
        const currentTopic = this.getCurrentTopic();
        if (!currentTopic) return;

        // Progress and title
        const progressEl = this.headerEl.createEl("div", {
            attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;" }
        });

        const titleEl = progressEl.createEl("div");
        titleEl.createEl("h2", {
            text: `${currentTopic.name}`,
            attr: { style: "margin: 0 0 5px 0;" }
        });

        // Add breadcrumb path
        const pathParts = currentTopic.file.path.replace(/\.md$/, '').split('/');
        const breadcrumb = pathParts.join(' > ');
        titleEl.createEl("div", {
            text: breadcrumb,
            attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-top: 2px;" }
        });

        // Navigation controls
        const navEl = progressEl.createEl("div", {
            attr: { style: "display: flex; align-items: center; gap: 10px;" }
        });

        // Progress indicator
        navEl.createEl("span", {
            text: `${this.currentTopicIndex + 1} of ${this.topics.length}`,
            attr: { style: "color: var(--text-muted); font-size: 0.9em;" }
        });

        // Next button
        this.nextBtn = navEl.createEl("button", {
            text: this.currentTopicIndex < this.topics.length - 1 ? "Next Topic" : "Finish",
            attr: { style: "padding: 6px 12px; border-radius: 4px; font-size: 0.9em;" }
        });

        this.nextBtn.onclick = () => this.nextTopic();

        // Disable if waiting for AI or if it's the last topic and not finished
        this.updateNextButton();
    }

    private updateNextButton() {
        if (!this.nextBtn) return;

        // Enable if waiting for AI to prevent spam
        this.nextBtn.disabled = this.isWaitingForAI;

        if (this.currentTopicIndex >= this.topics.length - 1) {
            this.nextBtn.textContent = "Finish";
        }
    }

    private async nextTopic() {
        if (this.currentTopicIndex < this.topics.length - 1) {
            this.currentTopicIndex++;
            this.conversation = [];
            this.conversationEl.empty();
            this.inputEl.disabled = false
            this.updateHeader();

            await this.callAI();
        } else {
            await this.addMessageToUI("System", "🎉 All topics reviewed! Great job!");
        }
    }


    private getSystemPrompt() {
        const currentTopic = this.getCurrentTopic();
        if (!currentTopic) return;

        return `You are an adaptive learning tutor conducting spaced repetition reviews.
Your goal is to assess understanding through a single focused exchange:
one question, one answer, one response that corrects, teaches, and rates.

## Context

Topic: ${currentTopic.name}

Their notes:

${currentTopic.content}

Your questions should test understanding and reasoning ability, not recall
of specific text.

Last rating: ${currentTopic.rating ?? 'new'}

## Format

1. Ask one well-chosen question
2. After they answer, respond with:
   - Direct assessment of what they got right and wrong
   - Clear explanation of anything they missed or got fuzzy, teaching the
      correct mental model
   - A rating

One exchange. No follow-ups. Your single response after their answer must
do all the teaching and correcting in one shot.

## Question Difficulty

Choose question difficulty based on their last rating:
- After Again/Hard: Ask an easier question. Check prerequisites, basic
  definitions, fundamental mechanisms.
- After Good/Easy: Ask a harder question. Applications, edge cases, synthesis,
  novel connections.
- New topic: Gauge-level question that reveals depth of understanding.

## Critical Assessment

Don't accept vague or incomplete answers. In your response:

- Call out buzzwords used without explaining mechanisms
- Correct unsupported claims or hand-waved details
- Fill in key nuances, trade-offs, or edge cases they missed
- Point out contradictions or fuzzy thinking

A "good" rating means they demonstrated clear reasoning, not that they
were in the right ballpark.

## Rating Levels

again: Fundamental gaps, couldn't articulate basics
hard: Partial understanding, missing key connections
good: Solid grasp with minor gaps, could explain most of it clearly
easy: Deep understanding, handled edge cases, made connections independently

## Rating Guidelines

Rate based on their answer as given. Don't give credit for what they
might know - only for what they demonstrated. Be honest but not punitive.

## Response Guidelines

- Questions must be self-contained; stay focused on the topic "${currentTopic.name}"
- Be concise but thorough in corrections
- When teaching, give them the mental model, not just the fact
- Format in Markdown; use LaTeX for math
- Always provide a rating in your response`;
    }

    async callAI() {
        if (this.isWaitingForAI) return;
        this.isWaitingForAI = true;
        this.updateNextButton();

        try {
            const messages = [{ role: "system", content: this.getSystemPrompt() }];

            // Add conversation history
            for (const msg of this.conversation) {
                const role = msg.sender === "Tutor" ? "assistant" : "user";
                const content = msg.rawContent || msg.content;
                messages.push({ role, content });
            }

            const response = await this.llmProvider.complete(messages, TUTOR_RESPONSE_SCHEMA);
            const parsed = JSON.parse(response);

            // Add tutor response to conversation
            this.conversation.push({
                sender: "Tutor",
                content: parsed.message,
                rawContent: response.trim()
            });
            await this.addMessageToUI("Tutor", parsed.message);

            // Check if tutor provided final rating
            if (parsed.rating !== null) {
                const currentTopic = this.getCurrentTopic();
                const normalizedRating = parsed.rating.toLowerCase() as Rating;
                await this.plugin.topicManager.updateTopicInNote(currentTopic!, normalizedRating);

                // Show completion message
                this.inputEl.disabled = true
                await this.addMessageToUI("System", "✅ Review completed!");
            }

        } catch (error) {
            this.inputEl.disabled = true
            await this.addMessageToUI("System", "Error: " + error.message);
        }

        this.isWaitingForAI = false;
        this.updateNextButton();
    }

    async addMessageToUI(sender: string, content: string) {
        const messageEl = this.conversationEl.createEl("div", {
            attr: {
                style: `padding: 15px; border-radius: 8px; max-width: 80%; ${sender === "You"
                    ? "background: var(--interactive-accent); color: var(--text-on-accent); align-self: flex-end; margin-left: auto;"
                    : sender === "System"
                        ? "background: var(--background-modifier-border); color: var(--text-muted); align-self: center; text-align: center; font-style: italic;"
                        : "background: var(--background-modifier-form-field); align-self: flex-start;"
                    }`
            }
        });

        if (sender !== "System") {
            messageEl.createEl("div", {
                text: sender,
                attr: {
                    style: "font-weight: bold; margin-bottom: 8px; font-size: 0.9em; opacity: 0.8;"
                }
            });
        }

        // Render message
        const contentEl = messageEl.createEl("div");
        await MarkdownRenderer.render(this.app, content, contentEl, "", this);

        // Scroll to bottom
        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    async sendMessage() {
        const message = this.inputEl.value.trim();
        if (!message || this.isWaitingForAI) return;

        // Add user message to conversation
        const rawUserMessage = `<student>\n  <message>${message}</message>\n</student>`;
        this.conversation.push({
            sender: "You",
            content: message,
            rawContent: rawUserMessage
        });
        await this.addMessageToUI("You", message);
        this.inputEl.value = "";

        // Get AI response
        await this.callAI();
    }

    async onClose() {}
}
