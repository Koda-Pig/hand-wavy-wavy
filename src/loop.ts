import type {
  HandLandmarker,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { CanvasLayout } from "./canvasLayout";
import { drawSkeleton } from "./draw";
import { GRACE_FRAMES, type HandSlot } from "./landmarks";
import { createPoseRouter } from "./poses";
import { BurstEffect } from "./effects/burst";
import { StreamEffect, type StreamAnchor } from "./effects/stream";
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

/** Effect options are constant, so build them once instead of spreading per frame. */
const SWIRL_OPTS: EffectOpts = { ...DEFAULT_OPTS, color: SWIRL_TINT };
const HAND_OPTS: readonly EffectOpts[] = HAND_TINTS.map((color) => ({
  ...DEFAULT_OPTS,
  color,
}));

/**
 * Once every effect is empty, keep fading for this many frames so existing
 * trails finish decaying (0.77^90 ≈ 6e-11 — far below one 8-bit level), then
 * stop repainting a canvas that can no longer change.
 */
const IDLE_FADE_FRAMES = 90;

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
  // alpha: false — the canvas is fully covered by the black fade every frame,
  // so it never needs to be blended with the page behind it.
  const overlayCtx = canvas.getContext("2d", { alpha: false });
  if (!overlayCtx) throw new Error("Could not get 2d canvas context");
  const ctx: CanvasRenderingContext2D = overlayCtx;

  let lastDetectTimestamp = -1;
  let lastVideoTime = -1;
  let lastFrameMs = -1;
  let idleFrames = 0;
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
  const swirlInput = {
    active: false,
    motion: "still" as "still" | "moving",
    vx: 0,
    vy: 0,
  };
  const burstAnchors = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const streamAnchors: StreamAnchor[] = [
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0, vx: 0, vy: 0 },
  ];

  // A resize clears the canvas (setting canvas.width), so the idle skip must
  // be cancelled to repaint the background.
  let lastLayout: CanvasLayout | null = null;
  function layoutChanged(layout: CanvasLayout): boolean {
    const changed = layout !== lastLayout;
    lastLayout = layout;
    return changed;
  }

  function updateGraceState(results: HandLandmarkerResult): void {
    const detected = results.landmarks.length;
    for (let i = 0; i < 2; i++) {
      if (i < detected) {
        handMissed[i] = 0;
        graceLandmarks[i] = results.landmarks[i];
        graceHandednesses[i] = results.handednesses[i] ?? null;
        continue;
      }
      handMissed[i]++;
      if (handMissed[i] > GRACE_FRAMES) {
        graceLandmarks[i] = null;
        graceHandednesses[i] = null;
      }
    }
  }

  // Reused every frame instead of allocating a fresh array + slot objects.
  const slotStore: HandSlot[] = [{ landmarks: [] }, { landmarks: [] }];
  const displaySlots: (HandSlot | null)[] = [null, null];

  function getDisplaySlots(): (HandSlot | null)[] {
    for (let i = 0; i < 2; i++) {
      const landmarks = graceLandmarks[i];
      if (!landmarks) {
        displaySlots[i] = null;
        continue;
      }
      const slot = slotStore[i];
      slot.landmarks = landmarks;
      slot.handedness = graceHandednesses[i] ?? undefined;
      displaySlots[i] = slot;
    }
    return displaySlots;
  }

  function loop(timestamp: number): void {
    // Only run inference when the camera has delivered a new frame. rAF runs
    // at display rate (60–144 Hz) but the webcam is typically 30 fps, so the
    // old per-rAF detect re-ran the model on duplicate frames 2–5× over.
    if (
      timestamp !== lastDetectTimestamp &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTime
    ) {
      lastDetectTimestamp = timestamp;
      lastVideoTime = video.currentTime;
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

    const anyHand = slots[0] !== null || slots[1] !== null;
    const anyParticles =
      swirl.hasParticles() ||
      bursts[0].hasParticles() ||
      bursts[1].hasParticles() ||
      streams[0].hasParticles() ||
      streams[1].hasParticles();
    if (anyHand || anyParticles || layoutChanged(layout)) {
      idleFrames = 0;
    } else if (idleFrames >= IDLE_FADE_FRAMES) {
      // Nothing alive, nothing to draw, canvas fully faded: skip the frame.
      requestAnimationFrame(loop);
      return;
    } else {
      idleFrames++;
    }

    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

    // Shared partial-frame fade — establishes the persistence model and
    // switches composite to 'lighter' for additive effect blending.
    applyFade(ctx, camW, camH, DEFAULT_OPTS.trail);

    // 1) Global Swirl (palm gate).
    swirlInput.active = poseFrame.swirl.active;
    swirlInput.motion = poseFrame.swirl.palmMotion;
    swirlInput.vx = poseFrame.swirl.palmVx;
    swirlInput.vy = poseFrame.swirl.palmVy;
    swirl.step(dt, swirlInput, SWIRL_OPTS);
    swirl.draw(ctx, SWIRL_OPTS);

    // 2) Per-hand Burst / Stream routed by pose.
    for (let i = 0; i < 2; i++) {
      const pose = poseFrame.hands[i];
      const handOpts = HAND_OPTS[i] ?? HAND_OPTS[0];

      const burst = bursts[i];
      const stream = streams[i];

      let burstAnchor: { x: number; y: number } | null = null;
      if (pose && pose.shape === "index" && pose.indexMotion === "still") {
        burstAnchor = burstAnchors[i];
        burstAnchor.x = pose.tipX;
        burstAnchor.y = pose.tipY;
      }
      burst.step(dt, burstAnchor, handOpts);
      burst.draw(ctx, handOpts);

      let streamAnchor: StreamAnchor | null = null;
      if (pose && pose.shape === "index" && pose.indexMotion === "moving") {
        streamAnchor = streamAnchors[i];
        streamAnchor.x = pose.tipX;
        streamAnchor.y = pose.tipY;
        streamAnchor.vx = pose.tipVx;
        streamAnchor.vy = pose.tipVy;
      }
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
