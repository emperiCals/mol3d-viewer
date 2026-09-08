import { Plugin, MarkdownRenderChild, TFile, normalizePath, MarkdownPostProcessorContext, Component } from "obsidian";
import { DEFAULT_SETTINGS, Mol3DPluginSettings, Mol3DMobileSettingTab } from "./settings";
import { Mol3DView, VIEW_TYPE_MOL3D } from "./view";
import { initI18n, t } from "./i18n";

declare global {
    interface Window {
        $3Dmol: any;
    }
}

export default class Mol3DViewerMobile extends Plugin {
    settings: Mol3DPluginSettings;

    async onload() {
        await initI18n();
        await this.loadSettings();
        this.addSettingTab(new Mol3DMobileSettingTab(this.app, this));

        try {
            await this.injectDependency("3Dmol-min.js", "$3Dmol");
            
            try {
                this.registerView(
                    VIEW_TYPE_MOL3D,
                    (leaf) => new Mol3DView(leaf, this)
                );
            } catch (e) {
                console.log(`[Mol3D] View type ${VIEW_TYPE_MOL3D} already registered.`);
            }

            const formats = Object.keys(this.settings.styles);
            formats.forEach(ext => {
                try {
                    this.registerExtensions([ext], VIEW_TYPE_MOL3D);
                } catch (e) {
                    console.log(`[Mol3D] 扩展名 .${ext} 已被接管`);
                }
            });

            this.initProcessors();
            this.applySettings();
            
            console.log("Mol3D Viewer: 已开启文件关联与增强嵌入渲染");
        } catch (e) {
            console.error("Mol3D Viewer 加载失败", e);
        }
    }

    async injectDependency(fileName: string, globalVar: string): Promise<any> {
        return new Promise((resolve) => {
            if (window[globalVar as keyof Window]) return resolve(window[globalVar as keyof Window]);
            
            const loadCDN = () => {
                console.log(`[Mol3D] 尝试从 CDN 回退加载 3Dmol-min.js ...`);
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.4.0/3Dmol-min.js";
                script.type = "text/javascript";
                script.onload = () => resolve(window[globalVar as keyof Window]);
                script.onerror = () => resolve(null);
                document.head.appendChild(script);
            };

            try {
                const adapter = this.app.vault.adapter as any;
                const resourcePath = adapter.getResourcePath(normalizePath(this.manifest.dir + "/" + fileName));
                const script = document.createElement("script");
                script.src = resourcePath;
                script.type = "text/javascript";
                script.onload = () => resolve(window[globalVar as keyof Window]);
                script.onerror = loadCDN;
                document.head.appendChild(script);
            } catch (e) {
                loadCDN();
            }
        });
    }

    // 解析关键词功能：支持 Key:Value, Key=Value 以及中英文
    parseKeywords(content: string): { keywords: Record<string, any>, finalContent: string } {
        const parts = content.split(/^---$/m);
        let keywords: Record<string, any> = {};
        let finalContent = content;

        if (parts.length >= 2) {
            const keywordSection = parts[0].trim();
            finalContent = parts.slice(1).join("---").trim();
            
            const rawKeys = keywordSection.split(/[,，\n]/);
            rawKeys.forEach(raw => {
                const pair = raw.trim().split(/[:：=]/); 
                if (pair.length === 2) {
                    keywords[pair[0].trim().toLowerCase()] = pair[1].trim();
                } else if (pair[0].trim()) {
                    keywords[pair[0].trim().toLowerCase()] = true;
                }
            });
        }
        return { keywords, finalContent };
    }

