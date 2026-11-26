import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import { HTML_RENDER_COLUMN_WIDTH } from "@t3tools/shared/htmlRender";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";

export type PrototypeViewport = "desktop" | "tablet" | "mobile";

/** A viewport without an entry is as wide as its container allows. */
export const PROTOTYPE_VIEWPORT_WIDTHS: Readonly<Partial<Record<PrototypeViewport, number>>> = {
  tablet: 768,
  mobile: 390,
};

export function isPrototypeViewport(value: unknown): value is PrototypeViewport {
  return value === "desktop" || value === "tablet" || value === "mobile";
}

/** A desktop page lays out at least this wide, then scales down to fit a narrow column. */
export const PROTOTYPE_DESKTOP_MIN_WIDTH = HTML_RENDER_COLUMN_WIDTH;
const PROTOTYPE_DESKTOP_MAX_WIDTH = 1280;

// `[Prototype] <topic>` is one prototype; `[Prototype:A] <topic>: <variant name>` is one of 2-3.
const PROTOTYPE_TITLE = /^\s*\[prototype(?::\s*([^\]\s]{1,12}))?\]\s*(\S[\s\S]*?)\s*$/i;
const TOPIC_SEPARATORS = [": ", "：", " - ", " | ", "｜"] as const;

export interface PrototypeTitle {
  /** `A` for `[Prototype:A]`; null for a single `[Prototype]`. */
  readonly key: string | null;
  /** Empty when a variant title names no topic, as in `[Prototype:A] Sidebar nav`. */
  readonly topic: string;
  readonly name: string;
}

function splitTopic(text: string): { readonly topic: string; readonly name: string } | null {
  let at = -1;
  let width = 0;
  for (const separator of TOPIC_SEPARATORS) {
    const index = text.indexOf(separator);
    if (index > 0 && (at === -1 || index < at)) {
      at = index;
      width = separator.length;
    }
  }
  if (at === -1) return null;
  const topic = text.slice(0, at).trim();
  const name = text.slice(at + width).trim();
  return topic === "" || name === "" ? null : { topic, name };
}

export function parsePrototypeTitle(title: string): PrototypeTitle | null {
  const match = PROTOTYPE_TITLE.exec(title);
  if (match === null) return null;
  const text = match[2] ?? "";
  const key = match[1] === undefined ? null : match[1].toUpperCase();
  const split = key === null ? null : splitTopic(text);
  return split === null
    ? { key, topic: key === null ? text : "", name: text }
    : { key, topic: split.topic, name: split.name };
}

export interface PrototypeVariant {
  /** The `html_render` tool item's id, which is also the id of its timeline row. */
  readonly id: string;
  readonly key: string | null;
  readonly name: string;
  readonly htmlRender: HtmlRenderReference;
}

/** The prototypes one run published for one topic. */
export interface PrototypeGroup {
  readonly id: string;
  /** Empty when no variant title named one. */
  readonly topic: string;
  readonly variants: readonly PrototypeVariant[];
}

function prototypeEntry(projected: OrchestrationV2ProjectedTurnItem): {
  readonly runId: string;
  readonly topic: string;
  readonly variant: PrototypeVariant;
} | null {
  const item = projected.item;
  if (item.type !== "dynamic_tool" || item.status !== "completed") return null;
  const htmlRender = htmlRenderFromToolItem(item);
  if (htmlRender === undefined) return null;
  const title = parsePrototypeTitle(htmlRender.title);
  if (title === null) return null;
  return {
    runId: item.runId ?? item.id,
    topic: title.topic,
    variant: { id: item.id, key: title.key, name: title.name, htmlRender },
  };
}

/** `items` are the thread's visible turn items as the timeline shows them. */
export function collectPrototypeGroups(
  items: readonly OrchestrationV2ProjectedTurnItem[],
): readonly PrototypeGroup[] {
  const runs = new Map<
    string,
    { readonly topics: Map<string, PrototypeVariant[]>; readonly untitled: PrototypeVariant[] }
  >();
  for (const projected of items) {
    const entry = prototypeEntry(projected);
    if (entry === null) continue;
    const run = runs.get(entry.runId) ?? {
      topics: new Map<string, PrototypeVariant[]>(),
      untitled: [],
    };
    runs.set(entry.runId, run);
    if (entry.topic === "") run.untitled.push(entry.variant);
    else run.topics.set(entry.topic, [...(run.topics.get(entry.topic) ?? []), entry.variant]);
  }
  const groups: PrototypeGroup[] = [];
  for (const [runId, run] of runs) {
    const grouped = new Map(run.topics);
    if (run.untitled.length > 0) {
      // A variant that names no topic belongs with the run's only titled topic.
      const topic = grouped.size === 1 ? [...grouped.keys()][0] : undefined;
      const shared = topic ?? "";
      grouped.set(shared, [...(grouped.get(shared) ?? []), ...run.untitled]);
    }
    for (const [topic, variants] of grouped) {
      groups.push({ id: `${runId}:${topic}`, topic, variants });
    }
  }
  return groups;
}

