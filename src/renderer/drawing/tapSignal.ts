/**
 * Cross-component gesture hand-off (drawing overlay → chart shell).
 *
 * On mobile the chart shell treats a clean tap on empty chart space as "toggle the
 * timeframe strip". But the drawing overlay (CanvasOverlay) handles its OWN touch taps
 * (selecting / deselecting an object, dismissing its menu) on a SEPARATE event path — so
 * without coordination, a tap that selected/deselected a drawing ALSO opened the TF strip
 * (#8: "tapping away to close the menu also makes the TF slider appear").
 *
 * The overlay STAMPS `consumedAt` the instant it handles such a touch (at pointer-DOWN, so
 * it's set before the shell's touch-END fires for the same gesture); the shell checks it on
 * touch-end and skips the TF toggle when the stamp is from this gesture, then clears it.
 */
export const drawTapSignal = { consumedAt: 0 };

/** Called by the drawing overlay when a TOUCH tap is consumed by the drawing layer. */
export function markDrawTapConsumed(): void {
  drawTapSignal.consumedAt = Date.now();
}

/** True if a drawing tap was consumed within the last gesture window; clears the stamp so
 *  it only ever suppresses the ONE tap it belongs to (a later clean tap toggles normally). */
export function consumeDrawTap(): boolean {
  const hit = drawTapSignal.consumedAt !== 0 && Date.now() - drawTapSignal.consumedAt < 1200;
  drawTapSignal.consumedAt = 0;
  return hit;
}
