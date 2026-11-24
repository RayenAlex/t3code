import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2Run } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { CustomDockThreadSnapshot, RunHistory, RunSummary, ThreadMeta } from "../host/types";
import { derivePlanSnapshot } from "./plans";
import {
  deriveActivitySnapshot,
  deriveContextWindowMetrics,
  deriveRunTelemetry,
  deriveRecentRunsTelemetry,
} from "./telemetry";
import { isTerminalRun, latestDockRun, timestampMs } from "./runStructure";

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

function latestResponseTokens(projection: ThreadStructure, run: OrchestrationV2Run | null) {
  if (run === null || isTerminalRun(run) || run.activeAttemptId === null) return null;
  const attempt = projection.attempts.find(
    ({ id, runId }) => id === run.activeAttemptId && runId === run.id,
  );
  if (!attempt || attempt.status !== "running") return null;

  let latest = null;
  for (const turn of projection.providerTurns) {
    if (
      turn.runAttemptId !== attempt.id ||
      turn.providerThreadId !== attempt.providerThreadId ||
      turn.promptDropped ||
      turn.turnTokenUsage?.localCommand === true
    )
      continue;
    if (latest === null || turn.ordinal >= latest.ordinal) latest = turn;
  }
  if (latest === null || latest.status !== "running") return null;
  const report = latest.tokenUsage;
  if (report?.inputTokens === undefined || report.outputTokens === undefined) return null;
  const startedAt = timestampMs(latest.startedAt ?? run.workStartedAt ?? run.startedAt);
  const reportedAt = Date.parse(report.updatedAt);
  if (startedAt === null || !Number.isFinite(reportedAt) || reportedAt < startedAt) return null;
  return report.inputTokens + report.outputTokens;
}

export type LiveOutputProgress = {
  readonly outputTokens: number;
  readonly startedAtMs: number;
  readonly reportedAtMs: number;
};

function liveOutputProgress(
  projection: ThreadStructure,
  run: OrchestrationV2Run | null,
): LiveOutputProgress | null {
  if (run === null || isTerminalRun(run)) return null;
  const startedAtMs = timestampMs(run.workStartedAt ?? run.startedAt);
  if (startedAtMs === null) return null;
  const attemptIds = new Set(
    (projection.attempts ?? [])
      .filter((attempt) => attempt.runId === run.id)
      .map((attempt) => attempt.id),
  );
  let outputTokens = 0;
  let reportedAtMs = startedAtMs;
  for (const turn of projection.providerTurns ?? []) {
    if (
      turn.runAttemptId === null ||
      !attemptIds.has(turn.runAttemptId) ||
      turn.promptDropped === true ||
      turn.turnTokenUsage?.localCommand === true ||
      (turn.turnTokenUsage !== undefined && turn.turnTokenUsage.usageScope !== "main_agent")
    )
      continue;
    const settledOutput =
      turn.turnTokenUsage?.usageStatus !== "unavailable"
        ? turn.turnTokenUsage?.outputTokens
        : undefined;
    if (settledOutput !== undefined && settledOutput > 0) {
      outputTokens += settledOutput;
      const completedAt = timestampMs(turn.completedAt ?? turn.startedAt);
      if (completedAt !== null) reportedAtMs = Math.max(reportedAtMs, completedAt);
      continue;
    }
    const report = turn.tokenUsage;
    if (turn.status !== "running" || report?.outputTokens === undefined || report.outputTokens <= 0)
      continue;
    const turnStartedAt = timestampMs(turn.startedAt) ?? startedAtMs;
    const reportTime = Date.parse(report.updatedAt);
    if (!Number.isFinite(reportTime) || reportTime < turnStartedAt) continue;
    outputTokens += report.outputTokens;
    reportedAtMs = Math.max(reportedAtMs, reportTime);
  }
  return outputTokens > 0 ? { outputTokens, startedAtMs, reportedAtMs } : null;
}

export function deriveDockSnapshot(
  projection: ThreadStructure,
  scope: ThreadMeta,
  nowMs: number,
  cached: readonly RunSummary[],
) {
  const recentRuns = deriveRecentRunsTelemetry(projection, cached, nowMs);
  const run = latestDockRun(projection);
  return {
    threadMeta: scope,
    contextWindow: deriveContextWindowMetrics(projection),
    currentRun: run
      ? (recentRuns.find(({ runId }) => runId === run.id) ??
        deriveRunTelemetry(projection, run, nowMs))
      : null,
    latestResponseTokens: latestResponseTokens(projection, run),
    liveOutputProgress: liveOutputProgress(projection, run),
    recentRuns,
    plans: derivePlanSnapshot(projection),
    activity: deriveActivitySnapshot(projection, nowMs),
  } satisfies CustomDockThreadSnapshot & {
    latestResponseTokens: number | null;
    liveOutputProgress: LiveOutputProgress | null;
  };
}

export function rememberDockRuns(
  history: RunHistory,
  scope: ThreadMeta,
  runs: ThreadStructure["runs"],
  recentRuns: CustomDockThreadSnapshot["recentRuns"],
) {
  const finished = new Map(
    runs
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
}
