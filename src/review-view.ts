import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";

import { LLMProvider, OpenRouterProvider } from "src/llm-provider";
import TutorPlugin from "src/main";
import { TopicCard } from "src/types";

export const VIEW_TYPE_REVIEW = "tutor-review";

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
        const currentTopic = this.topics[this.currentTopicIndex];
        return currentTopic ? currentTopic.file.basename : "Tutor";
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
            this.inputEl.disabled = false
            this.updateHeader();

            await this.callAI();
        } else {
            // Finished all topics
            await this.addMessageToUI("System", "🎉 All topics reviewed! Great job!");
        }
    }

    private parseXMLResponse(response: string): { message: string; rating: string | null } {
        const messageMatch = response.match(/<message>([\s\S]*?)<\/message>/);
        if (!messageMatch) {
            throw new Error("No <message> tag found in response");
        }

        const ratingMatch = response.match(/<rating>([\s\S]*?)<\/rating>/);
        if (!ratingMatch) {
            throw new Error("No <rating> tag found in response");
        }

        const ratingValue = ratingMatch[1].trim();
        const rating = ratingValue === "null" ? null : ratingValue;

        return {
            message: messageMatch[1].trim(),
            rating: rating
        };
    }

    private getSystemPrompt() {
        const currentTopic = this.getCurrentTopic();
        if (!currentTopic) return;

        return `You are an adaptive learning tutor conducting spaced repetition reviews.
Your goal is to assess understanding through conversational questioning while
helping build knowledge through Socratic dialogue and targeted feedback.

## Context

${currentTopic.name}

${currentTopic.content}

This is what they've been learning. Your questions should test understanding and
reasoning ability - NOT recall of specific text.

Last rating: ${currentTopic.rating || 'new'}

## Approach

This is formative assessment: you're testing AND teaching. Ask a question, evaluate
their response, provide nudges when they miss something, and let them refine their
understanding. The final rating reflects where they end up after your guidance.

## Rating Levels & Question Difficulty

again: Fundamental gaps, couldn't articulate basics even with scaffolding
- Questions: Check prerequisites, recall basic facts, start with definitions

hard: Partial understanding, needed significant guidance, missing key connections
- Questions: Core concepts with examples/analogies, build foundational understanding

good: Solid grasp with minor gaps, integrated nudges well, could explain most of it
- Questions: Applications, real-world connections, relationships between concepts

easy: Deep understanding, made connections independently, handled edge cases
- Questions: Complex analysis, synthesis, critique, edge cases, novel applications

Starting difficulty:
- After Again/Hard: Start easier to rebuild foundations
- After Good/Easy: Start harder to challenge them
- New topic: Start with a broad, open question to gauge their level, then adapt

## Rating Guidelines

When deciding on a rating, consider:
- Their initial response quality
- How readily they integrated your nudges

Someone who needed significant correction scores lower than someone who just
needed a small prompt to complete their thinking.

## Dialogue Guidelines

- Questions must be self-contained
- Be concise but thorough; stay focused on the topic
- Correct misunderstandings directly when needed
- End with a rating when confident (typically 4-8 exchanges)

## Response Format

<tutor>
  <message>Question, explanation, or feedback</message>
  <rating>again | hard | good | easy | null</rating>
</tutor>

- CRITICAL: The response MUST be in XML format
- CRITICAL: There MUST be no text outside (before or after) the XML tags
- The message field should be in Markdown; use LaTeX for math
- Set rating to null while continuing dialogue, provide rating when done

Start with one engaging question based on their last rating.`;
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

            const response = await this.llmProvider.complete(messages);

            try {
                const parsed = this.parseXMLResponse(response);

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
                    const normalizedRating = parsed.rating.toLowerCase() as "again" | "hard" | "good" | "easy";
                    await this.plugin.topicManager.updateTopicInNote(currentTopic!, normalizedRating);

                    // Show completion message
                    this.inputEl.disabled = true
                    await this.addMessageToUI("System", "✅ Review completed!");
                }
            } catch (parseError) {
                this.inputEl.disabled = true
                await this.addMessageToUI("System", "Error: Tutor did not return valid XML: " + response);
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

    async onClose() {
        // Cleanup if needed
    }
}
