export interface ReadingPosition {
  documentId: string;
  blockId: string;
  viewportOffset: number;
  progress: number;
  chapterLabel: string | null;
}

export interface ReadingState {
  version: 1;
  position: ReadingPosition | null;
  updatedAt: string | null;
}

export interface ReadingProgressSummary {
  progress: number;
  chapterLabel: string | null;
  updatedAt: string;
}

export const EMPTY_READING_STATE: ReadingState = {
  version: 1,
  position: null,
  updatedAt: null,
};

export function parseReadingPosition(value: unknown): ReadingPosition | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const position = value as Partial<ReadingPosition>;
  if (typeof position.documentId !== "string" || position.documentId.length === 0) return undefined;
  if (typeof position.blockId !== "string" || position.blockId.length === 0) return undefined;
  if (typeof position.viewportOffset !== "number" || !Number.isFinite(position.viewportOffset) || Math.abs(position.viewportOffset) > 10_000_000) return undefined;
  if (typeof position.progress !== "number" || !Number.isFinite(position.progress) || position.progress < 0 || position.progress > 1) return undefined;
  if (position.chapterLabel !== null && (typeof position.chapterLabel !== "string" || position.chapterLabel.length > 1_000)) return undefined;
  return {
    documentId: position.documentId,
    blockId: position.blockId,
    viewportOffset: position.viewportOffset,
    progress: position.progress,
    chapterLabel: position.chapterLabel,
  };
}

export function parseReadingState(value: unknown): ReadingState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const state = value as Partial<ReadingState>;
  if (state.version !== 1) return undefined;
  const position = state.position === null ? null : parseReadingPosition(state.position);
  if (position === undefined) return undefined;
  if (state.updatedAt !== null && typeof state.updatedAt !== "string") return undefined;
  return { version: 1, position, updatedAt: state.updatedAt };
}

export function readingProgressSummary(state: ReadingState): ReadingProgressSummary | null {
  if (!state.position || !state.updatedAt) return null;
  return {
    progress: state.position.progress,
    chapterLabel: state.position.chapterLabel,
    updatedAt: state.updatedAt,
  };
}
