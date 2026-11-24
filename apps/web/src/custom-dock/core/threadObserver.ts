import * as DateTime from "effect/DateTime";

import type {
  CustomDockThreadSnapshot,
  ReadThreadStructure,
  RunHistory,
  RunSummary,
  ThreadMeta,
} from "../host/types";
import { derivePlanSnapshot } from "./plans";
import {
  deriveActivitySnapshot,
  deriveContextWindowMetrics,
  deriveRunTelemetry,
  deriveRecentRunsTelemetry,
} from "./telemetry";
import { isTerminalRun, latestDockRun } from "./runStructure";

type PendingWrites = {
  queued: Map<string, RunSummary>;
  written: Map<string, string>;
  timer: ReturnType<typeof setTimeout> | null;
};
const writes = new WeakMap<RunHistory, Map<string, PendingWrites>>();

function queueSummaries(history: RunHistory, scope: ThreadMeta, summaries: readonly RunSummary[]) {
  let scopes = writes.get(history);
  if (!scopes) writes.set(history, (scopes = new Map()));
  const key = JSON.stringify([scope.environmentId, scope.threadId]);
  let state = scopes.get(key);
  if (!state) scopes.set(key, (state = { queued: new Map(), written: new Map(), timer: null }));
  for (const summary of summaries) {
    if (state.written.get(summary.runId) === JSON.stringify(summary))
      state.queued.delete(summary.runId);
    else state.queued.set(summary.runId, summary);
  }
  if (state.timer !== null || state.queued.size === 0) return;
  const pending = state;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    const batch = [...pending.queued.values()];
    pending.queued.clear();
    for (const summary of batch) {
      pending.written.set(summary.runId, JSON.stringify(summary));
      const oldest = pending.written.keys().next().value;
      if (pending.written.size > 50 && oldest !== undefined) pending.written.delete(oldest);
      void history.put(scope, summary).catch(() => pending.written.delete(summary.runId));
    }
  }, 250);
}

export async function observeThread(
  readThreadStructure: ReadThreadStructure,
  history: RunHistory,
  scope: ThreadMeta,
  nowMs: number,
) {
  const projection = readThreadStructure(scope);
  if (projection === null) return null;
  const cached = await history.list(scope).catch(() => []);
  const recentRuns = deriveRecentRunsTelemetry(projection, cached, nowMs);
  const finished = new Map(
    projection.runs
      .filter(
        (run) => isTerminalRun(run) && run.status !== "rolled_back" && run.completedAt !== null,
      )
      .map((run) => [run.id, run.completedAt]),
  );
  queueSummaries(
    history,
    scope,
    recentRuns.flatMap((telemetry) => {
      const completedAt = finished.get(telemetry.runId);
      return telemetry.status === "complete" && completedAt
        ? [
            {
              ...telemetry,
              status: "complete" as const,
              completedAt: DateTime.formatIso(completedAt),
            },
          ]
        : [];
    }),
  );
  const run = latestDockRun(projection);
  return {
    threadMeta: scope,
    contextWindow: deriveContextWindowMetrics(projection),
    currentRun: run
      ? (recentRuns.find(({ runId }) => runId === run.id) ??
        deriveRunTelemetry(projection, run, nowMs))
      : null,
    recentRuns,
    plans: derivePlanSnapshot(projection),
    activity: deriveActivitySnapshot(projection, nowMs),
  } satisfies CustomDockThreadSnapshot;
}
