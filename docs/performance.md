# Performance audit

Audit of the render/detection hot path (`src/loop.ts`, `src/effects/*`,
`src/canvasLayout.ts`, `src/poses.ts`, `src/draw.ts`). Issues are listed
roughly by expected impact. Each is marked **Fixed** or **Not fixed**, with the
reason when it was left alone.

The bar for fixing: no meaningful change to functionality and no visible change
to the effects. Anything that would alter the look (glow size or strength, trail
length, particle density) was documented, not changed.

## Summary

| # | Issue | Where | Impact | Status |
|---|-------|-------|--------|--------|
| 1 | Per-particle `shadowBlur` on every stroke (2 blurred strokes per particle) | `effects/*` | **Very high** (GPU/raster bound) | Not fixed — changes the look |
| 2 | Hand inference runs on every display frame, not every camera frame | `loop.ts` | **High** on 90–144 Hz displays | Fixed |
| 3 | Per-particle, per-frame allocations (curl tuples, `filter()` arrays, option spreads, slot objects) | `effects/*`, `loop.ts` | Medium (GC pauses / jank) | Fixed |
| 4 | Canvas drawn at full `devicePixelRatio` with blur in device pixels | `canvasLayout.ts` | High on HiDPI | Not fixed — changes the look |
| 5 | Duplicate path building: each glow segment / ring outline traced twice | `effectBase.ts`, `swirl.ts` | Low–medium | Fixed |
| 6 | `save()`/`restore()` per Swirl ring | `swirl.ts` | Low–medium | Fixed |
| 7 | Ring outline recomputes `cos`/`sin`/angles for fixed vertices every frame | `swirl.ts` | Low | Fixed |
| 8 | Color strings re-formatted per particle | `effectBase.ts`, `burst.ts`, `swirl.ts` | Low | Partly fixed |
| 9 | Full-screen fade + effect passes keep running when nothing is on screen | `loop.ts` | Low (idle power) | Fixed |
| 10 | Duplicate resize handling reallocates (and clears) the canvas on no-op updates | `canvasLayout.ts` | Low | Fixed |
| 11 | Canvas context created with an alpha channel it doesn't need | `loop.ts` | Low (compositing) | Fixed |
| 12 | Synchronous `detectForVideo` on the main thread | `loop.ts` | Medium | Not fixed — architectural |
| 13 | Small per-frame allocations in the pose router | `poses.ts` | Negligible | Not fixed — not worth the churn |
| 14 | Skeleton issues one `stroke()`/`fill()` per bone/joint | `draw.ts` | Negligible (debug-only, off by default) | Not fixed |

## Details

### 1. Per-particle `shadowBlur` (biggest cost) — Not fixed

Every Burst/Stream particle, every Swirl dot, and every Swirl ring is drawn
with `ctx.shadowBlur = 20` (or `18` / `21`), and each one is stroked **twice**
(tinted body + white core) with the shadow still enabled, so each particle
costs two Gaussian blurs. At the caps that is roughly:

- Stream: up to 900 particles × 2 hands
- Burst: up to 800 particles × 2 hands
- Swirl: ~440 dots + ~60 rings at the default 640×480 camera size

i.e. several thousand blurred draws per frame in the worst case. Canvas shadows
are among the most expensive 2D operations; in a headless software-rendered
benchmark of this project a single frame with these effects took ~0.5 s.

Options that would fix it, and why they were not applied:

- **Draw the glow once on an offscreen layer and blur it with one
  `ctx.filter = "blur(...)"` pass.** Additive blending makes this mathematically
  close, but per-shadow 8-bit rounding in the current approach drops many faint
  glows that a single accumulated blur would keep, so the glow would come out
  visibly stronger and softer. Needs a visual re-tune.
- **Drop the shadow on the white core stroke** (halves the blur count) and
  scale up the body's shadow alpha to compensate. The core's glow is a
  different share of the total depending on segment length, so it can't be
  matched exactly; the glow would shift slightly.
- **Lower `glow`** — the cost of a blur grows with its radius, but this is a
  direct visual change.

Recommended next step if more headroom is needed: prototype the offscreen glow
layer and tune its strength against the current look side by side.

### 2. Inference on every display frame — Fixed

`detectForVideo` ran whenever the `requestAnimationFrame` timestamp changed,
i.e. on every display refresh. Webcams typically deliver 30 fps, so on a 60 Hz
display the model ran twice per camera frame, and 4–5× on 120/144 Hz displays,
re-detecting the same image.

**Fix:** only run detection when `video.currentTime` has advanced (a new camera
frame exists). This is the pattern MediaPipe's own web examples use.

Behavioral note: the 6-frame grace period (`GRACE_FRAMES`) is counted in
detection calls, so it is now 6 *camera* frames (~200 ms at 30 fps) on every
display, rather than ~100 ms on 60 Hz and ~40–50 ms on 120–144 Hz displays.
This matches the plan's intent of a ~6-frame grace period and makes it
consistent across displays.

### 3. Per-frame allocations — Fixed

In the hot loop, each frame allocated:

