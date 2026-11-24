import { useLocale } from "gt-react";
import { createContext, use } from "react";

import en from "../copy/en.json";
import zh from "../copy/zh.json";
import type { deriveDockSnapshot } from "../core/threadObserver";
import { createDockStore } from "./dockStore";

export const dockPreferences = createDockStore();

export type DockSnapshot = ReturnType<typeof deriveDockSnapshot>;

type Runtime = {
  readonly snapshot: DockSnapshot | null;
  readonly runOrdinal: number | null;
  readonly runStartedAtMs: number | null;
  readonly claude: boolean;
  readonly cwd: string | undefined;
  readonly readLiveTps?: (nowMs: number) => number | null;
};

export const DockRuntime = createContext<Runtime>({
  snapshot: null,
  runOrdinal: null,
  runStartedAtMs: null,
  claude: false,
  cwd: undefined,
});

export function useDockRuntime(): Runtime {
  return use(DockRuntime);
}

export function useDockCopy(): typeof en {
  const locale = useLocale();
  return locale.split("-")[0] === "zh" ? zh : en;
}
