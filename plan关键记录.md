移除 `text-rendering: optimizeLegibility`，恢复 WebView2/Chromium 在 Windows 上的默认 DirectWrite 渲染，不添加会关闭子像素渲染的强制平滑属性。


中文、日文透明度不再通过整层 `opacity` 合成，而以正文颜色和透明色混合生成文字颜色，减少合成层造成的模糊；链接、注音和引用线维持正确继承关系。
