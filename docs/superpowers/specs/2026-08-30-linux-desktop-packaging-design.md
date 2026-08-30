# 墨读 Linux 桌面应用 1.0.0 设计规格

## 目标

将现有 Next.js 本地优先 PDF 阅读器封装为 Linux 桌面应用，提供 `.deb` 和 `.AppImage` x86_64 安装包。用户可以双击 PDF 自动导入并直接打开阅读器，也可在设置中将墨读设为 PDF 默认打开应用。

Linux 桌面包的产品版本固定为 `1.0.0`。仓库现有 `v1.0.0` 标签不重写；未来发布 Linux 桌面包时使用 `linux-v1.0.0` 标签。

## 范围

### 包含

- Electron 桌面运行时，托管应用窗口和本机 Next.js standalone 服务。
- Linux x86_64 `.deb` 和 `.AppImage` 构建产物。
- 单实例行为：再次启动聚焦已有窗口，并把新 PDF 交给已有实例。
- 命令行或文件管理器传入 PDF 时，验证、读取、导入并跳转到对应文档。
- 已导入 PDF 通过指纹去重，双击后直接打开旧记录。
- 设置页显示桌面集成状态，并提供用户主动点击的“设为 PDF 默认应用”。
- 安装包和 README 中的安装、默认应用与故障排查说明。

### 不包含

- Windows 和 macOS 打包。
- 自动更新、应用商店发布和代码签名。
- 安装时强制抢占 PDF 默认应用。
- 向网页渲染层暴露任意文件系统读写能力。
- 更改现有 PDF、翻译、批注、词汇或文件夹数据结构。

## 架构

### Electron 主进程

Electron 主进程是桌面集成的唯一特权边界，负责：

1. 获取单实例锁，处理首次启动参数与 `second-instance` 传入的 PDF。
2. 在固定回环端口 `32147` 启动 Next.js standalone 服务，等待健康检查后再显示窗口。固定 origin 保证 IndexedDB 资料在每次启动后仍然映射到同一存储空间。
3. 管理 `BrowserWindow`、进程退出、外部链接和导航限制。
4. 验证系统传入路径是普通文件、扩展名为 `.pdf`，且文件头为 `%PDF-`；通过验证后才读取字节。
5. 查询和设置 `application/pdf` 默认应用。

主进程不解析 PDF 内容、不访问 Dexie，也不处理翻译密钥。

### Next.js 应用服务

Next.js 使用 `output: "standalone"` 生成可由 Electron 启动的服务。打包阶段将 standalone 输出、`.next/static` 与 `public` 资产集合到 Electron resources。服务仅监听 `127.0.0.1:32147`，保留现有 `/api/translate` 同源转发。

端口被其他进程占用时，应用显示可理解的启动错误并退出，不改用随机端口，避免意外切换 IndexedDB origin。

### Preload 与 IPC

`BrowserWindow` 启用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。Preload 只暴露小而明确的 `window.moduDesktop` API：

- `isDesktop: true`
- `consumeLaunchPdf(): Promise<DesktopPdfFile | null>`
- `onOpenPdf(listener): () => void`
- `getPdfDefaultAppStatus(): Promise<DesktopIntegrationStatus>`
- `setAsPdfDefaultApp(): Promise<DesktopIntegrationStatus>`
- `showItemInFolder(path)` 不在首版范围内。

`DesktopPdfFile` 只包含 `name`、`bytes` 和可选的 `sourcePath` 显示值；渲染层不能请求任意路径。IPC 消息名和输入在主进程统一校验。

## PDF 打开与导入数据流

1. Linux 文件管理器根据 `application/pdf` 关联启动墨读，并传入一个或多个 PDF 路径。
2. 主进程按顺序验证路径并读取文件；首版一次仅向渲染层交付一个待打开 PDF，其余路径保留在内存队列中。
3. 根布局挂载的 `DesktopPdfOpenCoordinator` 通过 preload 消费待打开文件，将字节转为标准 `File`，再调用可复用的导入服务。协调器在资料库、阅读器、设置和词汇页均保持挂载，因此导航不会中断多文件队列。
4. 导入服务返回 `{ documentId, outcome }`，其中 `outcome` 为 `created` 或 `existing`。新文档写入 IndexedDB；重复文档保留原有翻译、批注、词汇和阅读进度。
5. 导入完成后导航到 `/reader/{documentId}`。如果又有 PDF 到达，完成当前导入后继续处理队列。
6. 非桌面浏览器环境没有 `window.moduDesktop`，现有拖放和文件选择行为保持不变。

导入服务从现有 `LibraryClient` 中抽离为独立单元，用于手动导入与桌面打开。视图仅管理进度和错误提示，不复制指纹、PDF 检查、待关联笔记合并逻辑。

## 默认应用集成

### `.deb`

