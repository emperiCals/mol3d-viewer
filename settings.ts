import { App, PluginSettingTab, Setting } from "obsidian";
import type Mol3DViewerMobile from "./main";

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
        
        containerEl.createEl("h2", { text: "尺寸与对齐设置" });
        new Setting(containerEl)
            .setName("块宽度")
            .addText(t => t
                .setValue(this.plugin.settings.blockWidth)
                .onChange(async v => { 
                    this.plugin.settings.blockWidth = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName("块高度")
            .addText(t => t
                .setValue(this.plugin.settings.blockHeight)
                .onChange(async v => { 
                    this.plugin.settings.blockHeight = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        containerEl.createEl("h2", { text: "边框样式设置" });
        new Setting(containerEl)
            .setName("边框宽度")
            .addText(t => t
                .setValue(this.plugin.settings.borderWidth)
                .onChange(async v => { 
                    this.plugin.settings.borderWidth = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName("边框颜色")
            .addColorPicker(cp => cp
                .setValue(this.plugin.settings.borderColor.startsWith('var') ? '#cccccc' : this.plugin.settings.borderColor)
                .onChange(async v => { 
                    this.plugin.settings.borderColor = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        containerEl.createEl("h2", { text: "分子背景设置" });
        new Setting(containerEl)
            .setName("启用透明背景")
            .setDesc("开启后将忽略背景颜色设置")
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
                .setName("背景颜色")
                .addColorPicker(cp => cp
                    .setValue(this.plugin.settings.backgroundColor)
                    .onChange(async v => {
                        this.plugin.settings.backgroundColor = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        containerEl.createEl("h2", { text: "格式默认风格" });
        const styleOptions: Record<string, string> = { "stick": "Stick", "sphere": "Sphere", "line": "Line", "cartoon": "Cartoon (光谱色)" };
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