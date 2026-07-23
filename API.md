# Mol3D Viewer — API 文档

## 插件概述

Mol3D Viewer 是一个 Obsidian 3D 分子结构查看器插件，基于 [3Dmol.js](https://3dmol.csb.pitt.edu/) 渲染分子模型。支持 `xyz`、`pdb`、`sdf`、`mol2`、`cif` 五种分子格式，提供四种使用方式：直接打开分子文件（自定义视图）、Markdown 代码块、嵌入文件 `![[file.pdb]]`、行内语法 `pdb([[file]])` 或 `pdb(...)`。

### Manifest 信息（manifest.json）

| 字段 | 值 |
| --- | --- |
| id | `mol3d-viewer` |
| name | Mol3D Viewer |
| version | 1.0.1 |
| minAppVersion | 0.15.0 |
| description | 3D molecule viewer |
| author | yzh-362 |
| isDesktopOnly | false（支持移动端） |
| main | main.js |

---

## 主插件类 `Mol3DViewerMobile`（main.ts）

继承自 `obsidian.Plugin`，为默认导出。

### 属性

- `settings: Mol3DPluginSettings` — 插件设置，见下文"设置项数据结构"。

### 生命周期

- `onload()`：
  1. 调用 `loadSettings()` 加载设置；
  2. 注册设置页 `Mol3DMobileSettingTab`；
  3. 通过 `injectDependency("3Dmol-min.js", "$3Dmol")` 注入 3Dmol.js（优先插件目录本地文件，失败回退 CDN `https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.4.0/3Dmol-min.js`），暴露为全局 `window.$3Dmol`；
  4. 注册自定义视图 `VIEW_TYPE_MOL3D`（`"mol3d-view"`），并将 `settings.styles` 中的全部扩展名（xyz/pdb/sdf/mol2/cif）关联到该视图（`registerExtensions`），重复注册时捕获异常并跳过；
  5. 调用 `initProcessors()` 注册 Markdown 处理器；
  6. 调用 `applySettings()` 应用 CSS 变量。
- `onunload()`：未显式实现，由 Obsidian 自动清理已注册的视图、处理器与事件。

> 注意：插件未注册任何命令（command），也没有 ribbon 图标。

### 公开方法

- `injectDependency(fileName: string, globalVar: string): Promise<any>`
  动态 `<script>` 注入依赖库。若 `window[globalVar]` 已存在则直接返回；本地文件加载失败时回退 CDN。返回全局库对象，失败时 resolve `null`。

- `parseKeywords(content: string): { keywords: Record<string, any>, finalContent: string }`
  解析代码块/内容开头以 `---` 分隔的关键词段。支持 `Key:Value`、`Key=Value`，键不区分中英文（内部统一小写），仅含键时值为 `true`。返回解析出的关键词字典和去掉关键词段后的分子数据正文。

- `renderMolecule(parentContainer: HTMLElement, format: string, rawContent: string, isEmbed: boolean | string = false): Promise<any>`
  核心渲染函数。在 `parentContainer` 内创建 `.mol3d-wrapper`（含可选标题栏 `.mol3d-title-bar` 和画布 `.mol3d-canvas-area`），调用 `$3Dmol.createViewer` 渲染模型。
  - `isEmbed === "view"`：无边框、宽高 100%（用于文件视图）；为 `true`：嵌入模式；为 `false`：行内模式。
  - 移动端（窗口宽 ≤ 600）且非 view 模式时宽度强制 `100%`。
  - 支持关键词覆盖：`width`/`height`、`bc`/`border-color`/`边框颜色`、`bw`/`border-width`/`边框宽度`、`bg`/`背景`、`title`/`标题`、`style`/`风格`。
  - 通过 `ResizeObserver` 在尺寸变化时 `viewer.resize()` 并重绘。返回 viewer 实例。
  - 容器宽度为 0 时延迟 200ms 重试；`$3Dmol` 未加载或模型解析失败时在容器内显示错误文本。

- `initProcessors()`：注册以下 Markdown 处理器（格式列表取自 `settings.styles` 的键）：
  1. 每个格式一个代码块处理器（如 ```` ```pdb ````），源码含 `[[wikilink]]` 且无 `---` 时读取链接文件内容；
  2. 一个全局 Markdown 后处理器，处理 `.internal-embed`（`![[file.xyz]]` 嵌入，文件未就绪时最多重试 10 次，间隔 300ms）以及段落/列表/行内代码中的 `格式(...)` 行内语法（如 `pdb([[myfile]])`）。
  所有渲染子组件注册 `mol3d:update` 工作区事件，设置保存后自动重渲染。

- `loadSettings()` / `saveSettings()`：加载/持久化设置。`saveSettings()` 同时调用 `applySettings()` 并触发 `mol3d:update` 事件。

- `applySettings()`：将 `--mol3d-block-width`、`--mol3d-block-height` 写入根元素 CSS 变量。

---

## 自定义视图 `Mol3DView`（view.ts）

- `VIEW_TYPE_MOL3D = "mol3d-view"` — 视图类型标识。
- `class Mol3DView extends TextFileView`
  - 属性：`plugin`、`viewContainer`、`.mol3d-molecule-container` 画布容器 `moleculeEl`、`.mol3d-text-preview` 文本预览 `textPreviewEl`。
  - `getViewType(): string` — 返回 `"mol3d-view"`。
  - `getDisplayText(): string` — 返回文件名，无文件时为 `"Mol3D Viewer"`。
  - `getIcon(): string` — 返回 `"box"`。
  - `onOpen()` — 构建容器 DOM（3D 画布 + 文本预览并排）。
  - `setViewData(data: string, clear: boolean)` — 调用 `plugin.renderMolecule(..., "view")` 渲染，并在文本预览区显示原始数据。
  - `getViewData(): string` / `clear()` — 返回/清空数据。

直接双击库中的分子文件即以此视图打开（只读，文本区为预览，不可编辑）。

---

## 设置页与设置数据结构（settings.ts）

### `Mol3DPluginSettings` 接口及默认值（`DEFAULT_SETTINGS`）

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `blockWidth` | string | `"100%"` | 代码块宽度 |
| `blockHeight` | string | `"400px"` | 代码块高度 |
| `inlineWidth` | string | `"150px"` | 行内渲染宽度（预留，当前由 CSS 控制） |
| `inlineHeight` | string | `"120px"` | 行内渲染高度（预留） |
| `inlineAlign` | string | `"middle"` | 行内对齐（预留） |
| `borderWidth` | string | `"1px"` | 边框宽度 |
| `borderColor` | string | `"var(--background-modifier-border)"` | 边框颜色 |
| `backgroundColor` | string | `"#000000"` | 背景颜色（关闭透明时生效） |
| `isTransparent` | boolean | `true` | 透明背景开关 |
| `styles` | Record<string, string> | `{ xyz: "stick", pdb: "cartoon", sdf: "sphere", mol2: "stick", cif: "line" }` | 各格式默认渲染风格，可选 `stick`/`sphere`/`line`/`cartoon` |

### `Mol3DMobileSettingTab extends PluginSettingTab`

- `constructor(app: App, plugin: Mol3DViewerMobile)`
- `display(): void` — 渲染设置界面：尺寸、边框、背景（透明开关关闭时显示取色器）、各格式默认风格下拉框。所有修改即时 `saveSettings()`。

---

## 用户侧用法

### 1. 代码块

````markdown
```pdb
title: 我的分子, bg: #112233, style: cartoon, width: 80%, height: 300px
---
ATOM      1  N   ALA A   1      ...
...
```
````

- 第一行到 `---` 之间为关键词段，逗号/换行分隔，支持中英文键：`title/标题`、`bg/背景`、`bc/边框颜色`、`bw/边框宽度`、`style/风格`、`width`、`height`。
- 代码块内容也可以直接写 `[[文件链接]]`（此时不能有 `---` 关键词段）：

````markdown
```xyz
[[molecules/water.xyz]]
```
````

### 2. 嵌入分子文件

```markdown
![[molecules/protein.pdb]]
```

### 3. 行内渲染

```markdown
文字中嵌入 pdb([[molecules/ligand.pdb]]) 或 sdf(...) 等格式名加括号。
```

### 4. 直接打开文件

在文件列表中点击 `.xyz`/`.pdb`/`.sdf`/`.mol2`/`.cif` 文件，以 Mol3D 视图打开。

---

## 自定义事件

- `mol3d:update`（workspace 事件）：设置保存后触发，所有已渲染的分子组件监听并重新渲染。

## 样式类（styles.css 中定义）

`.mol3d-wrapper`、`.mol3d-title-bar`、`.mol3d-canvas-area`、`.mol3d-view-container`、`.mol3d-molecule-container`、`.mol3d-text-preview`、`.mol3d-inline-container`、`.mol3d-embed-active`、`.mol3d-viewer-container-block`；CSS 变量 `--mol3d-block-width`、`--mol3d-block-height`。
