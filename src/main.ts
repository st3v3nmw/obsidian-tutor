import { Plugin, Notice } from "obsidian";

import { StatsModal } from "src/stats-modal";

import { CardManager } from "src/card-manager";
import { ReviewView, VIEW_TYPE_REVIEW } from "src/review-view";
import { DEFAULT_SETTINGS, TutorSettings, TutorSettingTab } from "src/settings-tab";
import { ReviewCard } from "src/types";

export default class TutorPlugin extends Plugin {
    settings: TutorSettings;
    cardManager: CardManager;

    async onload() {
        await this.loadSettings();
        this.cardManager = new CardManager(this.app, this);

        this.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewView(leaf, this));

        this.registerMarkdownPostProcessor((el) => {
            el.querySelectorAll<HTMLElement>('span.tutor-state').forEach((span) => {
                const parts = (span.textContent ?? "").trim().split(",");
                if (parts.length < 6) return;

                const [dueStr, , intervalStr, stabilityStr, difficultyStr] = parts;
                const [y, m, d] = dueStr.split("-").map(Number);
                const due = new Date(y, m - 1, d);
                const now = new Date();
                const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const diffDays = Math.round((due.getTime() - todayMidnight.getTime()) / 86400000);

                let dueLabel: string;
                if (diffDays < 0) dueLabel = `Due ${Math.abs(diffDays)}d ago`;
                else if (diffDays === 0) dueLabel = "Due today";
                else if (diffDays === 1) dueLabel = "Due tomorrow";
                else dueLabel = `Due in ${diffDays}d`;

                const stability = parseFloat(stabilityStr);
                const interval = parseInt(intervalStr);
                const difficulty = parseFloat(difficultyStr);

                // Elapsed days since last review (approximated as due - interval)
                const elapsed = Math.max(0, (now.getTime() - due.getTime()) / 86400000 + interval);
                const recall = Math.round(Math.pow(1 + (19 / 81) * elapsed / stability, -0.5) * 100);

                span.textContent = `${dueLabel} · Recall ${recall}% · Stability ${stability.toFixed(1)}d · Difficulty ${difficulty.toFixed(1)}`;
                span.addClass("tutor-state-badge");
            });
        });

        this.addRibbonIcon("brain-circuit", "Start Review Session", () => this.startReviewSession());

        this.addCommand({
            id: "tutor-start-review",
            name: "Start Review Session",
            callback: () => this.startReviewSession(),
        });

        this.addCommand({
            id: "tutor-show-due-cards",
            name: "Show Due Cards",
            callback: () => this.showDueCards(),
        });

        this.addCommand({
            id: "tutor-show-stats",
            name: "Show Statistics",
            callback: () => new StatsModal(this.app, this.cardManager).open(),
        });

        this.addCommand({
            id: "tutor-insert-card-callout",
            name: "Insert Card Callout",
            editorCallback(editor) {
                const cursor = editor.getCursor();
                editor.replaceSelection("> [!card] Question\n> Answer\n");
                editor.setSelection(
                    { line: cursor.line, ch: cursor.ch + 10 },
                    { line: cursor.line, ch: cursor.ch + 18 },
                );
            },
        });

        this.addSettingTab(new TutorSettingTab(this.app, this));

        console.log("Tutor plugin loaded");
    }

    onunload() {
        console.log("Tutor plugin unloaded");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async startReviewSession() {
        const dueCards = await this.cardManager.getDueCards();

        if (dueCards.length === 0) {
            new Notice("No cards due for review.");
            return;
        }

        // Group by file, then randomize groups and cards within each group
        const groups = new Map<string, ReviewCard[]>();
        for (const card of dueCards) {
            const key = card.file.path;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(card);
        }

        const groupList = Array.from(groups.values());
        groupList.sort(() => Math.random() - 0.5);
        for (const group of groupList) group.sort(() => Math.random() - 0.5);
        const ordered = groupList.flat();

        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0];
        if (leaf) {
            await (leaf.view as ReviewView).loadCards(ordered);
        } else {
            leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({ type: VIEW_TYPE_REVIEW, state: { cards: ordered } });
        }

        this.app.workspace.setActiveLeaf(leaf);
    }

    async showDueCards() {
        const dueCards = await this.cardManager.getDueCards();

        if (dueCards.length === 0) {
            new Notice("No cards due for review.");
            return;
        }

        const message = `Due for review (${dueCards.length}):\n\n` +
            dueCards.map(c => `• ${c.question} (${c.file.basename})`).join("\n");
        new Notice(message, 0);
    }

}
