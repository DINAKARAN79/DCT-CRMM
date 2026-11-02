export type GridPosition = { x: number; y: number; w: number; h: number };

export type GridItem = {
  id: string;
  position: GridPosition;
  minW?: number;
  minH?: number;
  minimized?: boolean;
};

export function overlaps(a: GridPosition, b: GridPosition) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function nextAvailablePosition(
  items: GridItem[],
  width: number,
  height: number,
  columns: number,
): GridPosition {
  const w = Math.max(1, Math.min(columns, width));
  const h = Math.max(1, height);
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= columns - w; x += 1) {
      const position = { x, y, w, h };
      if (!items.some((item) => overlaps(position, item.position))) {
        return position;
      }
    }
  }
}

export function clampGridValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function layoutGap(spacing: "compact" | "normal" | "wide") {
  if (spacing === "compact") return 4;
  if (spacing === "wide") return 20;
  return 12;
}

export function measureGridStride(
  grid: HTMLElement | null,
  columns: number,
  spacing: "compact" | "normal" | "wide",
) {
  const gap = layoutGap(spacing);
  const row = 90 + gap;
  let width = 0;
  if (grid && typeof window !== "undefined") {
    const style = window.getComputedStyle(grid);
    const padding =
      (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    width = grid.clientWidth - padding;
  }
  if (!width || columns < 1) {
    width = typeof window !== "undefined" ? window.innerWidth : 1200;
  }
  const column = (width + gap) / Math.max(columns, 1);
  return { column: Math.max(column, 1), row, gap };
}

export function layoutChanged(
  before: Array<{ id: string; position: GridPosition }> | null,
  after: Array<{ id: string; position: GridPosition }>,
) {
  if (!before) return false;
  if (before.length !== after.length) return true;
  return after.some((widget) => {
    const start = before.find((item) => item.id === widget.id);
    if (!start) return true;
    return (
      start.position.x !== widget.position.x ||
      start.position.y !== widget.position.y ||
      start.position.w !== widget.position.w ||
      start.position.h !== widget.position.h
    );
  });
}

export function normalizeLayout<T extends GridItem>(
  input: T[],
  movingId?: string,
  columns = 12,
  compactMovingUp = false,
): T[] {
  const result: T[] = [];
  const otherWidgets =
    compactMovingUp && movingId
      ? normalizeLayout(
          input.filter((widget) => widget.id !== movingId),
          undefined,
          columns,
        )
      : [];
  const ordered = [...input].sort((a, b) =>
    a.id === movingId
      ? -1
      : b.id === movingId
        ? 1
        : (a.position?.y ?? 0) - (b.position?.y ?? 0),
  );
  for (const widget of ordered) {
    const minW = widget.minW || 2;
    const minH = widget.minH || 2;
    const width = Math.max(minW, Math.min(columns, widget.position.w));
    const height = Math.max(minH, widget.minimized ? 1 : widget.position.h);
    const next: T = {
      ...widget,
      position: {
        x: Math.max(0, Math.min(Math.max(columns - width, 0), widget.position.x)),
        y: Math.max(0, widget.position.y),
        w: width,
        h: height,
      },
    };
    if (compactMovingUp && widget.id === movingId && next.position.y > 0) {
      const candidateColumns = Array.from(
        { length: Math.max(0, columns - width + 1) },
        (_, index) => index,
      ).sort(
        (a, b) =>
          Math.abs(a - next.position.x) - Math.abs(b - next.position.x) || a - b,
      );
      for (let y = 0; y < next.position.y; y += 1) {
        const availableColumn = candidateColumns.find((x) => {
          const candidate = { ...next.position, x, y };
          return !otherWidgets.some((item) => overlaps(candidate, item.position));
        });
        if (availableColumn !== undefined) {
          next.position.x = availableColumn;
          next.position.y = y;
          break;
        }
      }
    }
    while (result.some((item) => overlaps(next.position, item.position))) {
      next.position.y += 1;
    }
    result.push(next);
  }
  return result.sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
}
