export const READER_FONT_IDS = ["sarasa", "noto-serif", "noto-sans", "system-serif", "system-sans", "liberation-serif"] as const;
export type ReaderFontId = typeof READER_FONT_IDS[number];
export type ReaderLanguage = "zh" | "ja";

export const READER_FONTS: Record<ReaderLanguage, Record<ReaderFontId, { label: string; family: string }>> = {
  zh: {
    "liberation-serif": { label: "Liberation Serif（calibre 附带）", family: '"Liberation Serif", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif' },
    sarasa: { label: "更纱黑体 SC（默认）", family: '"Sarasa Gothic SC", "Microsoft YaHei", sans-serif' },
    "noto-serif": { label: "Noto Serif SC（宋体）", family: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif' },
    "noto-sans": { label: "Noto Sans SC（黑体）", family: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif' },
    "system-serif": { label: "宋体（Windows）", family: '"SimSun", "Songti SC", serif' },
    "system-sans": { label: "微软雅黑（Windows）", family: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  },
  ja: {
    "liberation-serif": { label: "Liberation Serif（calibre 附带）", family: '"Liberation Serif", "Noto Serif JP", "Source Han Serif", "Yu Mincho", serif' },
    sarasa: { label: "更纱黑体 J（默认）", family: '"Sarasa Gothic J", "Yu Gothic", sans-serif' },
    "noto-serif": { label: "Noto Serif JP（明朝体）", family: '"Noto Serif JP", "Source Han Serif", "Yu Mincho", serif' },
    "noto-sans": { label: "Noto Sans JP（黑体）", family: '"Noto Sans JP", "Source Han Sans", "Yu Gothic", sans-serif' },
    "system-serif": { label: "游明朝（Windows）", family: '"Yu Mincho", "MS Mincho", serif' },
    "system-sans": { label: "游黑体（Windows）", family: '"Yu Gothic", "Meiryo", sans-serif' },
  },
};

export function isReaderFontId(value: unknown): value is ReaderFontId {
  return typeof value === "string" && READER_FONT_IDS.includes(value as ReaderFontId);
}
