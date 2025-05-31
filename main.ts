import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import { GrimoireSettings, DEFAULT_SETTINGS } from './settings';
import { GrimoireSettingTab } from './settings-tab';
import { ConceptManager } from './concept-manager';
import { ReviewView, VIEW_TYPE_REVIEW } from './review-view';

export default class GrimoirePlugin extends Plugin {
    settings: GrimoireSettings;
    conceptManager: ConceptManager;

    async onload() {
        await this.loadSettings();
        this.conceptManager = new ConceptManager(this.app, this);

        // Register the review view
        this.registerView(
            VIEW_TYPE_REVIEW,
            (leaf) => new ReviewView(leaf, this)
        );

        // Add ribbon icon
        this.addRibbonIcon('brain-circuit', 'Grimoire Review', () => {
            this.startReviewSession();
        });

        // Add commands
        this.addCommand({
            id: 'start-review',
            name: 'Start Review Session',
            callback: () => this.startReviewSession()
        });

        this.addCommand({
            id: 'show-due-cards',
            name: 'Show Due Cards',
            callback: () => this.showDueCards()
        });

        // Add settings tab
        this.addSettingTab(new GrimoireSettingTab(this.app, this));

        console.log('Grimoire plugin loaded');
    }

    onunload() {
        console.log('Grimoire plugin unloaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async startReviewSession() {
        const dueConcepts = await this.conceptManager.getDueConcepts();

        if (dueConcepts.length === 0) {
            new Notice('No concepts due for review!');
            return;
        }

        // Check if review view is already open
        const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0];

        if (existingLeaf) {
            // Use existing view and load new concepts
            const view = existingLeaf.view as ReviewView;
            await view.loadConcepts(dueConcepts);
            this.app.workspace.setActiveLeaf(existingLeaf);
        } else {
            // Create new view
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_REVIEW,
                state: { concepts: dueConcepts }
            });
            this.app.workspace.setActiveLeaf(leaf);
        }
    }

    async showDueCards() {
        const dueConcepts = await this.conceptManager.getDueConcepts();

        if (dueConcepts.length === 0) {
            new Notice('No concepts due for review!');
            return;
        }

        const message = `Due for review (${dueConcepts.length}):\n\n` +
            dueConcepts.map(c => `• ${c.name} (${c.file.basename})`).join('\n');

        new Notice(message, 5000);
    }
}
