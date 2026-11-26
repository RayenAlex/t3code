import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "@t3tools/client-runtime/state/context-window";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2Run, TurnTokenUsage } from "@t3tools/contracts";

import type { ContextWindowMetrics, RunSummary, RunTelemetry } from "../host/types";
import {
  collectRunTimingIntervals,
  estimateToolCallInputTokens,
  intervalUnionMs,
  isTerminalRun,
  subtractIntervals,
  timestampMs,
} from "./runStructure";

export { deriveActivitySnapshot } from "./plans";

export function deriveContextWindowMetrics(
  projection: ThreadStructure,
): ContextWindowMetrics | null {
  const activeId = projection.thread.activeProviderThreadId;
  const provider = projection.providerThreads.find(({ id }) => id === activeId);
  const turns =
    activeId === null
      ? projection.providerTurns
      : projection.providerTurns.filter((turn) => turn.providerThreadId === activeId);
  const usage = latestProviderTurnTokenUsage(turns, projection, provider);
  const compactions = projection.turnItems.filter(
    (item) =>
      item.type === "compaction" &&
      item.status === "completed" &&
      (activeId === null || item.providerThreadId == null || item.providerThreadId === activeId),
  );
  const snapshot = deriveLatestContextWindowSnapshot(
    compactions.map((item) => ({ item })),
    usage,
    provider,
  );
  if (!snapshot) return null;
  const maxTokens = snapshot.maxTokens && snapshot.maxTokens > 0 ? snapshot.maxTokens : null;
  return {
    usedTokens: snapshot.usedTokens,
    maxTokens,
    usedPercentage: maxTokens === null ? null : snapshot.usedPercentage,
    remainingTokens: maxTokens === null ? null : snapshot.remainingTokens,
    autoCompactThreshold: maxTokens === null ? null : (snapshot.autoCompactThreshold ?? null),
  };
}

function sumReported(values: readonly (number | undefined)[], requireAll = false): number | null {
  let total: number | null = null;
  for (const value of values) {
    if (value === undefined) {
      if (requireAll) return null;
    } else {
      total = (total ?? 0) + value;
    }
  }
  return total;
}

function ledger(rows: readonly TurnTokenUsage[]) {
  const inputTokens = sumReported(rows.map((row) => row.inputTokens));
  const cachedInputTokens = sumReported(rows.map((row) => row.cachedInputTokens));
  const cacheWriteInputTokens = sumReported(rows.map((row) => row.cacheCreationTokens));
  const outputTokens = sumReported(rows.map((row) => row.outputTokens));
  const reasoningOutputTokens = sumReported(rows.map((row) => row.reasoningTokens));
  const uncachedInputTokens = sumReported(
    rows.map((row) =>
      row.inputTokens === undefined ||
      row.cachedInputTokens === undefined ||
      row.cacheCreationTokens === undefined
        ? undefined
        : Math.max(0, row.inputTokens - row.cachedInputTokens - row.cacheCreationTokens),
    ),
    true,
  );
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
    uncachedInputTokens,
  };
}

