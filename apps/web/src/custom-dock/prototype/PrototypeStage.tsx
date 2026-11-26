import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { htmlRenderFrameHeight } from "@t3tools/shared/htmlRender";
import { useState } from "react";

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
  /** The chat card marks the page; the studio only shows it. */
  readonly annotate: boolean;
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
  // Until the column is measured, the page shows at its own width.
  const inner =
    columnWidth === null ? STAGE_PAGE_WIDTHS[viewport] : Math.max(columnWidth - STAGE_CHROME_PX, 1);
  const { width, scale } = fitPrototypePage(viewport, inner);
  const pageHeight = htmlRenderFrameHeight(variant.htmlRender, width, contentHeight);
  const annotating = props.annotate && props.mode === "annotate";

  return (
    <div ref={observeColumn} className="min-w-0">
      <div
        data-prototype-stage
        className="mx-auto overflow-hidden rounded-md border border-border bg-card"
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
          {annotating ? <span className="shrink-0">{copy.protoModeAnnotate}</span> : null}
        </div>
        <div className="flex justify-center bg-background p-2.5">
          <div
            data-prototype-page={scale < 1 ? "scaled" : "natural"}
            className="relative"
            style={{ width: width * scale, height: pageHeight * scale }}
          >
            <div
              className="relative"
              style={{
                width,
                height: pageHeight,
                transform: scale < 1 ? `scale(${scale})` : undefined,
                transformOrigin: "top left",
              }}
            >
              <PrototypeFrame
                environmentId={props.environmentId}
                threadRef={props.threadRef}
                htmlRender={variant.htmlRender}
                onContentHeight={setContentHeight}
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
