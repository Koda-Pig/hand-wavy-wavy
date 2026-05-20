import "./style.css";
import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// ── DOM ──────────────────────────────────────────────────────────────────────
const video = document.getElementById("webcam");
const fxCanvas = document.getElementById("fxCanvas");
const uiCanvas = document.getElementById("uiCanvas");
const fxCtx = fxCanvas.getContext("2d", {
  willReadFrequently: false,
});
const uiCtx = uiCanvas.getContext("2d");
const overlay = document.getElementById("overlay");
const overlayMsg = document.getElementById("overlayMsg");

// ── Rainbow colors ───────────────────────────────────────────────────────────
const RAINBOW = [
  "#ff6b6b",
  "#ff9f43",
  "#ffd93d",
  "#6bcb77",
  "#4d96ff",
  "#7b2fff",
  "#c77dff",
];

// ── Trail: per-hand trail map  ───────────────────────────────────────────────
const TRAIL_LIFETIME = 2200; // ms before fully faded
const TRAIL_WIDTH = 18; // width per band
// keyed by hand index (0 or 1), each value is an array of {x, y, t}
const handTrails = { 0: [], 1: [] };

// ── Smoothed tip positions per hand (exponential smoothing) ─────────────────
const smoothTip = { 0: null, 1: null };
const SMOOTH = 0.55; // 0=no smoothing, 1=frozen. ~0.5 is responsive + stable

// ── Grace period: don't clear trail on a single missed frame ─────────────────
// Tracks how many consecutive frames each hand has been absent
const handMissed = { 0: 0, 1: 0 };
const GRACE_FRAMES = 6; // ~200ms at 30fps before we give up and clear

// ── Stars: { x, y, vx, vy, color, size, age, maxAge } ───────────────────────
const stars = [];
const MAX_STARS = 80; // hard cap — never let the particle pool explode

// ── State ────────────────────────────────────────────────────────────────────
let handLandmarker = null;
let lastTimestamp = -1;
let isRunning = false;
let W = 1,
  H = 1;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2, // support both hands!
  });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
  }
  video.srcObject = stream;
  video.addEventListener("loadeddata", () => {
    W = video.videoWidth;
    H = video.videoHeight;
    [fxCanvas, uiCanvas].forEach((c) => {
      c.width = W;
      c.height = H;
    });
    overlay.style.display = "none";
    isRunning = true;
    requestAnimationFrame(loop);
  });
}

// ── Gesture classifier ────────────────────────────────────────────────────────
function classify(lm) {
  const up = (i) => lm[i].y < lm[i - 2].y;
  const indexUp = up(8);
  const middleUp = up(12);
  const ringUp = up(16);
  const pinkyUp = up(20);
  if (indexUp && middleUp && ringUp && pinkyUp) return "idle";
  if (indexUp && middleUp && !ringUp && !pinkyUp) return "burst"; // ✌ two fingers
  if (indexUp && !middleUp && !ringUp && !pinkyUp) return "draw";
  return "idle";
}

// ── Spawn stars ───────────────────────────────────────────────────────────────
function spawnStars(x, y, count = 14) {
  // Don't spawn if already at cap — burst gesture won't tank perf
  const canAdd = MAX_STARS - stars.length;
  if (canAdd <= 0) return;
  const actual = Math.min(count, canAdd);
  for (let i = 0; i < actual; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    stars.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      color: RAINBOW[Math.floor(Math.random() * RAINBOW.length)],
      size: 3 + Math.random() * 5,
      age: 0,
      maxAge: 500 + Math.random() * 400, // shorter life = faster pool turnover
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
    });
  }
}