- a `[fx, fy]` tuple from `curl()` for **every particle** (thousands/frame),
- a new array per effect from `particles.filter(...)` (5 effects),
- new `EffectOpts` objects via `{ ...DEFAULT_OPTS, color }` (3/frame),
- anchor objects, the Swirl input object, a `Set` in `updateGraceState`, and
  new slot objects + array in `getDisplaySlots`.

This creates steady garbage-collector pressure, which shows up as periodic
frame hitches.

**Fix:** `curl()` writes into a reused output tuple; dead particles are removed
with an in-place compaction (`compactInPlace`, same order and result as
`filter`); options, anchors, Swirl input, and display slots are allocated once
and reused.

### 4. Full-`devicePixelRatio` canvas — Not fixed

The canvas backing store is `viewport × devicePixelRatio` (e.g. ~3000×2000 on a
Retina laptop), and the full-screen fade plus every blurred stroke is paid at
that resolution. Because `shadowBlur` is specified in device pixels (it ignores
the canvas transform), capping the DPR or rendering at a lower resolution would
change how large the glow looks and how sharp the lines are. Left as is; a DPR
cap (e.g. `Math.min(devicePixelRatio, 1.5)`) is a cheap option if a slightly
softer look is acceptable.

### 5. Duplicate path building — Fixed

`trailSegment` and the Swirl dot pass built the same `moveTo/lineTo` path twice
(once per stroke), and each Swirl ring traced its 27-vertex outline twice. A
path survives `stroke()`, so it is now built once and stroked twice with the
second style. Same pixels.

### 6. `save()`/`restore()` per ring — Fixed

Each ring wrapped its translate/rotate in `save()`/`restore()`, which snapshots
the whole context state. The ring pass now captures the base transform once and
resets it with `setTransform()` per ring.

### 7. Ring vertex trig — Fixed

The ring outline's vertex angles are fixed, so their `cos`/`sin` and `2θ`/`3θ`
are precomputed once into lookup tables. Only the two time-varying wobble terms
are computed per frame.

### 8. Color string formatting — Partly fixed

Canvas color properties only accept strings, so each particle builds 2–3
`rgba(...)` strings per frame and the browser parses them. The per-color
`rgba(r,g,b,` prefix is now cached and `lineCap` / constant `shadowBlur` values
are set once per pass instead of per particle. The per-particle alpha still
changes every frame, so the strings themselves can't be avoided without
quantizing alpha (a visual change).

### 9. Idle frames — Fixed

With no hands and no particles, every frame still ran the full-screen fade and
all effect passes on a canvas that was already black. The loop now keeps fading
for 90 frames after the last particle dies (0.77⁹⁰ ≈ 6e-11 — far past the point
where the canvas can change), then skips the draw until a hand appears.
Detection and the pose router keep running every frame, so responsiveness is
unchanged.

### 10. Duplicate resize handling — Fixed

Both a `ResizeObserver` and a window `resize` listener called the same
`update()`, and every call reassigned `canvas.width`/`height`, which reallocates
the backing store and wipes the trails even when the size hadn't changed.
`update()` now returns early when nothing changed. The window listener is kept
because it also catches `devicePixelRatio` changes (zoom, moving between
monitors) that don't resize the stage.

### 11. Opaque canvas context — Fixed

The fade paints the whole canvas black every frame, so it ends up fully opaque
anyway. Creating the context with `{ alpha: false }` lets the browser skip
blending the canvas with the page behind it. Visually identical (the page
background is `#0a0a0a` and the canvas converges to `#000` within a few frames
either way).

### 12. Synchronous main-thread detection — Not fixed

`detectForVideo` blocks the main thread (including the GPU readback of the
results). Moving the HandLandmarker to a Web Worker with an `OffscreenCanvas`
or `ImageBitmap` transfer would keep rendering smooth while detection runs, but
it's an architectural change that should be its own task.

### 13. Pose router allocations — Not fixed

`updateEmaVelocity` / `debounceMotion` return small objects (~20 per frame).
That is negligible next to the per-particle garbage fixed in #3, and rewriting
the classification code wasn't worth the risk.

### 14. Skeleton draw calls — Not fixed

`drawSkeleton` issues one `stroke()` per bone and one `fill()` per joint.
Batching into one path would merge overlapping semi-transparent strokes and
slightly change the debug overlay at the joints. It is hidden by default
(toggle with `S`), so it was left alone.

## Verification

- `pnpm build` passes.
- Effects were checked with a deterministic headless harness (seeded
  `Math.random`, fixed `dt`, scripted anchors for Swirl / Burst / Stream)
  comparing pixels before and after the change at three points in the
  sequence (Swirl spawning, Swirl displacing, everything decaying): **0 pixels
  differ** (max per-channel difference 0).
- That harness renders in software (headless Chromium), where shadow blur
  dominates so completely that the effect-side changes only moved frame time
  ~4% (89.7 s → 86.4 s for 120 frames). That is the reason #1 matters most and
  why the bigger wins here are #2 (fewer inference runs), #3 (less GC jank), and
  #9 (idle frames). Real GPU numbers were not measured.
- The app was smoke-tested in headless Chromium with a fake camera: the model
  loads, the loop runs, resizing works, no console errors. Hand-driven behavior
  (the manual checklist in the implementation plan) still needs a real webcam.