    // 核心渲染函数
    async renderMolecule(parentContainer: HTMLElement, format: string, rawContent: string, isEmbed: boolean | string = false, child?: Component): Promise<any> {
        if (parentContainer.clientWidth === 0) {
            setTimeout(() => this.renderMolecule(parentContainer, format, rawContent, isEmbed), 200);
            return;
        }
        
        parentContainer.empty();
        
        if (!window.$3Dmol) {
            parentContainer.setText(t("errors.libNotLoaded"));
            return;
        }

        // 解析关键词和真正的数据
        const { keywords, finalContent } = this.parseKeywords(rawContent);

        const wrapper = parentContainer.createDiv({ cls: "mol3d-wrapper" });
        
        // 移动端适配逻辑
        const isMobileScreen = window.innerWidth <= 600;
        let finalWidth = keywords.width || this.settings.blockWidth;
        let finalHeight = keywords.height || this.settings.blockHeight;

        if (isMobileScreen && isEmbed !== "view") {
            finalWidth = "100%";
        }

        // 边框控制
        let finalBorderColor = keywords.bc || keywords['border-color'] || keywords.边框颜色 || this.settings.borderColor;
        let finalBorderWidth = keywords.bw || keywords['border-width'] || keywords.边框宽度 || this.settings.borderWidth;

        // 样式区分
        if (isEmbed === "view") {
            wrapper.style.border = "none";
            wrapper.style.borderRadius = "0";
            wrapper.style.height = "100%";
            wrapper.style.width = "100%";
        } else {
            wrapper.style.border = `${finalBorderWidth} solid ${finalBorderColor}`;
            wrapper.style.borderRadius = "var(--radius-m, 8px)";
            wrapper.style.height = finalHeight;
            wrapper.style.width = finalWidth;
            const isFullWidth = finalWidth.toString().trim() === "100%";
            wrapper.style.margin = isFullWidth ? "0" : "1em auto";
        }

        // 处理背景
        let renderBg = this.settings.backgroundColor;
        let renderTransparent = this.settings.isTransparent;
        if (keywords.bg || keywords.背景) {
            renderBg = keywords.bg || keywords.背景;
            renderTransparent = (renderBg === "transparent" || renderBg === "none");
        }
        wrapper.style.backgroundColor = renderTransparent ? "transparent" : renderBg;

        // 插入标题栏（如果在 wrapper 内部显示）
        const titleText = keywords.title || keywords.标题;
        if (titleText) {
            const titleBar = wrapper.createDiv({ cls: "mol3d-title-bar" });
            titleBar.setText(titleText);
        }

        // 插入画布容器
        const canvasArea = wrapper.createDiv({ cls: "mol3d-canvas-area" });

        // 3Dmol 不认 'none'/'transparent' 这类 CSS 颜色关键字，透明背景要用 backgroundAlpha: 0
        const viewer = window.$3Dmol.createViewer(canvasArea, renderTransparent
            ? { backgroundColor: "#ffffff", backgroundAlpha: 0 }
            : { backgroundColor: renderBg });
        
        // 渲染风格
        let userStyle = keywords.style || keywords.风格 || this.settings.styles[format.toLowerCase()] || "stick";
        let styleObj: Record<string, any> = {};
        if (userStyle === "cartoon") {
            styleObj = { cartoon: { color: 'spectrum' } };
        } else {
            styleObj[userStyle] = {};
        }

        try {
            viewer.addModel(finalContent, format.toLowerCase());
            viewer.setStyle({}, styleObj);
            viewer.zoomTo();

            const bgColorHex = renderBg.startsWith('#') ? renderBg.replace('#', '0x') : renderBg;
            const opacity = renderTransparent ? 0 : 1;
            
            try {
                const colorVal = parseInt(bgColorHex.startsWith('0x') ? bgColorHex : (bgColorHex.startsWith('#') ? bgColorHex.replace('#', '0x') : '0x000000'));
                viewer.setBackgroundColor(isNaN(colorVal) ? 0x000000 : colorVal, opacity); 
            } catch(e) {
                viewer.setBackgroundColor(0x000000, opacity);
            }
            
            viewer.render();
        } catch (err) {
            canvasArea.setText(t("errors.parseFailed"));
        }

        const ro = new ResizeObserver(() => {
            if (wrapper.clientWidth > 0) { 
                viewer.resize(); 
                viewer.render(); 
            }
        });
        ro.observe(wrapper);
        if (child) {
            child.register(() => ro.disconnect());
        }
        return viewer;
    }

