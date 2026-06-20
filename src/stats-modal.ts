import { App, Modal } from "obsidian";

import { CardManager } from "src/card-manager";
import { ReviewCard } from "src/types";

interface Sums {
    cards: number;
    due: number;
    recallSum: number;
    recallCount: number;
    stabilitySum: number;
    difficultySum: number;
}

interface TreeNode {
    name: string;
    isFile: boolean;
    sums: Sums;
    children: Map<string, TreeNode>;
}

function emptySums(): Sums {
    return { cards: 0, due: 0, recallSum: 0, recallCount: 0, stabilitySum: 0, difficultySum: 0 };
}

export class StatsModal extends Modal {
    private cardManager: CardManager;

    constructor(app: App, cardManager: CardManager) {
        super(app);
        this.cardManager = cardManager;
    }

    async onOpen() {
        this.modalEl.addClass("tutor-stats-modal");
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("div", { cls: "tutor-stats-title", text: "Statistics" });

        const cards = await this.cardManager.getAllCards();
        if (cards.length === 0) {
            contentEl.createEl("p", { text: "No cards found." });
            return;
        }

        const root = this.buildTree(cards);
        const container = contentEl.createEl("div", { cls: "tutor-stats-container" });
        this.addHeaderRow(container);

        const body = container.createEl("div", { cls: "tutor-stats-body" });
        this.renderChildren(body, root, 0);
        this.addRow(container, "ALL", root.sums, 0, false).addClass("tutor-stats-total-row");
    }

    private buildTree(cards: ReviewCard[]): TreeNode {
        const now = new Date();
        const root: TreeNode = { name: "", isFile: false, sums: emptySums(), children: new Map() };

        for (const card of cards) {
            const parts = card.file.path.split("/");
            let node = root;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isFile = i === parts.length - 1;
                if (!node.children.has(part)) {
                    node.children.set(part, {
                        name: isFile ? card.file.basename : part,
                        isFile,
                        sums: emptySums(),
                        children: new Map(),
                    });
                }
                node = node.children.get(part)!;
            }

            const elapsed = Math.max(0, (now.getTime() - card.nextReview.getTime()) / 86400000 + card.interval);
            node.sums.cards++;
            if (card.nextReview <= now) node.sums.due++;
            if (card.state !== "new") {
                node.sums.recallSum += Math.pow(1 + (19 / 81) * elapsed / card.stability, -0.5);
                node.sums.recallCount++;
                node.sums.stabilitySum += card.stability;
                node.sums.difficultySum += card.difficulty;
            }
        }

        this.rollUp(root);
        return root;
    }

    private rollUp(node: TreeNode): Sums {
        if (node.isFile || node.children.size === 0) return node.sums;

        node.sums = emptySums();
        for (const child of node.children.values()) {
            const s = this.rollUp(child);
            node.sums.cards += s.cards;
            node.sums.due += s.due;
            node.sums.recallSum += s.recallSum;
            node.sums.recallCount += s.recallCount;
            node.sums.stabilitySum += s.stabilitySum;
            node.sums.difficultySum += s.difficultySum;
        }

        return node.sums;
    }

    private addHeaderRow(parent: HTMLElement) {
        const row = parent.createEl("div", { cls: "tutor-stats-row tutor-stats-header-row" });
        row.createEl("span", { cls: "tutor-stats-name tutor-stats-col-header", text: "Name" });

        for (const label of ["Cards", "Due", "Recall", "Stability", "Difficulty"]) {
            row.createEl("span", { cls: "tutor-stats-col tutor-stats-col-header", text: label });
        }
    }

    private addRow(parent: HTMLElement, label: string, sums: Sums, depth: number, isFolder: boolean): HTMLElement {
        const tag = isFolder ? "summary" : "div";
        const el = parent.createEl(tag, { cls: "tutor-stats-row" + (isFolder ? " tutor-stats-folder-row" : "") });

        const nameEl = el.createEl("span", { cls: "tutor-stats-name" });
        nameEl.style.paddingLeft = `${depth * 16}px`;
        if (isFolder) nameEl.createEl("span", { cls: "tutor-folder-arrow" });
        nameEl.createEl("span", { text: label });

        const recall = sums.recallCount > 0 ? `${Math.round(sums.recallSum / sums.recallCount * 100)}%` : "_";
        const stability = sums.recallCount > 0 ? `${(sums.stabilitySum / sums.recallCount).toFixed(1)}d` : "_";
        const difficulty = sums.recallCount > 0 ? (sums.difficultySum / sums.recallCount).toFixed(1) : "_";

        el.createEl("span", { cls: "tutor-stats-col", text: String(sums.cards) });
        el.createEl("span", { cls: "tutor-stats-col", text: String(sums.due) });
        el.createEl("span", { cls: "tutor-stats-col", text: recall });
        el.createEl("span", { cls: "tutor-stats-col", text: stability });
        el.createEl("span", { cls: "tutor-stats-col", text: difficulty });

        return el;
    }

    private sortedChildren(node: TreeNode): TreeNode[] {
        return Array.from(node.children.values()).sort((a, b) => {
            if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
    }

    private renderChildren(parent: HTMLElement, node: TreeNode, depth: number) {
        for (const child of this.sortedChildren(node)) {
            this.renderNode(parent, child, depth);
        }
    }

    private renderNode(parent: HTMLElement, node: TreeNode, depth: number) {
        if (node.isFile) {
            this.addRow(parent, node.name, node.sums, depth, false);
            return;
        }

        const details = parent.createEl("details");
        this.addRow(details, node.name, node.sums, depth, true);
        this.renderChildren(details, node, depth + 1);
    }

    onClose() {
        this.contentEl.empty();
    }
}
