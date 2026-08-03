# P0 / P0.5：EPUB 归一化与注音派生

## 1. 目标与命令

P0 把本地、无 DRM EPUB 转换为 Airnobe 中间格式；P0.5 可选地从 P0 基础书生成一份新的注音版。两者都不修改输入，也不重建 EPUB。

```text
airnobe-convert <input.epub> --out <directory> [--force]
airnobe-furigana <input-book-directory> --out <directory> [--force]
```

退出码：成功 `0`，参数错误 `2`，I/O、解析或验证失败 `1`。已有输出默认拒绝覆盖；`--force` 只在新结果通过完整校验后替换旧目录。

仓库命令：

```bash
npm install
npm run build
npm test
npm run test:real
npm run convert -- input.epub --out output/book
npm run furigana -- output/book --out output/book-furigana
```

## 2. 输出格式

```text
converted-book/
├─ book.json
├─ documents/0000.json ...
├─ assets/<sha256>.<ext>
└─ report.json
```

- `book.json`：版本、书籍元数据、封面、readingOrder、树形 TOC、资源和可选 derivation。
- `documents/*.json`：每个有效 spine 文档的 role、EPUB 内路径、fragment anchor 和块列表。
- `assets/`：实际引用且按内容哈希去重的图片。
- `report.json`：确定性统计与结构化警告，不含时间戳、绝对路径或运行时长。

readingOrder 来自 OPF spine；TOC 来自 EPUB3 nav，缺失时回退 NCX。nav 文档本身不进入 readingOrder；TOC 只引用 `documentId + fragmentId`。

## 3. 正文模型

正文只保存类型化 JSON AST，不保存 HTML 字符串或重复的 `plainText`。完整契约以 [`packages/book-format/src/index.ts`](./packages/book-format/src/index.ts) 的 Zod schema 为准。

- `TextBlock` 保存段落/标题/图注和一个或多个 `ContentVariant`。
- variant 保存语言、原文/译文来源、顺序、行内 AST 和源位置。
- 多个中文译文是多个有序 `zh-CN` variant；不伪造 EPUB 未提供的译者身份。
- 行内 AST 支持文本、ruby、强调、换行、链接和 gaiji。

ruby 额外区分来源：

```ts
{ type: "ruby", segments: RubySegment[], origin: "source" | "generated" }
```

- `source`：出版社/EPUB 自带注音，是日文原文的一部分。
- `generated`：P0.5 生成的可选辅助注音。

阅读器因此可以独立实现 `Q` 日文开关和 `W` 程序注音开关：`W` 只控制 `generated`，不能隐藏 `source`。

## 4. P0 归一化规则

处理链：

```text
container.xml -> OPF manifest/spine -> EPUB3 nav 或 NCX
              -> XHTML AST -> 哈希资源 -> 校验后原子输出
```

关键规则：

- 不按文件名重排 spine；保留并分类封面、前言、章节、题图、后记、版权页等有效内容。
- 同时支持纯中文书和 auto-novel 中日书；没有结构证据时不按语言猜测配对。
- auto-novel 只认 `opacity:0.4` 的原文 `<p>`，以及同父级紧邻、无属性、无子元素的纯文本译文 `<p>`；支持 `zh-jp`、`jp-zh` 和多个译文。
- ruby 支持 `rb+rt`、隐式文本或 span 加 `rt`、多组 base/rt 和 `rp`。
- 保留强调、换行、安全链接、行内 gaiji、块级图片、分隔图和简单 SVG image 包装。
- CSS、脚本和 EPUB 内字体不进入中间格式；复杂 SVG、缺失资源和未知节点使用占位/文本降级并报告。
- 危险 ZIP 路径、错误 XML 和无效引用不能静默通过。

## 5. P0.5 注音规则

P0.5 校验基础书后，复制全部文档和资源，只处理 `ja-JP` variant：

1. 将整个文本块展平为连续句子，同时保存 AST 偏移映射。
2. 把出版社 ruby、换行和图片标为只读范围。
3. 用 Kuromoji/IPADIC 对完整句子分词。
4. 优先复用在全书中读音唯一、且与分词边界完全匹配的原生读音。
5. 按词生成 ruby，并拆出共同假名前后缀作为送假名；不逐汉字强拆。
6. 仅在结果能安全映射回 AST 时写入 `origin: "generated"` 节点。
7. 未知词、人名、无读音和低置信度范围保持原文并进入报告。

派生书在 `book.json.derivation` 记录基础书 ID、引擎和词典版本。已有 derivation 的输入会被拒绝，避免重复注音。

## 6. 阅读器显示契约

| 状态 | 中文 | 日文 | `source` ruby | `generated` ruby |
|---|---|---|---|---|
| 纯中文 | 显示 | 隐藏 | 隐藏 | 隐藏 |
| 中日原始版 | 显示 | 显示 | 显示 | 隐藏 |
| 中日注音版 | 显示 | 显示 | 显示 | 显示 |

默认状态是纯中文且程序注音关闭。`Q` 和 `W` 必须维护两个独立状态；日文隐藏时切换 `W` 可以没有即时视觉变化，但再次显示日文时应使用新的注音状态。

程序注音的产品目标是补足日文汉字读音，但首版不保证每个汉字都有 ruby：无法可靠判断时宁可保留原文，不伪造读音。

## 7. 验收基线

公开测试使用自制最小 EPUB fixture；仓库内真实书只用于本地回归。

- EPUB2/3、nav/NCX、spine 顺序、中日两种顺序、多译文、纯中文和多种 ruby 结构通过测试。
- 危险路径、错误 XML、资源缺失、确定性输出、`--force` 回滚和 CLI 退出码有覆盖。
- 4 本混排书合计得到 15,056 个配对块，保留 5,707 个原生 ruby。
- `zjws.epub` 的 nav 不进入 readingOrder，保留 9,818 个正文文本块且无整本未配对警告。
- P0.5 覆盖整句上下文、送假名、原生 ruby 保护、唯一读音复用和低置信度跳过；生成目录必须再次通过格式校验。

## 8. 非目标

- DRM、在线翻译、远程资源下载和 EPUB 导出。
- 复刻 EPUB CSS、竖排分页或复杂 SVG 渲染。
- 在 P0/P0.5 中实现 React/Tauri 阅读界面。
- 宣称自动注音达到出版级准确率。
