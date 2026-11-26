import type { OrchestrationV2Run, OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import {
  collectRunTimingIntervals,
  estimateTextTokens,
  intervalUnionMs,
  isModelOutputItem,
  subtractIntervals,
  timestampMs,
  type TimeInterval,
} from "./runStructure";
import type { LiveOutputProgress } from "./threadObserver";

export { estimateTextTokens };

export function deriveLiveStreamTps(input: {
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly runId: OrchestrationV2Run["id"] | null;
  readonly runStartedAtMs: number | null;
  readonly providerProgress: LiveOutputProgress | null;
  readonly serverNowMs: number;
}): number | null {
  const { projection, runId, runStartedAtMs, providerProgress, serverNowMs } = input;
  if (runStartedAtMs === null) return null;

  let activeItemRate: number | null = null;
  let measuredTokens = 0;
  const measuredIntervals: TimeInterval[] = [];

  if (projection !== null && runId !== null) {
    const run = projection.runs.find((candidate) => candidate.id === runId);
    const { blockingToolAndWait } = collectRunTimingIntervals({
      projection,
      runId,
      rootNodeId: run?.rootNodeId ?? null,
      windowStart: runStartedAtMs,
      windowEnd: serverNowMs,
    });

    for (const item of projection.turnItems) {
      if (item.runId !== runId || !isModelOutputItem(item)) continue;
      const text = item.type === "proposed_plan" ? item.markdown : item.text;
      if (text.length === 0) continue;
      const tokens = estimateTextTokens(text);
      const startedAt = timestampMs(item.startedAt);
      const completedAt = timestampMs(item.completedAt);
      const updatedAt = timestampMs(item.updatedAt);
      const active = item.streaming || item.status === "running";
      // Bound by server-stamped delta/completion time so tool runs or pauses never decay TPS.
      const itemEnd = active ? (updatedAt ?? completedAt) : (completedAt ?? updatedAt);
      if (startedAt === null || itemEnd === null || itemEnd <= startedAt) continue;

      const effectiveIntervals = subtractIntervals([[startedAt, itemEnd]], blockingToolAndWait);
      const durationMs = intervalUnionMs(effectiveIntervals);
      if (durationMs <= 0) continue;

      measuredTokens += tokens;
      measuredIntervals.push(...effectiveIntervals);
      if (active && tokens >= 2 && durationMs >= 200) {
        activeItemRate = (tokens * 1000) / durationMs;
      }
    }
  }

  if (activeItemRate !== null) {
    return activeItemRate;
  }

  if (measuredTokens >= 2) {
    const measuredMs = intervalUnionMs(measuredIntervals);
    if (measuredMs >= 200) return (measuredTokens * 1000) / measuredMs;
  }

  if (
    providerProgress !== null &&
    providerProgress.outputTokens > 0 &&
    providerProgress.activeMs >= 200
  ) {
    return (providerProgress.outputTokens * 1000) / providerProgress.activeMs;
  }

  return null;
}
