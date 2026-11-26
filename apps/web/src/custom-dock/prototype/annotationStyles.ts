import type { ComponentProps } from "react";

import type { Badge } from "../../components/ui/badge";
import type { AnnotationBox, AnnotationKind } from "../core/prototypes";

/** Each kind of note keeps one color wherever it appears: on the page, in the rail, in lists. */

export const ANNOTATION_PIN = {
  inaccurate: "bg-warning text-background",
  replace: "bg-destructive text-destructive-foreground",
  layout: "bg-accent text-accent-foreground",
} as const satisfies Record<AnnotationKind, string>;

export const ANNOTATION_BOX = {
  inaccurate: "border-dashed border-warning bg-warning/10",
  replace: "border-dashed border-destructive bg-destructive/10",
  layout: "border-accent bg-accent/10",
} as const satisfies Record<AnnotationKind, string>;

export const ANNOTATION_BADGE = {
  inaccurate: "warning",
  replace: "error",
  layout: "secondary",
} as const satisfies Record<AnnotationKind, NonNullable<ComponentProps<typeof Badge>["variant"]>>;

export function annotationBoxStyle(box: AnnotationBox) {
  return {
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.w}%`,
    height: `${box.h}%`,
  };
}

export function annotationPinStyle(pin: { readonly x: number; readonly y: number }, scale: number) {
  return {
    left: `${pin.x}%`,
    top: `${pin.y}%`,
    // Pins sit inside the scaled page, so they undo the scale to stay one size.
    transform: `translate(-50%, -50%) scale(${1 / scale})`,
  };
}
