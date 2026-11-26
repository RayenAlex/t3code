import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadStructure } from "@t3tools/client-runtime/state/shell";
import type {
  ScopedThreadRef,
  ServerProvider,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Gauge,
  Globe,
  ListTodo,
  PanelRight,
  PencilRuler,
  X,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStore } from "zustand";

import { useComposerDraftStore } from "../../composerDraftStore";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { useNowMinute } from "../../hooks/useNowMinute";
import { observeResize } from "../../lib/observeResize";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import type { AppRouter } from "../../router";
import { useProject, useQuietThreadShell, useServerConfigs } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { resolveGeminiQuotaCard } from "../core/geminiQuota";
import { createRunHistory } from "../core/historyDb";
import { latestDockRun, isTerminalRun, timestampMs } from "../core/runStructure";
import { deriveLiveStreamTps } from "../core/streamRate";
import { deriveDockSnapshot, rememberDockRuns } from "../core/threadObserver";
import { ExternalPanelFrame, ExternalWebSettings } from "../panels/external-web";
import { ComposerTaskPlan } from "../panels/session-glance";
import { PrototypePolicyCapsule } from "../prototype/PrototypePolicyCapsule";
import { PrototypeStudio } from "../prototype/PrototypeStudio";
import { ComposerAnchorPortal } from "./ComposerAnchorPortal";
import { DockTab, DockTabList } from "./DockTabs";
import { composerMetricKeys } from "./dockStore";
import { DockRuntime, dockPreferences, useDockCopy, useDockRuntime } from "./panelContext";
import { RightRailGeminiQuotaCard } from "./RightRailGeminiQuotaCard";
import { RightRailGlmQuotaSlot } from "./RightRailGlmQuotaSlot";
import { RightRailJarRunnerSlot } from "./RightRailJarRunnerSlot";
import { RightRailTaskPortal, useRightRailGeometry } from "./RightRailTaskSlot";
import { resolveDockPanels } from "./registry";
import type { CustomDockPanelDefinition, ExternalWebPanelConfig, RunSummary } from "./types";

const icons = {
  activity: Activity,
  globe: Globe,
  "list-todo": ListTodo,
  gauge: Gauge,
  prototype: PencilRuler,
};
const noRef = () => null;
const history = createRunHistory();
const EMPTY_PROVIDERS: readonly ServerProvider[] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];
const GLANCE = "session-glance";
const EXTERNAL = "external-web";
const PROTOTYPE = "prototype-studio";
const DRAWER = "t3-custom-dock-drawer";
const COMPOSER_STACK = '[data-chat-composer-stack="true"]';

function threadRoute(router: AppRouter) {
  let current: ScopedThreadRef | null = null;
  return {
    read() {
      const next = resolveThreadRouteRef(router.state.matches.at(-1)?.params ?? {});
      if (current?.threadId !== next?.threadId || current?.environmentId !== next?.environmentId)
        current = next;
      return current;
    },
    subscribe(notify: () => void) {
      return router.subscribe("onResolved", notify);
    },
  };
}

function renderExternal(config: ExternalWebPanelConfig) {
  return <ExternalPanelFrame config={config} />;
}

function panelTitle(panel: CustomDockPanelDefinition, copy: ReturnType<typeof useDockCopy>) {
  if (panel.id === GLANCE) return copy.glance;
  if (panel.id === EXTERNAL) return copy.external;
  return panel.id === PROTOTYPE ? copy.prototypes : panel.title;
}

function openDrawer(id?: string) {
  const dock = dockPreferences.getState();
  if (id !== undefined) dock.setActivePanelId(id);
  dock.setDrawerOpen(true);
}

function openGlance() {
  openDrawer(GLANCE);
}

function closeDrawer() {
  dockPreferences.getState().setDrawerOpen(false);
}

