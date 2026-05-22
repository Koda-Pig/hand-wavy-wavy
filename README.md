# hand-wavy-wavy

Browser hand tracker that drives canvas visualizations. MediaPipe Hand Landmarker reads a hidden webcam; ethereal effects follow your fingertips.

**Live:** [hand-wavy-wavy.netlify.app](https://hand-wavy-wavy.netlify.app/)

Press **`S`** to toggle the skeleton overlay (hidden by default).

## Commands

Use **pnpm**:

```bash
pnpm dev      # local dev (HTTPS/localhost for camera)
pnpm build    # TypeScript check + production build
pnpm preview  # preview production build
```

## Docs

- **[Implementation plan](docs/implementation-plan.md)** — product intent, architecture, locked decisions
- **[Building hand gesture tracking](docs/building-hand-gesture-tracking.md)** — historical reference for gesture/effect patterns (not current product scope)
- **[AGENTS.md](AGENTS.md)** — agent workflow for this repo

Visual motion references live in [`visuals/`](visuals/) (explorations only; not wired into the app build).

## Stack

- TypeScript + Vite
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) `0.10.3`
- WASM copied to `public/mediapipe-wasm/` on dev/build (CDN fallback)
