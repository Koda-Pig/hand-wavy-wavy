import type { Category, NormalizedLandmark } from "@mediapipe/tasks-vision";

export const GRACE_FRAMES = 6;
export const MIRROR_X = true;
export const SHOW_DEBUG = false;

export const CONNECTIONS: [number, number][] = [
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

export const HAND_COLORS = [
  "rgba(199, 125, 255, 0.7)",
  "rgba(125, 200, 255, 0.7)",
] as const;

export const LINE_WIDTH = 1.5;
export const DOT_RADIUS = 4;

export function mx(p: { x: number }, width: number): number {
  return (MIRROR_X ? 1 - p.x : p.x) * width;
}

export function my(p: { y: number }, height: number): number {
  return p.y * height;
}

export type HandSlot = {
  landmarks: NormalizedLandmark[];
  handedness?: Category[];
};
