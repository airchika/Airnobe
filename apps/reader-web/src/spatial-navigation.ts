import { useEffect, type RefObject } from "react";

export type SpatialDirection = "up" | "down" | "left" | "right";

interface SpatialNavigationOptions {
  rootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  editing?: boolean;
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

export function useSpatialNavigation({ rootRef, enabled, editing = false, onActivate, onCancel, resolveTarget, keys = "wasd" }: SpatialNavigationOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
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
      if (!root) return;
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
