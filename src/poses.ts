import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { mx, my, type HandSlot } from "./landmarks";

/** Smoothing factor on raw per-frame velocity. */
const EMA_VEL_ALPHA = 0.35;

/** Min hold time (ms) before flipping index motion state. */
const INDEX_HOLD_MS = 200;

/** Min hold time (ms) before flipping global palm motion state. */
const PALM_HOLD_MS = 200;

/** px/s — within plan's 25–80 band; tuned mid for clear intent. */
const INDEX_SPEED_THRESH = 55;

/** px/s — palm centroid threshold for Swirl spawn vs displace. */
const PALM_SPEED_THRESH = 70;

/** When camera-space jumps exceed this/frame, ignore (drop-out / re-acquire). */
const MAX_VELOCITY_PX_PER_S = 4000;

export type HandShape = "palm" | "index" | "other";
export type Motion = "still" | "moving";

export type HandPose = {
  shape: HandShape;
  indexMotion: Motion;
  tipX: number;
  tipY: number;
  tipVx: number;
  tipVy: number;
  palmCx: number;
  palmCy: number;
};

export type SwirlGate = {
  active: boolean;
  palmMotion: Motion;
  palmVx: number;
  palmVy: number;
};

export type PoseFrame = {
  hands: (HandPose | null)[];
  swirl: SwirlGate;
};

type HandMemory = {
  prevTipX: number | null;
  prevTipY: number | null;
  emaTipVx: number;
  emaTipVy: number;
  indexMotion: Motion;
  indexCandidate: Motion;
  indexCandidateMs: number;

  prevPalmX: number | null;
  prevPalmY: number | null;
  emaPalmVx: number;
  emaPalmVy: number;
};

type GlobalPalm = {
  motion: Motion;
  candidate: Motion;
  candidateMs: number;
};

function makeMemory(): HandMemory {
  return {
    prevTipX: null,
    prevTipY: null,
    emaTipVx: 0,
    emaTipVy: 0,
    indexMotion: "still",
    indexCandidate: "still",
    indexCandidateMs: 0,
    prevPalmX: null,
    prevPalmY: null,
    emaPalmVx: 0,
    emaPalmVy: 0,
  };
}

function resetMemory(mem: HandMemory): void {
  mem.prevTipX = null;
  mem.prevTipY = null;
  mem.emaTipVx = 0;
  mem.emaTipVy = 0;
  mem.indexMotion = "still";
  mem.indexCandidate = "still";
  mem.indexCandidateMs = 0;
  mem.prevPalmX = null;
  mem.prevPalmY = null;
  mem.emaPalmVx = 0;
  mem.emaPalmVy = 0;
}

function dist2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * A finger is "extended" when its tip is farther from the wrist than its PIP joint
 * (a robust proxy across orientations).
 */
function fingerExtended(
  lm: NormalizedLandmark[],
  tipIdx: number,
  pipIdx: number,
): boolean {
  const w = lm[0];
  const tip = lm[tipIdx];
  const pip = lm[pipIdx];
  if (!w || !tip || !pip) return false;
  return dist2D(tip, w) > dist2D(pip, w) * 1.05;
}

/**
 * Open palm gate: all four fingers extended + thumb open + palm broadly facing
 * camera. Palm-facing proxy: 2D ratio of palm width (5↔17) to hand length (0↔9);
 * collapses when the hand is edge-on so this filters out side-on poses.
 */
function isOpenPalm(lm: NormalizedLandmark[]): boolean {
  if (!fingerExtended(lm, 8, 6)) return false;
  if (!fingerExtended(lm, 12, 10)) return false;
  if (!fingerExtended(lm, 16, 14)) return false;
  if (!fingerExtended(lm, 20, 18)) return false;

  const wrist = lm[0];
  const middleMcp = lm[9];
  const indexMcp = lm[5];
  const pinkyMcp = lm[17];
  const thumbTip = lm[4];
  if (!wrist || !middleMcp || !indexMcp || !pinkyMcp || !thumbTip) return false;

  const handLen = dist2D(wrist, middleMcp);
  if (handLen < 1e-6) return false;
  const palmWidth = dist2D(indexMcp, pinkyMcp);
  if (palmWidth / handLen < 0.55) return false;

  const thumbOpen = dist2D(thumbTip, indexMcp) / handLen > 0.45;
  return thumbOpen;
}

/** Index-only gate: index extended, other 3 curled. Thumb state ignored. */
function isIndexOnly(lm: NormalizedLandmark[]): boolean {
  if (!fingerExtended(lm, 8, 6)) return false;
  if (fingerExtended(lm, 12, 10)) return false;
  if (fingerExtended(lm, 16, 14)) return false;
  if (fingerExtended(lm, 20, 18)) return false;
  return true;
}

function classifyShape(lm: NormalizedLandmark[]): HandShape {
  if (isOpenPalm(lm)) return "palm";
  if (isIndexOnly(lm)) return "index";
  return "other";
}

