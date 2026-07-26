/**
 * Drag-to-resize a panel width from a handle element on one of its edges.
 * Shared by Sidebar, Inspector, and the per-terminal Agent Memory rail --
 * three otherwise-unrelated components that all need the exact same
 * "mousedown on handle, drag, clamp, persist" behavior.
 *
 * @param getWidth - current width
 * @param setWidth - persist a new width (already clamped by the caller's setter)
 * @param direction - "left" means dragging right GROWS the panel (handle on
 *   the panel's left edge, e.g. Inspector); "right" means dragging right
 *   SHRINKS it (handle on the panel's right edge, e.g. Sidebar).
 * @param getScale - CSS scale the handle is rendered under, for panels that
 *   live inside the zoomable canvas. Mouse deltas arrive in screen pixels but
 *   the width is in canvas units, so without this the panel resizes faster than
 *   the cursor when zoomed out and slower when zoomed in. Defaults to 1 for the
 *   app-chrome panels, which aren't transformed.
 */
export function useResizeHandle(
  getWidth: () => number,
  setWidth: (width: number) => void,
  direction: "left" | "right",
  getScale: () => number = () => 1
) {
  function startResize(event: MouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getWidth();
    const sign = direction === "left" ? -1 : 1;
    const scale = getScale() || 1;

    function onMove(e: MouseEvent): void {
      const delta = ((e.clientX - startX) * sign) / scale;
      setWidth(startWidth + delta);
    }
    function onUp(): void {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { startResize };
}
