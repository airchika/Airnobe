import { useEffect, useRef } from "react";

export type GamepadDirection = "up" | "down" | "left" | "right";
type Direction = GamepadDirection | null;

export const GAMEPAD_ACTIONS = [
  { button: 0, action: "topForward" },
  { button: 1, action: "topBackward" },
  { button: 2, action: "toggleJapanese" },
  { button: 4, action: "toggleAssistedRuby" },
  { button: 5, action: "toggleKatakanaRomaji" },
  { button: 7, action: "toggleFullscreen" },
  { button: 3, action: "returnLibrary" },
] as const;
export type GamepadAction = typeof GAMEPAD_ACTIONS[number]["action"];

function direction(pad: Gamepad): Direction {
  const horizontal = Number(Boolean(pad.buttons[15]?.pressed)) - Number(Boolean(pad.buttons[14]?.pressed));
  const vertical = Number(Boolean(pad.buttons[13]?.pressed)) - Number(Boolean(pad.buttons[12]?.pressed));
  if (pad.buttons.slice(12, 16).some((button) => button.pressed)) {
    if (vertical) return vertical < 0 ? "up" : "down";
    return horizontal ? horizontal < 0 ? "left" : "right" : null;
  }
  // Both sticks work; the strongest axis selects one direction for diagonals.
  let strongest = 0;
  let axisIndex = 0;
  pad.axes.slice(0, 4).forEach((value, index) => {
    if (Math.abs(value) > Math.abs(strongest)) { strongest = value; axisIndex = index; }
  });
  if (Math.abs(strongest) < 0.55) return null;
  return axisIndex % 2 === 0 ? strongest < 0 ? "left" : "right" : strongest < 0 ? "up" : "down";
}

export function useGamepadPaging(enabled: boolean, onPage: (direction: GamepadDirection) => void, onAction?: (action: GamepadAction) => void): void {
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== "function") return;
    let held: Direction = null;
    let nextRepeat = 0;
    let ready = false;
    let padIndex: number | undefined;
    let pressedButtons = new Set<number>();
    const reset = (): void => { held = null; ready = false; pressedButtons.clear(); };
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
      if (!current) { held = null; return; }
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
