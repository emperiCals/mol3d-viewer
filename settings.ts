import { App, PluginSettingTab, Setting } from "obsidian";
import type Mol3DViewerMobile from "./main";
import { t } from "./i18n";

export interface Mol3DPluginSettings {
    blockWidth: string;
    blockHeight: string;
    inlineWidth: string;
    inlineHeight: string;
    inlineAlign: string;
    borderWidth: string;
    borderColor: string;
    backgroundColor: string;
    isTransparent: boolean;
    styles: Record<string, string>;
}

export const DEFAULT_SETTINGS: Mol3DPluginSettings = {
    blockWidth: "100%",
    blockHeight: "400px",
    inlineWidth: "150px",
    inlineHeight: "120px",
    inlineAlign: "middle", 
    borderWidth: "1px",
    borderColor: "var(--background-modifier-border)",
    backgroundColor: "#000000",
    isTransparent: true,
    styles: { xyz: "stick", pdb: "cartoon", sdf: "sphere", mol2: "stick", cif: "line" }
};

export class Mol3DMobileSettingTab extends PluginSettingTab {
    plugin: Mol3DViewerMobile;

    constructor(app: App, plugin: Mol3DViewerMobile) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl("h2", { text: t("settings.sizeTitle") });
        new Setting(containerEl)
            .setName(t("settings.blockWidth"))
            .addText(t => t
                .setValue(this.plugin.settings.blockWidth)
                .onChange(async v => { 
                    this.plugin.settings.blockWidth = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName(t("settings.blockHeight"))
            .addText(t => t
                .setValue(this.plugin.settings.blockHeight)
                .onChange(async v => { 
                    this.plugin.settings.blockHeight = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        containerEl.createEl("h2", { text: t("settings.borderTitle") });
        new Setting(containerEl)
            .setName(t("settings.borderWidth"))
            .addText(t => t
                .setValue(this.plugin.settings.borderWidth)
                .onChange(async v => { 
                    this.plugin.settings.borderWidth = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName(t("settings.borderColor"))
            .addColorPicker(cp => cp
                .setValue(this.plugin.settings.borderColor.startsWith('var') ? '#cccccc' : this.plugin.settings.borderColor)
                .onChange(async v => { 
                    this.plugin.settings.borderColor = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        containerEl.createEl("h2", { text: t("settings.backgroundTitle") });
        new Setting(containerEl)
            .setName(t("settings.transparent"))
            .setDesc(t("settings.transparentDesc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.isTransparent)
                .onChange(async v => {
                    this.plugin.settings.isTransparent = v;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (!this.plugin.settings.isTransparent) {
            new Setting(containerEl)
                .setName(t("settings.backgroundColor"))
                .addColorPicker(cp => cp
                    .setValue(this.plugin.settings.backgroundColor)
                    .onChange(async v => {
                        this.plugin.settings.backgroundColor = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        containerEl.createEl("h2", { text: t("settings.styleTitle") });
        const styleOptions: Record<string, string> = { "stick": "Stick", "sphere": "Sphere", "line": "Line", "cartoon": t("settings.styleCartoon") };
        Object.keys(this.plugin.settings.styles).forEach(fmt => {
            new Setting(containerEl)
                .setName(fmt.toUpperCase())
                .addDropdown(drop => drop
                    .addOptions(styleOptions)
                    .setValue(this.plugin.settings.styles[fmt])
                    .onChange(async v => { 
                        this.plugin.settings.styles[fmt] = v; 
                        await this.plugin.saveSettings(); 
                    })
                );
        });
    }
}