import { App, Notice, TFile } from "obsidian";
import { Card, fsrs, Grade, Rating as FSRSRating, State } from "ts-fsrs";

import TutorPlugin from "src/main";
import { CardState, Rating, ReviewCard } from "src/types";

export class CardManager {
    private app: App;
    private plugin: TutorPlugin;
    private fsrsInstance = fsrs({
        request_retention: 0.9,
        enable_fuzz: true,
        enable_short_term: false,
    });

    constructor(app: App, plugin: TutorPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async getCardsForFile(file: TFile): Promise<ReviewCard[]> {
        const content = await this.app.vault.read(file);
        return this.parseCards(content, file);
    }

    async getAllCards(): Promise<ReviewCard[]> {
        const cards: ReviewCard[] = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            const content = await this.app.vault.read(file);
            cards.push(...this.parseCards(content, file));
        }

        return cards;
    }

    async getDueCards(): Promise<ReviewCard[]> {
        const all = await this.getAllCards();
        const now = new Date();
        return all.filter(c => c.nextReview <= now);
    }

    private parseCards(content: string, file: TFile): ReviewCard[] {
        const cards: ReviewCard[] = [];
        const lines = content.split("\n");
        const headingStack: { level: number; text: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const hMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
            if (hMatch) {
                const level = hMatch[1].length;
                while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
                    headingStack.pop();
                }

                headingStack.push({ level, text: hMatch[2].trim() });
            }

            const headerMatch = lines[i].match(/^>\s*\[!card\]\s*(.+)$/);
            if (!headerMatch) continue;

            const question = headerMatch[1].trim();
            const lineIndex = i;

            const bodyLines: string[] = [];
            let j = i + 1;
            while (j < lines.length && /^>/.test(lines[j])) {
                bodyLines.push(lines[j]);
                j++;
            }

            let nextReview = new Date(0);
            let rating: Rating | undefined;
            let interval = 1;
            let stability = 2.5;
            let difficulty = 5.0;
            let reps = 0;
            let state: CardState = "new";
            let spanLineIndex = -1;

            if (bodyLines.length > 0) {
                const last = bodyLines[bodyLines.length - 1];
                const spanMatch = last.match(/^>\s*<span class="tutor-state">([^<]+)<\/span>/);
                if (spanMatch) {
                    spanLineIndex = bodyLines.length - 1;
                    const parts = spanMatch[1].split(",");
                    if (parts.length >= 6) {
                        nextReview = new Date(parts[0]);
                        rating = parts[1] as Rating;
                        interval = parseInt(parts[2]);
                        stability = parseFloat(parts[3]);
                        difficulty = parseFloat(parts[4]);
                        reps = parseInt(parts[5]);
                        state = parts.length >= 7 ? (parts[6] as CardState) : "review";
                    }
                }
            }

            const answerLines = spanLineIndex >= 0
                ? bodyLines.slice(0, spanLineIndex)
                : bodyLines;
            const answer = answerLines.map(l => l.replace(/^>\s?/, "")).join("\n").trim();

            cards.push({ question, answer, file, lineIndex, headings: headingStack.map(h => h.text), nextReview, rating, interval, stability, difficulty, reps, state });
        }

