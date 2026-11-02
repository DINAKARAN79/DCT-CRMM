import { describe, expect, it } from "vitest";
import {
  layoutChanged,
  measureGridStride,
  nextAvailablePosition,
  normalizeLayout,
  overlaps,
  type GridItem,
} from "./dashboard-layout";

function widget(id: string, x: number, y: number, w = 6, h = 3): GridItem {
  return { id, position: { x, y, w, h }, minW: 2, minH: 2 };
}

describe("dashboard drag layout", () => {
  it("snaps a drag stride to the grid tracks", () => {
    const stride = measureGridStride(null, 12, "normal");
    expect(stride.row).toBe(102);
    expect(stride.column).toBeGreaterThan(1);
  });

  it("keeps the dropped widget in place and pushes the neighbor out of the way", () => {
    const dropped = [
      widget("a", 6, 0),
      widget("b", 6, 0),
    ];
    const next = normalizeLayout(dropped, "a", 12);
    const a = next.find((item) => item.id === "a")!;
    const b = next.find((item) => item.id === "b")!;
    expect(overlaps(a.position, b.position)).toBe(false);
    expect(a.position).toMatchObject({ x: 6, y: 0 });
    expect(b.position.y).toBeGreaterThanOrEqual(a.position.h);
    expect(layoutChanged(
      [{ id: "a", position: { x: 0, y: 0, w: 6, h: 3 } }, { id: "b", position: { x: 6, y: 0, w: 6, h: 3 } }],
      next,
    )).toBe(true);
  });

  it("lays out several widgets without overlaps", () => {
    const next = normalizeLayout(
      [
        widget("a", 0, 0, 8, 3),
        widget("b", 4, 0, 6, 3),
        widget("c", 0, 1, 4, 3),
      ],
      "b",
      12,
    );
    for (let index = 0; index < next.length; index += 1) {
      for (let other = index + 1; other < next.length; other += 1) {
        expect(overlaps(next[index].position, next[other].position)).toBe(false);
      }
    }
  });

  it("places new widgets into the first free dashboard slot", () => {
    const items = [
      widget("a", 0, 0, 4, 3),
      widget("b", 4, 0, 4, 3),
    ];

    expect(nextAvailablePosition(items, 4, 3, 12)).toEqual({
      x: 8,
      y: 0,
      w: 4,
      h: 3,
    });
    expect(
      nextAvailablePosition(
        [...items, widget("c", 8, 0, 4, 3)],
        4,
        3,
        12,
      ),
    ).toEqual({ x: 0, y: 3, w: 4, h: 3 });
  });
});
