import { Tabs } from "@base-ui/react/tabs";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Activity, Gauge, Globe, ListTodo, PanelRight, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStore } from "zustand";

import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import type { AppRouter } from "../../router";
import { useProject, useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { createRunHistory } from "../core/historyDb";
import { latestDockRun, isTerminalRun, timestampMs } from "../core/runStructure";
import { observeThread } from "../core/threadObserver";
import { ExternalPanelFrame, ExternalWebSettings } from "../panels/external-web";
import { ComposerAnchorPortal } from "./ComposerAnchorPortal";
import { DockTab, DockTabList } from "./DockTabs";
import {
  DockRuntime,
  dockPreferences,
  useDockCopy,
  useDockRuntime,
  type DockSnapshot,
} from "./panelContext";
import { resolveDockPanels } from "./registry";
import type { CustomDockPanelDefinition, ExternalWebPanelConfig } from "./types";

const icons = { activity: Activity, globe: Globe, "list-todo": ListTodo, gauge: Gauge };
const noRef = () => null;
const history = createRunHistory();
const metricOrder = ["context", "elapsed", "tokens", "cache", "output-rate"] as const;
const GLANCE = "session-glance";
const EXTERNAL = "external-web";
const DRAWER = "t3-custom-dock-drawer";

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
  return panel.id === GLANCE ? copy.glance : panel.id === EXTERNAL ? copy.external : panel.title;
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
          {metricOrder.map((metric) => (
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

function DockDrawer({
  scope,
  registry,
}: {
  readonly scope: ScopedThreadRef | null;
  readonly registry: readonly CustomDockPanelDefinition[];
}) {
  const copy = useDockCopy();
  const width = useStore(dockPreferences, (state) => state.drawerWidth);
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
      className="fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-card text-card-foreground shadow-2xl"
      style={{ width }}
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

function DockSurfaces({
  scope,
  composer,
  drawer,
  collapsed,
  registry,
}: {
  readonly scope: ScopedThreadRef | null;
  readonly composer: boolean;
  readonly drawer: boolean;
  readonly collapsed: boolean;
  readonly registry: readonly CustomDockPanelDefinition[];
}) {
  const copy = useDockCopy();
  const { snapshot } = useDockRuntime();
  const glance = registry.find((panel) => panel.id === GLANCE);
  function restore() {
    const dock = dockPreferences.getState();
    dock.setComposerBarEnabled(true);
    if (scope) dock.setThreadCollapsed(threadKey(scope), false);
  }
  return (
    <>
      <DockShortcut />
      <ComposerAnchorPortal
        threadActive={scope !== null && composer && !collapsed}
        fallback={<Launcher />}
      >
        <div
          data-custom-dock-compact-bar
          className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-xl border border-border bg-card px-1.5 py-0.5 shadow-sm"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-ring"
            onClick={openGlance}
            aria-label={copy.openDock}
          >
            {snapshot ? (
              glance?.renderComposerBar?.(snapshot)
            ) : (
              <span className="py-1 text-xs text-muted-foreground">{copy.loading}</span>
            )}
          </button>
          {scope && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={copy.hideBar}
              onClick={() => dockPreferences.getState().setThreadCollapsed(threadKey(scope), true)}
            >
              <X />
            </Button>
          )}
        </div>
      </ComposerAnchorPortal>
      {(scope === null || !composer || collapsed) && !drawer && (
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
  const source = useQuietThreadProjection(scope);
  const shell = useQuietThreadShell(scope);
  const projection = source?.projection ?? null;
  const project = useProject(shell ? scopeProjectRef(scope.environmentId, shell.projectId) : null);
  const [observed, setObserved] = useState<DockSnapshot | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hydrates scoped IndexedDB history when the quiet projection changes
  useEffect(() => {
    if (!projection) return;
    let keep = true;
    void observeThread(() => projection, history, scope, Date.now()).then((snapshot) => {
      if (keep) setObserved(snapshot);
    });
    return () => {
      keep = false;
    };
  }, [projection, scope]);
  const run = projection ? latestDockRun(projection) : null;
  const start = run && !isTerminalRun(run) ? timestampMs(run.workStartedAt ?? run.startedAt) : null;
  const driver = projection?.providerThreads.find(
    (row) => row.id === projection.thread.activeProviderThreadId,
  )?.driver;
  return (
    <DockRuntime
      value={{
        snapshot: projection ? observed : null,
        runStartedAtMs: observed?.currentRun?.runId === run?.id ? start : null,
        claude: driver === "claudeAgent" || shell?.providerInstanceId === "claudeAgent",
        cwd: projection?.thread.worktreePath ?? project?.workspaceRoot,
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
