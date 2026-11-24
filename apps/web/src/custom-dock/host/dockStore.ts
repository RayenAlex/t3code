import { createStore } from "zustand/vanilla";

import { parseExternalPanelUrl } from "./externalUrl";
import type { ExternalWebPanelConfig } from "./types";

const metricKeys = ["context", "elapsed", "tokens", "cache", "output-rate"] as const;
type MetricKey = (typeof metricKeys)[number];

const KEY = ["t3", "custom-dock", "v1"].join(".");
const MIN_WIDTH = 280;
const MAX_WIDTH = 560;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function panelConfig(value: unknown): ExternalWebPanelConfig | null {
  const entry = record(value);
  if (
    !entry ||
    typeof entry.id !== "string" ||
    !entry.id.trim() ||
    typeof entry.title !== "string" ||
    !entry.title.trim() ||
    typeof entry.url !== "string"
  )
    return null;
  const url = parseExternalPanelUrl(entry.url);
  return url
    ? {
        id: entry.id,
        title: entry.title.trim(),
        url: url.href,
        sendReadonlySnapshot: entry.sendReadonlySnapshot === true,
      }
    : null;
}

function metrics(values: readonly unknown[]): MetricKey[] {
  return metricKeys.filter((key) => values.includes(key));
}

function width(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value))) : 360;
}

function readPreferences(storage: Storage | null) {
  let state: Record<string, unknown> | null = null;
  try {
    state = record(JSON.parse(storage?.getItem(KEY) ?? "null"));
  } catch {
    /* An older or blocked store can be ignored. */
  }
  const collapsed = Object.fromEntries(
    Object.entries(record(state?.collapsedByThreadKey) ?? {}).filter(
      (entry): entry is [string, true] => entry[1] === true,
    ),
  );
  const panels = Array.isArray(state?.externalPanels)
    ? state.externalPanels.flatMap((entry: unknown) => panelConfig(entry) ?? [])
    : [];
  return {
    drawerOpen: state?.drawerOpen === true,
    drawerWidth: typeof state?.drawerWidth === "number" ? width(state.drawerWidth) : 360,
    activePanelId: typeof state?.activePanelId === "string" ? state.activePanelId : null,
    composerBarEnabled: state?.composerBarEnabled !== false,
    collapsedByThreadKey: collapsed as Record<string, boolean>,
    visibleMetrics: Array.isArray(state?.visibleMetrics)
      ? metrics(state.visibleMetrics)
      : [...metricKeys],
    externalPanels: [...new Map(panels.map((panel) => [panel.id, panel])).values()],
  };
}

function availableStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

type Preferences = ReturnType<typeof readPreferences>;
interface DockState extends Preferences {
  setDrawerOpen(open: boolean): void;
  setDrawerWidth(width: number): void;
  setActivePanelId(id: string | null): void;
  setComposerBarEnabled(enabled: boolean): void;
  setThreadCollapsed(key: string, collapsed: boolean): void;
  setVisibleMetrics(values: readonly string[]): void;
  upsertExternalPanel(panel: ExternalWebPanelConfig): void;
  removeExternalPanel(id: string): void;
}

export function createDockStore(storage: Storage | null = availableStorage()) {
  const initial = readPreferences(storage);
  const store = createStore<DockState>()((set) => ({
    ...initial,
    setDrawerOpen: (drawerOpen: boolean) => set({ drawerOpen }),
    setDrawerWidth: (input) =>
      set((state) => {
        const drawerWidth = width(input);
        return drawerWidth === state.drawerWidth ? state : { drawerWidth };
      }),
    setActivePanelId: (activePanelId: string | null) => set({ activePanelId }),
    setComposerBarEnabled: (composerBarEnabled: boolean) => set({ composerBarEnabled }),
    setThreadCollapsed: (key: string, collapsed: boolean) =>
      set((state) => {
        const collapsedByThreadKey = { ...state.collapsedByThreadKey };
        if (collapsed)
          Object.defineProperty(collapsedByThreadKey, key, {
            value: true,
            enumerable: true,
            configurable: true,
          });
        else delete collapsedByThreadKey[key];
        return { collapsedByThreadKey };
      }),
    setVisibleMetrics: (values: readonly string[]) => set({ visibleMetrics: metrics(values) }),
    upsertExternalPanel: (input: ExternalWebPanelConfig) => {
      const panel = panelConfig(input);
      if (panel)
        set((state) => {
          const entries = new Map(state.externalPanels.map((entry) => [entry.id, entry]));
          entries.set(panel.id, panel);
          return { externalPanels: [...entries.values()] };
        });
    },
    removeExternalPanel: (id: string) =>
      set((state) => ({
        externalPanels: state.externalPanels.filter((entry) => entry.id !== id),
        activePanelId: state.activePanelId === id ? null : state.activePanelId,
      })),
  }));
  if (storage)
    store.subscribe((state) => {
      try {
        storage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* Storage quotas must not disable controls. */
      }
    });
  return store;
}
