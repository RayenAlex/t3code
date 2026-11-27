import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { htmlRenderFrameHeight } from "@t3tools/shared/htmlRender";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import {
  PROTOTYPE_DESKTOP_MIN_WIDTH,
  PROTOTYPE_VIEWPORT_WIDTHS,
  annotationsFor,
  fitPrototypePage,
  type PrototypeGroup,
  type PrototypeVariant,
  type PrototypeViewport,
} from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import { AnnotationLayer } from "./AnnotationLayer";
import { PrototypeFrame } from "./PrototypeFrame";
import { type PrototypeMode, usePrototypeStore } from "./prototypeStore";

/** The frame's border and padding on both sides of the page: 1px and 10px each. */
const STAGE_CHROME_PX = 22;
const STAGE_PAGE_WIDTHS = {
  desktop: PROTOTYPE_DESKTOP_MIN_WIDTH,
  tablet: PROTOTYPE_VIEWPORT_WIDTHS.tablet ?? PROTOTYPE_DESKTOP_MIN_WIDTH,
  mobile: PROTOTYPE_VIEWPORT_WIDTHS.mobile ?? PROTOTYPE_DESKTOP_MIN_WIDTH,
} as const;

/**
 * One prototype page above a browser-like caption. The page lays out at its viewport's width and
 * is scaled to fit the column, so a desktop layout keeps its shape beside a narrow chat.
 * The parent keys it by variant and viewport: each change loads a fresh page.
 */
export function PrototypeStage(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly group: PrototypeGroup;
  readonly variant: PrototypeVariant;
  readonly viewport: PrototypeViewport;
  readonly mode: PrototypeMode;
  readonly caption: string;
  /** Whether clicking or dragging over the page records annotations. */
  readonly annotate: boolean;
  /** Optional externally computed layout width and scale (used by the expanded studio). */
  readonly layoutOverride?: { readonly width: number; readonly scale: number } | undefined;
  /** Optional elevated framing for the expanded workbench canvas. */
  readonly elevated?: boolean | undefined;
  /** Called whenever the embedded document reports its measured height. */
  readonly onContentHeight?: ((height: number) => void) | undefined;
}) {
  const copy = useDockCopy();
  const { group, variant, viewport } = props;
  const annotations = usePrototypeStore((state) =>
    annotationsFor(state.annotations, group.id, variant.id, viewport),
  );
  const draft = usePrototypeStore((state) =>
    state.draft !== null &&
    state.draft.groupId === group.id &&
    state.draft.variantId === variant.id &&
    state.draft.viewport === viewport
      ? state.draft
      : null,
  );
  const selectedId = usePrototypeStore((state) => state.selectedAnnotationId);
  const startDraft = usePrototypeStore((state) => state.startDraft);
  const selectAnnotation = usePrototypeStore((state) => state.selectAnnotation);
  const [columnWidth, setColumnWidth] = useState<number | null>(null);
  const observeColumn = (box: HTMLDivElement) => {
    setColumnWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry !== undefined) setColumnWidth(entry.contentRect.width);
    });
  };
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const handleContentHeight = (height: number) => {
    setContentHeight(height);
    props.onContentHeight?.(height);
  };
  // Until the column is measured, the page shows at its own width.
  const inner =
    columnWidth === null ? STAGE_PAGE_WIDTHS[viewport] : Math.max(columnWidth - STAGE_CHROME_PX, 1);
  const { width, scale } = props.layoutOverride ?? fitPrototypePage(viewport, inner);
  const pageHeight = htmlRenderFrameHeight(variant.htmlRender, width, contentHeight);
  const annotating = props.annotate && props.mode === "annotate";
  const pageScaleState = scale < 1 ? "scaled" : scale > 1 ? "enlarged" : "natural";
  const frameRadiusClass =
    props.elevated === true
      ? viewport === "mobile"
        ? "rounded-2xl shadow-xl"
        : "rounded-xl shadow-lg"
      : "rounded-md";

  return (
    <div ref={props.layoutOverride === undefined ? observeColumn : undefined} className="min-w-0">
      <div
        data-prototype-stage
        className={cn("mx-auto overflow-hidden border border-border bg-card", frameRadiusClass)}
        style={{ width: width * scale + STAGE_CHROME_PX }}
      >
        <div className="flex h-6 items-center justify-between gap-2 border-b border-border bg-muted px-2.5 text-2xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="flex shrink-0 gap-1">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="size-1.5 rounded-full bg-border" />
              ))}
            </span>
            <span className="truncate">{props.caption}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-3xs">
            {props.elevated === true ? (
              <span>
                {Math.round(width)}×{Math.round(pageHeight)} · {Math.round(scale * 100)}%
              </span>
            ) : null}
            {annotating ? (
              <span className="font-sans text-2xs">{copy.protoModeAnnotate}</span>
            ) : null}
          </span>
        </div>
        <div className="flex justify-center bg-background p-2.5">
          <div
            data-prototype-page={pageScaleState}
            className="relative"
            style={{ width: width * scale, height: pageHeight * scale }}
          >
            <div
              className="relative"
              style={{
                width,
                height: pageHeight,
                transform: scale !== 1 ? `scale(${scale})` : undefined,
                transformOrigin: "top left",
              }}
            >
              <PrototypeFrame
                environmentId={props.environmentId}
                threadRef={props.threadRef}
                htmlRender={variant.htmlRender}
                onContentHeight={handleContentHeight}
              />
              {props.annotate ? (
                <AnnotationLayer
                  active={props.mode === "annotate"}
                  scale={scale}
                  annotations={annotations}
                  selectedId={selectedId}
                  draft={draft}
                  onSelect={selectAnnotation}
                  onMark={(mark) =>
                    startDraft({ ...mark, groupId: group.id, variantId: variant.id, viewport })
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
