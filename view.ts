import { TextFileView, WorkspaceLeaf } from "obsidian";
import type Mol3DViewerMobile from "./main";
import { FORMAT_REGISTRY } from "./formats";
import { t } from "./i18n";

export const VIEW_TYPE_MOL3D = "mol3d-view";

export class Mol3DView extends TextFileView {
    plugin: Mol3DViewerMobile;
    viewContainer: HTMLDivElement;
    moleculeEl: HTMLDivElement;
    textPreviewEl: HTMLDivElement;
    rawToggleEl: HTMLDivElement;

    constructor(leaf: WorkspaceLeaf, plugin: Mol3DViewerMobile) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { 
        return VIEW_TYPE_MOL3D; 
    }

    getDisplayText(): string { 
        return this.file ? this.file.name : t("views.displayName"); 
    }

    getIcon(): string { 
        return "box"; 
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.viewContainer = this.contentEl.createDiv({ cls: "mol3d-view-container" });
        this.moleculeEl = this.viewContainer.createDiv({ cls: "mol3d-molecule-container" });
        // 原始文本默认隐藏（覆盖式悬浮层，不参与布局），右下角按钮切换
        this.textPreviewEl = this.viewContainer.createDiv({ cls: "mol3d-text-preview" });
        this.textPreviewEl.style.display = "none";
        const toggleBtn = this.viewContainer.createDiv({ cls: "mol3d-raw-toggle" });
        toggleBtn.setText("</>");
        toggleBtn.title = t("views.toggleRaw");
        toggleBtn.addEventListener("click", () => {
            const el = this.textPreviewEl;
            el.style.display = el.style.display === "none" ? "block" : "none";
        });
        this.rawToggleEl = toggleBtn;
    }

    setViewData(data: string, clear: boolean): void {
        this.data = data;
        const ext = this.file?.extension.toLowerCase() ?? "";
        const info = FORMAT_REGISTRY[ext];
        const isBinary = !!info?.binary;
        const isTopology = info?.category === "topology";

        // 拓扑文件无可视化内容：不建 viewer，原始文本铺满视图（顶部带配对引导）
        this.moleculeEl.style.display = isTopology ? "none" : "";
        this.textPreviewEl.classList.toggle("mol3d-text-full", isTopology);
        this.textPreviewEl.style.display = isTopology ? "block" : (isBinary ? "none" : this.textPreviewEl.style.display);
        // raw 切换按钮只对有意义的文本预览显示（二进制无预览、拓扑已铺满）
        this.rawToggleEl.style.display = (isBinary || isTopology) ? "none" : "";
        this.textPreviewEl.setText(isTopology
            ? t("errors.topologyNeedsTrajectory") + "\n\n" + data
            : (isBinary ? "" : data));

        if (this.file && !isTopology) {
            const file = this.file;
            // 二进制格式（bcif/轨迹等）TextFileView 读出的文本无效，统一走插件按格式读取
            this.plugin.readMolFile(file).then(d =>
                this.plugin.renderMolecule(this.moleculeEl, file.extension, d, "view", this, file.path)
            );
        }
    }

    getViewData(): string { 
        return this.data; 
    }

    clear(): void { 
        this.moleculeEl.empty(); 
        this.textPreviewEl.empty();
    }
}