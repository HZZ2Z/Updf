# 墨读开发与发布说明

README 面向产品用户；本文件集中保存开发、测试、桌面打包和版本维护信息。

## 环境要求

- Node.js 20.9 或更高版本
- npm
- 最新版 Chrome/Edge，用于本地 Web 调试
- Linux x86_64，用于构建当前桌面安装包

## 仓库结构

- `src/app/`：Next.js App Router 页面与翻译 API
- `src/components/`：资料库、阅读器、设置和词汇本界面
- `src/lib/`：PDF、数据库、翻译、导入导出与桌面边界逻辑
- `desktop/`：Electron 主进程、preload 与本地服务生命周期
- `scripts/`：启动器、PDF.js 资源同步、桌面打包与产物验证
- `tests/`：Playwright 端到端流程和无版权测试 PDF
- `docs/screenshots/`：README 使用的实际产品截图
- `docs/design/`：早期界面概念稿，仅作为设计历史保存
- `docs/superpowers/`：已实施功能的设计与计划记录

## 本地开发

```bash
npm install
npm run dev
```

开发服务默认监听 `http://127.0.0.1:3000`，不会暴露到局域网。

生产构建与本地运行：

```bash
npm run build
npm run start
```

也可以运行 `./启动墨读.sh`；启动器会查找 PATH、NVM、Volta、asdf 和 mise 中的 Node.js 20+，自动安装缺失依赖并打开浏览器。诊断命令为：

```bash
./启动墨读.sh --diagnose
```

## 验证

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
```

端到端测试使用 `tests/fixtures/reader-e2e-sample.pdf`，覆盖导入、阅读模式、页码与缩放、翻译缓存、注释、刷新恢复、导出和重新关联。测试中的翻译请求由本地模拟，不产生 API 费用。

## Linux 桌面打包

```bash
npm install
npm run build:linux
npm run verify:linux
```

构建结果写入忽略版本控制的 `dist/`：

- `墨读-<version>-x86_64.AppImage`
- `墨读-<version>-x86_64.deb`

桌面运行时会在 `.desktop-runtime/` 暂存 Next.js standalone 服务及静态资源，该目录同样不进入版本控制。PDF.js worker、CMap、标准字体和 WASM 由 `scripts/sync-pdfjs-assets.mjs` 生成到 `public/` 下的忽略目录。

## 版本规则

项目采用 `主版本.功能版本.修复版本`（`X.Y.Z`）：

- 架构、核心技术路线或不兼容数据结构改变：增加 `X`，并将 `Y.Z` 归零。
- 新增向后兼容功能：增加 `Y`，并将 `Z` 归零。
- Bug、性能或稳定性修复：增加 `Z`。

`package.json` 是版本号的唯一真值来源，`package-lock.json` 必须保持同步。正式发布时同步更新 `CHANGELOG.md`。

已有 Web 标签 `v1.0.0` 不重写；Linux 桌面首版使用 `linux-v1.0.0`。后续常规发布使用与版本号对应且不覆盖历史的 Git 标签。

## 生成内容与仓库卫生

以下内容必须保持在版本控制之外：

- `node_modules/`
- `.next/`
- `.desktop-runtime/`
- `dist/`
- `coverage/`
- `playwright-report/`
- `test-results/`
- `tmp/`
- `*.tsbuildinfo`
- 由同步脚本生成的 `public/pdf.worker.min.mjs` 与 `public/pdfjs/`

不要把个人 PDF、API Key、浏览器资料目录或真实阅读数据库加入仓库。README 截图使用无版权测试 PDF 和独立的本地演示资料库生成。