// ── Draw a 5-pointed star ─────────────────────────────────────────────────────
function drawStar(ctx, cx, cy, r, rotation, alpha, color) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  // No shadowBlur on stars — too expensive at 80 particles
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const a2 = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
    if (i === 0) ctx.moveTo(Math.cos(a1) * r, Math.sin(a1) * r);
    else ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.lineTo(Math.cos(a2) * (r * 0.4), Math.sin(a2) * (r * 0.4));
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function loop(timestamp) {
  if (!isRunning) return;

  const now = performance.now();

  // ── Clear UI canvas every frame ──
  uiCtx.clearRect(0, 0, W, H);

  // ── Detect hands ──
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    const results = handLandmarker.detectForVideo(video, timestamp);

    if (results.landmarks?.length > 0) {
      const activeCount = results.landmarks.length;

      // Grace period: only clear a trail after GRACE_FRAMES consecutive missed frames
      // This prevents a single dropped frame from wiping the rainbow
      if (activeCount < 2) {
        handMissed[1]++;
        if (handMissed[1] > GRACE_FRAMES) {
          handTrails[1] = [];
          smoothTip[1] = null;
        }
      } else {
        handMissed[1] = 0;
      }
      if (activeCount < 1) {
        handMissed[0]++;
        if (handMissed[0] > GRACE_FRAMES) {
          handTrails[0] = [];
          smoothTip[0] = null;
        }
      } else {
        handMissed[0] = 0;
      }

      results.landmarks.forEach((lm, handIdx) => {
        handMissed[handIdx] = 0; // reset miss counter for this hand
        const mx = (p) => (1 - p.x) * W;
        const my = (p) => p.y * H;
        const gesture = classify(lm);
        // Exponential smoothing: blends raw position toward previous for stability
        const rawX = mx(lm[8]),
          rawY = my(lm[8]);
        if (!smoothTip[handIdx]) smoothTip[handIdx] = { x: rawX, y: rawY };
        smoothTip[handIdx].x =
          smoothTip[handIdx].x * SMOOTH + rawX * (1 - SMOOTH);
        smoothTip[handIdx].y =
          smoothTip[handIdx].y * SMOOTH + rawY * (1 - SMOOTH);
        const tipX = smoothTip[handIdx].x;
        const tipY = smoothTip[handIdx].y;

        // skeleton
        drawSkeleton(uiCtx, lm, mx, my, gesture);

        if (gesture === "draw") {
          // Only append if not a teleport jump (hand reappearing far away)
          const trail = handTrails[handIdx];
          const last = trail[trail.length - 1];
          const dist = last ? Math.hypot(tipX - last.x, tipY - last.y) : 0;
          if (!last || dist > 180) {
            // Teleport or first point
            handTrails[handIdx] = [{ x: tipX, y: tipY, t: now }];
          } else if (dist >= 2) {
            // Only add point if moved enough — reduces overdense points at slow speed
            trail.push({ x: tipX, y: tipY, t: now });
          }
          if (Math.random() < 0.2) spawnStars(tipX, tipY, 1);
        } else if (gesture === "burst") {
          spawnStars(tipX, tipY, 12);
          handTrails[handIdx] = []; // clear trail on burst
        } else {
          // Idle/pause — don't clear trail, let it fade naturally
        }
      });
    } else {
      // No hands at all — increment miss counters, clear after grace period
      [0, 1].forEach((hi) => {
        handMissed[hi]++;
        if (handMissed[hi] > GRACE_FRAMES) {
          handTrails[hi] = [];
          smoothTip[hi] = null;
        }
      });
    }
  }

  // ── Expire old trail points per hand ──
  const cutoff = now - TRAIL_LIFETIME;
  [0, 1].forEach((hi) => {
    while (handTrails[hi].length && handTrails[hi][0].t < cutoff)
      handTrails[hi].shift();
  });

  // ── Draw rainbow trail onto fxCanvas ──
  fxCtx.clearRect(0, 0, W, H);

  [0, 1].forEach((hi) => {
    if (handTrails[hi].length > 1) {
      // Build normals for each point (perpendicular to the path direction)
      const pts = handTrails[hi];
      const normals = pts.map((p, i) => {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { nx: -dy / len, ny: dx / len };
      });

      // Draw each rainbow band as a smooth Catmull-Rom spline with offset
      RAINBOW.forEach((color, bi) => {
        const offset = (bi - (RAINBOW.length - 1) / 2) * (TRAIL_WIDTH * 0.9);

        // Build offset points for this band
        const bpts = pts.map((p, i) => ({
          x: p.x + normals[i].nx * offset,
          y: p.y + normals[i].ny * offset,
          t: p.t,
        }));

        // Draw as Catmull-Rom spline, segmented so we can fade by age
        // Split into chunks and draw each with its own alpha
        fxCtx.save();
        fxCtx.strokeStyle = color;
        fxCtx.lineWidth = TRAIL_WIDTH * 0.95;
        fxCtx.lineCap = "round";
        fxCtx.lineJoin = "round";
        fxCtx.shadowColor = color;
        fxCtx.shadowBlur = 8;

        // Draw the full spline using bezier curves segment by segment
        // Each segment gets alpha based on the age of its END point
        for (let i = 1; i < bpts.length; i++) {
          const age = now - pts[i].t;
          const alpha = Math.max(0, 1 - age / TRAIL_LIFETIME) * 0.88;
          if (alpha <= 0) continue;

          fxCtx.globalAlpha = alpha;
          fxCtx.beginPath();

          // Use previous, current, next for smooth Catmull-Rom segment
          const p0 = bpts[Math.max(0, i - 2)];
          const p1 = bpts[i - 1];
          const p2 = bpts[i];
          const p3 = bpts[Math.min(bpts.length - 1, i + 1)];

          // Convert Catmull-Rom to bezier control points (tension = 0.5)
          const t = 0.5;
          const cp1x = p1.x + ((p2.x - p0.x) * t) / 3;
          const cp1y = p1.y + ((p2.y - p0.y) * t) / 3;
          const cp2x = p2.x - ((p3.x - p1.x) * t) / 3;
          const cp2y = p2.y - ((p3.y - p1.y) * t) / 3;

          fxCtx.moveTo(p1.x, p1.y);
          fxCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          fxCtx.stroke();
        }
        fxCtx.restore();
      });
    }
  }); // end handTrails forEach

  // ── Update + draw stars ──
  const dt = 16; // approx ms per frame
  for (let i = stars.length - 1; i >= 0; i--) {
    const s = stars[i];
    s.age += dt;
    if (s.age > s.maxAge) {
      stars.splice(i, 1);
      continue;
    }

    s.vy += 0.18; // gravity
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.99; // air resistance
    s.rotation += s.rotSpeed;

    const alpha = Math.max(0, 1 - s.age / s.maxAge);
    drawStar(fxCtx, s.x, s.y, s.size, s.rotation, alpha, s.color);
  }

  requestAnimationFrame(loop);
}

// ── Skeleton overlay ──────────────────────────────────────────────────────────
function drawSkeleton(ctx, lm, mx, my, gesture) {
  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [5, 9],
    [9, 10],
    [10, 11],
    [11, 12],
    [9, 13],
    [13, 14],
    [14, 15],
    [15, 16],
    [13, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [0, 17],
  ];
  const color =
    gesture === "draw"
      ? "rgba(199,125,255,0.5)"
      : gesture === "burst"
        ? "rgba(255,217,61,0.6)"
        : "rgba(255,255,255,0.2)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  connections.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(mx(lm[a]), my(lm[a]));
    ctx.lineTo(mx(lm[b]), my(lm[b]));
    ctx.stroke();
  });
  lm.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(mx(p), my(p), i === 8 ? 6 : 3, 0, Math.PI * 2);
    ctx.fillStyle =
      i === 8
        ? gesture === "draw"
          ? "#ffd93d"
          : "white"
        : "rgba(255,255,255,0.4)";
    if (i === 8) {
      ctx.shadowColor = "#ffd93d";
      ctx.shadowBlur = 10;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init().catch((err) => {
  overlayMsg.textContent = "⚠ " + err.message;
  document.querySelector(".spinner").style.display = "none";
  console.error(err);
});