function DockShortcut() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the dock-only keyboard shortcut for the mounted host
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (
        event.code === "KeyG" &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const dock = dockPreferences.getState();
        dock.setDrawerOpen(!dock.drawerOpen);
      } else if (
        event.key === "Escape" &&
        event.target instanceof Element &&
        event.target.closest(`#${DRAWER}`) &&
        !event.target.closest("input,textarea,[contenteditable]")
      ) {
        closeDrawer();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  return null;
}

function ResizeHandle({ width }: { readonly width: number }) {
  const copy = useDockCopy();
  return (
    <div
      role="separator"
      aria-label={copy.resizeDock}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={280}
      aria-valuemax={560}
      tabIndex={0}
      className="absolute inset-y-0 -left-1 z-10 w-2 touch-none cursor-col-resize outline-none hover:bg-ring/30 focus-visible:bg-ring/45"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          dockPreferences.getState().setDrawerWidth(window.innerWidth - event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        dockPreferences.getState().setDrawerWidth(width + (event.key === "ArrowLeft" ? 16 : -16));
      }}
    />
  );
}

function DockPreferences({ scope }: { readonly scope: ScopedThreadRef | null }) {
  const copy = useDockCopy();
  const enabled = useStore(dockPreferences, (state) => state.composerBarEnabled);
  const visible = useStore(dockPreferences, (state) => state.visibleMetrics);
  return (
    <details className="border-b border-border px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">{copy.settings}</summary>
      <div className="mt-3 space-y-3 pb-1">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={enabled}
            onCheckedChange={(checked) => dockPreferences.getState().setComposerBarEnabled(checked)}
          />
          {copy.compactBar}
        </label>
        {scope && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => dockPreferences.getState().setThreadCollapsed(threadKey(scope), false)}
          >
            {copy.restoreBar}
          </Button>
        )}
        <fieldset className="flex flex-wrap gap-2.5">
          <legend className="mb-2 font-medium">{copy.metrics}</legend>
          {composerMetricKeys.map((metric) => (
            <label key={metric} className="flex items-center gap-1.5">
              <Checkbox
                checked={visible.includes(metric)}
                onCheckedChange={(checked) => {
                  const dock = dockPreferences.getState();
                  dock.setVisibleMetrics(
                    checked
                      ? [...dock.visibleMetrics, metric]
                      : dock.visibleMetrics.filter((key) => key !== metric),
                  );
                }}
              />
              {copy[metric]}
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  );
}

function drawerBottomInset(width: number) {
  const anchor = document.querySelector(COMPOSER_STACK);
  const bounds = anchor?.getBoundingClientRect();
  if (!bounds || bounds.width === 0 || bounds.right + 12 <= window.innerWidth - width) return 0;
  return Math.max(
    0,
    Math.min(window.innerHeight - 96, Math.ceil(window.innerHeight - bounds.top + 8)),
  );
}

function subscribeDrawerLayout(notify: () => void) {
  const anchor = document.querySelector(COMPOSER_STACK);
  const targets = [anchor, anchor?.parentElement].filter((node): node is Element => node != null);
  const stop = observeResize(targets, notify);
  window.addEventListener("resize", notify);
  return () => {
    stop();
    window.removeEventListener("resize", notify);
  };
}

function DockDrawer({
  scope,
  registry,
}: {
  readonly scope: ScopedThreadRef | null;
  readonly registry: readonly CustomDockPanelDefinition[];
}) {
  const copy = useDockCopy();
  const width = useStore(dockPreferences, (state) => state.drawerWidth);
  const bottom = useSyncExternalStore(
    subscribeDrawerLayout,
    () => (scope === null ? 0 : drawerBottomInset(width)),
    () => 0,
  );
  const selected = useStore(dockPreferences, (state) => state.activePanelId);
  const external = useStore(dockPreferences, (state) => state.externalPanels);
  const panels =
    external.length > 0 ? resolveDockPanels(external, renderExternal, registry) : registry;
  const active = panels.find((panel) => panel.id === selected) ?? panels[0];
  const runtime = useDockRuntime();
  return (
    <aside
      id={DRAWER}
      aria-label={copy.dock}
      className="fixed top-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-card text-card-foreground shadow-2xl wco:top-(--workspace-topbar-height)"
      style={{ width, bottom }}
    >
      <ResizeHandle width={width} />
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <PanelRight className="size-4 shrink-0 text-muted-foreground" />
          {copy.dock}
        </h2>
        <Button size="icon-xs" variant="ghost" aria-label={copy.closeDock} onClick={closeDrawer}>
          <X />
        </Button>
      </header>
      <DockPreferences scope={scope} />
      {active && (
        <Tabs.Root
          value={active.id}
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={(value) => {
            if (typeof value === "string") dockPreferences.getState().setActivePanelId(value);
          }}
        >
          <div className="shrink-0 px-3 pt-3">
            <DockTabList aria-label={copy.dock}>
              {panels.map((panel) => {
                const Icon = icons[panel.icon];
                return (
                  <DockTab key={panel.id} value={panel.id}>
                    <Icon className="size-3.5" />
                    {panelTitle(panel, copy)}
                  </DockTab>
                );
              })}
            </DockTabList>
          </div>
          <Tabs.Panel
            key={active.id}
            value={active.id}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
          >
            {runtime.snapshot ? (
              active.renderPanel(runtime.snapshot)
            ) : active.id !== EXTERNAL && !external.some((panel) => panel.id === active.id) ? (
              <p className="p-4 text-sm text-muted-foreground">
                {scope ? copy.loading : copy.noThread}
              </p>
            ) : active.id === EXTERNAL ? (
              <ExternalWebSettings />
            ) : (
              external
                .filter((panel) => panel.id === active.id)
                .map((config) => <ExternalPanelFrame key={config.id} config={config} />)
            )}
          </Tabs.Panel>
        </Tabs.Root>
      )}
    </aside>
  );
}

function Launcher({
  restore,
  onRestore,
}: {
  readonly restore?: boolean;
  readonly onRestore?: () => void;
}) {
  const copy = useDockCopy();
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-card px-1 py-0.5 shadow-md">
      <Button
        size="sm-pill"
        variant="ghost"
        aria-label={copy.openDock}
        aria-controls={DRAWER}
        onClick={() => openDrawer()}
      >
        <Activity />
        {copy.glance}
      </Button>
      {restore && (
        <Button size="xs" variant="ghost" onClick={onRestore}>
          {copy.restoreBar}
        </Button>
      )}
    </div>
  );
}