export function deriveRunTelemetry(
  projection: ThreadStructure,
  run: OrchestrationV2Run,
  nowMs: number,
) {
  const terminal = isTerminalRun(run);
  const started = timestampMs(run.startedAt);
  const requested = timestampMs(run.requestedAt);
  const workStart = timestampMs(run.workStartedAt) ?? started;
  const completed = timestampMs(run.completedAt);
  const end = terminal ? completed : nowMs;
  const elapsedMs = workStart == null || end == null ? 0 : Math.max(0, end - workStart);
  const queueMs = started == null || requested == null ? null : Math.max(0, started - requested);
  const attempts = (projection.attempts ?? []).filter((attempt) => attempt.runId === run.id);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const turns = (projection.providerTurns ?? []).filter(
    (turn) => turn.runAttemptId !== null && attemptIds.has(turn.runAttemptId),
  );
  const { waits, tools, blockingToolAndWait, streaming, effectiveNonModel } =
    workStart != null && end != null && elapsedMs > 0
      ? collectRunTimingIntervals({
          projection,
          runId: run.id,
          rootNodeId: run.rootNodeId,
          windowStart: workStart,
          windowEnd: end,
        })
      : { waits: [], tools: [], blockingToolAndWait: [], streaming: [], effectiveNonModel: [] };
  const waitingUserMs = intervalUnionMs(waits);
  const toolMs = intervalUnionMs(tools);
  const activeWorkMs = Math.max(0, elapsedMs - intervalUnionMs(effectiveNonModel));
  const streamingMs = intervalUnionMs(subtractIntervals(streaming, blockingToolAndWait));
  let estimatedToolInputTokens = 0;
  for (const item of projection.turnItems ?? []) {
    if (item.runId === run.id) estimatedToolInputTokens += estimateToolCallInputTokens(item);
  }
  const delivered = turns.filter(
    (turn) =>
      turn.promptDropped !== true &&
      (turn.turnTokenUsage === undefined || turn.turnTokenUsage.usageScope === "main_agent"),
  );
  const modelTurns = delivered.filter((turn) => turn.turnTokenUsage?.localCommand !== true);
  const rows = modelTurns.flatMap((turn) => {
    const usage = turn.turnTokenUsage;
    return usage && usage.usageStatus !== "unavailable" ? [usage] : [];
  });
  const isLocalCommandOnly = delivered.length > 0 && modelTurns.length === 0;
  const localCommand = delivered.length !== modelTurns.length;
  const hasSettlement = rows.length > 0;
  const tokenUsage = hasSettlement ? ledger(rows) : null;
  const otherUsage = rows.flatMap((row) => (row.otherUsage ? [row.otherUsage] : []));
  const status = isLocalCommandOnly
    ? "complete"
    : !hasSettlement
      ? terminal
        ? "unavailable"
        : "pending"
      : rows.length === modelTurns.length && rows.every((row) => row.usageStatus === "complete")
        ? "complete"
        : "partial";
  const input = sumReported(
    rows.map((row) => row.inputTokens),
    true,
  );
  const cache = sumReported(
    rows.map((row) => row.cachedInputTokens),
    true,
  );
  const cacheHitRate = input != null && input > 0 && cache != null ? cache / input : null;
  const output = sumReported(
    rows.map((row) => row.outputTokens),
    true,
  );
  const rate = (ms: number, tokens = output) =>
    tokens != null && tokens > 0 && ms >= 200 ? (tokens * 1000) / ms : null;
  const activeWorkTps = rate(activeWorkMs);
  // Exclude TTFT/prefill wait when the run has measured model streaming spans; subtract tool-argument tokens generated outside those spans.
  const streamTokens = output == null ? null : Math.max(0, output - estimatedToolInputTokens);
  const streamDecodeTps =
    streamingMs >= 200 && streamTokens != null && streamTokens >= 2
      ? rate(streamingMs, streamTokens)
      : null;
  const activeOutputTps =
    streamDecodeTps !== null
      ? activeWorkTps !== null
        ? Math.max(streamDecodeTps, activeWorkTps)
        : streamDecodeTps
      : activeWorkTps;
  const telemetry = {
    runId: run.id,
    status,
    elapsedMs,
    queueMs,
    waitingUserMs,
    toolMs,
    activeWorkMs,
    tokenUsage,
    otherUsage,
    localCommand,
    isLocalCommandOnly,
    cacheHitRate,
    turnAvgOutputTps: rate(elapsedMs),
    activeOutputTps,
  } satisfies RunTelemetry & { localCommand: boolean };
  return telemetry;
}

export function deriveRecentRunsTelemetry(
  projection: ThreadStructure,
  cachedHistory: readonly RunSummary[],
  nowMs: number,
): readonly RunTelemetry[] {
  const rows = new Map<
    RunTelemetry["runId"],
    { time: number; telemetry: RunTelemetry | OrchestrationV2Run }
  >(
    cachedHistory.map((summary) => [
      summary.runId,
      { time: timestampMs(summary.completedAt) ?? 0, telemetry: summary },
    ]),
  );
  for (const run of projection.runs) {
    if (run.status === "rolled_back") rows.delete(run.id);
    else
      rows.set(run.id, {
        time: timestampMs(run.completedAt) ?? timestampMs(run.requestedAt) ?? 0,
        telemetry: run,
      });
  }
  return [...rows.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-12)
    .map(({ telemetry }) =>
      "runId" in telemetry ? telemetry : deriveRunTelemetry(projection, telemetry, nowMs),
    );
}