        return cards;
    }

    private mapRating(rating: Rating): Grade {
        switch (rating) {
            case "again": return FSRSRating.Again;
            case "hard":  return FSRSRating.Hard;
            case "good":  return FSRSRating.Good;
            case "easy":  return FSRSRating.Easy;
        }
    }

    private toFSRSState(state: CardState): State {
        switch (state) {
            case "new":        return State.New;
            case "learning":   return State.Learning;
            case "review":     return State.Review;
            case "relearning": return State.Relearning;
        }
    }

    private fromFSRSState(state: State): CardState {
        switch (state) {
            case State.New:        return "new";
            case State.Learning:   return "learning";
            case State.Review:     return "review";
            case State.Relearning: return "relearning";
        }
    }

    private async loadBalance(fsrsDate: Date, scheduledDays: number): Promise<Date> {
        const window = Math.min(Math.floor(scheduledDays / 7), 3);
        if (window === 0) return fsrsDate;

        const allCards = await this.getAllCards();
        const counts = new Map<string, number>();
        for (const card of allCards) {
            const key = card.nextReview.toISOString().split("T")[0];
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        let bestDate = fsrsDate;
        let bestCount = counts.get(fsrsDate.toISOString().split("T")[0]) ?? 0;

        for (let offset = -window; offset <= window; offset++) {
            if (offset === 0) continue;

            const candidate = new Date(fsrsDate);
            candidate.setDate(candidate.getDate() + offset);
            const key = candidate.toISOString().split("T")[0];
            const count = counts.get(key) ?? 0;
            if (count < bestCount) {
                bestCount = count;
                bestDate = candidate;
            }
        }

        return bestDate;
    }

    async updateCardInNote(card: ReviewCard, newRating: Rating) {
        const fsrsCard: Card = {
            due: card.nextReview,
            stability: card.stability,
            difficulty: card.difficulty,
            elapsed_days: card.interval,
            scheduled_days: card.interval,
            learning_steps: 0,
            reps: card.reps,
            lapses: 0,
            state: this.toFSRSState(card.state),
        };

        const result = this.fsrsInstance.next(fsrsCard, new Date(), this.mapRating(newRating));
        const newCard = result.card;

        const scheduledDays = Math.max(1, newCard.scheduled_days);
        const due = await this.loadBalance(newCard.due, scheduledDays);
        const dueStr = due.toISOString().split("T")[0];
        const newState = this.fromFSRSState(newCard.state);

        const spanText = `${dueStr},${newRating},${scheduledDays},${newCard.stability.toFixed(1)},${newCard.difficulty.toFixed(1)},${newCard.reps},${newState}`;
        await this.writeSpan(card, `> <span class="tutor-state">${spanText}</span>`);
    }

    async updateAnswerInNote(card: ReviewCard, newAnswer: string) {
        const content = await this.app.vault.read(card.file);
        const lines = content.split("\n");

        const headerIdx = this.findHeader(lines, card.question);
        if (headerIdx < 0) return;

        const { bodyStart, bodyEnd, spanLine } = this.scanBody(lines, headerIdx);

        const answerLines = newAnswer.split("\n").map(l => `> ${l}`);
        const replacement = spanLine !== null ? [...answerLines, spanLine] : answerLines;
        lines.splice(bodyStart, bodyEnd - bodyStart, ...replacement);

        await this.app.vault.modify(card.file, lines.join("\n"));
    }

    private async writeSpan(card: ReviewCard, spanLine: string) {
        const content = await this.app.vault.read(card.file);
        const lines = content.split("\n");

        const headerIdx = this.findHeader(lines, card.question);
        if (headerIdx < 0) {
            new Notice(`Error: could not find card "${card.question}"`);
            return;
        }

        const { bodyEnd } = this.scanBody(lines, headerIdx);
        const lastBodyIdx = bodyEnd - 1;

        if (lastBodyIdx > headerIdx && /^>\s*<span class="tutor-state">/.test(lines[lastBodyIdx])) {
            lines[lastBodyIdx] = spanLine;
        } else {
            lines.splice(bodyEnd, 0, spanLine);
        }

        await this.app.vault.modify(card.file, lines.join("\n"));
    }

    private findHeader(lines: string[], question: string): number {
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^>\s*\[!card\]\s*(.+)$/);
            if (m && m[1].trim() === question) return i;
        }

        return -1;
    }

    private scanBody(lines: string[], headerIdx: number): { bodyStart: number; bodyEnd: number; spanLine: string | null } {
        const bodyStart = headerIdx + 1;
        let bodyEnd = bodyStart;
        while (bodyEnd < lines.length && /^>/.test(lines[bodyEnd])) bodyEnd++;

        let spanLine: string | null = null;
        if (bodyEnd > bodyStart && /^>\s*<span class="tutor-state">/.test(lines[bodyEnd - 1])) {
            spanLine = lines[bodyEnd - 1];
            // bodyEnd for answer purposes excludes span; callers use bodyEnd - 1 as span
        }

        return { bodyStart, bodyEnd, spanLine };
    }
}
