# Airnobe 主题 JSON 提示词

请为 Airnobe 生成一个主题。只输出一个 JSON 对象，不要使用 Markdown 代码块、注释、CSS、URL、字体或脚本。

格式：

```json
{
  "version": 1,
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
    "rubyReused": "#RRGGBB",
    "rubyGenerated": "#RRGGBB",
    "rubyRomaji": "#RRGGBB",
    "danger": "#RRGGBB"
  }
}
```

`id` 只能使用小写英文字母、数字和连字符，长度 1–64；`variant` 只能是 `dark` 或 `light`。所有颜色必须是六位或八位十六进制颜色。

请保证正文、菜单和按钮文字有清晰对比；弱化文字仍需可读；强调色上的 `accentText` 必须清楚；四类 ruby 应彼此可辨，并能在阅读背景上阅读；错误色不能只依赖微弱明度差。
