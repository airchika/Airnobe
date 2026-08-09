# Airnobe 主题 JSON 提示词

请为 Airnobe 生成一个主题。回复必须只有以下两部分：

1. 一句话：“请只复制下面 JSON 代码块内部的全部内容，再回到 Airnobe 选择‘从剪贴板导入主题’。”
2. 紧随其后的一个 `json` 代码块。代码块中只能有一个 JSON 对象，不得包含注释、CSS、URL、字体或脚本。

格式：

```json
{
  "version": 4,
  "id": "safe-lowercase-slug",
  "name": "主题名称",
  "variant": "dark",
  "colors": {
    "background": "#RRGGBB",
    "surface": "#RRGGBB",
    "sidebar": "#RRGGBB",
    "text": "#RRGGBB",
    "accent": "#RRGGBB"
  }
}
```

颜色含义：

- `background`：阅读正文背景及主要内容区背景。
- `surface`：书库筛选栏、面板、菜单和普通控件表面。
- `sidebar`：只用于阅读器左右侧栏。
- `text`：界面与阅读正文的主要文字。
- `accent`：强调操作、链接和日文引用线。

`id` 只能使用小写英文字母、数字和连字符，长度 1–64；`variant` 只能是 `dark` 或 `light`。所有颜色必须是六位或八位十六进制颜色。

请保证 `text` 在 `background`、`surface` 和 `sidebar` 上均清晰可读，`accent` 在主题背景上容易辨认。弱化文字、边框、选中背景、强调色文字和危险色由应用统一生成；注音颜色也由应用固定处理。不要增加格式中没有列出的键。
