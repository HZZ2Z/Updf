# 墨读 1.1.2

本版本修复 Linux 桌面端的返回资料库导航问题，不改变 PDF 渲染、缩略图或阅读进度保存策略。

## 修复

- 启动恢复只在每个桌面窗口会话首次加载时执行一次。
- 从 PDF 阅读器点击左上角返回后，资料库会稳定保持，不再跳回刚才的文献。
- 通过系统默认 PDF 应用打开的新文件仍优先于上次阅读恢复。

## 下载选择

- `Modu-1.1.2-x86_64.AppImage`：无需安装，添加可执行权限后直接运行。
- `Modu-1.1.2-x86_64.deb`：适用于 Debian、Ubuntu 及其衍生发行版。

## 文件校验

```text
78f6ced92149a26c9d9feac49230fec9ae3e1b759ad1da20ebf273383be582db  Modu-1.1.2-x86_64.AppImage
ada7c2cb6a5d40fa5ace05128f6a9ad0d72e5c8b441c36b16b871f71831aeb5c  Modu-1.1.2-x86_64.deb
52a91f74c912ffbdd621fea06c691d53234c2f4a236deba1a9d29aa9e0dc6138  latest-linux.yml
```
