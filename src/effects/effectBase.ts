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

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function n2(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 0.011 + t * 0.7) * 0.6 +
    Math.cos(y * 0.009 - t * 0.55) * 0.5 +
    Math.sin((x + y) * 0.005 + t * 0.3) * 0.3
  );
}

export function curl(
  x: number,
  y: number,
  t: number,
  scale = 1,
): [number, number] {
  const e = 1.2;
  const a = n2(x, y + e, t) - n2(x, y - e, t);
  const b = n2(x + e, y, t) - n2(x - e, y, t);
  return [a * scale, -b * scale];
}

export function applyFade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
): void {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
}

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
  ctx.strokeStyle = rgba(c, a * 0.55);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${a * 0.55})`;
  ctx.lineWidth = width * 0.35;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(x, y);
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
