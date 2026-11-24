import type { OrchestrationV2Run, OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import { timestampMs } from "./runStructure";
import type { LiveOutputProgress } from "./threadObserver";

export function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk / 1.5 + other / 4;
}

export function deriveLiveStreamTps(input: {
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly runId: OrchestrationV2Run["id"] | null;
  readonly runStartedAtMs: number | null;
  readonly providerProgress: LiveOutputProgress | null;
  readonly serverNowMs: number;
}): number | null {
  const { projection, runId, runStartedAtMs, providerProgress, serverNowMs } = input;
  if (runStartedAtMs === null) return null;

  let activeItemTokens = 0;
  let activeItemStartedAtMs: number | null = null;
  let totalStreamedTokens = 0;
  let earliestStreamStartedAtMs: number | null = null;

  if (projection !== null && runId !== null) {
    for (const item of projection.turnItems) {
      if (item.runId !== runId) continue;
      if (
        item.type !== "assistant_message" &&
        item.type !== "reasoning" &&
        item.type !== "proposed_plan"
      )
        continue;
      const text = item.type === "proposed_plan" ? item.markdown : item.text;
      if (text.length === 0) continue;
      const tokens = estimateTextTokens(text);
      totalStreamedTokens += tokens;
      const startedAt = timestampMs(item.startedAt);
      if (
        startedAt !== null &&
        (earliestStreamStartedAtMs === null || startedAt < earliestStreamStartedAtMs)
      ) {
        earliestStreamStartedAtMs = startedAt;
      }
      if (item.streaming || item.status === "running") {
        activeItemTokens = tokens;
        activeItemStartedAtMs = startedAt ?? runStartedAtMs;
      }
    }
  }

  if (activeItemTokens >= 2 && activeItemStartedAtMs !== null) {
    const elapsedMs = serverNowMs - activeItemStartedAtMs;
    if (elapsedMs >= 200) return (activeItemTokens * 1000) / elapsedMs;
  }

  if (providerProgress !== null && providerProgress.outputTokens > 0) {
    const elapsedMs = Math.max(
      providerProgress.reportedAtMs - providerProgress.startedAtMs,
      serverNowMs - providerProgress.startedAtMs,
    );
    if (elapsedMs >= 200) return (providerProgress.outputTokens * 1000) / elapsedMs;
  }

  if (totalStreamedTokens >= 2) {
    const origin = earliestStreamStartedAtMs ?? runStartedAtMs;
    const elapsedMs = serverNowMs - origin;
    if (elapsedMs >= 200) return (totalStreamedTokens * 1000) / elapsedMs;
  }

  return null;
}
