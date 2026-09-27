import { App, PluginSettingTab, Setting } from "obsidian";
import type Mol3DViewerMobile from "./main";
import { FORMAT_REGISTRY } from "./formats";
import { t } from "./i18n";

export interface Mol3DPluginSettings {
    blockWidth: string;
    blockHeight: string;
    borderWidth: string;
    borderColor: string;
    backgroundColor: string;
    isTransparent: boolean;
    styles: Record<string, string>;
    // 渲染效果（对齐 Mol* Settings/Controls 面板）
    occlusion: boolean;
    shadow: boolean;
    outline: boolean;
    dof: boolean;
    fog: boolean;
    transparencyMode: string;   // blended / wboit / dpoit
    resolutionMode: string;     // auto / scaled / native
    pixelScale: number;
}

export const DEFAULT_SETTINGS: Mol3DPluginSettings = {
    blockWidth: "100%",
    blockHeight: "400px",
    borderWidth: "1px",
    borderColor: "var(--background-modifier-border)",
    backgroundColor: "#000000",
    isTransparent: true,
    occlusion: true,
    shadow: true,
    outline: true,
    dof: false,
    fog: false,
    transparencyMode: "wboit",
    resolutionMode: "auto",
    pixelScale: 1,
    styles: {
        // 独立结构格式
        xyz: "ball-and-stick", pdb: "cartoon", ent: "cartoon", sdf: "spacefill", sd: "spacefill",
        mol: "ball-and-stick", mol2: "ball-and-stick", cif: "line", mcif: "line", bcif: "cartoon",
        pdbqt: "ball-and-stick", pqr: "ball-and-stick", gro: "line",
        // 轨迹格式（需 topology/model 关键词配对或同目录同名文件自动配对）
        dcd: "line", xtc: "line", trr: "line", nc: "line", nctraj: "line", lammpstrj: "line",
        // 纯拓扑文件（仅作轨迹配对，直接打开显示引导提示，风格占位）
        psf: "line", prmtop: "line", parm7: "line", top: "line"
    }
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
        containerEl.createEl("h2", { text: t("settings.title") });

        containerEl.createEl("h3", { text: t("settings.sizeTitle") });
        new Setting(containerEl)
            .setName(t("settings.blockWidth"))
            .setDesc(t("settings.blockWidthDesc"))
            .addText(t => t
                .setValue(this.plugin.settings.blockWidth)
                .onChange(async v => {
                    this.plugin.settings.blockWidth = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("settings.blockHeight"))
            .setDesc(t("settings.blockHeightDesc"))
            .addText(t => t
                .setValue(this.plugin.settings.blockHeight)
                .onChange(async v => {
                    this.plugin.settings.blockHeight = v;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl("h3", { text: t("settings.borderTitle") });
        new Setting(containerEl)
            .setName(t("settings.borderWidth"))
            .setDesc(t("settings.borderWidthDesc"))
            .addText(t => t
                .setValue(this.plugin.settings.borderWidth)
                .onChange(async v => {
                    this.plugin.settings.borderWidth = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("settings.borderColor"))
            .setDesc(t("settings.borderColorDesc"))
            .addColorPicker(cp => cp
                .setValue(this.plugin.settings.borderColor.startsWith('var') ? '#cccccc' : this.plugin.settings.borderColor)
                .onChange(async v => {
                    this.plugin.settings.borderColor = v;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl("h3", { text: t("settings.backgroundTitle") });
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
                .setDesc(t("settings.backgroundColorDesc"))
                .addColorPicker(cp => cp
                    .setValue(this.plugin.settings.backgroundColor)
                    .onChange(async v => {
                        this.plugin.settings.backgroundColor = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        containerEl.createEl("h3", { text: t("settings.renderingTitle") });

        const effectToggles: Array<[keyof Mol3DPluginSettings, string, string]> = [
            ["occlusion", "settings.occlusion", "settings.occlusionDesc"],
            ["shadow", "settings.shadow", "settings.shadowDesc"],
            ["outline", "settings.outline", "settings.outlineDesc"],
            ["dof", "settings.dof", "settings.dofDesc"],
            ["fog", "settings.fog", "settings.fogDesc"],
        ];
        for (const [field, nameKey, descKey] of effectToggles) {
            new Setting(containerEl)
                .setName(t(nameKey))
                .setDesc(t(descKey))
                .addToggle(toggle => toggle
                    .setValue(!!this.plugin.settings[field])
                    .onChange(async v => {
                        (this.plugin.settings as any)[field] = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(containerEl)
            .setName(t("settings.transparencyMode"))
            .setDesc(t("settings.transparencyModeDesc"))
            .addDropdown(d => d
                .addOptions({ wboit: "WBOIT", blended: "Blended", dpoit: "DPOIT" })
                .setValue(this.plugin.settings.transparencyMode)
                .onChange(async v => {
                    this.plugin.settings.transparencyMode = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("settings.resolutionMode"))
            .setDesc(t("settings.resolutionModeDesc"))
            .addDropdown(d => d
                .addOptions({ auto: "Auto", scaled: "Scaled", native: "Native" })
                .setValue(this.plugin.settings.resolutionMode)
                .onChange(async v => {
                    this.plugin.settings.resolutionMode = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("settings.pixelScale"))
            .setDesc(t("settings.pixelScaleDesc"))
            .addSlider(s => s
                .setLimits(0.5, 2, 0.05)
                .setValue(this.plugin.settings.pixelScale)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.pixelScale = v;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl("h3", { text: t("settings.styleTitle") });
        const styleOptions: Record<string, string> = {
            "ball-and-stick": "Ball and Stick",
            "spacefill": "Spacefill",
            "line": "Line",
            "cartoon": t("settings.styleCartoon"),
            "gaussian-surface": "Gaussian Surface"
        };
        // 按类别分组展示，拓扑格式不参与渲染、不出现在风格设置里
        const groups: [string, string][] = [
            ["structure", t("settings.styleStructure")],
            ["trajectory", t("settings.styleTrajectory")],
        ];
        for (const [category, title] of groups) {
            const fmts = Object.keys(this.plugin.settings.styles)
                .filter(f => FORMAT_REGISTRY[f]?.category === category);
            if (fmts.length === 0) continue;
            containerEl.createEl("h3", { text: title });
            fmts.forEach(fmt => {
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

        // --- 关键词帮助表格 ---
        containerEl.createEl("h3", { text: t("settings.help.heading"), style: "margin-top: 30px;" });
        const helpDiv = containerEl.createDiv({ cls: "mol3d-settings-help" });

        const sections: Array<{ key: string; rows: Array<[string, string, string]> }> = [
            { key: "settings.help.sections.layout", rows: [
                ["width", "css", "settings.help.rows.width"],
                ["height", "css", "settings.help.rows.height"],
                ["title / 标题", "string", "settings.help.rows.title"],
            ]},
            { key: "settings.help.sections.appearance", rows: [
                ["style / 风格", "enum", "settings.help.rows.style"],
                ["bg / 背景", "color", "settings.help.rows.bg"],
                ["bc / 边框颜色", "color", "settings.help.rows.bc"],
                ["bw / 边框宽度", "css", "settings.help.rows.bw"],
                ["cell / 晶胞", "enum", "settings.help.rows.cell"],
            ]},
            { key: "settings.help.sections.trajectory", rows: [
                ["topology / 拓扑", "wikilink", "settings.help.rows.topology"],
                ["model / 结构", "wikilink", "settings.help.rows.model"],
            ]},
        ];

        let tableHtml = `
        <table class="mol3d-help-table">
            <thead>
                <tr>
                    <th>${t("settings.help.colKeyword")}</th>
                    <th>${t("settings.help.colType")}</th>
                    <th>${t("settings.help.colDesc")}</th>
                </tr>
            </thead>
            <tbody>`;
        for (const section of sections) {
            tableHtml += `\n                <tr class="section-header"><td colspan="3">${t(section.key)}</td></tr>`;
            for (const [keyword, type, rowKey] of section.rows) {
                tableHtml += `\n                <tr><td>${keyword}</td><td>${type}</td><td>${t(rowKey)}</td></tr>`;
            }
        }
        tableHtml += `
            </tbody>
        </table>
        `;
        helpDiv.innerHTML = tableHtml;
    }
}