/**
 * What a timeline row for a prototype render shows: its group when the row leads it, nothing
 * when a leading row already covers it.
 */
export function prototypeGroupForRow(
  groups: readonly PrototypeGroup[],
  row: { readonly id: string; readonly htmlRender: HtmlRenderReference },
): PrototypeGroup | null {
  const group = groups.find((candidate) =>
    candidate.variants.some((variant) => variant.id === row.id),
  );
  if (group !== undefined) return group.variants[0]?.id === row.id ? group : null;
  // The thread's items are not at hand, as in a thread preview: the row stands on its own.
  const title = parsePrototypeTitle(row.htmlRender.title);
  if (title === null) return null;
  return {
    id: row.id,
    topic: title.topic || title.name,
    variants: [{ id: row.id, key: title.key, name: title.name, htmlRender: row.htmlRender }],
  };
}

export type AnnotationKind = "inaccurate" | "replace" | "layout";
export const PROTOTYPE_ANNOTATION_KINDS: readonly AnnotationKind[] = [
  "inaccurate",
  "replace",
  "layout",
];

/** Percent of the page box, so a mark survives resizing. */
export interface AnnotationBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AnnotationMark {
  readonly shape: "box" | "point";
  readonly box: AnnotationBox;
  /** Where the numbered pin sits. */
  readonly pin: { readonly x: number; readonly y: number };
}

export interface PrototypeAnnotation extends AnnotationMark {
  readonly id: number;
  readonly groupId: string;
  readonly variantId: string;
  /** Marks are kept per viewport: the other layout moves everything they point at. */
  readonly viewport: PrototypeViewport;
  readonly kind: AnnotationKind;
  readonly text: string;
}

export const ANNOTATION_DRAG_THRESHOLD_PX = 14;
const POINT_BOX_PERCENT = { w: 14, h: 9 } as const;

export interface StagePoint {
  readonly x: number;
  readonly y: number;
}

/** `start` and `end` are pixels from the page box's corner, as the reader sees the scaled page. */
export function annotationGeometry(
  start: StagePoint,
  end: StagePoint,
  page: { readonly width: number; readonly height: number },
): AnnotationMark {
  const width = Math.max(page.width, 1);
  const height = Math.max(page.height, 1);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const percent = (value: number, total: number) => (value / total) * 100;
  const x1 = clamp(start.x, width);
  const y1 = clamp(start.y, height);
  const x2 = clamp(end.x, width);
  const y2 = clamp(end.y, height);
  if (Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) > ANNOTATION_DRAG_THRESHOLD_PX) {
    const box = {
      x: percent(Math.min(x1, x2), width),
      y: percent(Math.min(y1, y2), height),
      w: percent(Math.abs(x2 - x1), width),
      h: percent(Math.abs(y2 - y1), height),
    };
    return { shape: "box", box, pin: { x: Math.min(96, box.x + box.w), y: Math.max(4, box.y) } };
  }
  const pin = { x: percent(x1, width), y: percent(y1, height) };
  return {
    shape: "point",
    box: {
      x: clamp(pin.x - POINT_BOX_PERCENT.w / 2, 100 - POINT_BOX_PERCENT.w),
      y: clamp(pin.y - POINT_BOX_PERCENT.h / 2, 100 - POINT_BOX_PERCENT.h),
      w: POINT_BOX_PERCENT.w,
      h: POINT_BOX_PERCENT.h,
    },
    pin,
  };
}

const whole = (value: number) => String(Math.round(value));

/** Page coordinates a model can locate in the HTML it wrote. */
export function formatAnnotationArea(mark: AnnotationMark): string {
  const { box } = mark;
  return mark.shape === "point"
    ? `x ${whole(box.x + box.w / 2)}%, y ${whole(box.y + box.h / 2)}%`
    : `x ${whole(box.x)}% to ${whole(box.x + box.w)}%, y ${whole(box.y)}% to ${whole(box.y + box.h)}%`;
}

export function annotationsFor(
  annotations: readonly PrototypeAnnotation[],
  groupId: string,
  variantId: string,
  viewport: PrototypeViewport,
): readonly PrototypeAnnotation[] {
  return annotations.filter(
    (annotation) =>
      annotation.groupId === groupId &&
      annotation.variantId === variantId &&
      annotation.viewport === viewport,
  );
}

/** The width a page lays out at, and the scale that fits it into `available` pixels. */
export function fitPrototypePage(
  viewport: PrototypeViewport,
  available: number,
): { readonly width: number; readonly scale: number } {
  const fixed = PROTOTYPE_VIEWPORT_WIDTHS[viewport];
  const width =
    fixed !== undefined
      ? fixed
      : Math.min(PROTOTYPE_DESKTOP_MAX_WIDTH, Math.max(PROTOTYPE_DESKTOP_MIN_WIDTH, available));
  return { width, scale: Math.min(1, available / width) };
}