const FOOTER_ROW =
  "@container/dock-bar mx-3 flex min-w-0 items-center gap-1 border-t border-border/65 sm:mx-4";
const FOOTER_TRIGGER =
  "group/dock-footer flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-left text-xs text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-ring";

export function CompactBar({
  anchor,
  panel,
  open,
  close,
  tools,
  children,
}: {
  readonly anchor?: HTMLElement | undefined;
  readonly panel?: ReactNode;
  readonly open: () => void;
  readonly close?: (() => void) | undefined;
  /** Controls that sit after the bar's main trigger. */
  readonly tools?: ReactNode;
  readonly children: ReactNode;
}) {
  const copy = useDockCopy();
  return (
    <div data-custom-dock-compact-bar className={FOOTER_ROW}>
      {panel == null ? (
        <button type="button" className={FOOTER_TRIGGER} onClick={open} aria-label={copy.openDock}>
          {children}
        </button>
      ) : (
        <Popover.Root>
          <Popover.Trigger aria-label={copy.openTasks} className={FOOTER_TRIGGER}>
            {children}
            <ChevronUp
              aria-hidden="true"
              className="size-3 shrink-0 opacity-70 group-aria-expanded/dock-footer:rotate-180"
            />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              anchor={anchor}
              side="top"
              sideOffset={10}
              collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
              className="z-[130] w-(--anchor-width) max-w-[calc(100vw-1rem)]"
            >
              <Popover.Popup
                data-custom-dock-task-panel
                className="flex max-h-[min(var(--available-height),55dvh)] min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl outline-none"
              >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/65 px-4 py-2">
                  <Popover.Title className="min-w-0 truncate text-sm font-semibold">
                    {copy.tasks}
                  </Popover.Title>
                  <div className="flex shrink-0 items-center gap-1">
                    <Popover.Close
                      render={<Button variant="ghost" size="icon-xs" />}
                      aria-label={copy.openDock}
                      onClick={open}
                    >
                      <PanelRight aria-hidden="true" />
                    </Popover.Close>
                    <Popover.Close
                      render={<Button variant="secondary" size="xs" />}
                      aria-label={copy.closeTasks}
                    >
                      {copy.collapseTasks}
                    </Popover.Close>
                  </div>
                </header>
                <div className="min-h-0 overflow-y-auto overscroll-contain">{panel}</div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
      {tools}
      {close && (
        <span className="shrink-0 opacity-65 focus-within:opacity-100 hover:opacity-100">
          <Button variant="ghost-muted" size="icon-xs" aria-label={copy.hideBar} onClick={close}>
            <X aria-hidden="true" />
          </Button>
        </span>
      )}
    </div>
  );
}

function RightRailTaskCard({
  snapshot,
  open,
}: {
  readonly snapshot: NonNullable<ReturnType<typeof useDockRuntime>["snapshot"]>;
  readonly open: () => void;
}) {
  const copy = useDockCopy();
  const [minimized, setMinimized] = useState(false);
  const steps = snapshot.plans.steps;
  const done = steps.filter((step) => step.stage === "Done").length;
  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <ListTodo className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{copy.tasks}</span>
          {steps.length > 0 && (
            <span className="shrink-0 font-mono text-2xs font-normal text-muted-foreground tabular-nums">
              {done}/{steps.length}
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" aria-label={copy.openDock} onClick={open}>
            <PanelRight aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={minimized ? copy.openTasks : copy.closeTasks}
            aria-expanded={!minimized}
            onClick={() => setMinimized((value) => !value)}
          >
            {minimized ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </Button>
        </div>
      </header>
      {!minimized && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ComposerTaskPlan snapshot={snapshot} compact />
        </div>
      )}
    </>
  );
}

function RightRailGeminiQuotaSlot({
  scope,
  router,
}: {
  readonly scope: ScopedThreadRef;
  readonly router: AppRouter;
}) {
  const shell = useQuietThreadShell(scope);
  const providersByEnvironment = useEnvironmentProviders();
  const serverConfigs = useServerConfigs();
  const nowMinute = useNowMinute();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders);
  const [refreshing, setRefreshing] = useState(false);

  const draftProvider = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(scope);
    return draft?.modelSelectionExplicit === true ? (draft.activeProvider ?? null) : null;
  });
  const draftModel = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(scope);
    if (draft?.modelSelectionExplicit !== true || !draft.activeProvider) return null;
    return draft.modelSelectionByProvider[draft.activeProvider]?.model ?? null;
  });

  const providerInstanceId =
    draftProvider ?? shell?.providerInstanceId ?? shell?.modelSelection.instanceId ?? null;
  const model =
    (draftProvider !== null && draftProvider === providerInstanceId ? draftModel : null) ??
    (shell?.modelSelection.instanceId === providerInstanceId ? shell.modelSelection.model : null);

  const providers = providersByEnvironment.get(scope.environmentId) ?? EMPTY_PROVIDERS;
  const sources =
    serverConfigs.get(scope.environmentId)?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES;
  const now = Date.parse(`${nowMinute}:00Z`);
  const card = resolveGeminiQuotaCard({
    providerInstanceId,
    model,
    providers,
    sources,
    now,
  });
  if (!card) return null;

  return (
    <RightRailGeminiQuotaCard
      card={card}
      now={now}
      refreshing={refreshing}
      onRefresh={() => {
        if (refreshing) return;
        setRefreshing(true);
        void refreshProviders({
          environmentId: scope.environmentId,
          input: { instanceId: card.instanceId },
        }).finally(() => setRefreshing(false));
      }}
      onOpenUsage={() => {
        void router.navigate({ to: "/usage" });
      }}
    />
  );
}

