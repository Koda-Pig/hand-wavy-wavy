// gestures.jsx — 9 ethereal energy-stream gestures.
// Each gesture is a class with:
//   new Gesture(w, h)
//   .resize(w, h)
//   .step(dt, opts)   // opts: {speed, color:[r,g,b], opacity, intensity, trail, glow}
//   .draw(ctx, opts)
// Naming order matches the 3x3 reference grid (top-left → bottom-right).
//
// Visual approach: every drifting particle stores its previous position and
// draws as a line segment from prev → current, with additive blending and a
// soft shadow halo. Combined with a low-alpha frame fade this produces
// flowing, smoke-like trails instead of discrete dots. Curl-noise drives all
// motion so paths feel divergence-free and turbulent in a natural way.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

function rgba(c, a) { return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`; }

// cheap sum-of-sines noise; smooth and cheap
function n2(x, y, t) {
  return (
    Math.sin(x * 0.011 + t * 0.7) * 0.6 +
    Math.cos(y * 0.009 - t * 0.55) * 0.5 +
    Math.sin((x + y) * 0.005 + t * 0.3) * 0.3
  );
}

// approximate curl noise — divergence-free 2D flow
function curl(x, y, t, scale = 1) {
  const e = 1.2;
  const a = n2(x, y + e, t) - n2(x, y - e, t);
  const b = n2(x + e, y, t) - n2(x - e, y, t);
  return [a * scale, -b * scale];
}

class GestureBase {
  constructor(w, h) { this.w = w; this.h = h; this.t = 0; }
  resize(w, h) { this.w = w; this.h = h; this._resized(); }
  _resized() {}
  step(dt, opts) { this.t += dt * (opts?.speed || 1); }
  draw() {}
  fade(ctx, alpha) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
  }
  // shared: draw a trail segment from (px,py) to (x,y) with glow + bright core
  trail(ctx, c, px, py, x, y, width, a, glow) {
    if (px == null) return;
    const dx = x - px, dy = y - py;
    // skip wrap jumps
    if (dx * dx + dy * dy > 400) return;
    ctx.shadowColor = rgba(c, a);
    ctx.shadowBlur = glow;
    ctx.strokeStyle = rgba(c, a * 0.55);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
    // brighter inner stroke for the hot core
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.55})`;
    ctx.lineWidth = width * 0.35;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
}

// ---- 1. Dendrite — branching lightning from a base point -------------------

