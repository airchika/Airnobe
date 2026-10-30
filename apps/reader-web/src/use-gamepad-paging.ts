import { useEffect, useRef } from "react";

type Direction = -1 | 0 | 1;

export const GAMEPAD_ACTIONS = [
  { button: 0, action: "toggleJapanese" },
  { button: 2, action: "toggleAssistedRuby" },
  { button: 3, action: "toggleKatakanaRomaji" },
  { button: 9, action: "toggleFullscreen" },
  { button: 1, action: "returnLibrary" },
] as const;
export type GamepadAction = typeof GAMEPAD_ACTIONS[number]["action"];

function direction(pad: Gamepad): Direction {
  const previous = pad.buttons[12]?.pressed || pad.buttons[14]?.pressed;
  const next = pad.buttons[13]?.pressed || pad.buttons[15]?.pressed;
  if (previous || next) return previous === next ? 0 : previous ? -1 : 1;
  // Both sticks work; use the strongest axis so diagonals produce one action.
  const axis = pad.axes.slice(0, 4).reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
  return Math.abs(axis) < 0.55 ? 0 : axis < 0 ? -1 : 1;
}

export function useGamepadPaging(enabled: boolean, onPage: (direction: -1 | 1) => void, onAction?: (action: GamepadAction) => void): void {
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== "function") return;
    let held: Direction = 0;
    let nextRepeat = 0;
    let ready = false;
    let padIndex: number | undefined;
    let pressedButtons = new Set<number>();
    const reset = (): void => { held = 0; ready = false; pressedButtons.clear(); };
    const timer = window.setInterval(() => {
      const target = document.activeElement as HTMLElement | null;
      if (!document.hasFocus() || document.visibilityState !== "visible"
        || target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) {
        reset();
        return;
      }
      let pads: (Gamepad | null)[];
      try { pads = Array.from(navigator.getGamepads()); }
      catch { reset(); return; }
      const pad = pads.find((item) => item?.connected && item.mapping === "standard");
      if (!pad) { padIndex = undefined; reset(); return; }
      if (padIndex !== pad.index) { padIndex = pad.index; reset(); }
      const current = direction(pad);
      const pressed = new Set(GAMEPAD_ACTIONS.filter(({ button }) => pad.buttons[button]?.pressed).map(({ button }) => button));
      // Require neutral after connecting, switching windows, or closing a dialog.
      if (!ready) {
        if (!current && pressed.size === 0) ready = true;
        return;
      }
      const actions = GAMEPAD_ACTIONS.filter(({ button }) => pressed.has(button) && !pressedButtons.has(button));
      pressedButtons = pressed;
      // Returning takes priority over simultaneous page/display changes.
      if (actions.some(({ action }) => action === "returnLibrary")) {
        reset();
        onActionRef.current?.("returnLibrary");
        return;
      }
      for (const { action } of actions) onActionRef.current?.(action);
      if (!current) { held = 0; return; }
      const now = performance.now();
      if (current !== held) {
        held = current;
        nextRepeat = now + 500;
        onPageRef.current(current);
      } else if (now >= nextRepeat) {
        nextRepeat = now + 350;
        onPageRef.current(current);
      }
    }, 50);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [enabled]);
}
