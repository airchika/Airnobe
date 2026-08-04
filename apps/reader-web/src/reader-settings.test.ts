import { describe, expect, it } from "vitest";
import { DEFAULT_READER_SETTINGS, parseReaderSettings } from "./reader-settings.js";

describe("reader settings", () => {
  it("uses two text blocks in each direction by default", () => {
    expect(DEFAULT_READER_SETTINGS).toEqual({
      version: 1,
      navigation: { backwardTextSteps: 2, forwardTextSteps: 2 },
      pageTransitions: false,
    });
  });

  it("accepts only versioned settings with 1–99 integer navigation counts", () => {
    expect(parseReaderSettings({
      version: 1,
      navigation: { backwardTextSteps: 3, forwardTextSteps: 9 },
    })).toEqual({ version: 1, navigation: { backwardTextSteps: 3, forwardTextSteps: 9 }, pageTransitions: false });
    expect(parseReaderSettings({
      version: 1,
      navigation: { backwardTextSteps: 3, forwardTextSteps: 9 },
      pageTransitions: true,
    })).toEqual({ version: 1, navigation: { backwardTextSteps: 3, forwardTextSteps: 9 }, pageTransitions: true });
    expect(parseReaderSettings({ version: 1, navigation: { backwardTextSteps: 0, forwardTextSteps: 2 } })).toBeUndefined();
    expect(parseReaderSettings({ version: 1, navigation: { backwardTextSteps: 2.5, forwardTextSteps: 2 } })).toBeUndefined();
    expect(parseReaderSettings({ version: 2, navigation: { backwardTextSteps: 2, forwardTextSteps: 2 } })).toBeUndefined();
  });
});