function updateEmaVelocity(
  prev: number | null,
  current: number,
  dt: number,
  ema: number,
): { prev: number; ema: number } {
  if (prev === null || dt <= 0) {
    return { prev: current, ema: 0 };
  }
  const raw = (current - prev) / dt;
  const clamped = Math.max(-MAX_VELOCITY_PX_PER_S, Math.min(MAX_VELOCITY_PX_PER_S, raw));
  const next = ema + (clamped - ema) * EMA_VEL_ALPHA;
  return { prev: current, ema: next };
}

function debounceMotion(
  current: Motion,
  candidate: Motion,
  candidateMs: number,
  desired: Motion,
  dt: number,
  holdMs: number,
): { motion: Motion; candidate: Motion; candidateMs: number } {
  if (desired === current) {
    return { motion: current, candidate: desired, candidateMs: 0 };
  }
  if (desired !== candidate) {
    return { motion: current, candidate: desired, candidateMs: dt * 1000 };
  }
  const next = candidateMs + dt * 1000;
  if (next >= holdMs) {
    return { motion: desired, candidate: desired, candidateMs: 0 };
  }
  return { motion: current, candidate, candidateMs: next };
}

export type PoseRouter = {
  update(
    slots: (HandSlot | null)[],
    dt: number,
    width: number,
    height: number,
  ): PoseFrame;
};

export function createPoseRouter(): PoseRouter {
  const hands: HandMemory[] = [makeMemory(), makeMemory()];
  const palmGlobal: GlobalPalm = { motion: "still", candidate: "still", candidateMs: 0 };

  function update(
    slots: (HandSlot | null)[],
    dt: number,
    width: number,
    height: number,
  ): PoseFrame {
    const out: (HandPose | null)[] = [null, null];

    let palmActive = false;
    let dominantPalmSpeed = -1;
    let dominantVx = 0;
    let dominantVy = 0;

    for (let i = 0; i < 2; i++) {
      const slot = slots[i];
      const mem = hands[i];
      if (!slot) {
        resetMemory(mem);
        continue;
      }
      const lm = slot.landmarks;
      const tip = lm[8];
      const wrist = lm[0];
      const middleMcp = lm[9];
      if (!tip || !wrist || !middleMcp) {
        resetMemory(mem);
        continue;
      }

      const tipX = mx(tip, width);
      const tipY = my(tip, height);
      const palmCx = (mx(wrist, width) + mx(middleMcp, width)) / 2;
      const palmCy = (my(wrist, height) + my(middleMcp, height)) / 2;

      const tipVxNext = updateEmaVelocity(mem.prevTipX, tipX, dt, mem.emaTipVx);
      const tipVyNext = updateEmaVelocity(mem.prevTipY, tipY, dt, mem.emaTipVy);
      mem.prevTipX = tipVxNext.prev;
      mem.prevTipY = tipVyNext.prev;
      mem.emaTipVx = tipVxNext.ema;
      mem.emaTipVy = tipVyNext.ema;

      const palmVxNext = updateEmaVelocity(mem.prevPalmX, palmCx, dt, mem.emaPalmVx);
      const palmVyNext = updateEmaVelocity(mem.prevPalmY, palmCy, dt, mem.emaPalmVy);
      mem.prevPalmX = palmVxNext.prev;
      mem.prevPalmY = palmVyNext.prev;
      mem.emaPalmVx = palmVxNext.ema;
      mem.emaPalmVy = palmVyNext.ema;

      const tipSpeed = Math.hypot(mem.emaTipVx, mem.emaTipVy);
      const desiredTipMotion: Motion =
        tipSpeed > INDEX_SPEED_THRESH ? "moving" : "still";
      const tipDebounce = debounceMotion(
        mem.indexMotion,
        mem.indexCandidate,
        mem.indexCandidateMs,
        desiredTipMotion,
        dt,
        INDEX_HOLD_MS,
      );
      mem.indexMotion = tipDebounce.motion;
      mem.indexCandidate = tipDebounce.candidate;
      mem.indexCandidateMs = tipDebounce.candidateMs;

      const shape = classifyShape(lm);

      out[i] = {
        shape,
        indexMotion: mem.indexMotion,
        tipX,
        tipY,
        tipVx: mem.emaTipVx,
        tipVy: mem.emaTipVy,
        palmCx,
        palmCy,
      };

      if (shape === "palm") {
        palmActive = true;
        const ps = Math.hypot(mem.emaPalmVx, mem.emaPalmVy);
        if (ps > dominantPalmSpeed) {
          dominantPalmSpeed = ps;
          dominantVx = mem.emaPalmVx;
          dominantVy = mem.emaPalmVy;
        }
      }
    }

    const desiredPalm: Motion =
      palmActive && dominantPalmSpeed > PALM_SPEED_THRESH ? "moving" : "still";
    const palmDebounce = debounceMotion(
      palmGlobal.motion,
      palmGlobal.candidate,
      palmGlobal.candidateMs,
      desiredPalm,
      dt,
      PALM_HOLD_MS,
    );
    palmGlobal.motion = palmDebounce.motion;
    palmGlobal.candidate = palmDebounce.candidate;
    palmGlobal.candidateMs = palmDebounce.candidateMs;

    return {
      hands: out,
      swirl: {
        active: palmActive,
        palmMotion: palmGlobal.motion,
        palmVx: dominantVx,
        palmVy: dominantVy,
      },
    };
  }

  return { update };
}
