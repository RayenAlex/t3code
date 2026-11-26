import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Maximize2Icon, PencilRulerIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import type { TimelineRow, TimelineRowSharedState } from "../../components/chat/timelineRowContext";
import { useThreadVisibleTurnItems } from "../../state/entities";
import {
  annotationsFor,
  collectPrototypeGroups,
  parsePrototypeTitle,
  prototypeGroupForRow,
  type PrototypeGroup,
  type PrototypeViewport,
} from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import { AnnotationRail } from "./AnnotationRail";
import { PrototypeDecisions } from "./PrototypeDecisions";
import { PrototypeStage } from "./PrototypeStage";
import { PrototypeVariantPills } from "./PrototypeVariantPills";
import { stagePrototypeMessage } from "./prototypeMessages";
import { readPrototypeView, usePrototypeStore } from "./prototypeStore";

type PrototypeRow = Extract<TimelineRow, { kind: "html-render" }>;

/**
 * The timeline's one seam to this feature: a row that a model titled as a prototype renders as a
 * review card. Any other row returns `undefined` and renders as it always did.
 */
export function renderCustomDockPrototypeRow(
  row: PrototypeRow,
  ctx: Pick<TimelineRowSharedState, "activeThreadEnvironmentId" | "threadRef">,
): ReactNode | undefined {
  if (parsePrototypeTitle(row.htmlRender.title) === null) return undefined;
  return (
    <PrototypeRow
      row={row}
      environmentId={ctx.activeThreadEnvironmentId}
      threadRef={ctx.threadRef ?? undefined}
    />
  );
}

function PrototypeRow({
  row,
  environmentId,
  threadRef,
}: {
  readonly row: PrototypeRow;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | undefined;
}) {
  const items = useThreadVisibleTurnItems(threadRef ?? null);
  // The first render of a set shows all its variants; the rows after it stay empty.
  const group = prototypeGroupForRow(collectPrototypeGroups(items), row);
  if (group === null) return null;
  return <PrototypeCard group={group} environmentId={environmentId} threadRef={threadRef} />;
}

const CARD_VIEWPORTS: readonly PrototypeViewport[] = ["desktop", "mobile"];

function PrototypeCard({
  group,
  environmentId,
  threadRef,
}: {
  readonly group: PrototypeGroup;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | undefined;
}) {
  const copy = useDockCopy();
  const view = usePrototypeStore((state) => readPrototypeView(state.views, group.id));
  const selectedVariantId = usePrototypeStore(
    (state) => state.selectedVariants[group.id] ?? group.variants[0]?.id ?? "",
  );
  const notes = usePrototypeStore((state) =>
    state.annotations.filter((annotation) => annotation.groupId === group.id),
  );
  const setView = usePrototypeStore((state) => state.setView);
  const selectVariant = usePrototypeStore((state) => state.selectVariant);
  const openStudio = usePrototypeStore((state) => state.openStudio);
  const variant =
    group.variants.find((candidate) => candidate.id === selectedVariantId) ?? group.variants[0];
  if (variant === undefined) return null;
  const multi = group.variants.length > 1;
  const title = group.topic || copy.protoUntitled;
  const counts = new Map(
    group.variants.map((candidate) => [
      candidate.id,
      notes.filter((note) => note.variantId === candidate.id).length,
    ]),
  );
  const caption = multi && variant.key !== null ? `${variant.key} · ${variant.name}` : title;
  const decide = (message: string) => {
    if (threadRef === undefined || message === "") return;
    stagePrototypeMessage(threadRef, message);
    toastManager.add({ type: "success", title: copy.protoFilledToast });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!multi || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")
    )
      return;
    const candidate = /^[1-9]$/.test(event.key) ? group.variants[Number(event.key) - 1] : undefined;
    if (candidate === undefined) return;
    event.preventDefault();
    selectVariant(group.id, candidate.id);
  };
  return (
    <section
      data-prototype-card={group.id}
      aria-label={title}
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    >
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-foreground">
            <PencilRulerIcon className="size-3.5" />
          </span>
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          <Badge data-prototype-notes-badge variant="secondary">
            {notes.length > 0
              ? copy.protoPendingAnnotations.replace("{count}", String(notes.length))
              : copy.protoNoAnnotations}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleGroup
            aria-label={copy.protoModeLabel}
            value={[view.mode]}
            onValueChange={(next) => {
              const mode = next[0];
              if (mode === "annotate" || mode === "browse") setView(group.id, { mode });
            }}
          >
            <Toggle value="annotate">{copy.protoModeAnnotate}</Toggle>
            <Toggle value="browse">{copy.protoModeBrowse}</Toggle>
          </ToggleGroup>
          <ToggleGroup
            aria-label={copy.protoViewportLabel}
            value={[view.viewport]}
            onValueChange={(next) => {
              const viewport = next[0];
              if (viewport === "desktop" || viewport === "mobile") setView(group.id, { viewport });
            }}
          >
            {CARD_VIEWPORTS.map((viewport) => (
              <Toggle key={viewport} value={viewport}>
                {viewport === "desktop" ? copy.protoViewportDesktop : copy.protoViewportMobile}
              </Toggle>
            ))}
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={copy.protoOpenStudio}
                  onClick={() => openStudio(group.id)}
                />
              }
            >
              <Maximize2Icon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">{copy.protoOpenStudio}</TooltipPopup>
          </Tooltip>
        </div>
      </header>
      {multi ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3.5 py-2">
          <PrototypeVariantPills
            variants={group.variants}
            selectedId={variant.id}
            lettered
            counts={counts}
            onSelect={(variantId) => selectVariant(group.id, variantId)}
          />
          <span className="text-2xs text-muted-foreground">
            {view.mode === "annotate" ? copy.protoModeTipAnnotate : copy.protoModeTipBrowse}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_236px] border-b border-border max-[640px]:grid-cols-1">
        <div className="min-w-0 border-r border-border p-3.5 max-[640px]:border-r-0 max-[640px]:border-b">
          <PrototypeStage
            key={`${variant.id}:${view.viewport}`}
            environmentId={environmentId}
            threadRef={threadRef}
            group={group}
            variant={variant}
            viewport={view.viewport}
            mode={view.mode}
            caption={caption}
            annotate
          />
        </div>
        <AnnotationRail
          group={group}
          variant={variant}
          viewport={view.viewport}
          mode={view.mode}
          annotations={annotationsFor(notes, group.id, variant.id, view.viewport)}
          onStartAnnotate={() => setView(group.id, { mode: "annotate" })}
        />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5">
        <span className="text-xs text-muted-foreground">
          {notes.length > 0
            ? copy.protoStatusCount.replace("{count}", String(notes.length))
            : view.mode === "annotate"
              ? copy.protoStatusEmpty
              : copy.protoStatusBrowse}
        </span>
        {threadRef !== undefined ? (
          <PrototypeDecisions group={group} variant={variant} notes={notes} onDecide={decide} />
        ) : null}
      </footer>
    </section>
  );
}
