import type {
  HandLandmarker,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { CanvasLayout } from "./canvasLayout";
import { drawSkeleton } from "./draw";
import { GRACE_FRAMES, type HandSlot } from "./landmarks";
import { createPoseRouter } from "./poses";
import { BurstEffect } from "./effects/burst";
import { StreamEffect } from "./effects/stream";
import { SwirlEffect } from "./effects/swirl";
import {
  applyFade,
  DEFAULT_OPTS,
  resetShadow,
  type EffectOpts,
  type RGB,
} from "./effects/effectBase";

/** Per-hand tint applied to Burst/Stream emitters. */
const HAND_TINTS: readonly RGB[] = [
  [199, 125, 255],
  [125, 200, 255],
];

const SWIRL_TINT: RGB = [180, 180, 240];

export type LoopHandle = {
  setSkeletonVisible(value: boolean): void;
  toggleSkeleton(): void;
};

export function startLoop(
  handLandmarker: HandLandmarker,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  getLayout: () => CanvasLayout | null,
): LoopHandle {
  const overlayCtx = canvas.getContext("2d");
  if (!overlayCtx) throw new Error("Could not get 2d canvas context");
  const ctx: CanvasRenderingContext2D = overlayCtx;

  let lastDetectTimestamp = -1;
  let lastFrameMs = -1;
  let skeletonVisible = false;

  const handMissed = [0, 0];
  const graceLandmarks: (HandLandmarkerResult["landmarks"][number] | null)[] = [
    null,
    null,
  ];
  const graceHandednesses: (HandLandmarkerResult["handednesses"][number] | null)[] = [
    null,
    null,
  ];

  const poseRouter = createPoseRouter();
  const bursts: BurstEffect[] = [new BurstEffect(), new BurstEffect()];
  const streams: StreamEffect[] = [new StreamEffect(), new StreamEffect()];
  let swirl: SwirlEffect | null = null;

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
    if (timestamp !== lastDetectTimestamp) {
      lastDetectTimestamp = timestamp;
      const results = handLandmarker.detectForVideo(video, timestamp);
      updateGraceState(results);
    }

    const layout = getLayout();
    if (!layout) {
      requestAnimationFrame(loop);
      return;
    }

    const dtMs = lastFrameMs < 0 ? 16 : Math.max(0, Math.min(100, timestamp - lastFrameMs));
    lastFrameMs = timestamp;
    const dt = dtMs / 1000;

    const { camW, camH, scale, offsetX, offsetY, dpr } = layout;

    if (!swirl) {
      swirl = new SwirlEffect(camW, camH);
    } else {
      swirl.resize(camW, camH);
    }

    const slots = getDisplaySlots();
    const poseFrame = poseRouter.update(slots, dt, camW, camH);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

    // Shared partial-frame fade — establishes the persistence model and
    // switches composite to 'lighter' for additive effect blending.
    applyFade(ctx, camW, camH, DEFAULT_OPTS.trail);

    // 1) Global Swirl (palm gate).
    const swirlOpts: EffectOpts = { ...DEFAULT_OPTS, color: SWIRL_TINT };
    swirl.step(
      dt,
      {
        active: poseFrame.swirl.active,
        motion: poseFrame.swirl.palmMotion,
        vx: poseFrame.swirl.palmVx,
        vy: poseFrame.swirl.palmVy,
      },
      swirlOpts,
    );
    swirl.draw(ctx, swirlOpts);

    // 2) Per-hand Burst / Stream routed by pose.
    for (let i = 0; i < 2; i++) {
      const pose = poseFrame.hands[i];
      const tint = HAND_TINTS[i] ?? HAND_TINTS[0];
      const handOpts: EffectOpts = { ...DEFAULT_OPTS, color: tint };

      const burst = bursts[i];
      const stream = streams[i];

      const burstAnchor =
        pose && pose.shape === "index" && pose.indexMotion === "still"
          ? { x: pose.tipX, y: pose.tipY }
          : null;
      burst.step(dt, burstAnchor, handOpts);
      burst.draw(ctx, handOpts);

      const streamAnchor =
        pose && pose.shape === "index" && pose.indexMotion === "moving"
          ? { x: pose.tipX, y: pose.tipY, vx: pose.tipVx, vy: pose.tipVy }
          : null;
      stream.step(dt, streamAnchor, handOpts);
      stream.draw(ctx, handOpts);
    }

    // 3) Optional skeleton on top.
    if (skeletonVisible) {
      ctx.globalCompositeOperation = "source-over";
      resetShadow(ctx);
      drawSkeleton(ctx, slots, camW, camH);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  return {
    setSkeletonVisible(value: boolean): void {
      skeletonVisible = value;
    },
    toggleSkeleton(): void {
      skeletonVisible = !skeletonVisible;
    },
  };
}
