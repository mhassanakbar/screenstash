import './region.css';
const context = await window.screenstashRegion.context();
const frame = document.getElementById('frame') as HTMLImageElement;
const selection = document.getElementById('selection')!;
const help = document.getElementById('help')!;
frame.src = context.imageUrl;
let origin: { x: number; y: number } | undefined;
let submitting = false;
const point = (event: PointerEvent) => ({
  x: Math.max(0, Math.min(context.width, event.clientX)),
  y: Math.max(0, Math.min(context.height, event.clientY)),
});
const rectangle = (end: { x: number; y: number }) => ({
  x: Math.min(origin!.x, end.x),
  y: Math.min(origin!.y, end.y),
  width: Math.abs(end.x - origin!.x),
  height: Math.abs(end.y - origin!.y),
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    void window.screenstashRegion.select({ id: context.id, rectangle: null });
  }
});
document.addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0 ||
    submitting ||
    !frame.complete ||
    !frame.naturalWidth
  )
    return;
  origin = point(event);
  selection.hidden = false;
  document.body.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', (event) => {
  if (!origin || submitting) return;
  const area = rectangle(point(event));
  Object.assign(selection.style, {
    left: `${area.x}px`,
    top: `${area.y}px`,
    width: `${area.width}px`,
    height: `${area.height}px`,
  });
  help.textContent = `${Math.round(area.width)} × ${Math.round(area.height)} · Release to capture · Escape to cancel`;
});
document.addEventListener('pointerup', async (event) => {
  if (!origin || submitting) return;
  const area = rectangle(point(event));
  origin = undefined;
  if (area.width < 2 || area.height < 2) {
    selection.hidden = true;
    help.textContent =
      'Select an area at least 2 × 2 pixels · Escape to cancel';
    return;
  }
  submitting = true;
  try {
    await window.screenstashRegion.select({ id: context.id, rectangle: area });
  } catch {
    submitting = false;
    help.textContent =
      'Selection could not be saved. Try again or press Escape.';
  }
});
document.addEventListener('pointercancel', () => {
  origin = undefined;
  selection.hidden = true;
});
