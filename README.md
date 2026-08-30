# 墨读 · 本地优先 PDF 深度阅读器

墨读是一个桌面端优先的本地 Web PDF 阅读器。它提供连续单页阅读、双页图书阅读、DeepSeek/Google 选区翻译、固定高亮、注释、词汇复习，以及可移植的阅读记录。

当前稳定版本：`1.0.0`

## 本地运行

需要 Node.js 20.9 或更高版本，以及最新版 Chrome/Edge。

### 一键启动（推荐）

在文件管理器中双击项目根目录下的 `启动墨读.desktop`。第一次运行时，系统可能会要求选择“允许启动”或“信任并启动”；之后双击即可自动安装缺失依赖、构建最新版本、启动本地服务并打开浏览器。关闭启动器的终端窗口即可停止服务。

启动器会自动查找系统 PATH、用户目录、NVM、Volta、asdf 和 mise 中的 Node.js 20+。如果双击后仍无反应，可在终端运行 `./启动墨读.sh --diagnose` 查看实际使用的 Node.js 和 npm。

也可以在终端中运行：

```bash
./启动墨读.sh
```

如果墨读已经在运行，再次双击只会打开浏览器，不会重复启动服务。

### 开发模式

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:3000`。开发和生产脚本默认只监听本机回环地址。

生产构建：

```bash
npm run build
npm run start
```

## 翻译设置

在“设置”页选择默认翻译服务，并输入对应的 DeepSeek 或 Google Cloud Translation API Key。两种密钥分开写入 `sessionStorage`，关闭标签页/浏览器会话后失效，不会进入 IndexedDB 或导出包；应用自身不会主动持久化或记录密钥。应用仅在用户选中文字并明确点击“翻译”时，通过同源 `/api/translate` 发送该选区。

Google 翻译使用 Cloud Translation Basic v2。使用前需要在 Google Cloud 项目中启用 Cloud Translation API、开启结算并创建 API Key；免费额度和超额价格请查看 [Google 官方定价](https://cloud.google.com/translate/pricing)。建议给密钥增加 API 限制，只允许访问 Cloud Translation API。

翻译缓存按“服务商 + 规范化原文 + 目标语言”隔离；已有 DeepSeek 缓存仍然兼容。同一服务下命中缓存时不会再次请求 API；侧栏的“重新翻译”是唯一的显式覆盖入口。

## 本地数据与分享

- PDF Blob、阅读进度、翻译、高亮、注释与词汇保存在浏览器 IndexedDB。
- `.updf-notes.json` 不包含原 PDF 或 API Key；接收者需要导入 SHA-256 指纹完全相同的 PDF。
- 指纹不匹配的笔记包会显示为“等待原 PDF”，以后导入原文件时自动合并。
- 当前文档还可导出 Markdown 笔记，词汇本可导出 CSV。

## 验证

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
```

端到端测试使用 `tests/fixtures/reader-e2e-sample.pdf`，覆盖导入、两种阅读模式、独立页码/缩放、翻译服务选择与缓存、注释、刷新恢复、导出与重新关联。翻译请求在测试中被本地模拟，不会产生 API 费用。

## 版本管理

项目使用 `主版本.功能版本.修复版本`（`X.Y.Z`）：

- 项目架构、核心技术路线或不兼容数据结构改变：增加 `X`，并将 `Y.Z` 归零。
- 新增向后兼容的功能：增加 `Y`，并将 `Z` 归零。
- 仅修复 Bug、性能或稳定性问题：增加 `Z`。

`package.json` 是版本号的唯一真值来源，`package-lock.json` 保持同步。每次正式发布同时更新 `CHANGELOG.md`，并创建 `vX.Y.Z` 格式的 Git 标签。

## 首版边界

扫描 PDF 可以阅读、缩放并添加页面注释，但暂不提供 OCR。首版不包含账户、云同步、在线协作、PDF 内容编辑或 DRM 支持；窄屏设备会将图书模式降级为单页翻动。