    initProcessors() {
        const formats = Object.keys(this.settings.styles);
        const plugin = this;

        formats.forEach(fmt => {
            try {
                this.registerMarkdownCodeBlockProcessor(fmt, (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
                    const div = el.createDiv({ cls: "mol3d-viewer-container-block" });
                    const child = new (class extends MarkdownRenderChild {
                        async onload() {
                            const updateRender = async () => {
                                let modelData = source.trim(), finalFmt = fmt;
                                if (modelData.includes("[[") && modelData.includes("]]") && !modelData.includes("---")) {
                                    const match = modelData.match(/\[\[(.*?)\]\]/);
                                    if (match) {
                                        const file = plugin.app.metadataCache.getFirstLinkpathDest(match[1], ctx.sourcePath || "");
                                        if (file instanceof TFile) { 
                                            modelData = await plugin.app.vault.read(file); 
                                            finalFmt = file.extension; 
                                        }
                                    }
                                }
                                await plugin.renderMolecule(div, finalFmt, modelData, true, this);
                            };
                            await updateRender();
                            this.registerEvent(plugin.app.workspace.on("mol3d:update", () => updateRender()));
                        }
                    })(div);
                    ctx.addChild(child);
                });
            } catch (e) {
                console.log(`[Mol3D] Code block processor for ${fmt} is already registered by another plugin.`);
            }
        });

        this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
            const embeds = el.querySelectorAll(".internal-embed");
            embeds.forEach(node => {
                const src = node.getAttribute("src");
                if (!src) return;
                
                const extension = src.split('.').pop()?.toLowerCase();
                if (extension && formats.includes(extension)) {
                    node.classList.add("mol3d-embed-active");
                    
                    const child = new (class extends MarkdownRenderChild {
                        async onload() {
                            const updateRender = async (retryCount = 0) => {
                                const file = plugin.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath || "");
                                if (file) {
                                    const data = await plugin.app.vault.read(file);
                                    await plugin.renderMolecule(node as HTMLElement, extension, data, true, this);
                                } else if (retryCount < 10) {
                                    setTimeout(() => updateRender(retryCount + 1), 300);
                                }
                            };
                            await updateRender();
                            this.registerEvent(plugin.app.workspace.on("mol3d:update", () => updateRender()));
                        }
                    })(node as HTMLElement);
                    ctx.addChild(child);
                }
            });

            const textNodes = el.querySelectorAll("p, li, code");
            textNodes.forEach(node => {
                if (node.classList.contains("internal-embed") || node.closest(".internal-embed")) return;
                const text = (node as HTMLElement).innerText;
                const regex = new RegExp(`(${formats.join("|")})\\((.*?)\\)`, "gi");
                if (regex.test(text)) {
                    const frag = document.createDocumentFragment();
                    let lastIndex = 0;
                    regex.lastIndex = 0;
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const currentMatch = match;
                        frag.appendChild(document.createTextNode(text.slice(lastIndex, currentMatch.index)));
                        const span = document.createElement("span");
                        span.classList.add("mol3d-inline-container");
                        const child = new (class extends MarkdownRenderChild {
                            async onload() {
                                const updateRender = async () => {
                                    let modelData = currentMatch[2].trim(), finalFmt = currentMatch[1];
                                    if (modelData.startsWith("[[") && modelData.endsWith("]]")) {
                                        const file = plugin.app.metadataCache.getFirstLinkpathDest(modelData.substring(2, modelData.length-2), ctx.sourcePath || "");
                                        if (file) { modelData = await plugin.app.vault.read(file); finalFmt = file.extension; }
                                    }
                                    await plugin.renderMolecule(span, finalFmt, modelData, false, this);
                                };
                                await updateRender();
                                this.registerEvent(plugin.app.workspace.on("mol3d:update", () => updateRender()));
                            }
                        })(span);
                        ctx.addChild(child);
                        frag.appendChild(span);
                        lastIndex = regex.lastIndex;
                    }
                    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
                    node.replaceWith(frag);
                }
            });
        });
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { 
        await this.saveData(this.settings); 
        this.applySettings(); 
        this.app.workspace.trigger("mol3d:update");
    }

    applySettings() {
        const root = document.documentElement;
        root.style.setProperty('--mol3d-block-width', this.settings.blockWidth);
        root.style.setProperty('--mol3d-block-height', this.settings.blockHeight);
    }
}