import "@testing-library/jest-dom/vitest";

if (!URL.createObjectURL) URL.createObjectURL = () => `blob:airnobe-${Math.random()}`;
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
Object.defineProperty(window, "scrollBy", { value: () => {}, writable: true });
Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true });
Object.defineProperty(document.documentElement, "scrollHeight", { value: 100_000, configurable: true });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: () => {}, writable: true });
Object.defineProperty(window, "requestAnimationFrame", { value: (callback: FrameRequestCallback) => window.setTimeout(callback, 0), writable: true });
Object.defineProperty(window, "cancelAnimationFrame", { value: (handle: number) => window.clearTimeout(handle), writable: true });
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => ({
    x: 0,
    y: 0,
    top: 0,
    right: 760,
    bottom: 72,
    left: 0,
    width: 760,
    height: 72,
    toJSON: () => ({}),
  }),
});
