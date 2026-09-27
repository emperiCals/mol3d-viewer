import { Plugin, MarkdownRenderChild, TFile, normalizePath, MarkdownPostProcessorContext, Component } from "obsidian";
import { DEFAULT_SETTINGS, Mol3DPluginSettings, Mol3DMobileSettingTab } from "./settings";
import { Mol3DView, VIEW_TYPE_MOL3D } from "./view";
import { initI18n, t } from "./i18n";
import { FORMAT_REGISTRY, TOPOLOGY_FORMATS } from "./formats";

declare global {
    interface Window {
        molstar: any;
    }
}

export default class Mol3DViewerMobile extends Plugin {
    settings: Mol3DPluginSettings;
    // 记录每个容器上的 Mol* viewer，重渲染/卸载时 dispose，防止 WebGL 上下文泄漏
    private viewers = new WeakMap<HTMLElement, any>();

    async onload() {
        await initI18n();
        await this.loadSettings();
        this.addSettingTab(new Mol3DMobileSettingTab(this.app, this));

        // 全局抑制 Mol* 上游 "empty textures" 未捕获拒绝（SSAO 0 尺寸边界 bug），
        // 同时作为版本探针：若控制台仍出现该错误且没有本条 warn，说明运行的不是本版本代码
        const rejHandler = (e: PromiseRejectionEvent) => {
            if (e.reason && e.reason.message === "empty textures are not allowed") {
                console.warn("[Mol3D] 已抑制上游 empty textures 异常（0 尺寸 resize，无害）");
                e.preventDefault();
            }
        };
        window.addEventListener("unhandledrejection", rejHandler);
        this.register(() => window.removeEventListener("unhandledrejection", rejHandler));

        try {
            await this.injectDependency("molstar.js", "molstar");
            
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

            console.log("Mol3D Viewer: 已开启文件关联与增强嵌入渲染");
        } catch (e) {
            console.error("Mol3D Viewer 加载失败", e);
        }
    }

