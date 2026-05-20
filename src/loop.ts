import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { CanvasLayout } from "./canvasLayout";
import { drawSkeleton } from "./draw";
import { GRACE_FRAMES, type HandSlot } from "./landmarks";

export function startLoop(
  handLandmarker: HandLandmarker,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  getLayout: () => CanvasLayout | null,
): void {
  const overlayCtx = canvas.getContext("2d");
  if (!overlayCtx) throw new Error("Could not get 2d canvas context");
  const ctx: CanvasRenderingContext2D = overlayCtx;

  let lastTimestamp = -1;
  const handMissed = [0, 0];
  const graceLandmarks: (HandLandmarkerResult["landmarks"][number] | null)[] = [
    null,
    null,
  ];
  const graceHandednesses: (HandLandmarkerResult["handednesses"][number] | null)[] = [
    null,
    null,
  ];

  function updateGraceState(results: HandLandmarkerResult): void {
    const present = new Set<number>();

    for (let i = 0; i < results.landmarks.length; i++) {
      present.add(i);
      handMissed[i] = 0;
      graceLandmarks[i] = results.landmarks[i];
      graceHandednesses[i] = results.handednesses[i] ?? null;
    }

    for (let i = 0; i < 2; i++) {
      if (present.has(i)) continue;
      handMissed[i]++;
      if (handMissed[i] > GRACE_FRAMES) {
        graceLandmarks[i] = null;
        graceHandednesses[i] = null;
      }
    }
  }

  function getDisplaySlots(): (HandSlot | null)[] {
    return [0, 1].map((i) => {
      const landmarks = graceLandmarks[i];
      if (!landmarks) return null;
      return {
        landmarks,
        handedness: graceHandednesses[i] ?? undefined,
      };
    });
  }

  function loop(timestamp: number): void {
    if (timestamp !== lastTimestamp) {
      lastTimestamp = timestamp;
      const results = handLandmarker.detectForVideo(video, timestamp);
      updateGraceState(results);
    }

    const layout = getLayout();
    if (!layout) {
      requestAnimationFrame(loop);
      return;
    }

    const { camW, camH, scale, offsetX, offsetY, dpr } = layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);
    drawSkeleton(ctx, getDisplaySlots(), camW, camH);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
