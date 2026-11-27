import type { ScopedThreadRef } from "@t3tools/contracts";
import { htmlRenderFrameHeight } from "@t3tools/shared/htmlRender";
import {
  Maximize2Icon,
  MessageSquareTextIcon,
  MinusIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilRulerIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { isElectron } from "../../env";
import { observeResize } from "../../lib/observeResize";
import { cn, isMacPlatform } from "../../lib/utils";
import { useThreadVisibleTurnItems } from "../../state/entities";
import {
  STUDIO_ZOOM_STEP,
  annotationsFor,
  collectPrototypeGroups,
  fitStudioPage,
  isPrototypeViewport,
  type PrototypeGroup,
  type PrototypeVariant,
  type PrototypeViewport,
} from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import { AnnotationRail } from "./AnnotationRail";
import { PrototypeDecisions } from "./PrototypeDecisions";
import { PrototypeStage } from "./PrototypeStage";
import { PrototypeVariantPills } from "./PrototypeVariantPills";
import { prototypeViewportLabel, stagePrototypeMessage } from "./prototypeMessages";
import {
  readPrototypeView,
  usePrototypeStore,
  type PrototypeOriginRect,
  type PrototypeStudioState,
} from "./prototypeStore";

const STUDIO_VIEWPORTS: readonly PrototypeViewport[] = ["desktop", "tablet", "mobile"];
const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";
const NARROW_STUDIO_BREAKPOINT_PX = 768;
const STAGE_FRAME_HORIZONTAL_CHROME_PX = 22;
const STAGE_FRAME_VERTICAL_CHROME_PX = 48;
const ENTER_DURATION_MS = 260;
const EXIT_DURATION_MS = 200;

let windowFullscreenSnapshot: boolean | null = null;

function macosDesktopBridge() {
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;
  return window.desktopBridge ?? null;
}

function subscribeToWindowFullscreen(onChange: () => void): () => void {
  const bridge = macosDesktopBridge();
  if (
    typeof bridge?.getWindowFullscreenState !== "function" ||
    typeof bridge.onWindowFullscreenStateChange !== "function"
  ) {
    return () => {};
  }
  const unsubscribe = bridge.onWindowFullscreenStateChange((fullscreen) => {
    windowFullscreenSnapshot = fullscreen;
    onChange();
  });
  windowFullscreenSnapshot = bridge.getWindowFullscreenState();
  return () => {
    unsubscribe();
    windowFullscreenSnapshot = null;
  };
}

function readWindowFullscreen(): boolean {
  if (windowFullscreenSnapshot === null) {
    const getWindowFullscreenState = macosDesktopBridge()?.getWindowFullscreenState;
    windowFullscreenSnapshot =
      typeof getWindowFullscreenState === "function" ? getWindowFullscreenState() : false;
  }
  return windowFullscreenSnapshot;
}

function subscribeToNarrowViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_STUDIO_BREAKPOINT_PX;
}

function studioMotionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (document.querySelector('[data-panel-animations="false"]') !== null) return false;
  return true;
}

function liveCardRect(groupId: string): PrototypeOriginRect | null {
  for (const candidate of document.querySelectorAll<HTMLElement>("[data-prototype-card]")) {
    if (candidate.dataset.prototypeCard !== groupId) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
  }
  return null;
}

function flipFrameForRect(rect: PrototypeOriginRect | null): Keyframe {
  if (rect === null || window.innerWidth <= 0 || window.innerHeight <= 0) {
    return {
      transform: "translate3d(0, 10px, 0) scale(0.965)",
      borderRadius: "14px",
      opacity: 0,
    };
  }
  const sx = Math.max(0.12, Math.min(1, rect.width / window.innerWidth));
  const sy = Math.max(0.12, Math.min(1, rect.height / window.innerHeight));
  return {
    transform: `translate3d(${rect.left}px, ${rect.top}px, 0) scale(${sx}, ${sy})`,
    borderRadius: "16px",
    opacity: 0.9,
  };
}

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
    <div className="flex min-h-0 min-w-0 flex-col items-center gap-2.5">
      <div className="flex flex-wrap items-center justify-center gap-2">
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