function DockSurfaces({
  router,
  scope,
  composer,
  drawer,
  collapsed,
  registry,
}: {
  readonly router: AppRouter;
  readonly scope: ScopedThreadRef | null;
  readonly composer: boolean;
  readonly drawer: boolean;
  readonly collapsed: boolean;
  readonly registry: readonly CustomDockPanelDefinition[];
}) {
  const copy = useDockCopy();
  const { snapshot } = useDockRuntime();
  const taskSnapshot = snapshot?.plans.todoStatus === "provided" ? snapshot : null;
  const rightRail = useRightRailGeometry(scope !== null);
  const glance = registry.find((panel) => panel.id === GLANCE);
  function restore() {
    const dock = dockPreferences.getState();
    dock.setComposerBarEnabled(true);
    if (scope) dock.setThreadCollapsed(threadKey(scope), false);
  }
  return (
    <>
      <DockShortcut />
      {rightRail && scope && (
        <RightRailTaskPortal geometry={rightRail}>
          <RightRailGlmQuotaSlot scope={scope} />
          <RightRailGeminiQuotaSlot scope={scope} router={router} />
          <RightRailJarRunnerSlot key={threadKey(scope)} scope={scope} />
          {taskSnapshot && (
            <section
              data-custom-dock-right-tasks="inline"
              className="dropdown-glass pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/75 bg-card/95 text-card-foreground shadow-sm"
            >
              <RightRailTaskCard snapshot={taskSnapshot} open={openGlance} />
            </section>
          )}
        </RightRailTaskPortal>
      )}
      {scope && <PrototypeStudio key={threadKey(scope)} scope={scope} />}
      <ComposerAnchorPortal
        threadActive={scope !== null && composer}
        fallback={<Launcher restore={collapsed} onRestore={restore} />}
      >
        {(anchor) =>
          collapsed ? (
            <div className="flex justify-end border-t border-border/65 px-3 py-0.5">
              <Button size="xs" variant="ghost-muted" onClick={restore}>
                {copy.restoreBar}
              </Button>
            </div>
          ) : (
            <CompactBar
              anchor={anchor}
              open={openGlance}
              panel={
                rightRail === null && taskSnapshot ? (
                  <ComposerTaskPlan snapshot={taskSnapshot} />
                ) : null
              }
              close={
                scope
                  ? () => dockPreferences.getState().setThreadCollapsed(threadKey(scope), true)
                  : undefined
              }
              tools={scope ? <PrototypePolicyCapsule scope={scope} /> : undefined}
            >
              {snapshot ? (
                glance?.renderComposerBar?.(snapshot)
              ) : (
                <span className="py-1 text-xs text-muted-foreground">{copy.loading}</span>
              )}
            </CompactBar>
          )
        }
      </ComposerAnchorPortal>
      {(scope === null || !composer) && !drawer && (
        <div className="fixed right-4 bottom-4 z-40">
          <Launcher restore={scope !== null} onRestore={restore} />
        </div>
      )}
      {drawer && <DockDrawer scope={scope} registry={registry} />}
    </>
  );
}

