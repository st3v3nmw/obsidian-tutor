import { App, PluginSettingTab, Setting } from "obsidian";

import TutorPlugin from "src/main";

export class TutorSettingTab extends PluginSettingTab {
    plugin: TutorPlugin;

    constructor(app: App, plugin: TutorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Tutor Settings" });

        new Setting(containerEl)
            .setName("OpenRouter API Key")
            .setDesc("Your OpenRouter API key")
            .addText(text => text
                .setPlaceholder("sk-or-...")
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Model")
            .setDesc("Model to use for review sessions (must support structured outputs)")
            .addText(text => text
                .setPlaceholder("anthropic/claude-sonnet-4-6")
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                }));
    }
}
