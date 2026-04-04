import { TextFileView, WorkspaceLeaf } from "obsidian";
import type Mol3DViewerMobile from "./main";

export const VIEW_TYPE_MOL3D = "mol3d-view";

export class Mol3DView extends TextFileView {
    plugin: Mol3DViewerMobile;
    viewContainer: HTMLDivElement;
    moleculeEl: HTMLDivElement;
    textPreviewEl: HTMLDivElement;

    constructor(leaf: WorkspaceLeaf, plugin: Mol3DViewerMobile) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { 
        return VIEW_TYPE_MOL3D; 
    }

    getDisplayText(): string { 
        return this.file ? this.file.name : "Mol3D Viewer"; 
    }

    getIcon(): string { 
        return "box"; 
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.viewContainer = this.contentEl.createDiv({ cls: "mol3d-view-container" });
        this.moleculeEl = this.viewContainer.createDiv({ cls: "mol3d-molecule-container" });
        this.textPreviewEl = this.viewContainer.createDiv({ cls: "mol3d-text-preview" });
    }

    setViewData(data: string, clear: boolean): void {
        this.data = data;
        if (this.file) {
            this.plugin.renderMolecule(this.moleculeEl, this.file.extension, data, "view");
        }
        this.textPreviewEl.setText(data);
    }

    getViewData(): string { 
        return this.data; 
    }

    clear(): void { 
        this.moleculeEl.empty(); 
        this.textPreviewEl.empty();
    }
}