electron-builder 生成的 desktop entry 声明 `MimeType=application/pdf;` 和 `%F`。安装包将 desktop entry 注册到系统应用菜单，但安装本身不调用 `xdg-mime default`。

### `.AppImage`

用户在设置中点击“设为 PDF 默认应用”后，主进程在用户目录写入 `~/.local/share/applications/com.hzz2z.modureader.desktop`，其 `Exec` 使用当前可执行文件的绝对路径和 `%F`，然后执行：

```text
xdg-mime default com.hzz2z.modureader.desktop application/pdf
```

如果系统存在 `update-desktop-database`，同步更新用户级应用数据库。所有路径以参数形式传递，不组装 shell 命令字符串。

默认应用状态通过 `xdg-mime query default application/pdf` 查询。设置页呈现“已设为默认”、“尚未设置”或可操作错误；浏览器版不显示此区块。

## 产品标识与构建产物

- Electron `appId`: `com.hzz2z.modureader`
- `productName`: `墨读`
- Linux 可执行名: `modu-reader`
- 版本: `1.0.0`
- 目标架构: `x86_64`
- 产物: `墨读-1.0.0-x86_64.AppImage`
- 产物: `墨读-1.0.0-x86_64.deb`

构建由一条明确的 npm 命令完成，输出到 `dist/`。安装包不携带用户数据、API Key、测试 PDF 或开发缓存。

## 用户数据与兼容性

Electron 使用自己的 Chromium 用户数据目录，Dexie/IndexedDB 结构不改变。桌面应用与浏览器版的 IndexedDB 不会自动共享；已有浏览器资料可使用现有 `.updf-notes.json` 导出/导入功能迁移，PDF 需在桌面应用中重新导入。

DeepSeek 和 Google API Key 仍只保存于 `sessionStorage`，不写入 Electron 配置、日志、IndexedDB 或导出包。

## 错误处理

- 不存在、无权限、非普通文件、非 PDF 扩展名或缺少 PDF 文件头：拒绝读取，在应用内显示具体文件名和原因。
- Next.js 服务启动失败、端口占用或健康检查超时：显示错误对话框并退出，不显示空白窗口。
- IndexedDB 空间不足：沿用现有会话阅读降级与资料库清理提示。
- `xdg-mime` 不存在、desktop entry 写入失败或系统拒绝变更：保留应用可用性，在设置页显示手动设置指引。
- 多 PDF 队列中某一文件失败：记录错误后继续下一个，不丢失已完成导入。

## 安全边界

- Electron 渲染层没有 Node.js 能力，也不接收通用路径读取 IPC。
- 只允许加载 `http://127.0.0.1:32147` 应用页面；拦截新窗口和非本地导航，可识别的 `https:` 链接交给系统浏览器。
- 路径和命令参数使用结构化调用，不使用 shell 字符串。
- 只有用户通过系统 PDF 打开动作传入的路径才可读取。
- 桌面集成按钮需要用户明确点击，安装和首次启动不自动改变 PDF 默认应用。

## 测试与验收

### 自动化测试

- 纯逻辑单元测试：命令行 PDF 路径提取、文件验证、desktop entry 渲染与转义、MIME 状态解析。
- 导入服务测试：新建文档返回 ID，重复文档返回原 ID 且不覆盖现有数据，待关联笔记继续合并。
- React 组件测试：桌面环境消费启动 PDF 并导航，浏览器环境不受影响，设置页显示并刷新默认应用状态。
- Electron 主进程集成测试：单实例第二次打开、本地服务启动/停止、安全 BrowserWindow 选项、PDF IPC 交付。
- 现有 TypeScript、Vitest、Playwright 和 Next.js 生产构建必须继续通过。

### 打包验证

- 生成同时包含 AppImage 和 deb 的 Linux x86_64 产物。
- 使用 `desktop-file-validate` 验证 desktop entry。
- 检查 deb 包元数据包含 `application/pdf`、正确的可执行命令和图标。
- 从文件管理器双击 PDF 后，应用在同一窗口直接显示对应阅读页。
- 已导入 PDF 再次双击时，不创建重复记录，阅读进度、翻译、批注和词汇保留。
- 将墨读设为 PDF 默认应用后，`xdg-mime query default application/pdf` 返回 `com.hzz2z.modureader.desktop`。

## 交付标准

1. 一条 npm 命令可重复构建 Linux x86_64 AppImage 和 deb。
2. 安装或运行 AppImage 后可正常访问资料库、阅读器、翻译、批注和词汇本。
3. 双击新 PDF 会自动导入并打开；双击重复 PDF 会打开旧记录。
4. 应用不会在没有用户操作时改变系统 PDF 默认应用。
5. 渲染层无 Node.js 或任意文件系统能力，且本地服务只监听回环地址。
6. 所有现有自动化测试通过，并新增桌面打开和默认应用关键路径测试。
