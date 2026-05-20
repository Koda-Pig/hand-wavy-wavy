# hand-wavy-wavy

Browser finger tracker: MediaPipe Hand Landmarker, hidden webcam, canvas overlay. Fingertip positions drive visual effects. No backend. No gesture classification.

## Agent priorities

1. **v2 effects** — fingertip-driven canvas visualizations (Fibrous first)
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
- If you changed camera, MediaPipe, the render loop, effects, layout, or stage styling (`main.ts`, `loop.ts`, `draw.ts`, `landmarks.ts`, `canvasLayout.ts`, `src/effects/*`, `style.css`), also verify manually using the checklist in `docs/implementation-plan.md`.

## Boundaries

Do not edit unless explicitly asked:

- `dist/`
- `node_modules/`
- `pnpm-lock.yaml`
- `public/mediapipe-wasm/` (vendored WASM assets; change loader paths in source, not the copied blobs)

## Out of scope (unless explicitly requested)

- Gesture classification (`draw` / `burst` / peace-sign FSM)
- Old rainbow-trail / particle demo from [building-hand-gesture-tracking.md](docs/building-hand-gesture-tracking.md)
- Visible video toggle, position smoothing, effect picker UI (later)

## Key conventions

- **Effect input:** index fingertip (landmark `8`) per hand via `mx`/`my`
- **Skeleton:** keep full draw logic; hidden by default; **`S`** toggles at runtime
- **Effects code:** `src/effects/effectBase.ts` + one file per effect
- **Reference visuals:** `visuals/` folder — look/feel only, not production imports
