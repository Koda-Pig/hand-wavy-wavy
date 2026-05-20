# TypeScript Migration Plan — hand-wavy-wavy

This document is the authoritative plan for converting the entire repository from JavaScript to TypeScript. It covers inventory, target architecture, phased execution, typing strategy, tooling, risks, verification, and definition of done.

**Status:** Planned (not started)  
**Last updated:** 2026-05-20  
**Estimated effort:** ~1 focused day (6–10 hours) for strict typing + MediaPipe npm migration + optional modularization

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Repository inventory](#2-repository-inventory)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Target end state](#4-target-end-state)
5. [Phased migration](#5-phased-migration)
6. [TypeScript configuration](#6-typescript-configuration)
7. [MediaPipe migration (critical path)](#7-mediapipe-migration-critical-path)
8. [Domain types reference](#8-domain-types-reference)
9. [Module extraction plan](#9-module-extraction-plan)
10. [DOM and canvas safety patterns](#10-dom-and-canvas-safety-patterns)
11. [Vite and build configuration](#11-vite-and-build-configuration)
12. [Scripts, CI, and developer workflow](#12-scripts-ci-and-developer-workflow)
13. [Verification and test plan](#13-verification-and-test-plan)
14. [Risks, mitigations, and rollback](#14-risks-mitigations-and-rollback)
15. [PR strategy and commit guidance](#15-pr-strategy-and-commit-guidance)
16. [Definition of done checklist](#16-definition-of-done-checklist)
17. [Appendix: file-by-file mapping](#17-appendix-file-by-file-mapping)

---

## 1. Executive summary

**hand-wavy-wavy** is a small Vite 8 vanilla browser app that uses MediaPipe Hand Landmarker for webcam hand tracking and renders rainbow trails, particle stars, and skeleton overlays on two stacked canvases. Almost all application logic lives in a single ~400-line file (`src/main.js`). A second file (`src/counter.js`) is leftover Vite scaffold code and is not used.

The migration is **low file count, medium complexity**: the main work is (1) wiring TypeScript with Vite, (2) replacing the CDN MediaPipe import with a typed npm dependency and correct WASM asset paths, and (3) adding explicit types for hand-indexed state, gestures, trails, and particles.

Recommended approach:

- **Incremental phases** with a green `pnpm build` after each phase.
- **Two PRs minimum**: PR1 = toolchain + rename; PR2 = MediaPipe npm + types. Optional PR3 = modular split.
- **Strict TypeScript from day one** (`strict: true`), with thin wrappers where third-party types are incomplete.

---

## 2. Repository inventory

### 2.1 Source files (application)

| Path | Lines (approx) | Role | Migration action |
|------|----------------|------|----------------|
| `src/main.js` | ~404 | App entry: MediaPipe, webcam, game loop, canvas drawing | Rename → `main.ts`; extract modules (optional) |
| `src/counter.js` | ~9 | Unused Vite demo (`setupCounter`) | **Delete** (not imported) |
| `src/style.css` | — | Styles | No change |
| `index.html` | — | Shell, script tag, DOM ids | Update script `src`; fix duplicate `<body>` |

### 2.2 Configuration and tooling

| Path | Present | Notes |
|------|---------|-------|
| `package.json` | Yes | `"type": "module"`, scripts: `dev`, `build`, `preview`; only devDep: `vite@^8` |
| `pnpm-lock.yaml` | Yes | Package manager: pnpm |
| `tsconfig.json` | No | Create in Phase 1 |
| `vite.config.ts` | No | Optional in Phase 5 (WASM/assets) |
| `README.md` | No | Optional doc update in Phase 6 |
| Tests | No | Manual browser verification only |
| CI | No | Add `typecheck` + `build` in Phase 5 |

### 2.3 External dependencies (runtime)

| Dependency | How used today | Migration target |
|------------|----------------|------------------|
| `@mediapipe/tasks-vision@0.10.3` | ESM import from **jsDelivr CDN URL** in `main.js` | `pnpm add @mediapipe/tasks-vision@0.10.3` |
| Web APIs | `navigator.mediaDevices`, `canvas`, `requestAnimationFrame` | Typed via `lib: ["DOM", ...]` |
| Model asset | Google Cloud Storage URL for `.task` file | Unchanged URL (or document self-hosting later) |

### 2.4 DOM contract (`index.html`)

Elements referenced by id in `main.js` (must exist at runtime):

| Element id | Type | Usage |
|------------|------|-------|
| `webcam` | `HTMLVideoElement` | Camera stream |
| `fxCanvas` | `HTMLCanvasElement` | Rainbow trails + stars |
| `uiCanvas` | `HTMLCanvasElement` | Skeleton overlay |
| `overlay` | `HTMLElement` | Loading overlay visibility |
| `overlayMsg` | `HTMLElement` | Error / loading message |
| `.spinner` | `HTMLElement` | Hidden on init error (querySelector) |

**HTML issue to fix in Phase 0:** `index.html` contains nested duplicate `<body>` tags (lines 9–10 and 51–53). Consolidate to a single valid document structure before or during Phase 1.

### 2.5 Application behavior summary (for regression testing)

- **Init:** Load MediaPipe WASM, create `HandLandmarker` (VIDEO mode, 2 hands, GPU delegate), request webcam (1280×720 preferred, fallback `video: true`).
- **Gestures** (`classify`):
  - All four fingers “up” → `idle` (open palm / pause drawing).
  - Index + middle up, ring + pinky down → `burst` (peace sign → star burst).
  - Only index up → `draw` (rainbow trail).
  - Else → `idle`.
- **Two-hand state:** Separate trails, smoothed tips, and grace-period miss counters for hand indices `0` and `1`.
- **Trail:** Points `{x, y, t}`; Catmull-Rom rainbow bands on `fxCanvas`; lifetime 2200ms.
- **Stars:** Particle pool max 80; spawn on draw (random) and burst (12); gravity and fade on `fxCanvas`.
- **Loop:** `requestAnimationFrame`; detect on timestamp change; clear `uiCanvas` each frame; draw trails/stars on `fxCanvas`.

---

## 3. Goals and non-goals

### 3.1 Goals

- All **application source** under `src/` is TypeScript (`.ts` only).
- `pnpm typecheck` (`tsc --noEmit`) passes with **`strict: true`**.
- `pnpm build` produces the same functional app (webcam gestures, trails, stars).
- MediaPipe imported from **npm** with a pinned version, not a bare CDN module URL in source.
- Explicit domain types for gestures, trail points, stars, and two-hand indexed state.
- Clear developer workflow: `dev`, `typecheck`, `build`, `preview`.

### 3.2 Non-goals (out of scope unless requested later)

- Rewriting UI in React/Vue/Svelte.
- Adding a full automated test suite (unit/e2e).
- Changing gesture logic, visual design, or performance characteristics.
- Self-hosting MediaPipe models (optional future improvement).
- Publishing as an npm library.

---

## 4. Target end state

### 4.1 Directory layout (recommended after modularization)

```
hand-wavy-wavy/
├── docs/
│   └── typescript-migration-plan.md   # this file
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts                     # optional
├── src/
│   ├── main.ts                        # bootstrap, error handling
│   ├── vite-env.d.ts                  # Vite client types
│   ├── types.ts                       # Gesture, TrailPoint, Star, Tip, HandIndex
│   ├── constants.ts                   # RAINBOW, TRAIL_*, GRACE_*, SMOOTH, MAX_STARS
│   ├── dom.ts                         # requireElement, requireCanvas2dContext
│   ├── mediapipe.ts                   # initVision, createHandLandmarker, getUserMedia
│   ├── mediapipe.d.ts                 # only if @mediapipe/tasks-vision lacks types
│   ├── gestures.ts                    # classify()
│   ├── skeleton.ts                    # drawSkeleton()
│   ├── stars.ts                       # spawnStars, updateStars, drawStar
│   ├── trail.ts                       # trail push/expire, drawRainbowTrails
│   ├── loop.ts                        # loop(), startAnimation()
│   └── style.css
└── dist/                              # build output (gitignored)
```

### 4.2 Minimal layout (acceptable for “TS only” milestone)

If modularization is deferred, a single `src/main.ts` plus `src/types.ts` and `src/dom.ts` is sufficient for definition of done, as long as `typecheck` passes.

### 4.3 `package.json` scripts (target)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "pnpm typecheck && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vite": "^8.0.12"
  },
  "dependencies": {
    "@mediapipe/tasks-vision": "0.10.3"
  }
}
```

Pin `@mediapipe/tasks-vision` to exact `0.10.3` (no caret) to match current runtime behavior.

---

## 5. Phased migration

Each phase should end with: `pnpm dev` (smoke test), `pnpm typecheck` (when applicable), `pnpm build`.

---

### Phase 0 — Baseline and hygiene

**Duration:** ~30 minutes  
**Risk:** Low

#### Tasks

1. **Delete** `src/counter.js` (unused; grep confirms no imports).
2. **Fix** `index.html`:
   - Single `<body>`.
   - Valid nesting: `head` → `body` → content → one module script.
3. **Run** baseline commands and record behavior:
   ```bash
   pnpm install
   pnpm dev
   # manual: webcam, draw, burst, idle, two hands
   pnpm build && pnpm preview
   ```
4. **Optional:** Add minimal `README.md` (install, scripts, gesture legend, webcam permission).

#### Exit criteria

- [ ] App behavior unchanged in browser.
- [ ] No dead `counter.js`.
- [ ] Valid HTML5 document.

---

### Phase 1 — TypeScript toolchain and entry rename

**Duration:** ~1 hour  
**Risk:** Low

#### Tasks

1. Install TypeScript:
   ```bash
   pnpm add -D typescript
   ```
2. Add `tsconfig.json` (see [Section 6](#6-typescript-configuration)).
3. Add `src/vite-env.d.ts`:
   ```ts
   /// <reference types="vite/client" />
   ```
4. Rename `src/main.js` → `src/main.ts` (content unchanged initially).
5. Update `index.html`:
   ```html
   <script type="module" src="/src/main.ts"></script>
   ```
6. Add `typecheck` script; update `build` to run typecheck first (see [Section 12](#12-scripts-ci-and-developer-workflow)).
7. Run `pnpm typecheck` and fix errors **only where TS blocks compile** (likely MediaPipe CDN module has no types — use `// @ts-expect-error` temporarily or skip with `allowJs` **not** recommended; prefer Phase 2).

**Temporary bridge (if Phase 1 and 2 are split across days):**  
Add `src/shims/mediapipe-cdn.d.ts`:

```ts
declare module "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3" {
  export class FilesetResolver {
    static forVisionTasks(wasmPath: string): Promise<unknown>;
  }
  export class HandLandmarker {
    static createFromOptions(
      vision: unknown,
      options: Record<string, unknown>,
    ): Promise<HandLandmarker>;
    detectForVideo(
      video: HTMLVideoElement,
      timestamp: number,
    ): { landmarks?: Array<Array<{ x: number; y: number; z?: number }>> };
  }
}
```

Remove this shim after Phase 2.

#### Exit criteria

- [ ] `src/main.ts` is the entry.
- [ ] `pnpm dev` works.
- [ ] `pnpm typecheck` passes (with shim or Phase 2 complete).

---

### Phase 2 — MediaPipe npm package and typing (critical path)

**Duration:** 2–4 hours  
**Risk:** **High** (WASM paths, bundler resolution, incomplete typings)

#### Tasks

1. Install runtime dependency:
   ```bash
   pnpm add @mediapipe/tasks-vision@0.10.3
   ```
2. Replace CDN import in `main.ts` (or `mediapipe.ts`):

   **Before:**
   ```js
   import {
     FilesetResolver,
     HandLandmarker,
   } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
   ```

   **After:**
   ```ts
   import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
   ```

3. Update WASM resolver path in `init()`:

   **Before (CDN):**
   ```js
   const vision = await FilesetResolver.forVisionTasks(
     "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
   );
   ```

   **After (try in order until dev + build work):**

   **Option A — Vite `?url` or public copy (preferred for reproducibility):**
   - Copy or reference `node_modules/@mediapipe/tasks-vision/wasm` via `vite.config.ts` `server.fs.allow` / static assets if needed.

   **Option B — Keep CDN for WASM only (interim):**
   ```ts
   const vision = await FilesetResolver.forVisionTasks(
     "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
   );
   ```
   Code import from npm; WASM still from CDN. Document as technical debt; move to local WASM in Phase 5.

   **Option C — `new URL(..., import.meta.url)` pattern:**
   ```ts
   const wasmPath = new URL(
     "@mediapipe/tasks-vision/wasm",
     import.meta.url,
   ).href;
   ```
   Verify against Vite 8 docs and package export map; adjust if resolution fails.

4. Keep model URL unchanged unless self-hosting:
   ```ts
   modelAssetPath:
     "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
   ```

5. Type `handLandmarker` module state:
   ```ts
   let handLandmarker: HandLandmarker | null = null;
   ```

6. If package types are missing or too loose, add `src/mediapipe.d.ts` (see [Section 7](#7-mediapipe-migration-critical-path)).

7. Remove CDN module shim from Phase 1.

8. Smoke test on **Chrome** (primary), and optionally Safari/Firefox (webcam + WebGL/GPU delegate quirks).

#### Exit criteria

- [ ] No CDN ESM import in application source.
- [ ] Hand landmarker initializes; overlay hides; loop runs.
- [ ] `detectForVideo` returns landmarks; gestures work.
- [ ] `pnpm build` succeeds (production bundle includes or loads WASM correctly).

---

### Phase 3 — Strict typing for app state and functions

**Duration:** 1–2 hours  
**Risk:** Medium

#### Tasks

1. Create `src/types.ts` with domain types ([Section 8](#8-domain-types-reference)).
2. Replace implicit object shapes:
   - `handTrails`, `smoothTip`, `handMissed` → `Record<HandIndex, ...>`.
   - `stars` → `Star[]`.
3. Type function signatures:

   | Function | Key parameter types |
   |----------|---------------------|
   | `classify` | `lm: NormalizedLandmark[]` or app `Landmark[]` |
   | `drawSkeleton` | `ctx: CanvasRenderingContext2D`, `lm`, `mx`/`my` mappers |
   | `spawnStars` | `x: number`, `y: number`, `count?: number` |
   | `drawStar` | all scalars + `color: string` |
   | `loop` | `timestamp: number` (DOMHighResTimeStamp) |

4. Introduce `src/dom.ts` helpers ([Section 10](#10-dom-and-canvas-safety-patterns)); replace bare `getElementById` at top level.
5. Enable and fix:
   - `noUnusedLocals` / `noUnusedParameters`
   - Avoid `any`; use `unknown` + narrow in catch blocks:
     ```ts
     init().catch((err: unknown) => {
       const message = err instanceof Error ? err.message : String(err);
       overlayMsg.textContent = "⚠ " + message;
     });
     ```

#### Exit criteria

- [ ] No `any` in `src/` except possibly one documented line in `mediapipe.d.ts` if unavoidable.
- [ ] `pnpm typecheck` clean under `strict: true`.

---

### Phase 4 — Modularize (optional, recommended)

**Duration:** 2–3 hours  
**Risk:** Low (refactor-only if behavior preserved)

#### Extraction order (minimize circular deps)

```
constants.ts, types.ts
    ↓
dom.ts
    ↓
gestures.ts, skeleton.ts, stars.ts, trail.ts
    ↓
mediapipe.ts
    ↓
loop.ts
    ↓
main.ts
```

#### Per-module responsibilities

| Module | Exports | Depends on |
|--------|---------|------------|
| `constants.ts` | `RAINBOW`, `TRAIL_LIFETIME`, `TRAIL_WIDTH`, `GRACE_FRAMES`, `SMOOTH`, `MAX_STARS` | — |
| `types.ts` | `Gesture`, `TrailPoint`, `Star`, `Tip`, `HandIndex`, `Landmark` | — |
| `dom.ts` | `requireElement`, `requireCanvas2d` | — |
| `gestures.ts` | `classify` | `types` |
| `skeleton.ts` | `drawSkeleton` | `types` |
| `stars.ts` | `spawnStars`, `tickAndDrawStars`, star pool state or pass `stars` ref | `types`, `constants` |
| `trail.ts` | trail push/expire/draw, hand trail state | `types`, `constants` |
| `mediapipe.ts` | `initApp()` → `{ video, landmarker, dimensions }` | dom, types |
| `loop.ts` | `startLoop(ctx)` | all above |
| `main.ts` | call `initApp`, `startLoop`, error overlay | mediapipe, loop, dom |

**State ownership decision:** Either keep module-level state in `loop.ts` (closest to current monolith) or introduce a small `AppState` interface passed into `loop`. Prefer one `AppState` object if extracting — easier to test later.

#### Exit criteria

- [ ] `main.ts` < 60 lines.
- [ ] No circular imports (`tsc` / Vite will report).
- [ ] Same manual behavior as Phase 0 baseline.

---

### Phase 5 — Vite config, CI, and optional lint

**Duration:** ~1 hour  
**Risk:** Low

#### Tasks

1. Add `vite.config.ts` if needed for WASM (see [Section 11](#11-vite-and-build-configuration)).
2. Add GitHub Actions workflow `.github/workflows/ci.yml`:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v4
           with:
             version: 9
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: pnpm
         - run: pnpm install --frozen-lockfile
         - run: pnpm typecheck
         - run: pnpm build
   ```
3. Optional ESLint:
   ```bash
   pnpm add -D eslint typescript-eslint
   ```
   Add flat config targeting `src/**/*.ts`.

#### Exit criteria

- [ ] CI green on PR.
- [ ] Production build artifact runs via `pnpm preview`.

---

### Phase 6 — Cleanup and documentation

**Duration:** ~30 minutes  
**Risk:** Low

#### Tasks

1. Confirm no `*.js` files remain in `src/`.
2. Update or add `README.md`: TypeScript, scripts, MediaPipe version, browser requirements.
3. Mark this plan’s **Status** at top as `Complete` with date.
4. Remove temporary shims, `@ts-expect-error`, and commented-out JS.

#### Exit criteria

- [ ] Definition of done ([Section 16](#16-definition-of-done-checklist)) fully checked.

---

## 6. TypeScript configuration

### 6.1 Recommended `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "useDefineForClassFields": true,
    "allowImportingTsExtensions": false
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 6.2 Why these options

| Option | Reason |
|--------|--------|
| `moduleResolution: "bundler"` | Matches Vite 8 / native ESM |
| `noEmit: true` | Vite emits JS; `tsc` only typechecks |
| `strict: true` | Catches null DOM, implicit any in state |
| `skipLibCheck: true` | Faster; acceptable for app project |
| `isolatedModules: true` | Required for Vite per-file transpile |

### 6.3 Future strictness (optional, post-migration)

- `exactOptionalPropertyTypes`
- `noUncheckedIndexedAccess` (will affect `handTrails[handIdx]` — use `HandIndex` type)

---

## 7. MediaPipe migration (critical path)

### 7.1 Current integration (reference)

```js
import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
);

handLandmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/...",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numHands: 2,
});

const results = handLandmarker.detectForVideo(video, timestamp);
// results.landmarks: array per hand, each landmark { x, y, z? } normalized 0–1
```

### 7.2 npm migration checklist

- [ ] Add `@mediapipe/tasks-vision@0.10.3` to `dependencies` (not devDependencies).
- [ ] Change import to package name.
- [ ] Verify WASM loading in dev and production.
- [ ] Verify GPU delegate; document fallback to CPU if init fails on some devices.
- [ ] Type `handLandmarker` as `HandLandmarker | null` until initialized.

### 7.3 Ambient declarations (`src/mediapipe.d.ts`)

Use if official types are missing or `detectForVideo` return type is not exported:

```ts
declare module "@mediapipe/tasks-vision" {
  export interface NormalizedLandmark {
    x: number;
    y: number;
    z: number;
  }

  export interface HandLandmarkerResult {
    landmarks?: NormalizedLandmark[][];
  }

  export class FilesetResolver {
    static forVisionTasks(wasmPath: string): Promise<unknown>;
  }

  export class HandLandmarker {
    static createFromOptions(
      vision: unknown,
      options: {
        baseOptions: {
          modelAssetPath: string;
          delegate?: "GPU" | "CPU";
        };
        runningMode: "VIDEO" | "IMAGE";
        numHands?: number;
      },
    ): Promise<HandLandmarker>;

    detectForVideo(
      video: HTMLVideoElement,
      timestamp: number,
    ): HandLandmarkerResult;
  }
}
```

Refine `vision` from `unknown` to a package type if exports exist.

### 7.4 Vite WASM troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| 404 on `.wasm` in dev | Wrong `forVisionTasks` path | Log `wasmPath`; try CDN interim |
| Works in dev, fails in preview | Asset not copied to `dist` | `vite.config` `assetsInclude`, `build.rollupOptions` |
| GPU delegate error | Hardware / browser | Try `delegate: "CPU"` in options |
| CORS on model | Unlikely (GCS allows) | Check network tab |

---

## 8. Domain types reference

Create `src/types.ts` with these definitions (adjust names to taste):

```ts
/** Only two hands are tracked (MediaPipe numHands: 2). */
export type HandIndex = 0 | 1;

export type Gesture = "idle" | "draw" | "burst";

/** Normalized landmark from MediaPipe (0–1). */
export type Landmark = {
  x: number;
  y: number;
  z?: number;
};

export type TrailPoint = {
  x: number;
  y: number;
  /** Timestamp from performance.now() when point was added. */
  t: number;
};

export type Tip = {
  x: number;
  y: number;
};

export type Star = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  age: number;
  maxAge: number;
  rotation: number;
  rotSpeed: number;
};

export type HandTrailState = Record<HandIndex, TrailPoint[]>;
export type HandTipState = Record<HandIndex, Tip | null>;
export type HandMissState = Record<HandIndex, number>;
```

### 8.1 Coordinate helpers

Type the mappers used in detection and skeleton code:

```ts
export type MapCoord = (p: Landmark) => number;
export type MapCoords = {
  mx: MapCoord;
  my: MapCoord;
};

export function createMappers(
  width: number,
  height: number,
): MapCoords {
  return {
    mx: (p) => (1 - p.x) * width,
    my: (p) => p.y * height,
  };
}
```

(`1 - p.x` mirrors horizontally for selfie-style webcam.)

---

## 9. Module extraction plan

### 9.1 `gestures.ts`

Move `classify(lm)` unchanged; return type `Gesture`.

Finger “up” logic uses landmark indices `8, 12, 16, 20` compared to `i - 2` (knuckle proxy). Document index map in a comment referencing MediaPipe hand landmark diagram.

### 9.2 `trail.ts`

Exports:

- `pushTrailPoint(trail, tipX, tipY, now, distThresholds...)`
- `expireTrailPoints(trail, cutoff)`
- `drawRainbowTrails(ctx, handTrails, now, W, H)` — includes Catmull-Rom band loop

Keep `RAINBOW`, `TRAIL_LIFETIME`, `TRAIL_WIDTH` from `constants.ts`.

### 9.3 `stars.ts`

Exports:

- `spawnStars(stars, x, y, count?)` — respects `MAX_STARS`
- `updateAndDrawStars(ctx, stars, dt)` — splice dead, physics, `drawStar`

### 9.4 `skeleton.ts`

Exports `drawSkeleton(ctx, lm, mx, my, gesture)`.

### 9.5 `mediapipe.ts`

Exports async `initializeHandTracking(): Promise<{
  video: HTMLVideoElement;
  handLandmarker: HandLandmarker;
  stream: MediaStream;
}>`.

Contains `getUserMedia` try/catch fallback from current `init()`.

### 9.6 `loop.ts`

Owns or receives:

- `handLandmarker`, `video`, canvas contexts, dimensions `W`/`H`
- mutable `handTrails`, `smoothTip`, `handMissed`, `stars`
- `lastTimestamp`, `isRunning`

Exports `function startLoop(...): void` scheduling `requestAnimationFrame`.

---

## 10. DOM and canvas safety patterns

### 10.1 `src/dom.ts`

```ts
export function requireElement<T extends HTMLElement>(
  id: string,
): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el as T;
}

export function requireCanvas2d(
  id: string,
): CanvasRenderingContext2D {
  const canvas = requireElement<HTMLCanvasElement>(id);
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) {
    throw new Error(`Could not get 2d context for #${id}`);
  }
  return ctx;
}
```

For `fxCanvas`, pass `{ willReadFrequently: false }` as today. For `uiCanvas`, default context options.

### 10.2 Boot sequence in `main.ts`

```ts
const video = requireElement<HTMLVideoElement>("webcam");
const fxCanvas = requireElement<HTMLCanvasElement>("fxCanvas");
const uiCanvas = requireElement<HTMLCanvasElement>("uiCanvas");
const fxCtx = requireCanvas2d("fxCanvas");
const uiCtx = requireCanvas2d("uiCanvas");
const overlay = requireElement<HTMLElement>("overlay");
const overlayMsg = requireElement<HTMLElement>("overlayMsg");
```

### 10.3 Resize canvas

Extract listener from `loadeddata`:

```ts
function resizeCanvasesToVideo(
  video: HTMLVideoElement,
  canvases: HTMLCanvasElement[],
): { width: number; height: number } {
  const width = video.videoWidth;
  const height = video.videoHeight;
  for (const c of canvases) {
    c.width = width;
    c.height = height;
  }
  return { width, height };
}
```

---

## 11. Vite and build configuration

### 11.1 When to add `vite.config.ts`

Add if any of the following occur during Phase 2:

- WASM files not served from `node_modules`
- Need `optimizeDeps.include: ['@mediapipe/tasks-vision']`
- Need `assetsInclude: ['**/*.wasm', '**/*.task']`

### 11.2 Example stub

```ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: ["@mediapipe/tasks-vision"],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
});
```

Tune after measuring `pnpm dev` and network panel.

### 11.3 `index.html` TypeScript entry

```html
<script type="module" src="/src/main.ts"></script>
```

Vite resolves `.ts` without a plugin.

---

## 12. Scripts, CI, and developer workflow

### 12.1 `package.json` changes summary

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite` | HMR development |
| `typecheck` | `tsc --noEmit` | CI and pre-commit |
| `build` | `pnpm typecheck && vite build` | Release |
| `preview` | `vite preview` | Test `dist/` |

### 12.2 Local workflow

```bash
pnpm install
pnpm dev          # http://localhost:5173 — allow camera
pnpm typecheck    # fast validation
pnpm build && pnpm preview
```

### 12.3 Editor support

Recommend VS Code / Cursor extensions:

- `dbaeumer.vscode-eslint` (if ESLint added)
- Built-in TypeScript (no extension required)

Add `.vscode/extensions.json` optional:

```json
{
  "recommendations": ["dbaeumer.vscode-eslint"]
}
```

---

## 13. Verification and test plan

No automated tests today. Use this manual checklist after **each phase**:

### 13.1 Init and error paths

- [ ] Loading overlay shows “Loading MediaPipe…”
- [ ] On success, overlay hides, video visible
- [ ] Deny camera permission → error message on overlay, spinner hidden
- [ ] Console: no uncaught errors

### 13.2 Single hand

- [ ] ☝️ Index only → `draw` → rainbow trail follows finger
- [ ] ✌️ Index + middle → `burst` → stars spawn, trail clears
- [ ] ✋ All fingers extended → `idle` → trail fades naturally (not cleared immediately)

### 13.3 Two hands

- [ ] Two independent trails (indices 0 and 1)
- [ ] Removing one hand: trail persists briefly (grace ~6 frames), then clears
- [ ] Re-add hand: trail does not “teleport” stitch if jump > 180px (new trail segment)

### 13.4 Performance smoke

- [ ] Animation smooth on target machine (~30–60 fps)
- [ ] Star count capped (no runaway memory)

### 13.5 Build vs dev

- [ ] `pnpm build && pnpm preview` matches `pnpm dev` behavior

---

## 14. Risks, mitigations, and rollback

| Risk | Impact | Mitigation | Rollback |
|------|--------|------------|----------|
| WASM path breaks | App stuck on loading | CDN WASM interim; log paths | Revert Phase 2 commit |
| GPU delegate unsupported | Init throws | `delegate: "CPU"` fallback | Config-only change |
| Incomplete MediaPipe types | `typecheck` noise | `mediapipe.d.ts` shim | Keep shim |
| Modularization bugs | Visual regressions | One module per commit; manual test | Revert module commit |
| Strict null on DOM | Build fails | `dom.ts` helpers | N/A |

**Git strategy:** One phase per branch; tag `pre-typescript` on `main` before starting if desired.

---

## 15. PR strategy and commit guidance

### 15.1 Recommended PR split

| PR | Title | Contents |
|----|-------|----------|
| 1 | `chore: add TypeScript toolchain` | Phase 0 + 1: delete counter, fix HTML, tsconfig, rename main.ts, scripts |
| 2 | `feat: use npm MediaPipe with types` | Phase 2 + 3: package import, types, dom helpers |
| 3 | `refactor: split src into modules` | Phase 4 (optional) |
| 4 | `ci: typecheck and build on push` | Phase 5 + 6 |

### 15.2 Commit message examples

- `chore: remove unused counter scaffold`
- `chore: add tsconfig and typecheck script`
- `refactor: rename main.js to main.ts`
- `feat: import MediaPipe from npm package`
- `feat: add domain types for trails and gestures`
- `refactor: extract trail drawing into trail.ts`
- `ci: add GitHub Actions workflow`

---

## 16. Definition of done checklist

Migration is **complete** when all are true:

- [ ] `src/` contains only `.ts` files (plus `.css`, `vite-env.d.ts`)
- [ ] `src/counter.js` deleted
- [ ] `index.html` references `/src/main.ts`; valid HTML
- [ ] `tsconfig.json` with `strict: true`
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build` exits 0
- [ ] `@mediapipe/tasks-vision@0.10.3` in `dependencies`
- [ ] No CDN JavaScript module import in source
- [ ] Domain types: `Gesture`, `TrailPoint`, `Star`, `HandIndex`
- [ ] Manual test plan ([Section 13](#13-verification-and-test-plan)) passed
- [ ] CI runs typecheck + build (if Phase 5 done)
- [ ] This document status updated to **Complete**

---

## 17. Appendix: file-by-file mapping

| Current (JS) | Target (TS) | Notes |
|--------------|-------------|-------|
| `src/main.js` (lines 1–5) | `main.ts` + `mediapipe.ts` | imports |
| `src/main.js` (7–16) | `main.ts` + `dom.ts` | DOM refs |
| `src/main.js` (18–27) | `constants.ts` | RAINBOW |
| `src/main.js` (29–46) | `constants.ts` + `types.ts` | trail/star config |
| `src/main.js` (48–53) | `loop.ts` or `types.ts` | module state |
| `src/main.js` (55–93) | `mediapipe.ts` | `init` |
| `src/main.js` (95–106) | `gestures.ts` | `classify` |
| `src/main.js` (108–130) | `stars.ts` | `spawnStars` |
| `src/main.js` (132–151) | `stars.ts` | `drawStar` |
| `src/main.js` (153–339) | `loop.ts` + `trail.ts` + `stars.ts` | `loop` |
| `src/main.js` (341–396) | `skeleton.ts` | `drawSkeleton` |
| `src/main.js` (398–403) | `main.ts` | boot catch |
| `src/counter.js` | — | delete |
| `index.html` | `index.html` | script src, fix body |
| `package.json` | `package.json` | deps + scripts |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-20 | Initial detailed plan |
