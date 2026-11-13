export type CanvasLayout = {
  camW: number;
  camH: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  dpr: number;
};

export function bindCanvasLayout(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  stage: HTMLElement,
): () => CanvasLayout | null {
  let layout: CanvasLayout | null = null;

  function update(): void {
    const camW = video.videoWidth;
    const camH = video.videoHeight;
    const viewW = stage.clientWidth;
    const viewH = stage.clientHeight;
    if (camW === 0 || camH === 0 || viewW === 0 || viewH === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(viewW / camW, viewH / camH);
    const offsetX = (viewW - camW * scale) / 2;
    const offsetY = (viewH - camH * scale) / 2;

    const pixelW = Math.round(viewW * dpr);
    const pixelH = Math.round(viewH * dpr);

    // ResizeObserver and window "resize" both fire for the same change.
    // Re-assigning canvas.width/height reallocates the backing store and wipes
    // the trails even when nothing changed, so bail out on a no-op update.
    if (
      layout &&
      layout.camW === camW &&
      layout.camH === camH &&
      layout.dpr === dpr &&
      canvas.width === pixelW &&
      canvas.height === pixelH
    ) {
      return;
    }

    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;

    layout = { camW, camH, scale, offsetX, offsetY, dpr };
  }

  const observer = new ResizeObserver(update);
  observer.observe(stage);
  // Kept for devicePixelRatio changes (browser zoom / moving between monitors),
  // which don't resize the stage in CSS pixels.
  window.addEventListener("resize", update);
  update();

  return () => layout;
}
