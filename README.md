# Airnobe

Airnobe 是面向 Windows 的中日双语 EPUB 轻小说书库与阅读器。它将 EPUB 转换为统一的类型化内容结构，在同一阅读块中保留中文译文、日文原文、出版社 ruby、程序振假名和片假名罗马音。

> 当前仍处于公开测试阶段，可从 [GitHub Releases](https://github.com/airchika/Airnobe/releases) 下载 Windows x64 安装器。

## 主要功能

- 本地 EPUB 书库，支持批量选择和文件拖放导入、完整哈希查重、收藏状态、原书导出与删除。
- 中日对照、纯中文和纯日文内容；出版社原生 ruby 始终保留。
- 使用 Kuromoji/IPADIC 生成辅助振假名，并为片假名词生成改良赫本式罗马音。
- 虚拟连续滚动、目录跳转、阅读进度恢复、书签和可配置键盘操作。
- 浅色、深色和跟随系统主题，以及安全的五色主题 JSON 导入。
- Tauri 2 Windows 桌面封装、系统托盘、全局显示/隐藏快捷键和开机静默启动。
- 首次创建书库时自动加入中日双语教程《Airnobe Start》。

## 下载与安装

Airnobe 目前只提供 Windows 10/11 x64 的 NSIS 安装器，不提供便携版、MSI 或自动更新。安装器按当前用户安装到 `%LOCALAPPDATA%`，无需管理员权限。

当前测试版尚未进行商业代码签名，Windows SmartScreen 可能显示未知发布者。运行前请下载同一 Release 中的 `SHA256SUMS.txt`，并在 PowerShell 中核对：

```powershell
Get-FileHash .\Airnobe_0.1.0_x64-setup.exe -Algorithm SHA256
```

以后发布新版时，从 [Releases](https://github.com/airchika/Airnobe/releases) 下载新版安装器并覆盖安装即可。书库保存在主程序同目录的 `AirnobeLibrary/`；覆盖安装和卸载程序都会保留该目录，重新安装后可继续使用。重要书籍仍建议自行备份。

## 开发环境

- Windows 10/11 与 WebView2
- Node.js `22.13.0` 或更新版本
- Rust stable
- Visual Studio 2022 C++ Build Tools（含 Windows SDK）

安装依赖并准备构建字体：

```powershell
npm ci
npm run setup:fonts
```

字体脚本固定下载 Sarasa Gothic `1.0.40`，校验官方压缩包和最终字体，只保留 SC/J 的 Regular、SemiBold 与 Bold。字体文件位于被 Git 忽略的 `Font/`，适用独立的 [SIL Open Font License 1.1](THIRD_PARTY_LICENSES/Sarasa-Gothic-OFL-1.1.txt)。

运行完整检查：

```powershell
npm run typecheck
npm test
npm run build
npm run check:desktop
npm run desktop:check
```

启动桌面开发版：

```powershell
npm run desktop
```

只启动浏览器开发版：

```powershell
npm run reader
```

## 可选的真实 EPUB 回归

公开测试只使用仓库内生成的最小 fixture。真实 EPUB 不进入 Git；本地样本默认放入 `epub/`，也可以指定其他目录：

```powershell
$env:AIRNOBE_REAL_EPUB_DIR = 'E:\Books\Airnobe-test'
npm run test:real
```

测试目录中的书籍文件名应与本地回归测试声明一致。请勿提交无权公开的电子书。

## 项目结构

```text
apps/desktop       Tauri 2 Windows 桌面应用
apps/reader-web    React 阅读器、书库和本地 sidecar 服务
packages/book-format
                   类型化书籍格式与运行时校验
tools/epub-normalizer
                   EPUB 2/3 归一化器
tools/furigana     振假名和片假名罗马音派生工具
```

开发模式的书库保存在仓库根目录 `AirnobeLibrary/`；正式桌面版默认保存在主程序同目录的 `AirnobeLibrary/`。书籍、设置、进度和书签均保存在本机，不上传到 Airnobe 服务。

## 使用边界

- 当前正式目标只有 Windows 桌面端。
- 只处理本地、无 DRM 的 EPUB，不负责移除 DRM。
- 程序注音用于辅助阅读，不保证人名、造语和低置信度词语达到出版级准确率。
- 从第三方网站导入内容时，用户需要自行确认来源和使用权限。
- 现有 “导出为EPUB” 点了没反应，但问题应该不大。

## License

Copyright (C) 2026 airchika.

Airnobe 源码按 [GNU General Public License v3.0](LICENSE) 发布。Sarasa Gothic 字体不属于项目 GPL，继续适用其 OFL-1.1 许可证。
