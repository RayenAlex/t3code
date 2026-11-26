import type { ThreadStructure, ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2Run, OrchestrationV2RuntimeRequest } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function timestampMs(
  value: DateTime.Utc | string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const ms =
    typeof value === "string"
      ? Date.parse(value)
      : typeof value === "number"
        ? value
        : DateTime.toEpochMillis(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isTerminalRun(run: OrchestrationV2Run): boolean {
  return (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "interrupted" ||
    run.status === "cancelled" ||
    run.status === "rolled_back"
  );
}

export function latestDockRun(projection: ThreadStructure): OrchestrationV2Run | null {
  let latest: OrchestrationV2Run | null = null;
  let active: OrchestrationV2Run | null = null;
  for (const run of projection.runs) {
    if (run.status === "rolled_back") continue;
    if (!latest || run.ordinal >= latest.ordinal) latest = run;
    if (
      !isTerminalRun(run) &&
      (run.status !== "queued" || run.startedAt !== null) &&
      (!active || run.ordinal >= active.ordinal)
    )
      active = run;
  }
  return active ?? latest;
}

export function isHumanRequest(request: OrchestrationV2RuntimeRequest): boolean {
  return request.kind !== "dynamic_tool_call" && request.kind !== "auth_refresh";
}

export function isToolItem(item: ThreadStructureTurnItem): boolean {
  return (
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "file_search" ||
    item.type === "web_search" ||
    item.type === "dynamic_tool"
  );
}

function isBlockingToolItem(item: ThreadStructureTurnItem): boolean {
  return (
    isToolItem(item) &&
    !item.toolNonExecutionKind &&
    !(item.type === "command_execution" && item.monitor === true)
  );
}

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

function estimateSerializedTokens(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return estimateTextTokens(value);
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function estimateToolCallInputTokens(item: ThreadStructureTurnItem): number {
  if (item.toolNonExecutionKind) return 0;
  // Tool call name + JSON envelope overhead.
  const envelope = 16;
  switch (item.type) {
    case "command_execution":
      return envelope + estimateTextTokens(item.input);
    case "file_change": {
      let total = envelope + estimateTextTokens(item.fileName);
      if (item.oldStr !== undefined || item.newStr !== undefined) {
        total += estimateTextTokens(item.oldStr ?? "") + estimateTextTokens(item.newStr ?? "");
      } else if (item.diffStr !== undefined) {
        total += estimateTextTokens(item.diffStr);
      }
      if (item.changes !== undefined && item.changes.length > 0) {
        total += estimateSerializedTokens(item.changes);
      }
      return total;
    }
    case "dynamic_tool":
      return (
        envelope + estimateTextTokens(item.toolName ?? "") + estimateSerializedTokens(item.input)
      );
    case "file_search":
      return envelope + estimateTextTokens(item.pattern ?? "");
    case "web_search":
      return (
        envelope +
        (item.patterns ?? []).reduce((sum, pattern) => sum + estimateTextTokens(pattern), 0)
      );
    case "todo_list":
      return (
        envelope + estimateSerializedTokens(item.steps) + estimateTextTokens(item.explanation ?? "")
      );
    case "user_input_request":
      return envelope + estimateSerializedTokens(item.questions);
    default:
      return 0;
  }
}

export function isModelOutputItem<T extends { readonly type: string }>(
  item: T,
): item is Extract<T, { readonly type: "assistant_message" | "reasoning" | "proposed_plan" }> {
  return (
    item.type === "assistant_message" || item.type === "reasoning" || item.type === "proposed_plan"
  );
}

export type TimeInterval = readonly [start: number, end: number];

export function mergeIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const valid = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .toSorted((a, b) => a[0] - b[0]);
  const merged: TimeInterval[] = [];
  for (const [start, end] of valid) {
    const previous = merged.at(-1);
    if (previous !== undefined && start <= previous[1]) {
      merged[merged.length - 1] = [previous[0], Math.max(previous[1], end)];
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function intervalUnionMs(intervals: readonly TimeInterval[]): number {
  let total = 0;
  for (const [start, end] of mergeIntervals(intervals)) {
    total += end - start;
  }
  return total;
}

export function subtractIntervals(
  base: readonly TimeInterval[],
  excluded: readonly TimeInterval[],
): TimeInterval[] {
  const mergedBase = mergeIntervals(base);
  const mergedExcluded = mergeIntervals(excluded);
  if (mergedBase.length === 0 || mergedExcluded.length === 0) return mergedBase;
  const result: TimeInterval[] = [];
  let j = 0;
  for (const [baseStart, baseEnd] of mergedBase) {
    let cursor = baseStart;
    while (j < mergedExcluded.length && mergedExcluded[j]![1] <= baseStart) {
      j += 1;
    }
    let k = j;
    while (k < mergedExcluded.length && mergedExcluded[k]![0] < baseEnd) {
      const [exStart, exEnd] = mergedExcluded[k]!;
      if (exStart > cursor) {
        result.push([cursor, Math.min(exStart, baseEnd)]);
      }
      cursor = Math.max(cursor, exEnd);
      if (cursor >= baseEnd) break;
      k += 1;
    }
    if (cursor < baseEnd) {
      result.push([cursor, baseEnd]);
    }
  }
  return result;
}

export function collectRunTimingIntervals(input: {
  readonly projection: Pick<
    ThreadStructure,
    "attempts" | "nodes" | "providerTurns" | "runtimeRequests" | "turnItems"
  >;
  readonly runId: OrchestrationV2Run["id"];
  readonly rootNodeId: OrchestrationV2Run["rootNodeId"];
  readonly windowStart: number;
  readonly windowEnd: number;
}): {
  readonly waits: TimeInterval[];
  readonly tools: TimeInterval[];
  readonly blockingToolAndWait: TimeInterval[];
  readonly blockingNonModel: TimeInterval[];
  readonly streaming: TimeInterval[];
  readonly effectiveNonModel: TimeInterval[];
} {
  const { projection, runId, rootNodeId, windowStart, windowEnd } = input;
  const waits: TimeInterval[] = [];
  const tools: TimeInterval[] = [];
  const blockingToolAndWait: TimeInterval[] = [];
  const blockingNonModel: TimeInterval[] = [];
  const streaming: TimeInterval[] = [];

  if (windowEnd <= windowStart) {
    return {
      waits,
      tools,
      blockingToolAndWait,
      blockingNonModel,
      streaming,
      effectiveNonModel: [],
    };
  }

  const attempts = (projection.attempts ?? []).filter((attempt) => attempt.runId === runId);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const turnIds = new Set(
    (projection.providerTurns ?? [])
      .filter((turn) => turn.runAttemptId !== null && attemptIds.has(turn.runAttemptId))
      .map((turn) => turn.id),
  );
  const nodeIds = new Set(attempts.map((attempt) => attempt.rootNodeId));
  if (rootNodeId != null) nodeIds.add(rootNodeId);
  for (const node of projection.nodes ?? []) if (node.runId === runId) nodeIds.add(node.id);

  function pushClipped(target: TimeInterval[], from: number | null, to: number | null) {
    if (from == null || to == null) return;
    const start = Math.max(from, windowStart);
    const finish = Math.min(to, windowEnd);
    if (finish > start) target.push([start, finish]);
  }

  for (const request of projection.runtimeRequests ?? []) {
    const owned =
      request.providerTurnId != null
        ? turnIds.has(request.providerTurnId)
        : nodeIds.has(request.nodeId);
    if (owned && isHumanRequest(request)) {
      const from = timestampMs(request.createdAt);
      const to =
        timestampMs(request.resolvedAt) ?? (request.status === "pending" ? windowEnd : null);
      pushClipped(waits, from, to);
      pushClipped(blockingToolAndWait, from, to);
      pushClipped(blockingNonModel, from, to);
    }
  }

  for (const item of projection.turnItems ?? []) {
    if (item.runId !== runId) continue;
    if (isToolItem(item) && !item.toolNonExecutionKind) {
      const from = timestampMs(item.startedAt);
      const to =
        timestampMs(item.completedAt) ??
        (item.status === "running" || item.status === "waiting" ? windowEnd : null);
      pushClipped(tools, from, to);
      if (isBlockingToolItem(item)) {
        pushClipped(blockingToolAndWait, from, to);
        pushClipped(blockingNonModel, from, to);
      }
      continue;
    }
    if (item.type === "subagent") {
      const from = timestampMs(item.startedAt);
      const to =
        timestampMs(item.completedAt) ??
        (item.status === "pending" || item.status === "running" || item.status === "waiting"
          ? windowEnd
          : null);
      pushClipped(blockingNonModel, from, to);
      continue;
    }
    if (isModelOutputItem(item)) {
      const from = timestampMs(item.startedAt);
      const updated = "updatedAt" in item ? timestampMs(item.updatedAt) : null;
      const active = item.streaming || item.status === "running";
      const to = active
        ? (updated ?? timestampMs(item.completedAt) ?? windowEnd)
        : (timestampMs(item.completedAt) ?? updated);
      pushClipped(streaming, from, to);
    }
  }

  // Keep any interval where the main model was actively streaming (e.g. alongside a background task).
  const effectiveNonModel = subtractIntervals(blockingNonModel, streaming);
  return { waits, tools, blockingToolAndWait, blockingNonModel, streaming, effectiveNonModel };
}
