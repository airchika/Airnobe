import { useEffect, useRef, type RefObject } from "react";

import { useGamepadPaging, type GamepadAction } from "./use-gamepad-paging.js";

export type SpatialDirection = "up" | "down" | "left" | "right";

interface SpatialNavigationOptions {
  rootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  editing?: boolean;
  gamepad?: boolean;
  onGamepadAction?(action: GamepadAction): void;
  onActivate?(element: HTMLElement): boolean | void;
  onCancel?(): boolean | void;
  resolveTarget?(items: HTMLElement[], current: HTMLElement, direction: SpatialDirection): HTMLElement | undefined;
  keys?: "wasd" | "arrows" | "both";
}

function isSpatialItem(element: HTMLElement): boolean {
  if (!(element instanceof HTMLElement) || !element.hasAttribute("data-spatial-item")) return false;
  if (element.hidden || element.closest("[hidden]")) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  if (element instanceof HTMLInputElement && element.disabled) return false;
  if (element instanceof HTMLSelectElement && element.disabled) return false;
  return true;
}

export function spatialItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-spatial-item]")].filter(isSpatialItem);
}

function center(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function nearestByAxis(elements: HTMLElement[], current: HTMLElement, axis: "x" | "y"): HTMLElement | undefined {
  const origin = center(current)[axis];
  return elements.reduce<HTMLElement | undefined>((best, candidate) => {
    if (!best) return candidate;
    return Math.abs(center(candidate)[axis] - origin) < Math.abs(center(best)[axis] - origin) ? candidate : best;
  }, undefined);
}

function zoneOrder(element: HTMLElement): number {
  const owner = element.closest<HTMLElement>("[data-spatial-zone-order]");
  const value = Number(element.dataset.spatialZoneOrder ?? owner?.dataset.spatialZoneOrder);
  return Number.isFinite(value) ? value : 0;
}

export function findSpatialTarget(
  items: HTMLElement[],
  current: HTMLElement,
  direction: SpatialDirection,
): HTMLElement | undefined {
  if (items.length === 0) return undefined;
  const zone = current.dataset.spatialZone ?? "default";
  const row = current.dataset.spatialRow ?? "0";
  const zoneItems = items.filter((item) => (item.dataset.spatialZone ?? "default") === zone);

  if (direction === "up" || direction === "down") {
    const rows = [...new Set(zoneItems.map((item) => item.dataset.spatialRow ?? "0"))];
    const currentRow = Math.max(0, rows.indexOf(row));
    const offset = direction === "up" ? -1 : 1;
    const targetRow = rows[(currentRow + offset + rows.length) % rows.length];
    if (targetRow === undefined) return current;
    return nearestByAxis(zoneItems.filter((item) => (item.dataset.spatialRow ?? "0") === targetRow), current, "x") ?? current;
  }

  const rowItems = zoneItems.filter((item) => (item.dataset.spatialRow ?? "0") === row);
  const rowIndex = rowItems.indexOf(current);
  const sameRowTarget = direction === "left" ? rowItems[rowIndex - 1] : rowItems[rowIndex + 1];
  if (sameRowTarget) return sameRowTarget;

  const currentZoneOrder = zoneOrder(current);
  const availableZoneOrders = [...new Set(items.map(zoneOrder))].sort((left, right) => left - right);
  const currentZoneIndex = availableZoneOrders.indexOf(currentZoneOrder);
  const targetZoneOrder = direction === "left"
    ? availableZoneOrders[currentZoneIndex - 1]
    : availableZoneOrders[currentZoneIndex + 1];
  if (targetZoneOrder === undefined) return current;
  return nearestByAxis(items.filter((item) => zoneOrder(item) === targetZoneOrder), current, "y") ?? current;
}

function focusSpatialItem(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function useSpatialNavigation({ rootRef, enabled, editing = false, gamepad = true, onGamepadAction, onActivate, onCancel, resolveTarget, keys = "wasd" }: SpatialNavigationOptions): void {
  const adjustmentRef = useRef<HTMLElement | null>(null);
  const stopAdjusting = (): void => {
    adjustmentRef.current?.removeAttribute("data-gamepad-editing");
    adjustmentRef.current = null;
  };
  useEffect(() => { if (!enabled) stopAdjusting(); return stopAdjusting; }, [enabled]);
  const currentItem = (): HTMLElement | undefined => {
    const root = rootRef.current;
    if (!root || (document.querySelector(".theme-editor") && !root.classList.contains("theme-editor"))) return;
    const items = spatialItems(root);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-spatial-item]") : null;
    return active && items.includes(active) ? active : items[0];
  };
  const adjustableControl = (item: HTMLElement): HTMLInputElement | HTMLSelectElement | null => {
    if (item instanceof HTMLSelectElement) return item;
    const select = item.querySelector<HTMLSelectElement>("select");
    if (select) return select;
    if (item instanceof HTMLInputElement && ["range", "number"].includes(item.type)) return item;
    // Use the slider so adjustments use the same validated, automatically saved change handler.
    return item.classList.contains("appearance-number-entry")
      ? item.closest("label")?.querySelector<HTMLInputElement>('input[type="range"]') ?? null
      : null;
  };
  useGamepadPaging(enabled && gamepad, (direction) => {
    if (editing) return;
    const current = currentItem();
    const root = rootRef.current;
    if (!current || !root) return;
    const control = adjustmentRef.current === current ? adjustableControl(current) : null;
    if (control) {
      const delta = direction === "up" || direction === "right" ? 1 : -1;
      if (control instanceof HTMLSelectElement) {
        const options = [...control.options].filter((option) => !option.disabled);
        const index = options.findIndex((option) => option.value === control.value);
        const next = options[Math.max(0, Math.min(options.length - 1, index + delta))];
        if (next) { control.value = next.value; control.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        const step = Number(control.step) || 1;
        const value = Math.max(control.min === "" ? -Infinity : Number(control.min), Math.min(control.max === "" ? Infinity : Number(control.max), Number(control.value) + delta * step));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, String(Number(value.toFixed(6))));
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    stopAdjusting();
    const target = resolveTarget ? resolveTarget(spatialItems(root), current, direction) : findSpatialTarget(spatialItems(root), current, direction);
    if (target) focusSpatialItem(target);
  }, (action) => {
    if (document.querySelector(".theme-editor") && !rootRef.current?.classList.contains("theme-editor")) return;
    if (action === "toggleSidebar") { stopAdjusting(); onCancel?.(); return; }
    if (action === "topBackward") {
      if (adjustmentRef.current) { stopAdjusting(); return; }
      onCancel?.();
      return;
    }
    if (action !== "topForward") { onGamepadAction?.(action); return; }
    if (editing) return;
    const current = currentItem();
    if (!current) return;
    if (adjustmentRef.current) { stopAdjusting(); return; }
    if (adjustableControl(current)) {
      focusSpatialItem(current);
      adjustmentRef.current = current;
      current.setAttribute("data-gamepad-editing", "true");
      return;
    }
    if (onActivate?.(current)) return;
    current.click();
  }, true);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.querySelector(".theme-editor") && !rootRef.current?.classList.contains("theme-editor")) return;
      if (editing || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      const directions = {
        KeyW: "up",
        KeyS: "down",
        KeyA: "left",
        KeyD: "right",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      }[event.code] as SpatialDirection | undefined;
      const direction = directionAllowed(event.code, keys) ? directions : undefined;
      if (event.code === "Escape" && !editing) {
        if (onCancel?.() !== false) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (!direction && event.code !== "Space" && event.code !== "Enter") return;
      const root = rootRef.current;
      if (!root || (document.querySelector(".theme-editor") && !root.classList.contains("theme-editor"))) return;
      const items = spatialItems(root);
      if (items.length === 0) return;
      const active = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>("[data-spatial-item]")
        : null;
      const current = active && root.contains(active) && items.includes(active) ? active : items[0];
      if (!current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (direction) {
        const target = resolveTarget ? resolveTarget(items, current, direction) : findSpatialTarget(items, current, direction);
        if (target && target !== current) focusSpatialItem(target);
        return;
      }
      if (event.repeat) return;
      if (onActivate?.(current)) return;
      current.click();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editing, enabled, keys, onActivate, onCancel, resolveTarget, rootRef]);
}

function directionAllowed(code: string, keys: "wasd" | "arrows" | "both"): boolean {
  if (code.startsWith("Arrow")) return keys === "arrows" || keys === "both";
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) return keys === "wasd" || keys === "both";
  return false;
}
