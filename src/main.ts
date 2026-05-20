import "./style.css";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { bindCanvasLayout } from "./canvasLayout";
import { startLoop } from "./loop";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const videoEl = document.querySelector<HTMLVideoElement>("#webcam");
const canvasEl = document.querySelector<HTMLCanvasElement>("#overlay");
const stageEl = document.querySelector<HTMLElement>(".stage");

function setStatus(message: string, hide = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.hidden = hide;
}

function showError(message: string): void {
  setStatus(message);
}

async function resolveVisionTasks() {
  const localWasm = new URL(
    `${import.meta.env.BASE_URL}mediapipe-wasm`,
    location.origin,
  ).href;
  const paths = [localWasm, WASM_CDN];

  let lastError: unknown;
  for (const wasmPath of paths) {
    try {
      const probe = await fetch(`${wasmPath}/vision_wasm_internal.js`, {
        method: "HEAD",
      });
      if (!probe.ok) throw new Error(`WASM loader not found (${probe.status})`);
      return await FilesetResolver.forVisionTasks(wasmPath);
    } catch (error) {
      lastError = error;
      console.warn(`MediaPipe WASM path failed: ${wasmPath}`, error);
    }
  }

  throw lastError ?? new Error("Failed to load MediaPipe WASM");
}

async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await resolveVisionTasks();

  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate,
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
    } catch (error) {
      if (delegate === "CPU") throw error;
    }
  }

  throw new Error("Failed to create HandLandmarker");
}

async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
  });

  video.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener(
      "error",
      () => reject(new Error("Video failed to load")),
      { once: true },
    );
  });

  await video.play();
}

async function main(): Promise<void> {
  if (!statusEl || !videoEl || !canvasEl || !stageEl) {
    throw new Error("Missing required DOM elements");
  }

  try {
    setStatus("Starting camera…");
    await startCamera(videoEl);

    const getLayout = bindCanvasLayout(canvasEl, videoEl, stageEl);

    setStatus("Loading hand tracker…");
    const handLandmarker = await createHandLandmarker();

    setStatus("Ready", true);
    startLoop(handLandmarker, videoEl, canvasEl, getLayout);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      showError("Camera permission denied. Allow camera access and reload.");
      return;
    }
    if (error instanceof DOMException && error.name === "NotFoundError") {
      showError("No camera found.");
      return;
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    showError(message);
    console.error(error);
  }
}

main();
