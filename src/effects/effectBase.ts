export const TAU = Math.PI * 2;

export type RGB = readonly [number, number, number];

export type EffectOpts = {
  speed: number;
  color: RGB;
  opacity: number;
  intensity: number;
  trail: number;
  glow: number;
};

export const DEFAULT_OPTS: EffectOpts = {
  speed: 1,
  color: [200, 200, 255],
  opacity: 0.72,
  intensity: 1,
  trail: 0.23,
  glow: 20,
};

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Cached `rgba(r,g,b,` prefix per color tuple — avoids re-formatting the channels per particle. */
const rgbaPrefixCache = new WeakMap<RGB, string>();

export function rgba(c: RGB, a: number): string {
  let prefix = rgbaPrefixCache.get(c);
  if (prefix === undefined) {
    prefix = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},`;
    rgbaPrefixCache.set(c, prefix);
  }
  return `${prefix}${a})`;
}

export const WHITE: RGB = [255, 255, 255];

function n2(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 0.011 + t * 0.7) * 0.6 +
    Math.cos(y * 0.009 - t * 0.55) * 0.5 +
    Math.sin((x + y) * 0.005 + t * 0.3) * 0.3
  );
}

/**
 * Curl-noise force at (x, y). Writes into `out` (reused by callers) instead of
 * allocating a tuple — this runs once per particle per frame.
 */
export function curl(
  out: [number, number],
  x: number,
  y: number,
  t: number,
  scale = 1,
): [number, number] {
  const e = 1.2;
  const a = n2(x, y + e, t) - n2(x, y - e, t);
  const b = n2(x + e, y, t) - n2(x - e, y, t);
  out[0] = a * scale;
  out[1] = -b * scale;
  return out;
}

/**
 * Remove items for which `keep` is false, preserving order, without allocating
 * a new array (replacement for `arr = arr.filter(...)` in per-frame code).
 */
export function compactInPlace<T>(arr: T[], keep: (item: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const item = arr[r];
    if (keep(item)) arr[w++] = item;
  }
  arr.length = w;
}

const fadeStyleCache = new Map<number, string>();

export function applyFade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
): void {
  let style = fadeStyleCache.get(alpha);
  if (style === undefined) {
    style = `rgba(0,0,0,${alpha})`;
    fadeStyleCache.set(alpha, style);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
}

/**
 * Glowing two-pass segment (tinted body + white core). The path is built once
 * and stroked twice; callers set `lineCap = "round"` once per draw pass.
 */
export function trailSegment(
  ctx: CanvasRenderingContext2D,
  c: RGB,
  px: number,
  py: number,
  x: number,
  y: number,
  width: number,
  a: number,
  glow: number,
  maxJumpSq = 4000,
): void {
  const dx = x - px;
  const dy = y - py;
  if (dx * dx + dy * dy > maxJumpSq) return;
  ctx.shadowColor = rgba(c, a);
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(x, y);
  ctx.strokeStyle = rgba(c, a * 0.55);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = rgba(WHITE, a * 0.55);
  ctx.lineWidth = width * 0.35;
  ctx.stroke();
}

export function resetShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = "rgba(0,0,0,0)";
}

export type EffectAlpha = {
  /**
   * Frame-wide multiplier on emissions/alpha. 1 while active, decays toward 0
   * during grace fade-out so trails persist without abrupt cut-off.
   */
  envelope: number;
  active: boolean;
};
