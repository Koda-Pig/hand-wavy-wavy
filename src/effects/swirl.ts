import {
  curl,
  rand,
  resetShadow,
  rgba,
  TAU,
  type EffectOpts,
} from "./effectBase";

type Ring = {
  x: number;
  y: number;
  r: number;
  rot: number;
  vrot: number;
  bphase: number;
  bfreq: number;
  wobP: number;
  life: number;
  ttl: number;
};

type Dot = {
  x: number;
  y: number;
  px: number;
  py: number;
  life: number;
  ttl: number;
  width: number;
};

/** Per-frame spawn budget while populating (rings, dots). */
const RING_SPAWN_PER_SEC = 6;
const DOT_SPAWN_PER_SEC = 40;

/**
 * Global Swirl field. Open palm + palm-still populates rings + smoke dots up to
 * a viewport-scaled cap. Open palm + palm-moving stops spawning and pushes
 * existing elements along palm velocity (with curl assist) so the field drifts
 * away. Dropout (no palm) lets the field decay through TTL + shared frame fade.
 */
export class SwirlEffect {
  private rings: Ring[] = [];
  private dots: Dot[] = [];
  private t = 0;
  private ringBudget = 0;
  private dotBudget = 0;
  private w: number;
  private h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  step(
    dt: number,
    palm: { active: boolean; motion: "still" | "moving"; vx: number; vy: number },
    opts: EffectOpts,
  ): void {
    this.t += dt * opts.speed;
    const s = dt * opts.speed;

    const ringCap = Math.round((this.w * this.h) / 5000);
    const dotCap = Math.round((this.w * this.h) / 700);

    // SPAWN — only while palm is gated active and palm centroid is still.
    if (palm.active && palm.motion === "still") {
      this.ringBudget += dt * RING_SPAWN_PER_SEC * opts.intensity;
      this.dotBudget += dt * DOT_SPAWN_PER_SEC * opts.intensity;
      while (this.ringBudget >= 1 && this.rings.length < ringCap) {
        this.rings.push(this.makeRing());
        this.ringBudget -= 1;
      }
      while (this.dotBudget >= 1 && this.dots.length < dotCap) {
        this.dots.push(this.makeDot());
        this.dotBudget -= 1;
      }
    } else {
      // bleed budget back so re-engagement isn't an instant burst
      this.ringBudget = Math.max(0, this.ringBudget - dt * RING_SPAWN_PER_SEC);
      this.dotBudget = Math.max(0, this.dotBudget - dt * DOT_SPAWN_PER_SEC);
    }

    // Palm-moving displacement: scale to canvas units/frame.
    const displaceScale = 1 / 60;
    const dispX = palm.active && palm.motion === "moving" ? palm.vx * displaceScale : 0;
    const dispY = palm.active && palm.motion === "moving" ? palm.vy * displaceScale : 0;

    for (const r of this.rings) {
      const [fx, fy] = curl(r.x, r.y, this.t * 0.22, 0.5);
      r.x += (fx * s * 8) + dispX * s * 60;
      r.y += (fy * s * 8) + dispY * s * 60;
      r.rot += r.vrot * s;
      r.life += s;
    }
    this.rings = this.rings.filter((r) => r.life < r.ttl);

    for (const p of this.dots) {
      p.px = p.x;
      p.py = p.y;
      const [fx, fy] = curl(p.x, p.y, this.t * 0.3, 1.1);
      p.x += (fx * s * 28) + dispX * s * 60;
      p.y += (fy * s * 28) + dispY * s * 60;
      p.life += s;
    }
    this.dots = this.dots.filter((p) => p.life < p.ttl);
  }

  draw(ctx: CanvasRenderingContext2D, opts: EffectOpts): void {
    const c = opts.color;

    // smoke dots first (under rings)
    for (const p of this.dots) {
      if (p.px == null) continue;
      const env = Math.sin((p.life / p.ttl) * Math.PI);
      const a = env * 0.55 * opts.opacity;
      const dx = p.x - p.px;
      const dy = p.y - p.py;
      if (dx * dx + dy * dy > 4000) continue;
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow * 0.9;
      ctx.strokeStyle = rgba(c, a * 0.55);
      ctx.lineWidth = p.width * (0.7 + env * 0.5);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.55})`;
      ctx.lineWidth = p.width * 0.35 * (0.7 + env * 0.5);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    // breathing rings on top
    for (const r of this.rings) {
      const env = Math.sin((r.life / r.ttl) * Math.PI);
      const a = env * opts.opacity;
      const br = r.r * (0.85 + Math.sin(this.t * r.bfreq + r.bphase) * 0.18);
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);

      ctx.strokeStyle = rgba(c, a * 0.45);
      ctx.lineWidth = 1.8;
      this.tracePath(ctx, br, br * 0.88, r.wobP);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
      ctx.lineWidth = 0.75;
      this.tracePath(ctx, br, br * 0.88, r.wobP);
      ctx.stroke();

      ctx.restore();
    }
    resetShadow(ctx);
  }

  hasParticles(): boolean {
    return this.rings.length > 0 || this.dots.length > 0;
  }

  private makeRing(): Ring {
    return {
      x: rand(this.w * 0.05, this.w * 0.95),
      y: rand(this.h * 0.05, this.h * 0.95),
      r: rand(3, 7) * this.scaleFactor(),
      rot: rand(0, TAU),
      vrot: rand(-0.6, 0.6),
      bphase: rand(0, TAU),
      bfreq: rand(1.6, 2.8),
      wobP: rand(0, TAU),
      life: 0,
      ttl: rand(4, 7),
    };
  }

  private makeDot(): Dot {
    const x = rand(0, this.w);
    const y = rand(0, this.h);
    return {
      x,
      y,
      px: x,
      py: y,
      life: 0,
      ttl: rand(2.5, 4.5),
      width: rand(0.5, 1.3),
    };
  }

  private scaleFactor(): number {
    // gentle scale-up for large viewports so rings remain readable
    const base = Math.min(this.w, this.h);
    return Math.max(1, base / 480);
  }

  private tracePath(
    ctx: CanvasRenderingContext2D,
    rx: number,
    ry: number,
    wobP: number,
  ): void {
    ctx.beginPath();
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const a2 = (i / N) * TAU;
      const w =
        1 +
        Math.sin(a2 * 2 + wobP + this.t * 0.7) * 0.08 +
        Math.sin(a2 * 3 + this.t * 0.45) * 0.06;
      const px = Math.cos(a2) * rx * w;
      const py = Math.sin(a2) * ry * w;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
}
