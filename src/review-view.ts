import { ItemView, MarkdownRenderer, Platform, setIcon, WorkspaceLeaf } from "obsidian";

import { OpenRouterProvider } from "src/llm-provider";
import TutorPlugin from "src/main";
import { Rating, ReviewCard } from "src/types";

export const VIEW_TYPE_REVIEW = "tutor-review";

const TUTOR_SCHEMA = {
    type: "json_schema",
    json_schema: {
        name: "tutor",
        strict: true,
        schema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "Response in Markdown.",
                },
                rating: {
                    enum: ["again", "hard", "good", "easy", null],
                    description: "Rating on grading turns, null for follow-ups.",
                },
                suggested_answer: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                    description: "Improved rubric text sourced from the user's answer, or null.",
                },
            },
            required: ["message", "rating", "suggested_answer"],
            additionalProperties: false,
        },
    },
};

function computeDiff(a: string, b: string): { type: "same" | "add" | "remove"; text: string }[] {
    const aLines = a.split("\n");
    const bLines = b.split("\n");
    const m = aLines.length;
    const n = bLines.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = aLines[i - 1] === bLines[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    const result: { type: "same" | "add" | "remove"; text: string }[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
            result.push({ type: "same", text: aLines[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.push({ type: "add", text: bLines[j - 1] });
            j--;
        } else {
            result.push({ type: "remove", text: aLines[i - 1] });
            i--;
        }
    }

    return result.reverse();
}

export class ReviewView extends ItemView {
    private plugin: TutorPlugin;
    private cards: ReviewCard[] = [];
    private currentCardIndex = 0;
    private conversation: { sender: string; content: string }[] = [];
    private conversationEl: HTMLElement;
    private inputEl: HTMLTextAreaElement;
    private sendBtn: HTMLButtonElement;
    private isWaitingForAI = false;
    private followUpCount = 0;
    private llmProvider: OpenRouterProvider;

    constructor(leaf: WorkspaceLeaf, plugin: TutorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_REVIEW; }
    getDisplayText() { return "Tutor"; }
    getIcon() { return "brain-circuit"; }

    async setState(state: any, result: any) {
        if (state.cards) await this.loadCards(state.cards);
        return super.setState(state, result);
    }

    getState() {
        return { cards: this.cards, currentCardIndex: this.currentCardIndex };
    }

    async loadCards(cards: ReviewCard[]) {
        this.cards = cards;
        this.currentCardIndex = 0;
        this.conversation = [];

        await this.render();
        this.initializeLLMProvider();
        if (this.getCurrentCard()) await this.startCardReview();
    }

    private getCurrentCard(): ReviewCard | null {
        return this.cards[this.currentCardIndex] ?? null;
    }

    private initializeLLMProvider() {
        const { apiKey, model } = this.plugin.settings;
        this.llmProvider = new OpenRouterProvider(apiKey, model);
    }

    async onOpen() {}

    async render() {
        const container = this.containerEl.children[1];
        container.empty();

        if (!this.getCurrentCard()) {
            container.createEl("p", { text: "No cards available for review." });
            return;
        }

        this.conversationEl = container.createEl("div", { cls: "tutor-conversation" });

        const inputContainer = container.createEl("div", { cls: "tutor-input-area" });
        this.inputEl = inputContainer.createEl("textarea", {
            attr: { rows: 1, placeholder: "Reply…" },
        });
        this.inputEl.addEventListener("input", () => {
            this.inputEl.style.height = "auto";
            this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + "px";
        });

        this.sendBtn = inputContainer.createEl("button", { cls: "tutor-send-btn clickable-icon" });
        setIcon(this.sendBtn, "arrow-up");
        this.sendBtn.onclick = () => this.sendMessage();

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

    private getSystemPrompt(mustGrade: boolean): string {
        const card = this.getCurrentCard()!;
        return `\
You are grading a spaced repetition response. The question has already
been presented; you are seeing the user's answer.

## Card

Question: ${card.question}

Rubric (the only ground truth, never use your own knowledge):
${card.answer}

## Grading

Use the rubric to understand what the card is about and what aspects
matter. Your own knowledge is the factual authority. The rubric may
be incomplete or wrong. If the rubric states something factually
incorrect, do not grade the user on that claim and do not rationalize
it into correctness — flag the error in suggested_answer instead.

You may ask at most 2 clarifying follow-ups if the response is too
ambiguous to grade. After that you must grade.

Ratings:
- again: couldn't cover the core claims
- hard: got the gist but the explanation was incomplete or muddled
- good: clearly explained, showed the reasoning behind each claim
- easy: explained it so cleanly and precisely that nothing was left
  implicit

## Suggested answer

If the answer could be improved, you may propose an updated rubric
via suggested_answer. You may draw on your own knowledge here. Write
it as prose expressing reasoning, not a list of conclusions. Leave it
null if the rubric already covers the concept well.

## Style

Write like a knowledgeable peer. Be information dense: cover what
matters, skip what doesn't, no hedges or caveats.

Prose over lists. Vary sentence length: short sentences land hard,
longer ones build and release. If there's an insight, deliver it
rather than performing it.

No em-dashes or double hyphens. No preamble, no metacommentary. No
closing questions or CTAs. When you're done, stop.

Avoid AI vocabulary: pivotal, robust, foster, showcase, underscore,
delve, bolster, meticulous, crucial, testament, enhance, highlight
(as verb), and similar words that assert without demonstrating.

Avoid structural AI patterns: "not just X but also Y" parallelisms,
the rule of three used to fake comprehensiveness, trailing
participles that gesture at significance.

Write in American English. Format in Markdown.
${mustGrade ? "\nThis is your final turn. You must emit a rating now." : ""}`;
    }

    private async fetchTutorResponse(): Promise<{ message: string; rating: Rating | null; suggested_answer: string | null } | null> {
        try {
            const mustGrade = this.followUpCount >= 2;
            const messages: { role: string; content: string }[] = [
                { role: "system", content: this.getSystemPrompt(mustGrade) },
            ];
            for (const msg of this.conversation) {
                messages.push({
                    role: msg.sender === "Tutor" ? "assistant" : "user",
                    content: msg.content,
                });
            }

            const response = await this.llmProvider.complete(messages, TUTOR_SCHEMA);
            const parsed = JSON.parse(response);

            this.conversation.push({ sender: "Tutor", content: parsed.message });
            await this.addMessageToUI("Tutor", parsed.message);

            return {
                message: parsed.message,
                rating: parsed.rating?.toLowerCase() as Rating ?? null,
                suggested_answer: parsed.suggested_answer ?? null,
            };
        } catch (error) {
            this.addErrorToUI("Error: " + error.message);
            return null;
        }
    }

    private async startCardReview() {
        this.followUpCount = 0;
        this.addCardSeparator();
        const card = this.getCurrentCard()!;
        this.conversation.push({ sender: "Tutor", content: card.question });
        await this.addMessageToUI("Tutor", card.question);
        this.setInputEnabled(true);
    }

    private async handleTurn() {
        if (this.isWaitingForAI) return;
        this.isWaitingForAI = true;
        this.setInputEnabled(false);

        const result = await this.fetchTutorResponse();
        this.isWaitingForAI = false;

        if (!result) return;

        if (result.rating !== null) {
            if (result.suggested_answer) {
                this.showSuggestedAnswerPanel(this.getCurrentCard()!, result.suggested_answer);
            }
            await this.saveRatingAndAdvance(result.rating);
        } else {
            this.followUpCount++;
            this.setInputEnabled(true);
        }
    }

    private async saveRatingAndAdvance(rating: Rating) {
        await this.plugin.cardManager.updateCardInNote(this.getCurrentCard()!, rating);
        this.currentCardIndex++;
        this.conversation = [];
        if (this.getCurrentCard()) {
            await this.startCardReview();
        } else {
            this.setInputEnabled(false);
            await this.addMessageToUI("Tutor", "That's everything for today. Good work!");
        }
    }

    private showSuggestedAnswerPanel(card: ReviewCard, suggested: string) {
        const panel = this.conversationEl.createEl("div", { cls: "tutor-suggestion" });
        panel.createEl("div", { cls: "tutor-suggestion-header", text: "Suggested rubric update" });

        const diffEl = panel.createEl("div", { cls: "tutor-suggestion-diff" });
        for (const { type, text } of computeDiff(card.answer, suggested)) {
            const lineEl = diffEl.createEl("div", { cls: `tutor-diff-line tutor-diff-${type}` });
            lineEl.createEl("span", { cls: "tutor-diff-marker", text: type === "add" ? "+ " : type === "remove" ? "- " : "  " });
            lineEl.createEl("span", { text });
        }

        const btnRow = panel.createEl("div", { cls: "tutor-suggestion-buttons" });

        const updateBtn = btnRow.createEl("button", { text: "Update", cls: "mod-cta" });
        updateBtn.onclick = async () => {
            await this.plugin.cardManager.updateAnswerInNote(card, suggested);
            panel.remove();
        };

        btnRow.createEl("button", { text: "Dismiss" }).onclick = () => panel.remove();

        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    async addMessageToUI(sender: "You" | "Tutor", content: string) {
        const cls = sender === "You"
            ? "tutor-message tutor-message--user"
            : "tutor-message tutor-message--tutor";
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

        const contentEl = messageEl.createEl("div");
        await MarkdownRenderer.render(this.app, content, contentEl, "", this);

        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    private addErrorToUI(message: string) {
        this.conversationEl.createEl("div", { text: message, cls: "tutor-error" });
        this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
    }

    private addCardSeparator() {
        this.conversationEl.createEl("div", { cls: "tutor-separator" });
    }

    async sendMessage() {
        const message = this.inputEl.value.trim();
        if (!message || this.isWaitingForAI) return;

        this.conversation.push({ sender: "You", content: message });
        await this.addMessageToUI("You", message);
        this.inputEl.value = "";
        this.inputEl.style.height = "";

        await this.handleTurn();
    }

    async onClose() {}
}
