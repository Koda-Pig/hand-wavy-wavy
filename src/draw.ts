import {
  CONNECTIONS,
  DOT_RADIUS,
  HAND_COLORS,
  LINE_WIDTH,
  mx,
  my,
  SHOW_DEBUG,
  type HandSlot,
} from "./landmarks";

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  slots: (HandSlot | null)[],
  width: number,
  height: number,
): void {
  for (let i = 0; i < slots.length; i++) {
    const hand = slots[i];
    if (!hand) continue;

    const color = HAND_COLORS[i] ?? HAND_COLORS[0];
    const { landmarks, handedness } = hand;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = LINE_WIDTH;

    for (const [a, b] of CONNECTIONS) {
      const p0 = landmarks[a];
      const p1 = landmarks[b];
      if (!p0 || !p1) continue;
      ctx.beginPath();
      ctx.moveTo(mx(p0, width), my(p0, height));
      ctx.lineTo(mx(p1, width), my(p1, height));
      ctx.stroke();
    }

    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc(mx(p, width), my(p, height), DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    if (SHOW_DEBUG && handedness?.[0]) {
      const wrist = landmarks[0];
      if (!wrist) continue;
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(
        handedness[0].categoryName,
        mx(wrist, width) + 8,
        my(wrist, height) - 8,
      );
    }
  }
}
