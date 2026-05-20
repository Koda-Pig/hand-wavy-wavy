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

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;

    layout = { camW, camH, scale, offsetX, offsetY, dpr };
  }

  const observer = new ResizeObserver(update);
  observer.observe(stage);
  window.addEventListener("resize", update);
  update();

  return () => layout;
}
