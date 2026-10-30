import { useEffect } from "react";

const IDLE_DELAY_MS = 3_000;

/** Hide only the page cursor, while Airnobe is visible and focused. */
export function useIdleCursor(): void {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let focused = document.hasFocus();
    let inside = true;
    let pressed = false;

    const reset = (): void => {
      clearTimeout(timer);
      root.classList.remove("cursor-idle");
    };
    const restart = (): void => {
      reset();
      if (focused && inside && !pressed && document.visibilityState === "visible") {
        timer = setTimeout(() => root.classList.add("cursor-idle"), IDLE_DELAY_MS);
      }
    };
    const move = (event: MouseEvent): void => {
      inside = true;
      pressed = event.buttons !== 0;
      restart();
    };
    const down = (): void => { pressed = true; reset(); };
    const up = (): void => { pressed = false; restart(); };
    const leave = (): void => { inside = false; reset(); };
    const focus = (): void => { focused = true; restart(); };
    const blur = (): void => { focused = false; pressed = false; reset(); };

    document.addEventListener("mousemove", move, true);
    document.addEventListener("mousedown", down, true);
    document.addEventListener("mouseup", up, true);
    root.addEventListener("mouseenter", move);
    root.addEventListener("mouseleave", leave);
    document.addEventListener("visibilitychange", restart);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    restart();

    return () => {
      reset();
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("mouseup", up, true);
      root.removeEventListener("mouseenter", move);
      root.removeEventListener("mouseleave", leave);
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
}
