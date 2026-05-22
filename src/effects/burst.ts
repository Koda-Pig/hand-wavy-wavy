import {
  curl,
  rand,
  resetShadow,
  rgba,
  TAU,
  trailSegment,
  type EffectOpts,
} from "./effectBase";

type BurstParticle = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  width: number;
  sparkle: boolean;
};

/**
 * Radial smoke burst anchored at the index tip while the index pose is stationary.
 * Port of `08 · Burst` from visuals/gestures.jsx, with the emitter point following
 * the hand instead of being pinned to canvas center.
 */
export class BurstEffect {
  private particles: BurstParticle[] = [];
  private cooldown = 0;
  private t = 0;

  step(dt: number, anchor: { x: number; y: number } | null, opts: EffectOpts): void {
    this.t += dt * opts.speed;

    if (anchor) {
      this.cooldown -= dt * opts.speed;
      if (this.cooldown <= 0) {
        this.cooldown = rand(0.06, 0.14);
        const n = Math.max(1, Math.round(4 * opts.intensity));
        this.emit(anchor, n);
      }
    }

    const s = dt * opts.speed;
    for (const p of this.particles) {
      p.px = p.x;
      p.py = p.y;
      const [fx, fy] = curl(p.x, p.y, this.t * 0.35, 0.9);
      p.vx = p.vx * 0.985 + fx * 0.15;
      p.vy = p.vy * 0.985 + fy * 0.1;
      p.x += p.vx * s * 26;
      p.y += p.vy * s * 26;
      p.life += s;
    }
    if (this.particles.length > 800) {
      this.particles.splice(0, this.particles.length - 800);
    }
    this.particles = this.particles.filter((p) => p.life < p.ttl);
  }

  draw(ctx: CanvasRenderingContext2D, opts: EffectOpts): void {
    const c = opts.color;
    for (const p of this.particles) {
      const u = p.life / p.ttl;
      const env = Math.sin(u * Math.PI);
      const a = env * 0.8 * opts.opacity;
      trailSegment(
        ctx,
        c,
        p.px,
        p.py,
        p.x,
        p.y,
        p.width * (0.7 + env * 0.6),
        a,
        opts.glow,
      );
      if (p.sparkle && env > 0.4) {
        ctx.shadowColor = rgba(c, a);
        ctx.shadowBlur = opts.glow * 0.8;
        ctx.fillStyle = `rgba(255,255,255,${a * 1.4})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.width * 0.4, 0, TAU);
        ctx.fill();
      }
    }
    resetShadow(ctx);
  }

  hasParticles(): boolean {
    return this.particles.length > 0;
  }

  private emit(anchor: { x: number; y: number }, n: number): void {
    for (let i = 0; i < n; i++) {
      const ang = rand(-Math.PI, Math.PI);
      const r = rand(0, 6);
      const x = anchor.x + Math.cos(ang) * r;
      const y = anchor.y + Math.sin(ang) * r;
      const sp = rand(0.5, 1.8);
      this.particles.push({
        x,
        y,
        px: x,
        py: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - rand(0, 0.15),
        life: 0,
        ttl: rand(2.5, 4.5),
        width: rand(0.8, 1.8),
        sparkle: Math.random() < 0.12,
      });
    }
  }
}