function DockThread({
  scope,
  children,
}: {
  readonly scope: ScopedThreadRef;
  readonly children: ReactNode;
}) {
  const shell = useQuietThreadShell(scope);
  const project = useProject(shell ? scopeProjectRef(scope.environmentId, shell.projectId) : null);
  const [sampled, setSampled] = useState<{
    readonly snapshot: ReturnType<typeof deriveDockSnapshot>;
    readonly runOrdinal: number | null;
    readonly runStartedAtMs: number | null;
    readonly worktreePath: string | null;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples the quiet atom and the server clock on external updates, independently of the local history read
  useEffect(() => {
    let keep = true;
    let cached: readonly RunSummary[] = [];
    const atom = environmentThreadDetails.quietThreadAtom(scope);
    const update = (value: EnvironmentThreadStructure | null) => {
      const projection = value?.projection;
      if (!projection) {
        setSampled(null);
        return;
      }
      const snapshot = deriveDockSnapshot(
        projection,
        scope,
        toServerClock(scope.environmentId, Date.now()),
        cached,
      );
      const run = latestDockRun(projection);
      setSampled({
        snapshot,
        runOrdinal: run?.ordinal ?? null,
        runStartedAtMs:
          run && !isTerminalRun(run) ? timestampMs(run.workStartedAt ?? run.startedAt) : null,
        worktreePath: projection.thread.worktreePath,
      });
      rememberDockRuns(history, scope, projection.runs, snapshot.recentRuns);
    };
    const unsubscribe = appAtomRegistry.subscribe(atom, update, { immediate: true });
    void history
      .list(scope)
      .then((rows) => {
        if (!keep || rows.length === 0) return;
        cached = rows;
        update(appAtomRegistry.get(atom));
      })
      .catch(() => {});
    return () => {
      keep = false;
      unsubscribe();
    };
  }, [scope]);
  const readLiveTps = (nowMs: number) => {
    const runStartedAtMs = sampled?.runStartedAtMs ?? null;
    if (runStartedAtMs === null) return null;
    const live = appAtomRegistry.get(environmentThreadDetails.threadAtom(scope));
    return deriveLiveStreamTps({
      projection: live?.projection ?? null,
      runId: sampled?.snapshot.currentRun?.runId ?? null,
      runStartedAtMs,
      providerProgress: sampled?.snapshot.liveOutputProgress ?? null,
      serverNowMs: toServerClock(scope.environmentId, nowMs),
    });
  };
  return (
    <DockRuntime
      value={{
        snapshot: sampled?.snapshot ?? null,
        runOrdinal: sampled?.runOrdinal ?? null,
        runStartedAtMs: sampled?.runStartedAtMs ?? null,
        cwd: sampled?.worktreePath ?? project?.workspaceRoot,
        readLiveTps,
      }}
    >
      {children}
    </DockRuntime>
  );
}

function DockHostView({ router }: { readonly router: AppRouter }) {
  const [route] = useState(() => threadRoute(router));
  const [registry] = useState(() => resolveDockPanels([], renderExternal));
  const scope = useSyncExternalStore(route.subscribe, route.read, noRef);
  const drawer = useStore(dockPreferences, (state) => state.drawerOpen);
  const composer = useStore(dockPreferences, (state) => state.composerBarEnabled);
  const collapsed = useStore(dockPreferences, (state) =>
    scope ? state.collapsedByThreadKey[threadKey(scope)] === true : false,
  );
  const view = (
    <DockSurfaces
      router={router}
      scope={scope}
      drawer={drawer}
      composer={composer}
      collapsed={collapsed}
      registry={registry}
    />
  );
  if (scope && (drawer || (composer && !collapsed)))
    return (
      <DockThread key={threadKey(scope)} scope={scope}>
        {view}
      </DockThread>
    );
  return view;
}

export function CustomDockHost({ router }: { readonly router: AppRouter }) {
  const copy = useDockCopy();
  const [generation, setGeneration] = useState(0);
  return (
    <RenderErrorBoundary
      key={generation}
      fallback={
        <div className="fixed right-4 bottom-4 z-50">
          <Button
            size="sm-pill"
            variant="outline"
            onClick={() => {
              closeDrawer();
              setGeneration((value) => value + 1);
            }}
          >
            {copy.recover}
          </Button>
        </div>
      }
    >
      <DockHostView router={router} />
    </RenderErrorBoundary>
  );
}
