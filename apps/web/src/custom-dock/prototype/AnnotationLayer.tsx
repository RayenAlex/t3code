import type { PointerEvent } from "react";
import { Fragment, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import {
  ANNOTATION_DRAG_THRESHOLD_PX,
  annotationGeometry,
  type AnnotationKind,
  type AnnotationMark,
  type PrototypeAnnotation,
  type StagePoint,
} from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import {
  ANNOTATION_BOX,
  ANNOTATION_PIN,
  annotationBoxStyle,
  annotationPinStyle,
} from "./annotationStyles";
import { annotationKindLabel } from "./prototypeMessages";
import type { AnnotationDraft } from "./prototypeStore";

type Mark = AnnotationMark & { readonly kind: AnnotationKind };

function MarkBox({
  mark,
  className,
}: {
  readonly mark: Mark;
  readonly className?: string | undefined;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-md border",
        ANNOTATION_BOX[mark.kind],
        className,
      )}
      style={annotationBoxStyle(mark.box)}
    />
  );
}

interface Drag {
  readonly start: StagePoint;
  readonly current: StagePoint;
  readonly width: number;
  readonly height: number;
}

/**
 * A transparent sheet over the sandboxed prototype page. Only an active sheet takes the pointer:
 * the page is an opaque origin, so the host cannot see clicks inside it or name what they hit.
 */
export function AnnotationLayer(props: {
  readonly active: boolean;
  readonly scale: number;
  readonly annotations: readonly PrototypeAnnotation[];
  readonly selectedId: number | null;
  readonly draft: AnnotationDraft | null;
  readonly onSelect: (id: number | null) => void;
  readonly onMark: (mark: AnnotationMark) => void;
}) {
  const copy = useDockCopy();
  const [drag, setDrag] = useState<Drag | null>(null);
  const draggingPointer = useRef<number | null>(null);
  const offset = (event: PointerEvent<HTMLDivElement>, rect: DOMRect): StagePoint => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!props.active || event.button !== 0 || draggingPointer.current !== null) return;
    if (event.target instanceof Element && event.target.closest("[data-annotation-pin]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingPointer.current = event.pointerId;
    const at = offset(event, rect);
    setDrag({ start: at, current: at, width: rect.width, height: rect.height });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    setDrag({ ...drag, current: offset(event, event.currentTarget.getBoundingClientRect()) });
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (drag === null || draggingPointer.current !== event.pointerId) return;
    draggingPointer.current = null;
    setDrag(null);
    if (cancelled) return;
    const end = offset(event, event.currentTarget.getBoundingClientRect());
    props.onMark(annotationGeometry(drag.start, end, drag));
  };
  const dragged =
    drag !== null &&
    Math.max(Math.abs(drag.current.x - drag.start.x), Math.abs(drag.current.y - drag.start.y)) >
      ANNOTATION_DRAG_THRESHOLD_PX
      ? annotationGeometry(drag.start, drag.current, drag).box
      : null;

  return (
    <div
      data-prototype-annotation-layer={props.active ? "active" : "passive"}
      tabIndex={-1}
      className={cn(
        "absolute inset-0 z-20 touch-none select-none outline-none",
        props.active ? "cursor-crosshair" : "pointer-events-none",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerEnd(event, false)}
      onPointerCancel={(event) => onPointerEnd(event, true)}
    >
      {props.annotations.map((annotation, index) => {
        const selected = props.selectedId === annotation.id;
        return (
          <Fragment key={annotation.id}>
            <MarkBox mark={annotation} className={selected ? "border-solid" : undefined} />
            <button
              type="button"
              data-annotation-pin
              aria-pressed={selected}
              aria-label={`${index + 1}. ${annotationKindLabel(copy, annotation.kind)}: ${annotation.text}`}
              className={cn(
                "pointer-events-auto absolute z-10 flex size-5 items-center justify-center rounded-full border-2 border-card font-mono text-3xs font-bold shadow-md",
                ANNOTATION_PIN[annotation.kind],
                selected && "ring-2 ring-card",
              )}
              style={annotationPinStyle(annotation.pin, props.scale)}
              onClick={() => props.onSelect(selected ? null : annotation.id)}
            >
              {index + 1}
            </button>
          </Fragment>
        );
      })}
      {props.draft !== null && (
        <>
          <MarkBox mark={props.draft} />
          <div
            aria-hidden="true"
            className={cn(
              "absolute z-10 flex size-5 items-center justify-center rounded-full border-2 border-card font-mono text-3xs leading-none font-bold",
              ANNOTATION_PIN[props.draft.kind],
            )}
            style={annotationPinStyle(props.draft.pin, props.scale)}
          >
            +
          </div>
        </>
      )}
      {dragged !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded border border-dashed border-accent bg-accent/15"
          style={annotationBoxStyle(dragged)}
        />
      ) : null}
    </div>
  );
}
