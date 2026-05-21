import type { TerminalSession } from "@renderer/type/terminal";
import type { Group } from "@renderer/type/workspace";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_TERMINAL_WIDTH = 640;
const DEFAULT_TERMINAL_HEIGHT = 400;
const PADDING = 40;
const MAX_SEARCH_RADIUS = 25; // max spiral radius in grid cells

/**
 * Check if two rectangles overlap (including padding).
 */
function rectsOverlap(a: Rect, b: Rect, padding: number): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

/**
 * Check if a candidate rectangle collides with any existing terminal or group.
 */
function hasCollision(
  candidate: Rect,
  terminals: TerminalSession[],
  groups: Group[],
  excludeTerminalId?: string
): boolean {
  for (const t of terminals) {
    if (excludeTerminalId && t.id === excludeTerminalId) continue;
    const tw = t.node.width || DEFAULT_TERMINAL_WIDTH;
    const th = t.node.height || DEFAULT_TERMINAL_HEIGHT;
    if (rectsOverlap(candidate, { x: t.node.x, y: t.node.y, width: tw, height: th }, PADDING)) {
      return true;
    }
  }
  for (const g of groups) {
    if (rectsOverlap(candidate, { x: g.x, y: g.y, width: g.width, height: g.height }, PADDING)) {
      return true;
    }
  }
  return false;
}

/**
 * Find a non-overlapping position for a new terminal using a spiral grid search.
 *
 * @param terminals - Existing terminal sessions on the canvas
 * @param groups - Existing groups on the canvas
 * @param viewport - Optional viewport to center placement near
 * @param preferred - Optional preferred position to try first
 * @param size - Size of the new terminal
 * @returns A {x, y} position guaranteed not to overlap (within search limits)
 */
export function findNonOverlappingPosition(
  terminals: TerminalSession[],
  groups: Group[],
  viewport?: { x: number; y: number; zoom: number } | null,
  preferred?: { x: number; y: number } | null,
  size: { width: number; height: number } = {
    width: DEFAULT_TERMINAL_WIDTH,
    height: DEFAULT_TERMINAL_HEIGHT,
  }
): { x: number; y: number } {
  const cellW = size.width + PADDING;
  const cellH = size.height + PADDING;

  // Determine base position
  let baseX = 100;
  let baseY = 100;

  if (preferred) {
    baseX = preferred.x;
    baseY = preferred.y;
  } else if (viewport) {
    // Place near the center of the current viewport
    // viewport x,y is the top-left of the visible area in canvas coords
    const screenW = window.innerWidth || 1400;
    const screenH = window.innerHeight || 900;
    baseX = -viewport.x / viewport.zoom + screenW / 2 / viewport.zoom - size.width / 2;
    baseY = -viewport.y / viewport.zoom + screenH / 2 / viewport.zoom - size.height / 2;
  }

  // Round to grid
  const startCol = Math.round(baseX / cellW);
  const startRow = Math.round(baseY / cellH);

  // Try the exact preferred/base position first (not snapped to grid)
  const exactCandidate: Rect = {
    x: preferred ? preferred.x : baseX,
    y: preferred ? preferred.y : baseY,
    width: size.width,
    height: size.height,
  };
  if (!hasCollision(exactCandidate, terminals, groups)) {
    return { x: exactCandidate.x, y: exactCandidate.y };
  }

  // Spiral search around the base position
  // Directions: right, down, left, up
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
  ];

  let col = startCol;
  let row = startRow;
  let stepLen = 1;
  let dirIndex = 0;

  for (let radius = 1; radius <= MAX_SEARCH_RADIUS; radius++) {
    for (let rep = 0; rep < 2; rep++) {
      const { dx, dy } = dirs[dirIndex % 4];
      for (let step = 0; step < stepLen; step++) {
        col += dx;
        row += dy;

        const candidate: Rect = {
          x: col * cellW,
          y: row * cellH,
          width: size.width,
          height: size.height,
        };

        if (!hasCollision(candidate, terminals, groups)) {
          return { x: candidate.x, y: candidate.y };
        }
      }
      dirIndex++;
    }
    stepLen++;
  }

  // Fallback: place far to the right of the rightmost terminal
  let maxX = baseX;
  let maxY = baseY;
  for (const t of terminals) {
    const tw = t.node.width || DEFAULT_TERMINAL_WIDTH;
    maxX = Math.max(maxX, t.node.x + tw + PADDING);
    maxY = Math.max(maxY, t.node.y);
  }

  return { x: maxX, y: maxY };
}
