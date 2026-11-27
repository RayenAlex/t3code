import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export function detentPosition(index: number, count: number, inset: number) {
  return count <= 1 ? 0.5 : inset + (index / (count - 1)) * (1 - 2 * inset);
}

export function detentKeyIndex(
  event: KeyboardEvent,
  index: number,
  count: number,
  enabled: (index: number) => boolean,
) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return null;
  const direction =
    event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "Home"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "End"
        ? -1
        : 0;
  if (direction === 0) return null;
  event.preventDefault();
  event.stopPropagation();
  let next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : index + direction;
  for (; next >= 0 && next < count; next += direction) {
    if (enabled(next)) return next;
  }
  return null;
}

export function useDetentDrag({
  count,
  inset,
  enabled,
  onCommit,
}: {
  count: number;
  inset: number;
  enabled: (index: number) => boolean;
  onCommit: (index: number) => void;
}) {
  const drag = useRef<{ id: number; left: number; width: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const read = (event: PointerEvent<HTMLElement>) => {
    const session = drag.current;
    if (!session || session.id !== event.pointerId) return null;
    const fraction = (event.clientX - session.left) / session.width;
    const first = inset;
    const last = 1 - inset;
    const clamped = Math.min(last, Math.max(first, fraction));
    const index = Math.round(((clamped - first) / (last - first)) * (count - 1));
    const center = detentPosition(index, count, inset);
    const overshoot = Math.min(0.045, Math.max(-0.045, (fraction - clamped) * 0.2));
    const position = Math.min(0.98, Math.max(0.02, 0.72 * clamped + 0.28 * center + overshoot));
    return { index, position };
  };
  const update = (event: PointerEvent<HTMLElement>) => {
    const next = read(event);
    if (!next) return;
    event.currentTarget.style.setProperty("--dock-detent-drag", `${next.position * 100}%`);
    setPreview(enabled(next.index) ? next.index : null);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.style.removeProperty("--dock-detent-drag");
    delete event.currentTarget.dataset.dragging;
    setPreview(null);
  };
  return {
    preview,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.defaultPrevented || event.button !== 0 || !event.isPrimary || count < 2) return;
        const { left, width } = event.currentTarget.getBoundingClientRect();
        if (width === 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, left, width };
        event.currentTarget.dataset.dragging = "";
        update(event);
      },
      onPointerMove: update,
      // Dragging previews only; releasing on a valid detent is what writes the model or permission change.
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const next = read(event);
        finish(event);
        if (next && enabled(next.index)) onCommit(next.index);
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  };
}
