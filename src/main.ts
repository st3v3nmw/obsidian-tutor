import { Plugin, Notice } from "obsidian";

import { ReviewView, VIEW_TYPE_REVIEW } from "src/review-view";
import { DEFAULT_SETTINGS, TutorSettings } from "src/settings";
import { TutorSettingTab } from "src/settings-tab";
import { TopicManager } from "src/topic-manager";

export default class TutorPlugin extends Plugin {
    settings: TutorSettings;
    topicManager: TopicManager;

    async onload() {
        await this.loadSettings();
        this.topicManager = new TopicManager(this.app, this);

        // Views
        this.registerView(
            VIEW_TYPE_REVIEW,
            (leaf) => new ReviewView(leaf, this)
        );

        // Ribbon Icons
        this.addRibbonIcon("brain-circuit", "Start Review Session", () => {
            this.startReviewSession();
        });

        // Commands
        this.addCommand({
            id: "start-review",
            name: "Start Review Session",
            callback: () => this.startReviewSession()
        });

        this.addCommand({
            id: "show-due-cards",
            name: "Show Due Cards",
            callback: () => this.showDueCards()
        });

        // Settings
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
        const dueTopics = await this.topicManager.getDueTopics();

        if (dueTopics.length === 0) {
            new Notice("No topics due for review.");
            return;
        }

        // Check if the review view is already open
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0];

        if (leaf) {
            // Use existing view and load new topics
            const view = leaf.view as ReviewView;
            await view.loadTopics(dueTopics);
        } else {
            // Create new view
            leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({
                type: VIEW_TYPE_REVIEW,
                state: { topics: dueTopics }
            });
        }

        this.app.workspace.setActiveLeaf(leaf);
    }

    async showDueCards() {
        const dueTopics = await this.topicManager.getDueTopics();

        if (dueTopics.length === 0) {
            new Notice("No topics due for review.");
            return;
        }

        const message = `Due for review (${dueTopics.length}):\n\n` +
            dueTopics.map(c => `• ${c.name} (${c.file.basename})`).join("\n");

        new Notice(message, 0);
    }
}
