import type { ScopedThreadRef } from "@t3tools/contracts";
import { PencilRulerIcon, XIcon } from "lucide-react";
import { useEffect, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { useThreadVisibleTurnItems } from "../../state/entities";
import {
  collectPrototypeGroups,
  isPrototypeViewport,
  type PrototypeGroup,
  type PrototypeVariant,
  type PrototypeViewport,
} from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import { PrototypeDecisions } from "./PrototypeDecisions";
import { PrototypeStage } from "./PrototypeStage";
import { PrototypeVariantPills } from "./PrototypeVariantPills";
import { prototypeViewportLabel, stagePrototypeMessage } from "./prototypeMessages";
import { usePrototypeStore } from "./prototypeStore";

const STUDIO_VIEWPORTS: readonly PrototypeViewport[] = ["desktop", "tablet", "mobile"];

function Pane({
  label,
  group,
  selected,
  onSelect,
  children,
}: {
  readonly label: string;
  readonly group: PrototypeGroup;
  readonly selected: PrototypeVariant;
  readonly onSelect: (variantId: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold text-muted-foreground">{label}</span>
        <PrototypeVariantPills
          variants={group.variants}
          selectedId={selected.id}
          lettered={group.variants.length > 1}
          onSelect={onSelect}
        />
      </div>
      {children}
    </div>
  );
}

/**
 * A full-window workbench for one prototype set: the pages at their real size, side by side, and
 * the decision at the bottom. It lives outside the chat's virtual list, so it outlives its card.
 */
export function PrototypeStudio({ scope }: { readonly scope: ScopedThreadRef }) {
  const copy = useDockCopy();
  const items = useThreadVisibleTurnItems(scope);
  const studio = usePrototypeStore((state) => state.studio);
  const groupId = studio?.groupId ?? "";
  const compare = studio?.compare === true;
  const viewport = usePrototypeStore((state) => state.studioViewport);
  const rightId = usePrototypeStore((state) => state.studioRightId);
  const selectedId = usePrototypeStore((state) => state.selectedVariants[groupId] ?? "");
  const notes = usePrototypeStore((state) =>
    state.annotations.filter((annotation) => annotation.groupId === groupId),
  );
  const closeStudio = usePrototypeStore((state) => state.closeStudio);
  const setStudioCompare = usePrototypeStore((state) => state.setStudioCompare);
  const setStudioViewport = usePrototypeStore((state) => state.setStudioViewport);
  const setStudioRightId = usePrototypeStore((state) => state.setStudioRightId);
  const selectVariant = usePrototypeStore((state) => state.selectVariant);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- leaving its thread closes the studio, so it never covers another thread on return
  useEffect(() => closeStudio, [closeStudio]);

  const group =
    studio === null
      ? null
      : (collectPrototypeGroups(items).find((candidate) => candidate.id === studio.groupId) ??
        null);
  if (studio === null || group === null) return null;
  const left = group.variants.find((variant) => variant.id === selectedId) ?? group.variants[0];
  if (left === undefined) return null;
  const right =
    group.variants.find((variant) => variant.id === rightId && variant.id !== left.id) ??
    group.variants.find((variant) => variant.id !== left.id);
  const side = group.variants.length > 1 && compare && right !== undefined ? right : null;
  const title = group.topic || copy.protoUntitled;
  const decide = (message: string) => {
    if (message === "") return;
    stagePrototypeMessage(scope, message);
    toastManager.add({ type: "success", title: copy.protoFilledToast });
    closeStudio();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeStudio();
      return;
    }
    if (side !== null || group.variants.length <= 1) return;
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
  const stage = (variant: PrototypeVariant) => (
    <PrototypeStage
      key={`${variant.id}:${viewport}`}
      environmentId={scope.environmentId}
      threadRef={scope}
      group={group}
      variant={variant}
      viewport={viewport}
      mode="browse"
      caption={title}
      annotate={false}
    />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.protoStudioTitle}
      autoFocus
      tabIndex={-1}
      data-prototype-studio={group.id}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-100 flex flex-col bg-background outline-none"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-foreground">
            <PencilRulerIcon className="size-3.5" />
          </span>
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {group.variants.length > 1 ? (
            <ToggleGroup
              aria-label={copy.protoStudioView}
              value={[side === null ? "single" : "compare"]}
              onValueChange={(next) => {
                const mode = next[0];
                if (mode === "single" || mode === "compare") setStudioCompare(mode === "compare");
              }}
            >
              <Toggle value="single">{copy.protoStudioSingle}</Toggle>
              <Toggle value="compare">{copy.protoStudioCompare}</Toggle>
            </ToggleGroup>
          ) : null}
          <ToggleGroup
            aria-label={copy.protoViewportLabel}
            value={[viewport]}
            onValueChange={(next) => {
              const nextViewport = next[0];
              if (isPrototypeViewport(nextViewport)) setStudioViewport(nextViewport);
            }}
          >
            {STUDIO_VIEWPORTS.map((candidate) => (
              <Toggle key={candidate} value={candidate}>
                {prototypeViewportLabel(copy, candidate)}
              </Toggle>
            ))}
          </ToggleGroup>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={copy.protoStudioClose}
            onClick={closeStudio}
          >
            <XIcon />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {side !== null ? (
          <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
            <Pane
              label={copy.protoStudioLeft}
              group={group}
              selected={left}
              onSelect={(variantId) => selectVariant(group.id, variantId)}
            >
              {stage(left)}
            </Pane>
            <Pane
              label={copy.protoStudioRight}
              group={group}
              selected={side}
              onSelect={setStudioRightId}
            >
              {stage(side)}
            </Pane>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {group.variants.length > 1 ? (
              <PrototypeVariantPills
                variants={group.variants}
                selectedId={left.id}
                lettered
                counts={
                  new Map(
                    group.variants.map((variant) => [
                      variant.id,
                      notes.filter((note) => note.variantId === variant.id).length,
                    ]),
                  )
                }
                onSelect={(variantId) => selectVariant(group.id, variantId)}
              />
            ) : null}
            <div className="w-full min-w-0">{stage(left)}</div>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
        <span className="text-xs text-muted-foreground">
          {left.key !== null && group.variants.length > 1 ? `${left.key} · ${left.name}` : title}
        </span>
        <PrototypeDecisions group={group} variant={left} notes={notes} onDecide={decide} />
      </footer>
    </div>
  );
}
