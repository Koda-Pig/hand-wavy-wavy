import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const publicWasm = path.join(root, "public/mediapipe-wasm");

function copyWasmFiles(): void {
  fs.mkdirSync(publicWasm, { recursive: true });
  for (const file of fs.readdirSync(wasmSrc)) {
    fs.copyFileSync(path.join(wasmSrc, file), path.join(publicWasm, file));
  }
}

function mediapipeWasm(): Plugin {
  return {
    name: "mediapipe-wasm",
    buildStart() {
      copyWasmFiles();
    },
    configureServer() {
      copyWasmFiles();
    },
  };
}

export default defineConfig({
  plugins: [mediapipeWasm()],
});
