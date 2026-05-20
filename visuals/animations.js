// Nine ethereal energy-stream animations rendered onto individual canvases.
// All animations share a global state object on window.__streams (set up below)
// so the Tweaks panel can mutate values live without re-mounting anything.
//
// Aesthetic anchors:
//   - white-on-black bio-luminescent / smoke vocabulary
//   - additive (lighter) blending with a per-frame dark fade for trails
//   - everything fades in and out softly — no hard edges anywhere
//   - "ephemeral" rules: nothing stays static; flows reorganise constantly

(function () {
  'use strict';

  // ─── Global mutable state shared with the Tweaks panel ─────────────────
  const State = window.__streams = {
    speed: 1.0,
    opacity: 1.0,
    density: 1.0,
    trail: 0.08,
    glow: 1.0,
    // current accent color, hex
    color: '#e8f4ff',
    // alternate accent for two-tone bloom (per-tile may ignore)
    accent: '#7adfff',
    palette: 'silver', // silver | aurora | ember | violet | jade
    bg: '#000000',
    paused: false,
  };

  // ─── Color helpers ─────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const x = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [
      parseInt(x.slice(0, 2), 16),
      parseInt(x.slice(2, 4), 16),
      parseInt(x.slice(4, 6), 16),
    ];
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  // bias toward white for sharp cores so accent shows in halos
  function coreColor(a) {
    return `rgba(255,255,255,${a})`;
  }

  // ─── Pseudo-noise (cheap, deterministic) ──────────────────────────────
  function noise2(x, y, t) {
    return (
      Math.sin(x * 0.013 + t * 0.31) * 0.5 +
      Math.cos(y * 0.017 - t * 0.21) * 0.4 +
      Math.sin((x + y) * 0.009 + t * 0.11) * 0.3
    );
  }
  // pseudo-curl flow angle
  function flow(x, y, t) {
    return noise2(x, y, t) * Math.PI * 1.6;
  }

  // ─── Canvas sizing with HiDPI ─────────────────────────────────────────
  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas._dpr = dpr;
    canvas._cssW = rect.width;
    canvas._cssH = rect.height;
    return canvas.getContext('2d');
  }

  // Apply per-frame trail fade. Slightly tinted black helps prevent grey accumulation.
  function fade(ctx, W, H, amount) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${amount})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
  }

  // ─── Animation #1 — Plasma Web ────────────────────────────────────────
  // A handful of charged nodes wander slowly. Lightning bolts arc between
  // pairs of nodes periodically, with jagged jittered paths that fade fast.
  function makePlasmaWeb(canvas) {
    let ctx = fitCanvas(canvas);
    const nodes = [];
    const bolts = [];
    let lastResize = 0;

    function reseed() {
      nodes.length = 0;
      const W = canvas.width, H = canvas.height;
      const n = Math.round(5 * State.density);
      for (let i = 0; i < n; i++) {
        nodes.push({
          x: W * (0.2 + Math.random() * 0.6),
          y: H * (0.15 + Math.random() * 0.7),
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    reseed();

    function jaggedPath(x1, y1, x2, y2, segs, jitter) {
      const pts = [[x1, y1]];
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        const nx = -(y2 - y1);
        const ny = (x2 - x1);
        const len = Math.hypot(nx, ny) || 1;
        const off = (Math.random() - 0.5) * jitter;
        pts.push([px + (nx / len) * off, py + (ny / len) * off]);
      }
      pts.push([x2, y2]);
      return pts;
    }

    function fireBolt() {
      if (nodes.length < 2) return;
      const a = nodes[Math.floor(Math.random() * nodes.length)];
      const b = nodes[Math.floor(Math.random() * nodes.length)];
      if (a === b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const segs = Math.max(8, Math.floor(d / 14));
      const pts = jaggedPath(a.x, a.y, b.x, b.y, segs, Math.min(d * 0.18, 60));
      // sub-branches
      const branches = [];
      const nBranch = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < nBranch; k++) {
        const i = 2 + Math.floor(Math.random() * (pts.length - 4));
        if (i < 1 || i >= pts.length - 1) continue;
        const [sx, sy] = pts[i];
        const len = 20 + Math.random() * 60;
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + (Math.random() - 0.5) * 1.6;
        const ex = sx + Math.cos(ang) * len;
        const ey = sy + Math.sin(ang) * len;
        const bsegs = Math.max(4, Math.floor(len / 10));
        branches.push(jaggedPath(sx, sy, ex, ey, bsegs, len * 0.25));
      }
      bolts.push({ pts, branches, age: 0, life: 0.55 + Math.random() * 0.45, peak: 0.18 });
    }

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reseed(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.6 + 0.04);
      const s = dt * State.speed;

      // drift nodes
      for (const n of nodes) {
        n.x += n.vx * s * 60;
        n.y += n.vy * s * 60;
        if (n.x < W * 0.1 || n.x > W * 0.9) n.vx *= -1;
        if (n.y < H * 0.1 || n.y > H * 0.9) n.vy *= -1;
        n.phase += s * 4;
      }
      // fire bolts on a slow schedule
      if (Math.random() < 0.04 * State.speed * State.density) fireBolt();

      // draw bolts
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.age += s;
        const t = b.age / b.life;
        if (t >= 1) { bolts.splice(i, 1); continue; }
        // alpha: fast fade-in, longer fade-out
        const a = (t < b.peak ? t / b.peak : 1 - (t - b.peak) / (1 - b.peak)) * State.opacity;
        if (a <= 0) continue;
        ctx.strokeStyle = rgba(State.color, a * 0.55);
        ctx.lineWidth = 1.6 * canvas._dpr;
        ctx.beginPath();
        for (let j = 0; j < b.pts.length; j++) {
          const [x, y] = b.pts[j];
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // bright core overlay
        ctx.strokeStyle = coreColor(a * 0.9);
        ctx.lineWidth = 0.7 * canvas._dpr;
        ctx.stroke();
        // branches
        ctx.strokeStyle = rgba(State.color, a * 0.35);
        ctx.lineWidth = 0.8 * canvas._dpr;
        for (const br of b.branches) {
          ctx.beginPath();
          for (let j = 0; j < br.length; j++) {
            const [x, y] = br[j];
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // glow nodes
      for (const n of nodes) {
        const glow = (0.5 + 0.5 * Math.sin(n.phase)) * State.glow;
        const r = (4 + glow * 5) * canvas._dpr;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4);
        g.addColorStop(0, coreColor(0.9 * State.opacity));
        g.addColorStop(0.3, rgba(State.color, 0.45 * State.opacity * glow));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Animation #2 — Particle Drift ────────────────────────────────────
  // Soft drifting specks; nearest neighbours connect by faint lines when
  // close. Reads as floating spores with intermittent lightning.
  function makeParticleDrift(canvas) {
    let ctx = fitCanvas(canvas);
    let parts = [];
    let lastResize = 0;

    function reseed() {
      parts = [];
      const W = canvas.width, H = canvas.height;
      const n = Math.round(40 * State.density);
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4 - 0.15,
          phase: Math.random() * Math.PI * 2,
          base: 0.5 + Math.random() * 0.5,
        });
      }
    }
    reseed();

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reseed(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.7 + 0.05);
      const s = dt * State.speed;

      // update
      for (const p of parts) {
        const ang = flow(p.x, p.y, now * 0.0004);
        p.vx += Math.cos(ang) * 0.02 * s * 60;
        p.vy += Math.sin(ang) * 0.02 * s * 60;
        p.vx *= 0.95; p.vy *= 0.95;
        p.x += p.vx * s * 60;
        p.y += p.vy * s * 60;
        p.phase += s * 3;
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;
      }

      // faint connecting filaments between nearest neighbours
      const D = 70 * canvas._dpr;
      ctx.lineWidth = 0.6 * canvas._dpr;
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i], b = parts[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < D * D) {
            const t = 1 - Math.sqrt(d2) / D;
            ctx.strokeStyle = rgba(State.color, t * 0.18 * State.opacity);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // glow specks
      for (const p of parts) {
        const tw = (0.5 + 0.5 * Math.sin(p.phase)) * State.glow * p.base;
        const r = (2 + tw * 2.4) * canvas._dpr;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        g.addColorStop(0, coreColor(0.95 * State.opacity * p.base));
        g.addColorStop(0.4, rgba(State.color, 0.4 * State.opacity * tw));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Animation #3 — Fracture ──────────────────────────────────────────
  // Dense static-charge field: many small bolts spawn and dissipate, no
  // wandering nodes. Reads as cracking glass / persistent crackle.
  function makeFracture(canvas) {
    let ctx = fitCanvas(canvas);
    const bolts = [];
    let lastResize = 0;

    function spawn() {
      const W = canvas.width, H = canvas.height;
      const x = W * (0.1 + Math.random() * 0.8);
      const y = H * (0.1 + Math.random() * 0.8);
      const segs = 6 + Math.floor(Math.random() * 10);
      const len = 30 + Math.random() * 90;
      const ang0 = Math.random() * Math.PI * 2;
      // a small jagged crack that may branch
      const path = [[x, y]];
      let cx = x, cy = y, ang = ang0;
      for (let i = 0; i < segs; i++) {
        ang += (Math.random() - 0.5) * 1.2;
        cx += Math.cos(ang) * (len / segs);
        cy += Math.sin(ang) * (len / segs);
        path.push([cx, cy]);
      }
      const branches = [];
      const nb = Math.floor(Math.random() * 3);
      for (let k = 0; k < nb; k++) {
        const i = 1 + Math.floor(Math.random() * (path.length - 2));
        const [sx, sy] = path[i];
        let bAng = ang0 + (Math.random() - 0.5) * 2;
        const blen = (len * (0.3 + Math.random() * 0.5));
        const bsegs = 4 + Math.floor(Math.random() * 4);
        let bx = sx, by = sy;
        const bp = [[bx, by]];
        for (let j = 0; j < bsegs; j++) {
          bAng += (Math.random() - 0.5) * 1.2;
          bx += Math.cos(bAng) * (blen / bsegs);
          by += Math.sin(bAng) * (blen / bsegs);
          bp.push([bx, by]);
        }
        branches.push(bp);
      }
      bolts.push({ path, branches, age: 0, life: 0.6 + Math.random() * 0.6 });
    }

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.5 + 0.05);
      const s = dt * State.speed;

      // spawn rate scales with density
      const target = 18 * State.density;
      while (bolts.length < target && Math.random() < 0.5) spawn();
      if (Math.random() < 0.5 * State.speed) spawn();

      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.age += s;
        const t = b.age / b.life;
        if (t >= 1) { bolts.splice(i, 1); continue; }
        const a = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * State.opacity;

        ctx.strokeStyle = rgba(State.color, a * 0.45);
        ctx.lineWidth = 1.2 * canvas._dpr;
        ctx.beginPath();
        for (let j = 0; j < b.path.length; j++) {
          const [x, y] = b.path[j];
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = coreColor(a * 0.85);
        ctx.lineWidth = 0.6 * canvas._dpr;
        ctx.stroke();

        ctx.strokeStyle = rgba(State.color, a * 0.32);
        ctx.lineWidth = 0.7 * canvas._dpr;
        for (const br of b.branches) {
          ctx.beginPath();
          for (let j = 0; j < br.length; j++) {
            const [x, y] = br[j];
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        // bright endpoint glow
        const endpoint = b.path[b.path.length - 1];
        const r = 5 * canvas._dpr;
        const g = ctx.createRadialGradient(endpoint[0], endpoint[1], 0, endpoint[0], endpoint[1], r * 4);
        g.addColorStop(0, coreColor(0.9 * a * State.glow));
        g.addColorStop(0.4, rgba(State.color, 0.4 * a * State.glow));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(endpoint[0], endpoint[1], r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Animation #4 — Wisp Column ───────────────────────────────────────
  // Many thin vertical strands swaying with low-frequency lateral noise.
  // Reads as smoke rising slowly with branched divergences.
  function makeWispColumn(canvas) {
    let ctx = fitCanvas(canvas);
    let strands = [];
    let lastResize = 0;

    function reseed() {
      strands = [];
      const W = canvas.width;
      const n = Math.round(22 * State.density);
      for (let i = 0; i < n; i++) {
        strands.push({
          baseX: W * (0.1 + Math.random() * 0.8),
          phase: Math.random() * Math.PI * 2,
          amp: 18 + Math.random() * 32,
          speed: 0.4 + Math.random() * 0.8,
          rise: Math.random() * Math.PI * 2,
          life: Math.random(),
          lifeLen: 4 + Math.random() * 5,
        });
      }
    }
    reseed();

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reseed(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.55 + 0.04);
      const s = dt * State.speed;

      ctx.lineCap = 'round';
      for (const st of strands) {
        st.life += s / st.lifeLen;
        if (st.life > 1) {
          st.life = 0;
          st.baseX = W * (0.1 + Math.random() * 0.8);
          st.phase = Math.random() * Math.PI * 2;
        }
        st.rise += s * st.speed;
        // alpha: smooth in/out
        const u = st.life;
        const a = Math.sin(Math.PI * u) * State.opacity;
        if (a <= 0) continue;

        const segs = 30;
        ctx.strokeStyle = rgba(State.color, a * 0.55);
        ctx.lineWidth = 0.9 * canvas._dpr;
        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const y = H - t * H;
          const sway = Math.sin(t * 3 + st.phase + st.rise * 0.6) * st.amp * t;
          const x = st.baseX + sway;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // bright core
        ctx.strokeStyle = coreColor(a * 0.5);
        ctx.lineWidth = 0.4 * canvas._dpr;
        ctx.stroke();

        // occasional luminous bead along the strand
        const beadT = (Math.sin(st.rise * 0.7) * 0.5 + 0.5);
        const by = H - beadT * H;
        const bx = st.baseX + Math.sin(beadT * 3 + st.phase + st.rise * 0.6) * st.amp * beadT;
        const r = 3 * canvas._dpr;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, r * 4);
        g.addColorStop(0, coreColor(0.8 * a * State.glow));
        g.addColorStop(0.5, rgba(State.color, 0.3 * a * State.glow));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Animation #5 — Neural Bloom ──────────────────────────────────────
  // Recursive tree growing from bottom, with glowing ring nodes at branch
  // tips. The tree dissolves and regrows on a slow cycle.
  function makeNeuralBloom(canvas) {
    let ctx = fitCanvas(canvas);
    let tree = null;
    let phase = 0; // 0..1 grow, 1..2 fade
    let lastResize = 0;

    function buildTree() {
      const W = canvas.width, H = canvas.height;
      const segments = [];
      const tips = [];
      function branch(x, y, ang, len, depth) {
        if (depth > 5 || len < 8) {
          tips.push({ x, y, r: 4 + Math.random() * 4, phase: Math.random() * Math.PI * 2 });
          return;
        }
        const ex = x + Math.cos(ang) * len;
        const ey = y + Math.sin(ang) * len;
        // small midpoint bend
        const mx = x + Math.cos(ang) * len * 0.5 + (Math.random() - 0.5) * len * 0.15;
        const my = y + Math.sin(ang) * len * 0.5 + (Math.random() - 0.5) * len * 0.15;
        segments.push({ x1: x, y1: y, mx, my, x2: ex, y2: ey, depth });
        const nb = 2 + (Math.random() < 0.35 ? 1 : 0);
        for (let i = 0; i < nb; i++) {
          const spread = 0.6 + Math.random() * 0.6;
          const na = ang + (i - (nb - 1) / 2) * spread + (Math.random() - 0.5) * 0.4;
          const nl = len * (0.55 + Math.random() * 0.25);
          branch(ex, ey, na, nl, depth + 1);
        }
      }
      branch(W / 2, H * 0.92, -Math.PI / 2, H * 0.18, 0);
      return { segments, tips };
    }
    function reset() {
      tree = buildTree();
      phase = 0;
    }
    reset();

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reset(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.55 + 0.04);
      const s = dt * State.speed;

      phase += s * 0.16;
      if (phase > 2) { reset(); }

      const grow = Math.min(1, phase); // 0..1 reveal
      const fadeT = phase > 1 ? (phase - 1) : 0; // 0..1 fade
      const baseA = (1 - fadeT) * State.opacity;

      const maxDepth = 6;
      const totalSegs = tree.segments.length;
      // reveal segments based on depth ordering for organic growth
      const revealed = Math.floor(grow * totalSegs);

      ctx.lineCap = 'round';
      for (let i = 0; i < revealed; i++) {
        const seg = tree.segments[i];
        const depthA = 1 - seg.depth / maxDepth;
        const a = baseA * (0.4 + depthA * 0.5);
        ctx.strokeStyle = rgba(State.color, a * 0.5);
        ctx.lineWidth = (1.3 - seg.depth * 0.15) * canvas._dpr;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.quadraticCurveTo(seg.mx, seg.my, seg.x2, seg.y2);
        ctx.stroke();
        ctx.strokeStyle = coreColor(a * 0.6);
        ctx.lineWidth = (0.5 - seg.depth * 0.05) * canvas._dpr;
        ctx.stroke();
      }
      // tips appear after the tree is mostly drawn
      const tipReveal = Math.max(0, (grow - 0.7) / 0.3);
      const nTips = Math.floor(tipReveal * tree.tips.length);
      for (let i = 0; i < nTips; i++) {
        const tip = tree.tips[i];
        tip.phase += s * 2;
        const tw = (0.55 + 0.45 * Math.sin(tip.phase)) * State.glow;
        // ring shape — open circle with bright core
        const r = (tip.r + tw * 2) * canvas._dpr;
        const a = baseA * 0.9;
        ctx.strokeStyle = rgba(State.color, a * 0.5);
        ctx.lineWidth = 1.0 * canvas._dpr;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = coreColor(a * 0.85);
        ctx.lineWidth = 0.5 * canvas._dpr;
        ctx.stroke();
        // halo
        const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r * 3);
        g.addColorStop(0, rgba(State.color, 0));
        g.addColorStop(0.4, rgba(State.color, 0.18 * a * tw));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Animation #6 — Fiber Field ───────────────────────────────────────
  // Many horizontal-ish hairs moving by curl flow. Soft fur/fabric texture.
  function makeFiberField(canvas) {
    let ctx = fitCanvas(canvas);
    let fibers = [];
    let lastResize = 0;

    function reseed() {
      fibers = [];
      const W = canvas.width, H = canvas.height;
      const n = Math.round(70 * State.density);
      for (let i = 0; i < n; i++) {
        fibers.push({
          x: Math.random() * W,
          y: Math.random() * H,
          age: Math.random() * 4,
          maxAge: 3 + Math.random() * 3,
          len: 14 + Math.random() * 28,
          speed: 0.4 + Math.random() * 0.9,
        });
      }
    }
    reseed();

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reseed(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.4 + 0.03);
      const s = dt * State.speed;

      ctx.lineCap = 'round';
      ctx.lineWidth = 0.8 * canvas._dpr;
      for (const f of fibers) {
        f.age += s;
        if (f.age > f.maxAge) {
          f.age = 0;
          f.x = Math.random() * W;
          f.y = Math.random() * H;
          f.maxAge = 3 + Math.random() * 3;
        }
        const u = f.age / f.maxAge;
        const a = Math.sin(Math.PI * u) * State.opacity * 0.7;
        if (a <= 0) continue;

        // draw a short curving filament following the flow field
        const segs = 14;
        let x = f.x, y = f.y;
        ctx.strokeStyle = rgba(State.color, a * 0.55);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let i = 0; i < segs; i++) {
          const ang = flow(x, y, now * 0.0003);
          x += Math.cos(ang) * (f.len / segs) * f.speed;
          y += Math.sin(ang) * (f.len / segs) * f.speed;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        // bright core
        ctx.strokeStyle = coreColor(a * 0.35);
        ctx.lineWidth = 0.3 * canvas._dpr;
        ctx.stroke();
        ctx.lineWidth = 0.8 * canvas._dpr;
      }
    };
  }

  // ─── Animation #7 — Bubble Rise ───────────────────────────────────────
  // Soft rings floating upward with slight wobble. Reads like jellyfish
  // bioluminescence — many soft circles drifting.
  function makeBubbleRise(canvas) {
    let ctx = fitCanvas(canvas);
    let bubbles = [];
    let lastResize = 0;

    function reseed() {
      bubbles = [];
      const W = canvas.width, H = canvas.height;
      const n = Math.round(36 * State.density);
      for (let i = 0; i < n; i++) {
        bubbles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 6 + Math.random() * 18,
          speed: 8 + Math.random() * 22,
          wobble: Math.random() * Math.PI * 2,
          life: Math.random(),
        });
      }
    }
    reseed();

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reseed(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.5 + 0.04);
      const s = dt * State.speed;

      for (const b of bubbles) {
        b.y -= b.speed * s;
        b.wobble += s * 1.4;
        b.x += Math.sin(b.wobble) * 6 * s;
        b.life += s * 0.18;
        if (b.y < -b.r * 2 || b.life > 1) {
          b.x = Math.random() * W;
          b.y = H + b.r;
          b.life = 0;
          b.r = 6 + Math.random() * 18;
          b.speed = 8 + Math.random() * 22;
        }
        // fade-in then sustained then fade-out
        const u = b.life;
        const a = (u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - u) / 0.2 : 1) * State.opacity * 0.8;
        if (a <= 0) continue;
        const r = b.r * canvas._dpr;
        // ring stroke
        ctx.strokeStyle = rgba(State.color, a * 0.4);
        ctx.lineWidth = 1.0 * canvas._dpr;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = coreColor(a * 0.55);
        ctx.lineWidth = 0.5 * canvas._dpr;
        ctx.stroke();
        // soft halo
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 2);
        g.addColorStop(0, rgba(State.color, 0));
        g.addColorStop(0.6, rgba(State.color, 0.12 * a * State.glow));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Animation #8 — Plume ─────────────────────────────────────────────
  // A central upward smoke plume emitted from the lower-center. Particles
  // diverge with curl noise and brighten / dim as they rise.
  function makePlume(canvas) {
    let ctx = fitCanvas(canvas);
    let parts = [];
    let lastResize = 0;

    function spawn() {
      const W = canvas.width, H = canvas.height;
      parts.push({
        x: W * 0.5 + (Math.random() - 0.5) * 8 * canvas._dpr,
        y: H * 0.88,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -1 - Math.random() * 1.2,
        age: 0,
        life: 2.5 + Math.random() * 2,
        size: 1.8 + Math.random() * 1.8,
      });
    }

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.45 + 0.04);
      const s = dt * State.speed;

      // emit
      const emit = Math.ceil(3 * State.density * (1 + State.speed * 0.4));
      for (let i = 0; i < emit; i++) spawn();

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += s;
        if (p.age > p.life) { parts.splice(i, 1); continue; }
        // curl-noise nudge
        const ang = flow(p.x, p.y, now * 0.0005);
        p.vx += Math.cos(ang) * 0.04 * s * 60;
        p.vy += Math.sin(ang) * 0.02 * s * 60 - 0.04 * s * 60;
        p.vx *= 0.97; p.vy *= 0.985;
        p.x += p.vx * s * 60;
        p.y += p.vy * s * 60;
        const u = p.age / p.life;
        const a = Math.sin(Math.PI * u) * State.opacity * 0.7;
        if (a <= 0) continue;
        const r = p.size * canvas._dpr * (1 + u * 2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
        g.addColorStop(0, coreColor(a * 0.65));
        g.addColorStop(0.4, rgba(State.color, a * 0.35 * State.glow));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // bright source glow at bottom
      const sx = W * 0.5, sy = H * 0.9;
      const r = 18 * canvas._dpr * State.glow;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2);
      g.addColorStop(0, coreColor(0.5 * State.opacity * State.glow));
      g.addColorStop(0.5, rgba(State.color, 0.18 * State.opacity * State.glow));
      g.addColorStop(1, rgba(State.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2, 0, Math.PI * 2);
      ctx.fill();
    };
  }

  // ─── Animation #9 — Ring Vortex ───────────────────────────────────────
  // Many rings orbit a slow vortex, leaving soft trails. Reads as smoke
  // rings or jellyfish drifting in a current.
  function makeRingVortex(canvas) {
    let ctx = fitCanvas(canvas);
    let rings = [];
    let lastResize = 0;

    function reseed() {
      rings = [];
      const W = canvas.width, H = canvas.height;
      const n = Math.round(28 * State.density);
      for (let i = 0; i < n; i++) {
        rings.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 8 + Math.random() * 14,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 2,
          phase: Math.random() * Math.PI * 2,
          drift: Math.random() * Math.PI * 2,
          life: Math.random(),
          lifeLen: 3 + Math.random() * 3,
        });
      }
    }
    reseed();

    return function frame(dt, now) {
      if (now - lastResize > 250) { ctx = fitCanvas(canvas); lastResize = now; reseed(); }
      const W = canvas.width, H = canvas.height;
      fade(ctx, W, H, State.trail * 0.4 + 0.04);
      const s = dt * State.speed;

      for (const r of rings) {
        r.life += s / r.lifeLen;
        if (r.life > 1) {
          r.life = 0;
          r.x = Math.random() * W;
          r.y = Math.random() * H;
          r.r = 8 + Math.random() * 14;
        }
        const ang = flow(r.x, r.y, now * 0.0004);
        r.x += Math.cos(ang) * 12 * s;
        r.y += Math.sin(ang) * 12 * s;
        r.rot += r.rotSpeed * s;
        r.phase += s * 2;

        const u = r.life;
        const a = Math.sin(Math.PI * u) * State.opacity * 0.85;
        if (a <= 0) continue;

        // ring drawn as a tilted ellipse to imply 3D
        const tilt = Math.sin(r.rot) * 0.45;
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(r.phase * 0.3);
        ctx.strokeStyle = rgba(State.color, a * 0.5);
        ctx.lineWidth = 1.1 * canvas._dpr;
        ctx.beginPath();
        ctx.ellipse(0, 0, r.r * canvas._dpr, r.r * canvas._dpr * (0.4 + Math.abs(tilt) * 0.6), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = coreColor(a * 0.6);
        ctx.lineWidth = 0.45 * canvas._dpr;
        ctx.stroke();
        ctx.restore();

        // faint smoke trail behind the ring
        const tx = r.x - Math.cos(ang) * 18;
        const ty = r.y - Math.sin(ang) * 18;
        const rr = 14 * canvas._dpr;
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, rr);
        g.addColorStop(0, rgba(State.color, 0.18 * a * State.glow));
        g.addColorStop(1, rgba(State.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  // ─── Registry ─────────────────────────────────────────────────────────
  window.__streamMakers = [
    { id: 1, name: 'Plasma Web',       make: makePlasmaWeb },
    { id: 2, name: 'Particle Drift',   make: makeParticleDrift },
    { id: 3, name: 'Fracture',         make: makeFracture },
    { id: 4, name: 'Wisp Column',      make: makeWispColumn },
    { id: 5, name: 'Neural Bloom',     make: makeNeuralBloom },
    { id: 6, name: 'Fiber Field',      make: makeFiberField },
    { id: 7, name: 'Bubble Rise',      make: makeBubbleRise },
    { id: 8, name: 'Plume',            make: makePlume },
    { id: 9, name: 'Ring Vortex',      make: makeRingVortex },
  ];

  // ─── Boot ─────────────────────────────────────────────────────────────
  window.__bootStreams = function () {
    const tiles = document.querySelectorAll('.tile canvas');
    const frames = [];
    tiles.forEach((c, i) => {
      const maker = window.__streamMakers[i];
      if (!maker) return;
      const fn = maker.make(c);
      frames.push(fn);
    });
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!State.paused) {
        for (const f of frames) f(dt, now);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  };
})();
