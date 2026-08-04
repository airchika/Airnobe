# Airnobe Reader Web

本地 EPUB 阅读原型。

## 运行

在仓库根目录安装依赖并启动：

```text
npm install
npm run reader
```

打开终端显示的本地地址，选择 EPUB 即可。基础结果与注音派生结果分别保存在仓库根目录的 `AirnobeLibrary/base/<book-id>/` 和 `AirnobeLibrary/furigana/<book-id>/`；该目录已加入 `.gitignore`。

“打开转换结果”只作为调试和打开 P0.5 派生书的备用入口。

## 阅读控制

- `Q`：显示或隐藏对应日文；出版社原生 ruby 随日文显示。
- `E`：同时显示或隐藏 `origin: "reused"` 与 `origin: "generated"` 的辅助注音。
- `W` / `S`：以下方可见单位为基准，按全局回退/快进段数移动并对齐底部。
- `R` / `F`：以上方可见单位为基准，按全局回退/快进段数移动并对齐顶部。
- `A` / `D`：向上或向下滚动一个完整视口高度。
- 右键：打开阅读菜单。

日文和程序注音互相独立，换书后都恢复为关闭。从 EPUB 导入时会自动生成 P0.5 派生书。

文本块和块级图片都可导航；分隔符跳过。段数只计文本块，但图片是硬停靠点。右键菜单中的回退、快进段数默认均为 2，保存在 `AirnobeLibrary/user.json`。

当前版本按 readingOrder 虚拟连续阅读，仅维护桌面端。TOC、阅读进度和桌面文件访问属于后续 P1b/P2。
