import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf } from "obsidian";

import { LLMProvider, OpenRouterProvider } from "src/llm-provider";
import TutorPlugin from "src/main";
import { TopicCard } from "src/types";

export const VIEW_TYPE_REVIEW = "tutor-review";

export class ReviewView extends ItemView {
    private plugin: TutorPlugin;
    private topics: TopicCard[] = [];
    private currentTopicIndex = 0;
    private conversation: { sender: string; content: string }[] = [];
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
        const currentTopic = this.topics[this.currentTopicIndex];
        return currentTopic ? `Tutor: ${currentTopic.file.basename}` : "Tutor";
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
        this.initializeLLMProvider();
        await this.render();
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
        const { provider, apiKey, openrouterModel } = this.plugin.settings;
        if (provider === "openrouter") {
            this.llmProvider = new OpenRouterProvider(apiKey, openrouterModel);
        } else {
            throw new Error("Unsupported provider: " + provider);
        }
    }

    async onOpen() {
        // Initial render will happen in setState
    }

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

        this.inputEl.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Make container flex
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

        titleEl.createEl("p", {
            text: `From: ${currentTopic.file.basename}`,
            attr: { style: "margin: 0; color: var(--text-muted); font-size: 0.9em;" }
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

        // Disable if waiting for AI or if it"s the last topic and not finished
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
            this.updateHeader();
            await this.callAI();
        } else {
            // Finished all topics
            await this.addMessageToUI("System", "🎉 All topics reviewed! Great job! You can close this tab.");
        }
    }

    private getSystemPrompt() {
        const currentTopic = this.getCurrentTopic();
        if (!currentTopic) return;

        return `
You are an adaptive learning tutor conducting spaced repetition reviews.
Your goal is to assess a user's understanding through conversational questioning, then build their knowledge through Socratic dialogue.

## Context
They're reviewing: "${currentTopic.name}" (last score: ${(currentTopic.score * 100).toFixed(0)}%)

Their notes:
${currentTopic.content}

## Adaptive Questioning Strategy
- 80-100%: Start with challenging applications, edge cases, or synthesis questions
- 60-79%: Start with solid foundational questions, then build complexity
- 40-59%: Start with basic topics, use examples and analogies
- 20-39%: Start with very simple explanations, build slowly
- 0-19%: Consider if prerequisites are missing, start ultra-basic

## Guidelines
- Questions MUST be understandable in isolation - assume users DO NOT remember their notes verbatim
- Build understanding progressively - let them level up in future reviews
- Focus on topicual grasp over factual recall
- When you're confident in your assessment (after 3-5 exchanges), end with a score
- Limit the conversation to the given topic - DO NOT go beyond
- Keep responses short but comprehensive
- The response MUST be JSON, use Markdown for the content & LaTeX for math

## Response Format
{
  "content": "Your question or response (use LaTeX for math)",
  "score": <0.0-1.0 or null if continuing>
}

Start with one engaging question appropriate for their level.
`;
    }

    async callAI() {
        if (this.isWaitingForAI) return;
        this.isWaitingForAI = true;
        this.updateNextButton();

        try {
            const messages = [{ role: "system", content: this.getSystemPrompt() }];

            // Add conversation history
            for (const msg of this.conversation) {
                const role = msg.sender === 'AI' ? 'assistant' : 'user';
                messages.push({ role, content: msg.content });
            }

            const response = await this.llmProvider.makeAPICall(messages);

            try {
                const parsed = JSON.parse(response);

                console.log(parsed);

                // Add tutor response to conversation
                this.conversation.push({ sender: "Tutor", content: parsed.content });
                await this.addMessageToUI("Tutor", parsed.content);

                // Check if tutor provided final score
                if (parsed.score !== null) {
                    const currentTopic = this.getCurrentTopic();
                    if (currentTopic) {
                        await this.plugin.topicManager.updateTopicInNote(currentTopic, parsed.score);
                        // Show completion message
                        await this.addMessageToUI("System", `✅ Review completed! Score: ${(parsed.score * 100).toFixed(0)}%. Click "Next Topic" to continue or review another topic.`);
                    }
                } else {
                    this.inputEl.focus();
                }
            } catch (e) {
                console.error("Tutor did not return valid JSON: ", response)

                this.conversation.push({ sender: "Tutor", content: response });
                await this.addMessageToUI("Tutor", response);
                this.inputEl.focus();
            }

        } catch (error) {
            new Notice("Error communicating with Tutor: " + error.message);
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

        // Create content container
        const contentEl = messageEl.createEl("div");

        // Render content as Markdown
        await MarkdownRenderer.renderMarkdown(content, contentEl, "", this);

        // Scroll to bottom
        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    async sendMessage() {
        const message = this.inputEl.value.trim();
        if (!message || this.isWaitingForAI) return;

        // Add user message to conversation
        this.conversation.push({ sender: "You", content: message });
        await this.addMessageToUI("You", message);
        this.inputEl.value = "";

        // Get AI response
        await this.callAI();
    }

    async onClose() {
        // Cleanup if needed
    }
}
