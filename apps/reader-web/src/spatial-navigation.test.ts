import { afterEach, describe, expect, it } from "vitest";
import { findSpatialTarget, spatialItems } from "./spatial-navigation.js";

function item(zone: string, zoneOrder: number, row: string, left: number, top: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.dataset.spatialItem = "true";
  button.dataset.spatialZone = zone;
  button.dataset.spatialZoneOrder = String(zoneOrder);
  button.dataset.spatialRow = row;
  Object.defineProperty(button, "getBoundingClientRect", {
    value: () => ({ left, top, width: 20, height: 20, right: left + 20, bottom: top + 20, x: left, y: top, toJSON: () => ({}) }),
  });
  document.body.append(button);
  return button;
}

afterEach(() => document.body.replaceChildren());

describe("spatial navigation", () => {
  it("moves vertically by row, preserves the nearest column, and wraps", () => {
    const first = item("menu", 0, "0", 0, 0);
    const secondLeft = item("menu", 0, "1", 0, 40);
    const secondRight = item("menu", 0, "1", 100, 40);
    const third = item("menu", 0, "2", 100, 80);
    const items = spatialItems(document.body);
    expect(findSpatialTarget(items, first, "down")).toBe(secondLeft);
    expect(findSpatialTarget(items, secondRight, "down")).toBe(third);
    expect(findSpatialTarget(items, third, "down")).toBe(first);
    expect(findSpatialTarget(items, first, "up")).toBe(third);
  });

  it("moves horizontally within a row before crossing to an adjacent zone", () => {
    const filter = item("filters", 0, "0", 0, 0);
    const book = item("books", 1, "0", 100, 0);
    const statusLeft = item("detail", 2, "1", 200, 0);
    const statusRight = item("detail", 2, "1", 240, 0);
    const items = spatialItems(document.body);
    expect(findSpatialTarget(items, filter, "right")).toBe(book);
    expect(findSpatialTarget(items, book, "right")).toBe(statusLeft);
    expect(findSpatialTarget(items, statusLeft, "right")).toBe(statusRight);
    expect(findSpatialTarget(items, statusRight, "right")).toBe(statusRight);
    expect(findSpatialTarget(items, statusLeft, "left")).toBe(book);
  });

  it("excludes disabled and aria-disabled controls", () => {
    const enabled = item("menu", 0, "0", 0, 0);
    const disabled = item("menu", 0, "1", 0, 40);
    disabled.disabled = true;
    const ariaDisabled = item("menu", 0, "2", 0, 80);
    ariaDisabled.setAttribute("aria-disabled", "true");
    expect(spatialItems(document.body)).toEqual([enabled]);
  });
});
