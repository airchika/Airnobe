# P0 / P0.5：EPUB 归一化与注音派生

## 目标与命令

P0 把本地、无 DRM EPUB 转换为 Airnobe 中间格式；P0.5 可选地从基础书生成一份新的注音版。两者都不修改输入或重建 EPUB。

```text
airnobe-convert <input.epub> --out <directory> [--force]
airnobe-furigana <input-book-directory> --out <directory> [--force]
```

成功退出码为 `0`，参数错误为 `2`，I/O、解析或验证失败为 `1`。已有输出默认拒绝覆盖；`--force` 只在新结果通过校验后替换旧目录。

仓库命令：

```text
npm run build
npm test
npm run test:real
npm run convert -- input.epub --out output/book
npm run furigana -- output/book --out output/book-furigana
```

## 输出格式

```text
converted-book/
├─ book.json
├─ documents/0000.json ...
├─ assets/<sha256>.<ext>
└─ report.json
```

- `book.json`：版本、元数据、封面、readingOrder、树形 TOC、资源和可选 derivation。
- `documents/`：有效 spine 文档的 role、源路径、fragment anchor 和块列表。
- `assets/`：实际引用并按内容哈希去重的图片。
- `report.json`：确定性统计和结构化警告。

readingOrder 来自 OPF spine；TOC 优先使用 EPUB3 nav，缺失时回退 NCX。nav 文档不进入 readingOrder，TOC 目标使用 `documentId + fragmentId`。

## 正文模型

正文只保存类型化 JSON AST，不保存 HTML 或重复的 `plainText`。当前格式版本为 2，Zod schema 位于 [`packages/book-format/src/index.ts`](./packages/book-format/src/index.ts)。

- `TextBlock` 保存段落、标题或图注及一个或多个 `ContentVariant`。
- variant 保存语言、原文/译文来源、顺序、行内 AST 和源位置。
- 多个中文译文保存为多个有序 `zh-CN` variant，不伪造译者身份。
- 行内节点支持文本、ruby、强调、换行、链接和 gaiji。

ruby 使用 `origin: "source" | "reused" | "generated"` 区分出版社注音、书内读音复用和词典生成注音。出版社注音属于日文原文；后两类是同一个可选辅助层。

## P0 规则

```text
container.xml -> OPF manifest/spine -> EPUB3 nav 或 NCX
              -> XHTML AST -> 哈希资源 -> 校验后原子输出
```

- 不按文件名重排 spine；保留并分类封面、前言、章节、题图、后记和版权页等有效内容。
- 同时支持纯中文书和 auto-novel 中日书；没有结构证据时不按语言猜测配对。
- auto-novel 只认 `opacity:0.4` 的原文段落及同父级紧邻的纯文本译文段落，支持两种中日顺序和多个译文。
- ruby 支持 `rb+rt`、隐式文本或 span 加 `rt`、多组 base/rt 和 `rp`。
- 保留强调、换行、安全链接、行内 gaiji、块级图片、分隔图和简单 SVG image 包装；无正文文本的纯图片段落输出为块级插画。
- CSS、脚本和 EPUB 内字体不进入输出；复杂 SVG、缺失资源和未知节点使用占位或文本降级并报告。
- 危险 ZIP 路径、错误 XML 和无效引用不能静默通过。

## P0.5 规则

P0.5 校验基础书后复制文档和资源，只处理 `ja-JP` variant：

1. 展平整个文本块并建立 AST 偏移映射。
2. 保护出版社 ruby、换行和图片范围。
3. 使用 Kuromoji/IPADIC 对完整句子分词。
4. 将多 segment ruby 的完整 base/readings 一并登记，仅在一个或多个完整分词边界匹配时复用书内唯一读音。
5. 按词生成 ruby，并拆出共同假名前后缀作为送假名。
6. 复用结果写为 `origin: "reused"`，词典结果写为 `origin: "generated"`，并分别计数。
7. 未知词、人名和低置信度范围保持原文并报告。

派生书在 `book.json.derivation` 记录基础书 ID、引擎和词典版本。已有 derivation 的输入会被拒绝。

## 验收基线

- 公开 fixture 覆盖 EPUB 2/3、nav/NCX、spine、中日顺序、多译文、纯中文和多种 ruby。
- 危险路径、错误 XML、缺失资源、确定性输出、`--force` 回滚和 CLI 退出码有自动测试。
- 4 本本地混排书合计得到 15,056 个配对块并保留 5,707 个原生 ruby。
- `zjws.epub` 的 nav 不进入 readingOrder，保留 9,818 个正文文本块且无整本未配对警告。
- P0.5 覆盖整句上下文、送假名、原生 ruby 保护、唯一读音复用和低置信度跳过。

## 非目标

- DRM、在线翻译、远程资源和 EPUB 导出。
- 复刻 EPUB CSS、竖排分页或复杂 SVG 渲染。
- 出版级自动注音准确率。