function PrototypeStudioSession({
  scope,
  studio,
  group,
}: {
  readonly scope: ScopedThreadRef;
  readonly studio: PrototypeStudioState;
  readonly group: PrototypeGroup;
}) {
  const copy = useDockCopy();
  const viewport = usePrototypeStore((state) => state.studioViewport);
  const zoomMode = usePrototypeStore((state) => state.studioZoomMode);
  const manualZoom = usePrototypeStore((state) => state.studioManualZoom);
  const railOpen = usePrototypeStore((state) => state.studioRailOpen);
  const rightId = usePrototypeStore((state) => state.studioRightId);
  const selectedId = usePrototypeStore((state) => state.selectedVariants[group.id] ?? "");
  const view = usePrototypeStore((state) => readPrototypeView(state.views, group.id));
  const notes = usePrototypeStore((state) =>
    state.annotations.filter((annotation) => annotation.groupId === group.id),
  );
  const hasActiveDraft = usePrototypeStore(
    (state) =>
      state.draft !== null && state.draft.groupId === group.id && state.draft.viewport === viewport,
  );
  const closeStudio = usePrototypeStore((state) => state.closeStudio);
  const setStudioCompare = usePrototypeStore((state) => state.setStudioCompare);
  const setStudioViewport = usePrototypeStore((state) => state.setStudioViewport);
  const setStudioZoomFit = usePrototypeStore((state) => state.setStudioZoomFit);
  const setStudioManualZoom = usePrototypeStore((state) => state.setStudioManualZoom);
  const stepStudioZoom = usePrototypeStore((state) => state.stepStudioZoom);
  const toggleStudioRail = usePrototypeStore((state) => state.toggleStudioRail);
  const setStudioRightId = usePrototypeStore((state) => state.setStudioRightId);
  const setView = usePrototypeStore((state) => state.setView);
  const selectVariant = usePrototypeStore((state) => state.selectVariant);

  const isNarrow = useSyncExternalStore(subscribeToNarrowViewport, readNarrowViewport);
  const isWindowFullscreen = useSyncExternalStore(
    subscribeToWindowFullscreen,
    readWindowFullscreen,
  );
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const needsMacTrafficLightInset = isMacosDesktop && !isWindowFullscreen;

  const backdropRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [stageSize, setStageSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<Readonly<Record<string, number>>>({});
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const observeStage = (box: HTMLDivElement) => {
    setStageSize({ width: box.clientWidth, height: box.clientHeight });
    return observeResize(box, ([entry]) => {
      if (entry !== undefined) {
        setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the imperative Web Animations FLIP mount transition on the studio DOM nodes
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const backdrop = backdropRef.current;
    if (shell === null || !studioMotionAllowed() || typeof shell.animate !== "function") return;
    const origin = studio.originRect ?? liveCardRect(group.id);
    const enterAnim = shell.animate(
      [
        flipFrameForRect(origin),
        { transform: "translate3d(0, 0, 0) scale(1, 1)", borderRadius: "0px", opacity: 1 },
      ],
      { duration: ENTER_DURATION_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    const backdropAnim = backdrop?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      easing: "ease-out",
    });
    return () => {
      enterAnim.cancel();
      backdropAnim?.cancel();
    };
  }, [group.id, studio.originRect]);

  const left = group.variants.find((variant) => variant.id === selectedId) ?? group.variants[0];
  if (left === undefined) return null;
  const right =
    group.variants.find((variant) => variant.id === rightId && variant.id !== left.id) ??
    group.variants.find((variant) => variant.id !== left.id);
  const side = group.variants.length > 1 && studio.compare && right !== undefined ? right : null;
  const title = group.topic || copy.protoUntitled;
  const multi = group.variants.length > 1;
  const effectiveMode = side !== null ? "browse" : view.mode;
  const desktopRailVisible = !isNarrow && side === null && railOpen;
  const mobileSheetVisible = isNarrow && side === null && (mobileSheetOpen || hasActiveDraft);

  const stagePadX = isNarrow ? 24 : 48;
  const stagePadY = isNarrow ? 80 : 104;
  const compareGap = 24;
  const rawAvailWidth =
    stageSize === null
      ? isNarrow
        ? 360
        : 960
      : side !== null && !isNarrow
        ? Math.max((stageSize.width - stagePadX - compareGap) / 2, 1)
        : Math.max(stageSize.width - stagePadX, 1);
  const rawAvailHeight = stageSize === null ? 640 : Math.max(stageSize.height - stagePadY, 1);

  const layoutFor = (variant: PrototypeVariant) => {
    const heightKey = `${variant.id}:${viewport}`;
    const reportedHeight = measuredHeights[heightKey];
    const approxWidth = Math.max(rawAvailWidth - STAGE_FRAME_HORIZONTAL_CHROME_PX, 1);
    const estimatedHeight = htmlRenderFrameHeight(variant.htmlRender, approxWidth, reportedHeight);
    return fitStudioPage({
      viewport,
      availableWidth: Math.max(rawAvailWidth - STAGE_FRAME_HORIZONTAL_CHROME_PX, 1),
      availableHeight: Math.max(rawAvailHeight - STAGE_FRAME_VERTICAL_CHROME_PX, 1),
      pageHeight: estimatedHeight,
      zoomMode,
      manualZoom,
    });
  };

  const leftLayout = layoutFor(left);
  const rightLayout = side !== null ? layoutFor(side) : null;
  const activeScale = leftLayout.scale;
  const zoomPercent = Math.round(activeScale * 100);
  const leftNotes = annotationsFor(notes, group.id, left.id, viewport);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const shell = shellRef.current;
    const backdrop = backdropRef.current;
    if (shell === null || !studioMotionAllowed() || typeof shell.animate !== "function") {
      closeStudio();
      return;
    }
    const target = liveCardRect(group.id) ?? studio.originRect;
    const exitAnim = shell.animate(
      [
        { transform: "translate3d(0, 0, 0) scale(1, 1)", borderRadius: "0px", opacity: 1 },
        { ...flipFrameForRect(target), opacity: 0 },
      ],
      { duration: EXIT_DURATION_MS, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" },
    );
    backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: EXIT_DURATION_MS,
      easing: "ease-in",
      fill: "forwards",
    });
    const finish = () => {
      closeStudio();
    };
    void exitAnim.finished.then(finish, finish);
  };

  const decide = (message: string) => {
    if (message === "") return;
    stagePrototypeMessage(scope, message);
    toastManager.add({ type: "success", title: copy.protoFilledToast });
    requestClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (mobileSheetOpen) {
        setMobileSheetOpen(false);
        return;
      }
      requestClose();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        stepStudioZoom(STUDIO_ZOOM_STEP, activeScale);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        stepStudioZoom(-STUDIO_ZOOM_STEP, activeScale);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setStudioZoomFit();
        return;
      }
    }
    if (side !== null || !multi) return;
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

  const renderStage = (
    variant: PrototypeVariant,
    layout: { readonly width: number; readonly scale: number },
    allowAnnotate: boolean,
  ) => {
    const heightKey = `${variant.id}:${viewport}`;
    const caption = multi && variant.key !== null ? `${variant.key} · ${variant.name}` : title;
    return (
      <PrototypeStage
        key={`${variant.id}:${viewport}`}
        environmentId={scope.environmentId}
        threadRef={scope}
        group={group}
        variant={variant}
        viewport={viewport}
        mode={allowAnnotate ? effectiveMode : "browse"}
        caption={caption}
        annotate={allowAnnotate}
        layoutOverride={layout}
        elevated
        onContentHeight={(height) =>
          setMeasuredHeights((prev) =>
            prev[heightKey] === height ? prev : { ...prev, [heightKey]: height },
          )
        }
      />
    );
  };

  const topbarStyle: CSSProperties | undefined = needsMacTrafficLightInset
    ? { paddingLeft: MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
    : undefined;

  return (
    <div className="fixed inset-0 z-100">
      <div
        ref={backdropRef}
        aria-hidden="true"
        data-prototype-studio-backdrop
        className="absolute inset-0 bg-foreground/20 backdrop-blur-xs"
      />
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.protoStudioTitle}
        autoFocus
        tabIndex={-1}
        data-prototype-studio={group.id}
        onKeyDown={onKeyDown}
        className="relative flex size-full origin-top-left flex-col overflow-hidden bg-background outline-none"
      >
        <header
          data-prototype-studio-header
          style={topbarStyle}
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3",
            isElectron
              ? "drag-region h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] wco:pr-(--workspace-native-controls-inset)"
              : "h-12 min-h-12",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-foreground">
              <PencilRulerIcon className="size-3.5" />
            </span>
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {!isNarrow ? (
              <Badge variant="secondary">
                {notes.length > 0
                  ? copy.protoPendingAnnotations.replace("{count}", String(notes.length))
                  : copy.protoNoAnnotations}
              </Badge>
            ) : null}
          </div>

          <div className="hidden items-center gap-2 [-webkit-app-region:no-drag] md:flex">
            {multi ? (
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
          </div>

          <div className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
            {side === null && !isNarrow ? (
              <ToggleGroup
                aria-label={copy.protoModeLabel}
                value={[effectiveMode]}
                onValueChange={(next) => {
                  const mode = next[0];
                  if (mode === "annotate" || mode === "browse") setView(group.id, { mode });
                }}
              >
                <Toggle value="annotate">{copy.protoModeAnnotate}</Toggle>
                <Toggle value="browse">{copy.protoModeBrowse}</Toggle>
              </ToggleGroup>
            ) : null}
            {side === null && isNarrow ? (
              <Button
                size="xs"
                variant={mobileSheetVisible ? "secondary" : "outline"}
                aria-pressed={mobileSheetVisible}
                onClick={() => setMobileSheetOpen((open) => !open)}
              >
                <MessageSquareTextIcon className="size-3.5" />
                {copy.protoRailTitle.replace("{count}", String(leftNotes.length))}
              </Button>
            ) : null}
            {side === null && !isNarrow ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant={railOpen ? "secondary" : "ghost"}
                      aria-label={copy.protoStudioToggleRail}
                      aria-pressed={railOpen}
                      onClick={toggleStudioRail}
                    />
                  }
                >
                  {railOpen ? (
                    <PanelRightCloseIcon className="size-4" />
                  ) : (
                    <PanelRightOpenIcon className="size-4" />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="bottom">{copy.protoStudioToggleRail}</TooltipPopup>
              </Tooltip>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={copy.protoStudioClose}
              onClick={requestClose}
            >
              <XIcon />
            </Button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            ref={observeStage}
            data-prototype-studio-canvas
            className="prototype-studio-canvas relative min-h-0 min-w-0 flex-1 overflow-auto"
          >
            <div className="flex min-h-full w-full flex-col items-center justify-center p-6 pb-20 max-[767px]:p-3 max-[767px]:pb-16">
              {side !== null && rightLayout !== null ? (
                <div className="grid w-full grid-cols-2 items-start justify-items-center gap-6 max-[900px]:grid-cols-1">
                  <Pane
                    label={copy.protoStudioLeft}
                    group={group}
                    selected={left}
                    onSelect={(variantId) => selectVariant(group.id, variantId)}
                  >
                    {renderStage(left, leftLayout, false)}
                  </Pane>
                  <Pane
                    label={copy.protoStudioRight}
                    group={group}
                    selected={side}
                    onSelect={setStudioRightId}
                  >
                    {renderStage(side, rightLayout, false)}
                  </Pane>
                </div>
              ) : (
                <div className="flex w-full flex-col items-center gap-3">
                  {multi ? (
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
                  {renderStage(left, leftLayout, true)}
                </div>
              )}
            </div>

            <div className="pointer-events-none sticky bottom-3 z-30 flex justify-center px-3">
              <div
                role="group"
                aria-label={copy.protoStudioZoomLabel}
                data-prototype-zoom-dock
                className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/92 px-2 py-1 shadow-md backdrop-blur-md"
              >
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={copy.protoStudioZoomOut}
                  onClick={() => stepStudioZoom(-STUDIO_ZOOM_STEP, activeScale)}
                >
                  <MinusIcon className="size-3.5" />
                </Button>
                <span
                  data-prototype-zoom-value
                  className="min-w-11 text-center font-mono text-xs text-muted-foreground tabular-nums"
                >
                  {zoomPercent}%
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={copy.protoStudioZoomIn}
                  onClick={() => stepStudioZoom(STUDIO_ZOOM_STEP, activeScale)}
                >
                  <PlusIcon className="size-3.5" />
                </Button>
                <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />
                <Button
                  size="xs"
                  variant={zoomMode === "fit" ? "secondary" : "ghost"}
                  aria-pressed={zoomMode === "fit"}
                  onClick={setStudioZoomFit}
                >
                  <Maximize2Icon className="size-3" />
                  {copy.protoStudioZoomFit}
                </Button>
                <Button
                  size="xs"
                  variant={
                    zoomMode === "manual" && Math.abs(manualZoom - 1) < 0.01 ? "secondary" : "ghost"
                  }
                  aria-pressed={zoomMode === "manual" && Math.abs(manualZoom - 1) < 0.01}
                  onClick={() => setStudioManualZoom(1)}
                >
                  {copy.protoStudioZoomActual}
                </Button>
              </div>
            </div>
          </div>

          {desktopRailVisible ? (
            <div className="w-72 shrink-0 border-l border-border bg-card">
              <AnnotationRail
                group={group}
                variant={left}
                viewport={viewport}
                mode={effectiveMode}
                annotations={leftNotes}
                layout="studio"
                onStartAnnotate={() => setView(group.id, { mode: "annotate" })}
              />
            </div>
          ) : null}

          {mobileSheetVisible ? (
            <div className="absolute inset-0 z-40 flex flex-col justify-end">
              <button
                type="button"
                aria-label={copy.protoStudioCloseSheet}
                onClick={() => setMobileSheetOpen(false)}
                className="flex-1 bg-foreground/20 backdrop-blur-xs"
              />
              <div className="overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl">
                <AnnotationRail
                  group={group}
                  variant={left}
                  viewport={viewport}
                  mode={effectiveMode}
                  annotations={leftNotes}
                  layout="sheet"
                  onStartAnnotate={() => {
                    setView(group.id, { mode: "annotate" });
                    setMobileSheetOpen(false);
                  }}
                  onClose={() => setMobileSheetOpen(false)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-t border-border bg-card px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="truncate">
              {left.key !== null && multi ? `${left.key} · ${left.name}` : title}
            </span>
            {!isNarrow ? (
              <span className="shrink-0 opacity-75">{copy.protoStudioShortcuts}</span>
            ) : null}
          </div>
          <PrototypeDecisions group={group} variant={left} notes={notes} onDecide={decide} />
        </footer>
      </div>
    </div>
  );
}

/**
 * A full-window workbench for one prototype set: enlarged adaptive canvas, optional side-by-side
 * compare, live annotation rail, and FLIP transition back to its card.
 */
export function PrototypeStudio({ scope }: { readonly scope: ScopedThreadRef }) {
  const items = useThreadVisibleTurnItems(scope);
  const studio = usePrototypeStore((state) => state.studio);
  const closeStudio = usePrototypeStore((state) => state.closeStudio);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- leaving its thread closes the studio, so it never covers another thread on return
  useEffect(() => closeStudio, [closeStudio]);

  const group =
    studio === null
      ? null
      : (collectPrototypeGroups(items).find((candidate) => candidate.id === studio.groupId) ??
        null);
  if (studio === null || group === null) return null;
  return (
    <PrototypeStudioSession key={studio.groupId} scope={scope} studio={studio} group={group} />
  );
}
