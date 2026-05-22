# hand-wavy-wavy

Browser hand tracker: MediaPipe Hand Landmarker, hidden webcam, canvas overlay. **Pose + motion** heuristics route to visual effects. No backend. No ML gesture classifier.

## Agent priorities

1. **v2 pose router + effects** — palm → Swirl (global), index still → Burst, index moving → stream trail
2. **Maintain detection foundation** — grace period, two hands, coordinate mapping, skeleton draw path
3. **Housekeeping** — deps, build, docs, focused refactors

## Source of truth

- Product scope and architecture: [`docs/implementation-plan.md`](docs/implementation-plan.md)
- This file summarizes how to work here; if anything conflicts with the plan, **the plan wins** — update this file when conventions change.

## Commands

Use **pnpm** (not npm or yarn).

- `pnpm dev` — local development
- `pnpm build` — TypeScript check + production build
- `pnpm preview` — preview production build

## Before calling work done

- Always run `pnpm build`.
- If you changed camera, MediaPipe, the render loop, poses, effects, layout, or stage styling (`main.ts`, `loop.ts`, `poses.ts`, `draw.ts`, `landmarks.ts`, `canvasLayout.ts`, `src/effects/*`, `style.css`), also verify manually using the checklist in `docs/implementation-plan.md`.

## Boundaries

Do not edit unless explicitly asked:

- `dist/`
- `node_modules/`
- `pnpm-lock.yaml`
- `public/mediapipe-wasm/` (vendored WASM assets; change loader paths in source, not the copied blobs)

## Out of scope (unless explicitly requested)

- 9-pose full map / peace-sign FSM from [building-hand-gesture-tracking.md](docs/building-hand-gesture-tracking.md)
- Old rainbow-trail / particle demo architecture from that doc
- Cross-hand Fibrous bridge (superseded by per-hand stream trail)
- Visible video toggle, effect picker UI, position smoothing (later)

## Key conventions

- **Pose → effect:** palm → global Swirl; index stationary → Burst @ tip; index moving → stream ribbon @ tip (trail + fade)
- **Motion gates:** EMA-smoothed velocity + ~200 ms hold (Burst ↔ stream; Swirl spawn ↔ displace)
- **Palm detection:** finger extension + palm normal toward camera
- **Skeleton:** keep full draw logic; hidden by default; **`S`** toggles at runtime
- **Effects code:** `src/effects/effectBase.ts` + one file per effect; `src/poses.ts` for classification
- **Reference visuals:** `visuals/` folder — look/feel only, not production imports
