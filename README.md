# Airnobe

Airnobe 是面向 Windows 的中日双语 EPUB 轻小说书库与阅读器。它将 EPUB 转换为统一的类型化内容结构，在同一阅读块中保留中文译文、日文原文、出版社 ruby、程序振假名和片假名罗马音。

> 默认推荐从源码启动网页模式，方便个人使用和随时修改。Tauri 桌面入口及 Windows 安装包仍然保留。

## 一键启动与边改边用

网页模式只需要 Node.js `22.13.0` 或更新版本，无需 Rust、WebView2 或 C++ Build Tools。首次在仓库执行：

```powershell
npm ci
npm run setup:fonts
```

之后双击仓库根目录的 `Start Airnobe.cmd`：后台构建并启动本地服务，就绪后打开默认浏览器。可以为这个文件创建桌面快捷方式。重复启动会复用本仓库已运行的服务，不会启动第二份书库后端。服务启动期间再次点击不会重复打开窗口。

- `Restart Airnobe.cmd`：重新构建并重启后台服务。
- `Stop Airnobe.cmd`：停止后台服务。关闭浏览器窗口不会停止服务。
- `npm start` / `npm run reader`：在终端启动并显示日志，支持 Ctrl+C 停止。
- `npm run status`、`npm restart`、`npm stop`：查看状态、重启、停止。
- 双击启动的日志位于 `.airnobe-web/*.log`。首次构建需要一些时间；若网页未打开，检查该目录中的 `err.log` 和 `out.log`。

前端 `apps/reader-web/src/` 的修改由 Vite 热更新；后端和三个共享包的源码修改会自动重新编译并重启服务。编译失败时日志会显示原因，修正并保存后会重试。后端重启期间请求可能暂时失败，因此导入书籍时请等导入完成再修改后端。依赖或启动脚本修改后，请停止服务，按需执行 `npm ci`，再启动。无需生成安装包。

### 固定书库目录

首次启动自动生成 **不提交 Git** 的 `airnobe.local.json`。若仓库已有 `AirnobeLibrary/library.json`，继续使用该书库并记录其绝对路径；新机器默认使用用户主目录下的 `AirnobeLibrary`。不会自动移动或合并旧书库。

```json
{
  "libraryDirectory": "E:/Books/AirnobeLibrary",
  "port": 5173
}
```

`libraryDirectory` 必须为绝对路径；修改配置会自动重启网页服务。更改目录表示切换书库，原目录保持原样。更改端口后请重新点击启动入口打开新地址。也可以用 `AIRNOBE_LIBRARY_DIRECTORY` 和 `AIRNOBE_WEB_PORT` 环境变量覆盖配置。网页通过仅监听 `127.0.0.1` 的 Node 服务读写书库，不依赖浏览器目录授权。

此配置用于新的网页启动入口；Tauri 原有开发／发行启动方式暂时保留，正式桌面版仍使用安装目录旁的书库。不要同时使用两个后端修改同一书库。

另一台电脑可以克隆源码、安装依赖后使用同样入口。更新前先停止服务，再 `git pull --ff-only`、`npm ci` 并重新启动；本机有改动时先提交或自行处理差异。GitHub 只同步代码，本机配置、书籍和阅读进度不随代码同步。

## 主要功能

阅读时右键打开侧栏，在「排版与样式」中可分别选择中文、日文字体，即时预览并自动保存。提供更纱黑体、Noto Serif、Noto Sans、Windows 宋体／明朝体和黑体，以及 calibre 附带的 Liberation Serif；日文注音跟随日文字体。更纱字体由项目准备，Liberation Serif 2.1.5 随应用提供（[OFL-1.1 许可证](apps/reader-web/public/fonts/liberation/LICENSE.txt)）；Liberation 主要覆盖西文，中日文搭配 Noto Serif 或系统宋体／明朝体。其余字体使用本机安装的版本，缺少时按字体列表回退。旧设置默认保留更纱黑体及原有字号、快捷键等选项。