class Dendrite extends GestureBase {
  constructor(w, h) { super(w, h); this.bolts = []; this.cd = 0; }
  _resized() { this.bolts = []; }
  growBolt() {
    const segs = [];
    const rootX = this.w * rand(0.25, 0.75);
    const rootY = this.h * rand(0.85, 0.98);
    const grow = (x, y, ang, depth) => {
      if (depth <= 0 || x < -20 || x > this.w + 20 || y < -20 || y > this.h + 20) return;
      const len = rand(8, 22);
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
      grow(nx, ny, ang + rand(-0.7, 0.7), depth - 1);
      if (Math.random() < 0.55 && depth > 1) {
        grow(nx, ny, ang + rand(-1.6, 1.6), depth - 2);
      }
    };
    grow(rootX, rootY, -Math.PI / 2 + rand(-0.5, 0.5), 8 + (Math.random() * 3 | 0));
    return { segs, life: 0, ttl: rand(2.6, 4.2), phase: rand(0, TAU) };
  }
  step(dt, opts) {
    super.step(dt, opts);
    this.cd -= dt * opts.speed;
    if (this.cd <= 0 && this.bolts.length < 3 * opts.intensity) {
      this.cd = rand(0.6, 1.2);
      this.bolts.push(this.growBolt());
    }
    for (const b of this.bolts) b.life += dt * opts.speed;
    this.bolts = this.bolts.filter((b) => b.life < b.ttl);
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    for (const b of this.bolts) {
      const u = b.life / b.ttl;
      // smoother fade: ease-in-out with a soft flicker
      const flicker = 0.92 + Math.sin(this.t * 7 + b.phase) * 0.08;
      const env = Math.sin(u * Math.PI);
      const a = env * flicker * opts.opacity;
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow;
      for (const s of b.segs) {
        ctx.strokeStyle = rgba(c, a * 0.7);
        ctx.lineWidth = 0.3 + s.depth * 0.22;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
      // bright hot cores along thick segments
      ctx.fillStyle = `rgba(255,255,255,${a * 0.95})`;
      for (const s of b.segs) {
        if (s.depth > 4 || Math.random() < 0.12) {
          ctx.beginPath();
          ctx.arc(s.x2, s.y2, 0.8 + s.depth * 0.18, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 2. Constellation — drifting glow-nodes leaving fluid trails -----------

class Constellation extends GestureBase {
  constructor(w, h) { super(w, h); this._resized(); }
  _resized() {
    const n = Math.round((this.w * this.h) / 2600);
    this.pts = [];
    for (let i = 0; i < n; i++) {
      const x = Math.random() * this.w, y = Math.random() * this.h;
      this.pts.push({
        x, y, px: x, py: y,
        phase: Math.random() * TAU,
        speed: rand(0.7, 1.4),
      });
    }
  }
  step(dt, opts) {
    super.step(dt, opts);
    const s = dt * opts.speed * 28;
    for (const p of this.pts) {
      p.px = p.x; p.py = p.y;
      const [fx, fy] = curl(p.x, p.y, this.t * 0.18, 0.7);
      p.x += fx * s * 0.05 * p.speed;
      p.y += fy * s * 0.05 * p.speed;
      if (p.x < -5)         { p.x += this.w + 10; p.px = p.x; }
      if (p.x > this.w + 5) { p.x -= this.w + 10; p.px = p.x; }
      if (p.y < -5)         { p.y += this.h + 10; p.py = p.y; }
      if (p.y > this.h + 5) { p.y -= this.h + 10; p.py = p.y; }
    }
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    // faint threads between nearby pts (proximity-linked)
    const linkD = 55;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < this.pts.length; i++) {
      const a = this.pts[i];
      for (let j = i + 1; j < this.pts.length; j++) {
        const b = this.pts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < linkD * linkD) {
          const al = (1 - Math.sqrt(d2) / linkD) * 0.28 * opts.opacity;
          ctx.strokeStyle = rgba(c, al);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    // glowing nodes with motion trail
    for (const p of this.pts) {
      const pulse = 0.6 + Math.sin(this.t * 1.6 + p.phase) * 0.4;
      const a = opts.opacity * pulse;
      this.trail(ctx, c, p.px, p.py, p.x, p.y, 1.6, a * 0.7, opts.glow);
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow;
      ctx.fillStyle = `rgba(255,255,255,${a * 0.95})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.3 + pulse * 0.6, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 3. Fractures — chaotic crackling web ---------------------------------

class Fractures extends GestureBase {
  constructor(w, h) { super(w, h); this.bolts = []; this.cd = 0; }
  _resized() { this.bolts = []; }
  spawn() {
    const segs = [];
    const ox = rand(0, this.w), oy = rand(0, this.h);
    const grow = (x, y, ang, depth) => {
      if (depth <= 0) return;
      const len = rand(6, 16);
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
      grow(nx, ny, ang + rand(-0.9, 0.9), depth - 1);
      if (Math.random() < 0.5 && depth > 1) grow(nx, ny, ang + rand(-1.8, 1.8), depth - 2);
    };
    grow(ox, oy, rand(0, TAU), 6 + (Math.random() * 3 | 0));
    return { segs, life: 0, ttl: rand(2.0, 3.4), phase: rand(0, TAU) };
  }
  step(dt, opts) {
    super.step(dt, opts);
    this.cd -= dt * opts.speed;
    const target = 6 * opts.intensity;
    if (this.cd <= 0 && this.bolts.length < target) {
      this.cd = rand(0.18, 0.4);
      this.bolts.push(this.spawn());
    }
    for (const b of this.bolts) b.life += dt * opts.speed;
    this.bolts = this.bolts.filter((b) => b.life < b.ttl);
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    for (const b of this.bolts) {
      const u = b.life / b.ttl;
      const flicker = 0.9 + Math.sin(this.t * 6 + b.phase) * 0.1;
      const a = Math.sin(u * Math.PI) * flicker * opts.opacity;
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow * 0.9;
      ctx.lineCap = 'round';
      for (const s of b.segs) {
        ctx.strokeStyle = rgba(c, a * 0.8);
        ctx.lineWidth = 0.4 + s.depth * 0.2;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 4. Wisps — rising ethereal smoke ribbons ------------------------------

class Wisps extends GestureBase {
  constructor(w, h) { super(w, h); this._resized(); }
  _resized() {
    const n = Math.round((this.w * this.h) / 900);
    this.ps = [];
    for (let i = 0; i < n; i++) this.ps.push(this._mk(true));
  }
  _mk(initial) {
    const x = rand(this.w * 0.08, this.w * 0.92);
    const y = initial ? rand(0, this.h) : this.h + rand(2, 30);
    return {
      x, y, px: x, py: y,
      vx: 0, vy: rand(-0.4, -0.15),
      life: initial ? rand(0, 1.5) : 0,
      ttl: rand(3.5, 6.5),
      width: rand(0.6, 1.6),
    };
  }
  step(dt, opts) {
    super.step(dt, opts);
    const s = dt * opts.speed;
    for (const p of this.ps) {
      p.px = p.x; p.py = p.y;
      // bias flow upward + curl turbulence
      const [fx, fy] = curl(p.x, p.y, this.t * 0.25, 1.4);
      p.vx = p.vx * 0.92 + fx * 0.5 * s * 28;
      p.vy = p.vy * 0.95 + (fy * 0.35 - 0.55) * s * 28;
      p.x += p.vx * s * 7;
      p.y += p.vy * s * 7;
      p.life += s;
      if (p.life > p.ttl || p.y < -20) Object.assign(p, this._mk(false));
    }
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail * 0.85);
    const c = opts.color;
    for (const p of this.ps) {
      const u = p.life / p.ttl;
      const env = Math.sin(u * Math.PI);
      const a = env * 0.85 * opts.opacity;
      this.trail(ctx, c, p.px, p.py, p.x, p.y, p.width * (0.8 + env * 0.6), a, opts.glow * 1.1);
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 5. Neural — central branching with breathing ring nodes ---------------

class Neural extends GestureBase {
  constructor(w, h) { super(w, h); this.bolts = []; this.cd = 0; }
  _resized() { this.bolts = []; }
  spawn() {
    const segs = [], rings = [];
    const x0 = this.w / 2 + rand(-this.w * 0.1, this.w * 0.1);
    const y0 = rand(this.h * 0.2, this.h * 0.4);
    const grow = (x, y, ang, depth) => {
      if (depth <= 0) return;
      const len = rand(14, 28);
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
      if (Math.random() < 0.4 || depth <= 2) {
        rings.push({ x: nx, y: ny, r: rand(2.5, 5.5), phase: rand(0, TAU) });
      }
      grow(nx, ny, ang + rand(-0.6, 0.6), depth - 1);
      if (Math.random() < 0.55 && depth > 1) {
        grow(nx, ny, ang + rand(-1.5, 1.5), depth - 1);
      }
    };
    grow(x0, y0, Math.PI / 2 + rand(-0.4, 0.4), 7);
    return { segs, rings, life: 0, ttl: rand(3.5, 5.0) };
  }
  step(dt, opts) {
    super.step(dt, opts);
    this.cd -= dt * opts.speed;
    if (this.cd <= 0 && this.bolts.length < 2 * opts.intensity) {
      this.cd = rand(0.9, 1.6);
      this.bolts.push(this.spawn());
    }
    for (const b of this.bolts) b.life += dt * opts.speed;
    this.bolts = this.bolts.filter((b) => b.life < b.ttl);
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    for (const b of this.bolts) {
      const env = Math.sin((b.life / b.ttl) * Math.PI);
      const a = env * opts.opacity;
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow;
      ctx.strokeStyle = rgba(c, a * 0.7);
      ctx.lineCap = 'round';
      for (const s of b.segs) {
        ctx.lineWidth = 0.4 + s.depth * 0.2;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
      // breathing luminous rings
      for (const r of b.rings) {
        const pulse = 0.7 + Math.sin(this.t * 2.5 + r.phase) * 0.3;
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * pulse, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = rgba(c, a * 0.4);
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * pulse * 0.6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 6. Fibrous — dense soft parallel hair-like strands swaying ------------

class Fibrous extends GestureBase {
  constructor(w, h) { super(w, h); this._resized(); }
  _resized() {
    const n = Math.round(this.w / 3.5);
    this.fibers = [];
    for (let i = 0; i < n; i++) {
      this.fibers.push({
        x0: (i / n) * this.w + rand(-2, 2),
        amp: rand(8, 22),
        freq: rand(0.012, 0.022),
        phase: rand(0, TAU),
        speed: rand(0.4, 1.0),
        bright: rand(0.4, 1.0),
      });
    }
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail * 1.4);
    const c = opts.color;
    ctx.shadowColor = rgba(c, opts.opacity * 0.6);
    ctx.shadowBlur = opts.glow * 0.7;
    for (const f of this.fibers) {
      const a = f.bright * opts.opacity * 0.5;
      ctx.strokeStyle = rgba(c, a);
      ctx.lineWidth = 0.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let y = 0; y <= this.h; y += 4) {
        const dx = Math.sin(y * f.freq + this.t * f.speed + f.phase) * f.amp
                 + Math.sin(y * f.freq * 2.3 + this.t * f.speed * 0.7) * f.amp * 0.4;
        const x = f.x0 + dx;
        if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 7. Rings — soft luminous loops drifting through curl flow -------------

class Rings extends GestureBase {
  constructor(w, h) { super(w, h); this._resized(); }
  _resized() {
    const n = Math.round((this.w * this.h) / 3600);
    this.rs = [];
    for (let i = 0; i < n; i++) this.rs.push(this._mk(true));
  }
  _mk(initial) {
    return {
      x: rand(this.w * 0.08, this.w * 0.92),
      y: initial ? rand(0, this.h) : this.h + rand(0, 20),
      vx: rand(-0.2, 0.2),
      vy: rand(-0.5, -0.2),
      rx: rand(3, 8),
      ry: rand(3, 8),
      // independent breathing for x/y radii — never a clean ellipse
      bphaseX: rand(0, TAU),
      bphaseY: rand(0, TAU),
      bfreqX: rand(1.4, 2.6),
      bfreqY: rand(1.4, 2.6),
      rot: rand(0, TAU),
      vrot: rand(-0.5, 0.5),
      life: initial ? rand(0, 1) : 0,
      ttl: rand(4, 7),
      wobP: rand(0, TAU),
    };
  }
  step(dt, opts) {
    super.step(dt, opts);
    const s = dt * opts.speed;
    for (const r of this.rs) {
      const [fx, fy] = curl(r.x, r.y, this.t * 0.2, 0.6);
      r.x += (r.vx + fx * 0.4) * s * 14;
      r.y += (r.vy + fy * 0.2) * s * 14;
      r.rot += r.vrot * s;
      r.life += s;
      if (r.life > r.ttl || r.y < -30) Object.assign(r, this._mk(false));
    }
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    for (const r of this.rs) {
      const env = Math.sin((r.life / r.ttl) * Math.PI);
      const a = env * opts.opacity;
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow;
      // breathing radii
      const brx = r.rx * (0.85 + Math.sin(this.t * r.bfreqX + r.bphaseX) * 0.2);
      const bry = r.ry * (0.85 + Math.sin(this.t * r.bfreqY + r.bphaseY) * 0.2);
      // outer soft halo stroke
      ctx.strokeStyle = rgba(c, a * 0.4);
      ctx.lineWidth = 2.0;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      this._loop(ctx, brx, bry, r.wobP);
      ctx.stroke();
      // inner hot core stroke
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
      ctx.lineWidth = 0.8;
      this._loop(ctx, brx, bry, r.wobP);
      ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }
  _loop(ctx, rx, ry, wobP) {
    ctx.beginPath();
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const a2 = (i / N) * TAU;
      // gentler wobble — feels like a soft loop not a star
      const w = 1 + Math.sin(a2 * 2 + wobP + this.t * 0.8) * 0.08
                  + Math.sin(a2 * 3 + this.t * 0.5) * 0.06;
      const px = Math.cos(a2) * rx * w;
      const py = Math.sin(a2) * ry * w;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
}

// ---- 8. Burst — radial smoke trails from the centre ------------------------

class Burst extends GestureBase {
  constructor(w, h) { super(w, h); this._resized(); }
  _resized() {
    this.ps = [];
    this.cd = 0;
  }
  emit(n) {
    for (let i = 0; i < n; i++) {
      const ang = rand(-Math.PI, Math.PI);
      const r = rand(0, 6);
      const x = this.w / 2 + Math.cos(ang) * r;
      const y = this.h / 2 + Math.sin(ang) * r;
      const sp = rand(0.5, 1.8);
      this.ps.push({
        x, y, px: x, py: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - rand(0, 0.15),
        life: 0,
        ttl: rand(2.5, 4.5),
        width: rand(0.8, 1.8),
        sparkle: Math.random() < 0.12,
      });
    }
  }
  step(dt, opts) {
    super.step(dt, opts);
    this.cd -= dt * opts.speed;
    if (this.cd <= 0) {
      this.cd = rand(0.06, 0.14);
      this.emit(Math.round(4 * opts.intensity));
    }
    const s = dt * opts.speed;
    for (const p of this.ps) {
      p.px = p.x; p.py = p.y;
      const [fx, fy] = curl(p.x, p.y, this.t * 0.35, 0.9);
      p.vx = p.vx * 0.985 + fx * 0.15;
      p.vy = p.vy * 0.985 + fy * 0.1;
      p.x += p.vx * s * 26;
      p.y += p.vy * s * 26;
      p.life += s;
    }
    if (this.ps.length > 800) this.ps.splice(0, this.ps.length - 800);
    this.ps = this.ps.filter((p) => p.life < p.ttl);
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    for (const p of this.ps) {
      const u = p.life / p.ttl;
      const env = Math.sin(u * Math.PI);
      const a = env * 0.8 * opts.opacity;
      this.trail(ctx, c, p.px, p.py, p.x, p.y, p.width * (0.7 + env * 0.6), a, opts.glow);
      if (p.sparkle && env > 0.4) {
        ctx.shadowColor = rgba(c, a);
        ctx.shadowBlur = opts.glow * 0.8;
        ctx.fillStyle = `rgba(255,255,255,${a * 1.4})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.width * 0.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }
}

// ---- 9. Swirl — entwined loops + smoke ribbons through curl flow -----------

class Swirl extends GestureBase {
  constructor(w, h) { super(w, h); this._resized(); }
  _resized() {
    const nr = Math.round((this.w * this.h) / 5000);
    const np = Math.round((this.w * this.h) / 700);
    this.rs = [];
    this.ps = [];
    for (let i = 0; i < nr; i++) this.rs.push(this._mkR(true));
    for (let i = 0; i < np; i++) this.ps.push(this._mkP(true));
  }
  _mkR(initial) {
    return {
      x: rand(this.w * 0.1, this.w * 0.9),
      y: rand(this.h * 0.1, this.h * 0.9),
      r: rand(3, 7),
      rot: rand(0, TAU),
      vrot: rand(-0.6, 0.6),
      bphase: rand(0, TAU),
      bfreq: rand(1.6, 2.8),
      wobP: rand(0, TAU),
      life: initial ? rand(0, 1) : 0,
      ttl: rand(4, 7),
    };
  }
  _mkP(initial) {
    const x = rand(0, this.w), y = rand(0, this.h);
    return {
      x, y, px: x, py: y,
      life: initial ? rand(0, 1) : 0,
      ttl: rand(2.5, 4.5),
      width: rand(0.5, 1.3),
    };
  }
  step(dt, opts) {
    super.step(dt, opts);
    const s = dt * opts.speed;
    for (const r of this.rs) {
      const [fx, fy] = curl(r.x, r.y, this.t * 0.22, 0.5);
      r.x += fx * s * 8;
      r.y += fy * s * 8;
      r.rot += r.vrot * s;
      r.life += s;
      if (r.life > r.ttl) Object.assign(r, this._mkR(false));
    }
    for (const p of this.ps) {
      p.px = p.x; p.py = p.y;
      const [fx, fy] = curl(p.x, p.y, this.t * 0.3, 1.1);
      p.x += fx * s * 28;
      p.y += fy * s * 28;
      p.life += s;
      if (p.life > p.ttl) Object.assign(p, this._mkP(false));
    }
  }
  draw(ctx, opts) {
    this.fade(ctx, opts.trail);
    const c = opts.color;
    // smoke trails first (under the rings)
    for (const p of this.ps) {
      const env = Math.sin((p.life / p.ttl) * Math.PI);
      const a = env * 0.55 * opts.opacity;
      this.trail(ctx, c, p.px, p.py, p.x, p.y, p.width * (0.7 + env * 0.5), a, opts.glow * 0.9);
    }
    // breathing rings on top
    for (const r of this.rs) {
      const env = Math.sin((r.life / r.ttl) * Math.PI);
      const a = env * opts.opacity;
      const br = r.r * (0.85 + Math.sin(this.t * r.bfreq + r.bphase) * 0.18);
      ctx.shadowColor = rgba(c, a);
      ctx.shadowBlur = opts.glow;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      // outer soft halo
      ctx.strokeStyle = rgba(c, a * 0.45);
      ctx.lineWidth = 1.8;
      this._loop(ctx, br, br * 0.88, r.wobP);
      ctx.stroke();
      // hot inner core
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
      ctx.lineWidth = 0.75;
      this._loop(ctx, br, br * 0.88, r.wobP);
      ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }
  _loop(ctx, rx, ry, wobP) {
    ctx.beginPath();
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const a2 = (i / N) * TAU;
      const w = 1 + Math.sin(a2 * 2 + wobP + this.t * 0.7) * 0.08
                  + Math.sin(a2 * 3 + this.t * 0.45) * 0.06;
      const px = Math.cos(a2) * rx * w;
      const py = Math.sin(a2) * ry * w;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
}

// ---- registry --------------------------------------------------------------

const GESTURES = [
  { id: 'dendrite',     name: '01 · Dendrite',     desc: 'Branching strike from a root',  cls: Dendrite },
  { id: 'constellation',name: '02 · Constellation',desc: 'Drifting nodes, faint threads',  cls: Constellation },
  { id: 'fractures',    name: '03 · Fractures',    desc: 'Chaotic crackling web',          cls: Fractures },
  { id: 'wisps',        name: '04 · Wisps',        desc: 'Rising ethereal smoke',          cls: Wisps },
  { id: 'neural',       name: '05 · Neural',       desc: 'Branching with ring junctions',  cls: Neural },
  { id: 'fibrous',      name: '06 · Fibrous',      desc: 'Swaying soft fibers',            cls: Fibrous },
  { id: 'rings',        name: '07 · Rings',        desc: 'Drifting luminous loops',        cls: Rings },
  { id: 'burst',        name: '08 · Burst',        desc: 'Radial smoke ribbons',           cls: Burst },
  { id: 'swirl',        name: '09 · Swirl',        desc: 'Loops & smoke entwined',         cls: Swirl },
];

Object.assign(window, { GESTURES });
