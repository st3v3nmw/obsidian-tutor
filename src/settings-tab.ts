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
            .setName("AI Provider")
            .setDesc("Choose your AI provider")
            .addDropdown(dropdown => dropdown
                .addOption("openrouter", "OpenRouter")
                .addOption("claude", "Claude (Coming Soon)")
                .setValue(this.plugin.settings.provider)
                .onChange(async (value: "openrouter" | "claude") => {
                    this.plugin.settings.provider = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName("API Key")
            .setDesc(`Your ${this.plugin.settings.provider} API key`)
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        if (this.plugin.settings.provider === "openrouter") {
            new Setting(containerEl)
                .setName("OpenRouter Model")
                .setDesc("Model to use for conversations")
                .addText(text => text
                    .setPlaceholder("anthropic/claude-3.5-sonnet")
                    .setValue(this.plugin.settings.openrouterModel)
                    .onChange(async (value) => {
                        this.plugin.settings.openrouterModel = value;
                        await this.plugin.saveSettings();
                    }));
        }
    }
}
