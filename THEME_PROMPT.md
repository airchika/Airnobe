# Airnobe 主题 JSON 提示词

请为 Airnobe 生成一个主题。回复必须只有以下两部分：

1. 一句话：“请只复制下面 JSON 代码块内部的全部内容，再回到 Airnobe 选择‘从剪贴板导入主题’。”
2. 紧随其后的一个 `json` 代码块。代码块中只能有一个 JSON 对象，不得包含注释、CSS、URL、字体或脚本。

格式：

```json
{
  "version": 2,
  "id": "safe-lowercase-slug",
  "name": "主题名称",
  "variant": "dark",
  "colors": {
    "background": "#RRGGBB",
    "surface": "#RRGGBB",
    "surfaceRaised": "#RRGGBBAA",
    "sidebar": "#RRGGBB",
    "text": "#RRGGBB",
    "mutedText": "#RRGGBB",
    "border": "#RRGGBBAA",
    "accent": "#RRGGBB",
    "accentText": "#RRGGBB",
    "accentSoft": "#RRGGBBAA",
    "link": "#RRGGBB",
    "readingText": "#RRGGBB",
    "japaneseRule": "#RRGGBBAA",
    "rubySource": "#RRGGBB",
    "danger": "#RRGGBB"
  }
}
```

`id` 只能使用小写英文字母、数字和连字符，长度 1–64；`variant` 只能是 `dark` 或 `light`。所有颜色必须是六位或八位十六进制颜色。

请保证正文、菜单和按钮文字有清晰对比；弱化文字仍需可读；强调色上的 `accentText` 必须清楚；出版社原生 ruby 的 `rubySource` 能在阅读背景上阅读；错误色不能只依赖微弱明度差。不要增加格式中没有列出的键。
