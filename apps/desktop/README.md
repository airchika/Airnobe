# Airnobe Desktop

P2a 的 Tauri 2 Windows 桌面壳。当前阶段复用 Reader Web 与 Node 本地服务，正式版 sidecar 和安装包属于 P2b/P2c。

## 开发运行

需要 WebView2、Visual Studio C++ Build Tools 和 Rust stable。仓库根目录运行：

```text
npm run desktop
```

该命令自行管理 Reader 与 Tauri 的生命周期：端口上已有 Airnobe Reader 时直接复用，否则启动新的服务；关闭桌面窗口后只回收本次启动的服务，不再把正常退出显示成 npm 生命周期错误。

开发模式继续使用仓库中的 `AirnobeLibrary`。如需隔离书库，可在启动前设置 `AIRNOBE_LIBRARY_DIRECTORY` 为目标目录。

桌面窗口提供原生 EPUB 多选对话框和 Tauri 文件拖放；浏览器开发版继续使用 HTML 文件输入和浏览器拖放。两者最终进入同一个顺序导入队列。

图标只提交可编辑源文件 `app-icon.svg` 和 Windows 构建所需的 `src-tauri/icons/icon.ico`。Tauri 图标命令额外生成的 Android、iOS、macOS 和 PNG 图标属于当前阶段不使用的派生产物，已从版本控制中排除。

## 当前边界

- `npm run desktop` 是 P2a 的可运行开发版。
- `npm run build -w @airnobe/desktop` 只构建无安装包的桌面前端壳；P2b 完成 Node sidecar 前，不作为可分发版本。
- P2b 将把现有转换与书库服务封装为自包含 sidecar，并把正式书库放入应用本地数据目录。
- P2c 再生成并验收 Windows 安装包。
