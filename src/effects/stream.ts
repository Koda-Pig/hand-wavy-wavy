import {
  curl,
  rand,
  resetShadow,
  trailSegment,
  type EffectOpts,
} from "./effectBase";

type StreamParticle = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  width: number;
};

export type StreamAnchor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/**
 * Moving-index ribbon: while the index pose is moving, spawn ribbon particles
 * along the tip's drag path. Particles inherit tip velocity (scaled), are
 * jittered laterally for ribbon width, then drift through curl noise. When the
 * anchor goes away (motion stops or pose changes), existing particles continue
 * and fade out — the shared partial-frame fade in loop.ts handles persistence.
 */
export class StreamEffect {
  private particles: StreamParticle[] = [];
  private cooldown = 0;
  private t = 0;

  step(dt: number, anchor: StreamAnchor | null, opts: EffectOpts): void {
    this.t += dt * opts.speed;

    if (anchor) {
      this.cooldown -= dt * opts.speed;
      if (this.cooldown <= 0) {
        this.cooldown = rand(0.012, 0.024);
        const n = Math.max(1, Math.round(3 * opts.intensity));
        this.emit(anchor, n);
      }
    }

    const s = dt * opts.speed;
    for (const p of this.particles) {
      p.px = p.x;
      p.py = p.y;
      const [fx, fy] = curl(p.x, p.y, this.t * 0.4, 1.0);
      p.vx = p.vx * 0.94 + fx * 0.35;
      p.vy = p.vy * 0.94 + fy * 0.35;
      p.x += p.vx * s * 20;
      p.y += p.vy * s * 20;
      p.life += s;
    }
    if (this.particles.length > 900) {
      this.particles.splice(0, this.particles.length - 900);
    }
    this.particles = this.particles.filter((p) => p.life < p.ttl);
  }

  draw(ctx: CanvasRenderingContext2D, opts: EffectOpts): void {
    const c = opts.color;
    for (const p of this.particles) {
      const u = p.life / p.ttl;
      const env = Math.sin(u * Math.PI);
      const a = env * 0.85 * opts.opacity;
      trailSegment(
        ctx,
        c,
        p.px,
        p.py,
        p.x,
        p.y,
        p.width * (0.7 + env * 0.6),
        a,
        opts.glow * 1.05,
      );
    }
    resetShadow(ctx);
  }

  hasParticles(): boolean {
    return this.particles.length > 0;
  }

  private emit(anchor: StreamAnchor, n: number): void {
    const speed = Math.hypot(anchor.vx, anchor.vy);
    const ux = speed > 1e-3 ? anchor.vx / speed : 0;
    const uy = speed > 1e-3 ? anchor.vy / speed : 0;
    // perpendicular for ribbon-width jitter
    const px = -uy;
    const py = ux;
    // Inherit tip velocity at canvas scale (~px/s → particle units per frame).
    const inheritScale = 1 / 60;
    const baseVx = anchor.vx * inheritScale;
    const baseVy = anchor.vy * inheritScale;

    for (let i = 0; i < n; i++) {
      const lateral = rand(-6, 6);
      const x = anchor.x + px * lateral;
      const y = anchor.y + py * lateral;
      this.particles.push({
        x,
        y,
        px: x,
        py: y,
        vx: baseVx + rand(-0.4, 0.4),
        vy: baseVy + rand(-0.4, 0.4),
        life: 0,
        ttl: rand(1.4, 2.6),
        width: rand(1.0, 2.2),
      });
    }
  }
}