- 本地 EPUB 书库，支持批量选择和文件拖放导入、完整哈希查重、收藏状态、原书导出与删除。
- 中日对照、纯中文和纯日文内容；出版社原生 ruby 始终保留。
- 使用 Kuromoji/IPADIC 生成辅助振假名，并为片假名词生成改良赫本式罗马音。
- 虚拟连续滚动、目录跳转、阅读进度恢复、书签和可配置键盘操作。
- 同一浏览器标签页刷新或被回收后，自动恢复正在阅读的书、段落和屏幕内偏移；主动返回书库后则保持书库。各标签页独立保存阅读会话，浏览器禁用会话存储时仍保留原有服务端进度保存。
- 浅色、深色和跟随系统主题，以及安全的五色主题 JSON 导入。
- Tauri 2 Windows 桌面封装、系统托盘、全局显示/隐藏快捷键和开机静默启动。
- 首次创建书库时自动加入中日双语教程《Airnobe Start》。

### 手柄操作

打开书籍后，可用浏览器识别为标准布局的手柄操作。连接后先松开摇杆和按钮，再开始操作；左右摇杆和十字键均支持方向操作。

| 操作 | Xbox 按键 | PlayStation 对应按键 |
| --- | --- | --- |
| 从视口顶部向上／向下移动菜单设置的段数 | 摇杆或十字键：上／下 | 同左 |
| 上一页／下一页 | 摇杆或十字键：左／右 | 同左 |
| 从视口顶部向下／向上移动菜单设置的段数 | A／B | ×／○ |
| 切换日文显示 | X（左侧） | □ |
| 切换振假名 | LB | L1 |
| 切换罗马音 | RB | R1 |
| 切换全屏 | RT | R2 |
| 保存阅读位置并返回书库 | Y（上方） | △ |

书库中，方向键／摇杆移动焦点，A（×）打开书籍操作菜单或确认当前操作，B（○）关闭菜单／返回上一级，Y（△）返回阅读界面（有上次阅读的书籍时），RT（R2）切换全屏。可在书籍菜单中继续阅读、从头开始、修改状态或导出。

方向操作支持长按重复，A/B 及功能按钮每次按下只触发一次。阅读侧栏或弹窗、书库外部弹窗打开、输入框编辑、窗口失焦时暂停手柄操作，恢复后需先松开按钮和摇杆。全屏使用现有桌面／浏览器全屏功能，浏览器端受其全屏权限限制。

## 下载与安装

Airnobe 目前只提供 Windows 10/11 x64 的 NSIS 安装器，不提供便携版、MSI 或自动更新。安装器按当前用户安装到 `%LOCALAPPDATA%`，无需管理员权限。

当前测试版尚未进行商业代码签名，Windows SmartScreen 可能显示未知发布者。运行前请下载同一 Release 中的 `SHA256SUMS.txt`，并在 PowerShell 中核对：

```powershell
Get-FileHash .\Airnobe_0.1.0_x64-setup.exe -Algorithm SHA256
```

以后发布新版时，从 [Releases](https://github.com/airchika/Airnobe/releases) 下载新版安装器并覆盖安装即可。书库保存在主程序同目录的 `AirnobeLibrary/`；覆盖安装和卸载程序都会保留该目录，重新安装后可继续使用。重要书籍仍建议自行备份。

## 可选的 Tauri 开发环境

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

网页启动入口的书库位置由 `airnobe.local.json` 决定；原有 Tauri 开发模式默认使用仓库根目录 `AirnobeLibrary/`，正式桌面版默认保存在主程序同目录的 `AirnobeLibrary/`。书籍、设置、进度和书签均保存在本机，不上传到 Airnobe 服务。

## 使用边界

- 当前正式目标只有 Windows 桌面端。
- 只处理本地、无 DRM 的 EPUB，不负责移除 DRM。
- 程序注音用于辅助阅读，不保证人名、造语和低置信度词语达到出版级准确率。
- 从第三方网站导入内容时，用户需要自行确认来源和使用权限。
- 现有 “导出为EPUB” 点了没反应，但问题应该不大。

## License

Copyright (C) 2026 airchika.

Airnobe 源码按 [GNU General Public License v3.0](LICENSE) 发布。Sarasa Gothic 字体不属于项目 GPL，继续适用其 OFL-1.1 许可证。