    async injectDependency(fileName: string, globalVar: string): Promise<any> {
        if (window[globalVar as keyof Window]) return window[globalVar as keyof Window];

        // Obsidian CSP 拦截 <link> 外链样式（style-src 仅 unsafe-inline/self），
        // 因此 CSS 一律读文本后以内联 <style> 注入
        const injectCssText = (css: string) => {
            const style = document.createElement("style");
            style.setAttribute("data-mol3d", "molstar");
            style.textContent = css;
            document.head.appendChild(style);
        };
        const injectLocalCss = async () => {
            try {
                const css = await (this.app.vault.adapter as any).read(normalizePath(this.manifest.dir + "/molstar.css"));
                injectCssText(css);
            } catch (e) { /* css 缺失时仅靠 styles.css 兜底 */ }
        };

        return new Promise((resolve) => {
            const loadCDN = () => {
                console.log(`[Mol3D] 尝试从 CDN 回退加载 molstar.js ...`);
                fetch("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css")
                    .then(r => r.text()).then(injectCssText).catch(() => { /* 忽略 */ });
                const script = document.createElement("script");
                script.src = "https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js";
                script.type = "text/javascript";
                script.onload = () => resolve(window[globalVar as keyof Window]);
                script.onerror = () => resolve(null);
                document.head.appendChild(script);
            };

            try {
                injectLocalCss();
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

    // 按格式读取分子文件：二进制格式（bcif/dcd/xtc/体积图等）走 readBinary
    async readMolFile(file: TFile): Promise<string | Uint8Array> {
        const info = FORMAT_REGISTRY[file.extension.toLowerCase()];
        if (info?.binary) return new Uint8Array(await this.app.vault.readBinary(file));
        return this.app.vault.read(file);
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

    // 核心渲染函数（filePath：体积图按 URL 加载所需；sourcePath：轨迹 topology 链接解析基准）
    async renderMolecule(parentContainer: HTMLElement, format: string, rawContent: string | Uint8Array, isEmbed: boolean | string = false, child?: Component, filePath?: string, sourcePath?: string): Promise<any> {
        if (parentContainer.clientWidth === 0) {
            setTimeout(() => this.renderMolecule(parentContainer, format, rawContent, isEmbed, child, filePath, sourcePath), 200);
            return;
        }

        parentContainer.empty();
        this.disposeViewer(parentContainer);

        if (!window.molstar) {
            parentContainer.setText(t("errors.libNotLoaded"));
            return;
        }

        // 解析关键词和真正的数据（二进制内容跳过关键词段解析）
        const parsed = typeof rawContent === "string"
            ? this.parseKeywords(rawContent)
            : { keywords: {} as Record<string, any>, finalContent: rawContent };
        const keywords = parsed.keywords;
        let finalContent = parsed.finalContent;

        // 关键词段之后的 [[wikilink]] 统一在此解析（代码块带关键词 + 文件引用的场景）
        let effExt = format.toLowerCase();
        let effPath = filePath;
        if (typeof finalContent === "string" && /^\[\[.+\]\]$/.test(finalContent.trim())) {
            const ref = finalContent.trim().slice(2, -2);
            const f = this.app.metadataCache.getFirstLinkpathDest(ref, sourcePath || "");
            if (f instanceof TFile) {
                finalContent = await this.readMolFile(f);
                effExt = f.extension.toLowerCase();
                effPath = f.path;
            }
        }

        const wrapper = parentContainer.createDiv({ cls: "mol3d-wrapper" });
        if (FORMAT_REGISTRY[effExt]?.category === "trajectory") wrapper.addClass("mol3d-trajectory");
        
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
            wrapper.addClass("mol3d-view-full");
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

        // Mol* 创建时要求容器尺寸非 0（后台页签 display:none 或布局未完成会报 "empty textures"），
        // 用 ResizeObserver 挂起，直到容器真正可见才创建 viewer
        if (canvasArea.clientWidth === 0 || canvasArea.clientHeight === 0) {
            await new Promise<void>(resolve => {
                const sro = new ResizeObserver(() => {
                    if (canvasArea.clientWidth > 0 && canvasArea.clientHeight > 0) { sro.disconnect(); resolve(); }
                });
                sro.observe(canvasArea);
            });
        }

        let viewer: any;
        try {
            const isTrajectory = FORMAT_REGISTRY[effExt]?.category === "trajectory";
            const perfOpts = {
                pixelScale: this.settings.pixelScale,
                resolutionMode: this.settings.resolutionMode as "auto" | "scaled" | "native",
            };
            // 全文件视图使用完整 Mol* 界面；卡片/嵌入保持精简
            const viewerOptions = isEmbed === "view" ? {
                viewportBackgroundColor: renderTransparent ? undefined : renderBg,
                layoutIsExpanded: false, // expanded 布局为全窗口应用设计，移动端会溢出容器与 Obsidian 栏重叠
                // reactive 默认会在窄屏把面板堆叠到容器外，按宽度固定布局方向
                layoutControlsDisplay: (canvasArea.clientWidth >= 700 ? "landscape" : "portrait") as "landscape" | "portrait",
                layoutShowRemoteState: false, // 远程状态面板会联网拉取 webchem.ncbr.muni.cz，离线报错
                viewportShowExpand: false, // 展开/全屏按钮无实际用途
                viewportShowToggleFullscreen: false,
                disabledExtensions: ["g3d"], // 避免多实例重复注册 g3d symbol 刷警告
                ...perfOpts,
            } : {
                layoutIsExpanded: false,
                layoutShowControls: false,
                layoutShowSequence: false,
                layoutShowLog: false,
                layoutShowLeftPanel: false,
                viewportShowExpand: false,
                viewportShowControls: false,
                viewportShowSettings: false,
                viewportShowScreenshotControls: false,
                viewportShowSelectionMode: false,
                // 轨迹格式需要播放/帧控制条
                viewportShowAnimation: isTrajectory,
                viewportShowTrajectoryControls: isTrajectory,
                viewportBackgroundColor: renderTransparent ? undefined : renderBg,
                disabledExtensions: ["g3d"],
                ...perfOpts,
            };
            viewer = await window.molstar.Viewer.create(canvasArea, viewerOptions);
            this.viewers.set(parentContainer, viewer);
            if (child) {
                child.register(() => this.disposeViewer(parentContainer));
            }

            // 终极兜底：钳制 getDrawingBufferSize 最小 8x8。
            // Mol* passes.updateSize 只钳到 2x2，SSAO 在高分屏（1/pixelRatio ≤ 0.5）
            // 下 floor(2*0.33)=0 仍会抛 empty textures；画布 0x0 可能经挂载竞态等路径漏入。
            // 必须最先执行且独立 try：后续补丁若抛异常不能影响本补丁生效
            try {
                const webgl = viewer.plugin.canvas3d?.webgl;
                if (webgl && !webgl.__mol3dSizeClamped) {
                    const origGetSize = webgl.getDrawingBufferSize.bind(webgl);
                    webgl.getDrawingBufferSize = () => {
                        const s = origGetSize();
                        if (s.width >= 8 && s.height >= 8) return s;
                        return { width: Math.max(s.width, 8), height: Math.max(s.height, 8) };
                    };
                    webgl.__mol3dSizeClamped = true;
                    console.debug("[Mol3D] drawing buffer size clamp applied");
                } else if (!webgl) {
                    console.warn("[Mol3D] canvas3d.webgl 不可用，尺寸钳制未生效");
                }
            } catch (e) { /* 钳制失败不阻断渲染 */ }

            // 直接吞掉 passes.updateSize 的异常：SSAO 0 尺寸纹理是 Mol* 上游边界 bug，
            // 错过一帧 resize 无害，但 uncaught 错误会污染控制台
            try {
                const passes = viewer.plugin.canvas3dContext?.passes;
                if (passes && !passes.__mol3dGuarded) {
                    const origUpdateSize = passes.updateSize.bind(passes);
                    passes.updateSize = () => {
                        try { origUpdateSize(); } catch (e) {
                            console.debug("[Mol3D] updateSize 异常已吞掉（容器尺寸为 0 时的上游 bug）", e);
                        }
                    };
                    passes.__mol3dGuarded = true;
                }
            } catch (e) { /* 防御失败不阻断渲染 */ }

            // 背景与透明度必须在 loadStructureFromData 之前设置，
            // 否则加载期间以 Mol* 默认白色背景渲染，造成打开时闪白
            // （Mol* 的 Color 为 0xRRGGBB 数字；transparentBackground 是 canvas3d 顶层参数）
            try {
                const hex = renderBg.trim().replace(/^#/, "");
                const colorNum = /^[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex, 16) : 0x000000;
                const c3d = viewer.plugin.canvas3d;
                const s = this.settings;
                c3d?.setProps({
                    transparentBackground: renderTransparent,
                    checkeredTransparentBackground: false, // 透明时透出笔记底色，而非棋盘格
                    renderer: { backgroundColor: colorNum },
                    // 渲染效果开关（参数为 Mol* 官方默认值；off 状态 params 为 {}，沿用会缺字段崩 shader）
                    postprocessing: {
                        occlusion: { name: s.occlusion ? "on" : "off", params: { samples: 32, multiScale: { name: "off", params: {} }, radius: 5, bias: 0.8, blurKernelSize: 15, blurDepthBias: 0.5, resolutionScale: 1, color: 0, transparentThreshold: 0.4 } },
                        shadow: { name: s.shadow ? "on" : "off", params: { steps: 1, maxDistance: 3, tolerance: 1 } },
                        outline: { name: s.outline ? "on" : "off", params: { scale: 1, threshold: 0.33, color: 0, includeTransparent: true } },
                        dof: { name: s.dof ? "on" : "off", params: { blurSize: 9, blurSpread: 1, inFocus: 0, PPM: 20, center: "camera-target", mode: "plane" } },
                    },
                    cameraFog: { name: s.fog ? "on" : "off", params: { intensity: 15 } },
                    transparency: s.transparencyMode,
                });
            } catch (e) { /* 颜色解析失败时保持默认背景 */ }

            // 辅助防御：包装 context.handleResize，容器尺寸为 0 时拒绝执行，
            // 防止 Mol* 内部把 canvas 写成 0x0
            try {
                const origCtxResize = viewer.plugin.handleResize?.bind(viewer.plugin);
                if (origCtxResize) {
                    viewer.plugin.handleResize = () => {
                        if (canvasArea.clientWidth > 0 && canvasArea.clientHeight > 0) origCtxResize();
                    };
                    // 挂载瞬间若已拿到 0 尺寸，这里趁容器可见立即修正
                    if (canvasArea.clientWidth > 0 && canvasArea.clientHeight > 0) origCtxResize();
                }
            } catch (e) { /* 包装失败不阻断渲染 */ }
        } catch (e) {
            canvasArea.setText(t("errors.libNotLoaded"));
            return;
        }

        // 渲染风格（Mol* 原生表示名，兼容旧版 3Dmol 风格名）
        const legacyStyle: Record<string, string> = { stick: "ball-and-stick", sphere: "spacefill" };
        let userStyle = keywords.style || keywords.风格 || this.settings.styles[effExt] || "ball-and-stick";
        userStyle = legacyStyle[userStyle] || userStyle;

        const info = FORMAT_REGISTRY[effExt];

        try {
            if (info?.category === "topology") {
                canvasArea.setText(t("errors.topologyNeedsTrajectory"));
            } else if (info?.category === "trajectory") {
                // 轨迹：topology/model 关键词指定拓扑或结构文件（wikilink 或路径）；
                // 缺省时按同目录同名文件自动配对（psf/prmtop/parm7/top/pdb/gro）
                const topoRef = keywords.topology || keywords.拓扑 || keywords.model || keywords.结构;
                let topoFile: TFile | null = null;
                if (topoRef) {
                    const ref = String(topoRef).replace(/^\[\[|\]\]$/g, "");
                    topoFile = this.app.metadataCache.getFirstLinkpathDest(ref, sourcePath || "");
                } else if (filePath) {
                    const base = filePath.replace(/\.[^.]+$/, "");
                    for (const e of ["psf", "prmtop", "parm7", "top", "pdb", "gro"]) {
                        const f = this.app.vault.getAbstractFileByPath(`${base}.${e}`);
                        if (f instanceof TFile) { topoFile = f; break; }
                    }
                }
                if (!(topoFile instanceof TFile)) {
                    canvasArea.setText(t("errors.trajectoryNeedsTopology"));
                } else {
                    const topoExt = topoFile.extension.toLowerCase();
                    const topoData = await this.readMolFile(topoFile);
                    const model = TOPOLOGY_FORMATS[topoExt]
                        ? { kind: "topology-data", data: topoData, format: TOPOLOGY_FORMATS[topoExt] }
                        : { kind: "model-data", data: topoData, format: FORMAT_REGISTRY[topoExt]?.mol || topoExt };
                    await viewer.loadTrajectory({
                        model,
                        coordinates: { kind: "coordinates-data", data: finalContent, format: info.mol },
                    });
                    await this.applyRepresentation(viewer, userStyle);
                    // loadTrajectory 不一定自动对焦，手动重置相机
                    try { viewer.plugin.canvas3d?.requestCameraReset?.(); } catch (e) { /* noop */ }
                }
            } else {
                let molFormat = info?.mol || effExt;
                const isCoreCif = molFormat === "mmcif" && typeof finalContent === "string" &&
                    /_atom_site_fract_/.test(finalContent) && !/_atom_site\.label_atom_id/.test(finalContent);
                if (isCoreCif) {
                    // 晶体学 core CIF（CIF1 方言，仅分数坐标）：mmcif 解析为空模型，
                    // 手动走 cifCore 解析 + 对称性展开 preset（默认完整晶胞；cell 关键词可选 supercell/contacts）
                    const cellMode = (keywords.cell || keywords.晶胞 || "unit").toString().toLowerCase();
                    const presetId = cellMode === "supercell" ? "preset-trajectory-supercell"
                        : cellMode === "contacts" ? "preset-trajectory-crystal-contacts"
                        : "preset-trajectory-unitcell";
                    const data = await viewer.plugin.builders.data.rawData({ data: finalContent });
                    const trajectory = await viewer.plugin.builders.structure.parseTrajectory(data, "cifCore");
                    await viewer.plugin.builders.structure.hierarchy.applyPreset(trajectory, presetId);
                } else {
                    await viewer.loadStructureFromData(finalContent, molFormat);
                }
                await this.applyRepresentation(viewer, userStyle);
            }
        } catch (err) {
            canvasArea.setText(t("errors.parseFailed"));
        }

        // 容器归零（页签切后台 display:none）时暂停渲染循环：
        // Mol* passes.updateSize 钳到 2x2 后 SSAO 在高分屏下降采样为 0，会抛 empty textures
        const ro = new ResizeObserver(() => {
            const c3d = viewer.plugin?.canvas3d;
            if (wrapper.clientWidth > 0 && wrapper.clientHeight > 0) {
                c3d?.resume();
                viewer.handleResize();
            } else {
                c3d?.pause();
            }
        });
        ro.observe(wrapper);
        if (child) {
            child.register(() => ro.disconnect());
        }
        return viewer;
    }

    private disposeViewer(container: HTMLElement) {
        const v = this.viewers.get(container);
        if (v) {
            try { v.dispose(); } catch (e) { /* 忽略重复 dispose */ }
            this.viewers.delete(container);
        }
    }

    // 按 Mol* 原生表示名重建结构表示，统一使用二级结构着色
    async applyRepresentation(viewer: any, style: string): Promise<void> {
        const mgr = viewer.plugin?.managers?.structure;
        if (!mgr) return;
        const structures = mgr.hierarchy.current.structures;
        for (const s of structures) {
            const comps = s.components;
            if (!comps || comps.length === 0) continue;
            try {
                await mgr.component.removeRepresentations(comps);
                await mgr.component.addRepresentation(comps, style);
                // 重建后重新读取层级，旧的组件快照里 representation 引用已失效
                const fresh = mgr.hierarchy.current.structures;
                for (const fs of fresh) {
                    if (fs.components?.length) {
                        // cartoon 用二级结构着色，其余（小分子/配体球棍等）用元素着色
                        await mgr.component.updateRepresentationsTheme?.(fs.components, (_c: any, repr: any) => ({
                            color: repr.cell?.transform?.params?.type?.name === "cartoon" ? "secondary-structure" : "element-symbol"
                        }));
                    }
                }
                // 晶胞框不在这里处理：core CIF 由 unitcell preset 自带可见晶胞，
                // 蛋白等 mmcif/pdb 的晶胞保持默认隐藏
            } catch (e) {
                console.warn(`[Mol3D] 无法应用表示风格 ${style}`, e);
            }
        }
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
                                let modelData: string | Uint8Array = source.trim(), finalFmt = fmt, filePath: string | undefined;
                                if (typeof modelData === "string" && modelData.includes("[[") && modelData.includes("]]") && !modelData.includes("---")) {
                                    const match = modelData.match(/\[\[(.*?)\]\]/);
                                    if (match) {
                                        const file = plugin.app.metadataCache.getFirstLinkpathDest(match[1], ctx.sourcePath || "");
                                        if (file instanceof TFile) {
                                            modelData = await plugin.readMolFile(file);
                                            finalFmt = file.extension;
                                            filePath = file.path;
                                        }
                                    }
                                }
                                await plugin.renderMolecule(div, finalFmt, modelData, true, this, filePath, ctx.sourcePath);
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
                                    const data = await plugin.readMolFile(file);
                                    await plugin.renderMolecule(node as HTMLElement, extension, data, true, this, file.path, ctx.sourcePath);
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
                                    let modelData: string | Uint8Array = currentMatch[2].trim(), finalFmt = currentMatch[1], filePath: string | undefined;
                                    if (typeof modelData === "string" && modelData.startsWith("[[") && modelData.endsWith("]]")) {
                                        const file = plugin.app.metadataCache.getFirstLinkpathDest(modelData.substring(2, modelData.length-2), ctx.sourcePath || "");
                                        if (file) { modelData = await plugin.readMolFile(file); finalFmt = file.extension; filePath = file.path; }
                                    }
                                    await plugin.renderMolecule(span, finalFmt, modelData, false, this, filePath, ctx.sourcePath);
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // 新版新增的格式键合并进已持久化的 styles（Object.assign 浅合并会整体替换 styles）
        this.settings.styles = Object.assign({}, DEFAULT_SETTINGS.styles, this.settings.styles);
        // 旧版 3Dmol 风格名迁移到 Mol* 原生表示名
        const legacy: Record<string, string> = { stick: "ball-and-stick", sphere: "spacefill", line: "line", cartoon: "cartoon" };
        let migrated = false;
        for (const fmt of Object.keys(this.settings.styles)) {
            const v = this.settings.styles[fmt];
            if (legacy[v] && legacy[v] !== v) {
                this.settings.styles[fmt] = legacy[v];
                migrated = true;
            }
        }
        if (migrated) await this.saveData(this.settings);
    }
    async saveSettings() {
        await this.saveData(this.settings);
        this.app.workspace.trigger("mol3d:update");
    }
}