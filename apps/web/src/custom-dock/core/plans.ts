import type { ThreadStructure, ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2RemoteTaskChild,
  OrchestrationV2Run,
  ScopedThreadRef,
} from "@t3tools/contracts";

import type { ActivitySnapshot, PlanSnapshot, PlanStep } from "../host/types";
import {
  intervalUnionMs,
  isHumanRequest,
  isTerminalRun,
  isToolItem,
  latestDockRun,
  mergeIntervals,
  subtractIntervals,
  timestampMs,
  type TimeInterval,
} from "./runStructure";

type PlanTodoScope = "current" | "none";

export type StepArchetype = "explore" | "implement" | "verify" | "general";

type RawTodoStep = {
  readonly id: string;
  readonly label: string;
  readonly stage: "Done" | "Now" | "Next";
  readonly durationMs: number | null;
  readonly durationAnchorAt: string | null;
  readonly explicitProgress: number | null;
};

type TimedStepRecord = {
  startedAtMs: number | null;
  startedAtOrdinal: number;
  completedAtOrdinal: number | null;
  durationMs: number | null;
  explicitProgress: number | null;
};

const UPDATE_STEPS_TOOL_NAMES = new Set(["update_steps", "run update_steps"]);

const LEADING_EXPLORE_STEP =
  /^(?:定位|查找|搜索|检索|读取|查看|浏览|清点|确认|检查状态|(?:locate|find|search|grep|read|inspect|scan|list|browse)\b)/iu;
const LIGHT_SYNC_STEP =
  /(?:文案|国际化|翻译|文档|注释|提交|推送|清理|\b(?:i18n|translations?|copy|docs|documentation|readme|changelog|commit|push|cleanup)\b)/iu;
const VERIFY_STEP =
  /(?:测试|验证|校验|联调|回归|编译|构建|验收|类型检查|\b(?:tests?|testing|checks?|checking|verify|verification|validate|validation|typecheck|lint|compile|build|prove|e2e)\b)/iu;
const IMPLEMENT_STEP =
  /(?:实现|开发|重构|编写|修改|改造|修复|集成|迁移|重写|新增|添加|补齐|优化|\b(?:implement|develop|refactor|rewrite|write|edit|modify|fix|patch|integrate|migrate|add|wire|optimize)\b)/iu;

const VERIFY_COMMAND =
  /^(?:(?:(?:npm|pnpm|bun|yarn|vp|npx)\s+(?:run\s+)?)?(?:test(?:\s|:|$)|check(?::\S+)?(?:\s|$)|typecheck(?:\s|:|$)|lint(?:\s|:|$)|build(?:\s|:|$)|vitest\b|jest\b|tsc\b|oxlint\b|eslint\b|pytest\b)|(?:go|cargo|dotnet|mvn|gradle)\s+(?:test|check|verify|compile|package)\b)/iu;
const READ_ONLY_COMMAND =
  /^(?:rg|grep|egrep|fgrep|fd|find|ls|tree|cat|head|tail|sed\s+-n|awk|wc|stat|file|which|pwd|echo|git\s+(?:status|diff|log|show|branch|rev-parse|ls-files))\b/iu;
const READ_ONLY_DYNAMIC_TOOL =
  /^(?:read|view|cat|grep|rg|glob|find|search|list|inspect|status|get_|list_|read_|t3_.*_(?:read|list|status|search)|preview_(?:status|snapshot))\b/iu;

const MIN_SINGLE_STEP_UNIT_MS = 5_000;
const MAX_SINGLE_STEP_UNIT_MS = 180_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function classifyTodoStep(label: string): {
  readonly archetype: StepArchetype;
  readonly weight: number;
} {
  const text = label.trim();
  if (LEADING_EXPLORE_STEP.test(text)) {
    return { archetype: "explore", weight: 0.7 };
  }
  const hasImplement = IMPLEMENT_STEP.test(text);
  const hasVerify = VERIFY_STEP.test(text);
  if (!hasImplement && !hasVerify && LIGHT_SYNC_STEP.test(text)) {
    return { archetype: "explore", weight: 0.75 };
  }
  if (hasImplement && hasVerify) {
    return { archetype: "implement", weight: 1.65 };
  }
  if (hasVerify) {
    return { archetype: "verify", weight: 1.2 };
  }
  if (hasImplement) {
    return { archetype: "implement", weight: 1.55 };
  }
  return { archetype: "general", weight: 1 };
}

function isUpdateStepsItem(item: ThreadStructureTurnItem): boolean {
  if (item.type !== "dynamic_tool" || item.toolNonExecutionKind) return false;
  const toolName = item.toolName?.trim().toLowerCase();
  const title = item.title?.trim().toLowerCase();
  return (
    (toolName !== undefined && UPDATE_STEPS_TOOL_NAMES.has(toolName)) ||
    (title !== undefined && UPDATE_STEPS_TOOL_NAMES.has(title))
  );
}

function parseExplicitProgress(raw: Record<string, unknown>): number | null {
  const candidate = raw.progress ?? raw.percent ?? raw.progressPercent;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
  return Math.min(100, Math.max(0, candidate));
}

function parseUpdateSteps(item: ThreadStructureTurnItem): readonly RawTodoStep[] | null {
  if (
    item.type !== "dynamic_tool" ||
    !isUpdateStepsItem(item) ||
    !isRecord(item.input) ||
    !Array.isArray(item.input.steps)
  ) {
    return null;
  }
  const steps: RawTodoStep[] = [];
  for (const [index, raw] of item.input.steps.entries()) {
    if (!isRecord(raw)) continue;
    const rawTitle =
      typeof raw.title === "string"
        ? raw.title.trim()
        : typeof raw.text === "string"
          ? raw.text.trim()
          : "";
    if (rawTitle.length === 0) continue;
    const rawStatus = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "pending";
    const stage =
      rawStatus === "done" || rawStatus === "completed" || rawStatus === "skipped"
        ? ("Done" as const)
        : rawStatus === "in_progress" || rawStatus === "running"
          ? ("Now" as const)
          : ("Next" as const);
    steps.push({
      id: `${item.id}#${index}`,
      label: rawTitle,
      stage,
      durationMs: null,
      durationAnchorAt: null,
      explicitProgress: parseExplicitProgress(raw),
    });
  }
  return steps.length > 0 ? steps : null;
}

function mapArtifactSteps(
  steps: Extract<OrchestrationV2PlanArtifact, { kind: "todo_list" }>["steps"],
): readonly RawTodoStep[] {
  return steps.map((step) => ({
    id: step.id,
    label: step.text,
    stage:
      step.status === "completed"
        ? ("Done" as const)
        : step.status === "running"
          ? ("Now" as const)
          : ("Next" as const),
    durationMs: step.durationMs ?? null,
    durationAnchorAt: step.durationAnchorAt ?? null,
    explicitProgress: null,
  }));
}

function splitShellSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;/u)
    .map((segment) =>
      segment
        .trim()
        .replace(/^cd\s+\S+\s*$/iu, "")
        .trim(),
    )
    .filter((segment) => segment.length > 0);
}

function classifyCommandRole(command: string): "verify" | "read" | "mutate" {
  const segments = splitShellSegments(command);
  if (segments.length === 0) return "read";
  if (segments.some((segment) => VERIFY_COMMAND.test(segment))) return "verify";
  const allReadOnly = segments.every((segment) => {
    const primary = segment.split("|")[0]?.trim() ?? segment;
    return READ_ONLY_COMMAND.test(primary);
  });
  return allReadOnly ? "read" : "mutate";
}

function isCompletedVerifySuccess(
  item: Extract<ThreadStructureTurnItem, { type: "command_execution" }>,
): boolean {
  return (
    item.status === "completed" &&
    item.outputIndicatesFailure !== true &&
    (item.exitCode == null || item.exitCode === 0)
  );
}

function isVerifyFailure(
  item: Extract<ThreadStructureTurnItem, { type: "command_execution" }>,
): boolean {
  return (
    item.status === "failed" ||
    item.outputIndicatesFailure === true ||
    (item.exitCode != null && item.exitCode !== 0)
  );
}

function deriveActiveStepProgress(input: {
  readonly archetype: StepArchetype;
  readonly items: readonly ThreadStructureTurnItem[];
  readonly explicitProgress?: number | null;
}): number {
  const { archetype, items, explicitProgress = null } = input;
  if (explicitProgress !== null) {
    return Math.min(99, Math.max(0, Math.round(explicitProgress)));
  }

  let subagentsTotal = 0;
  let subagentsDone = 0;
  let subagentsRunning = 0;
  let reasoningRunning = false;
  let reasoningDone = 0;
  let readsRunning = 0;
  let readsDone = 0;
  let editsRunning = 0;
  let editsDone = 0;
  let lastEditOrdinal = -Infinity;
  let verifyRunning = 0;
  let verifyPassedCount = 0;
  let lastVerifyOrdinal = -Infinity;
  let lastVerifyPassed = false;
  let lastVerifyFailed = false;
  let replyActive = false;
  let replyDone = false;

  for (const item of items) {
    if (
      item.type === "todo_list" ||
      item.type === "user_message" ||
      item.toolNonExecutionKind ||
      isUpdateStepsItem(item) ||
      (item.type === "command_execution" && item.monitor === true)
    ) {
      continue;
    }
    const isRunning =
      item.status === "pending" || item.status === "running" || item.status === "waiting";
    const isDone = item.status === "completed";

    switch (item.type) {
      case "subagent": {
        subagentsTotal += 1;
        if (isDone) subagentsDone += 1;
        else if (isRunning) subagentsRunning += 1;
        break;
      }
      case "reasoning": {
        if (item.streaming || item.status === "running") reasoningRunning = true;
        else if (isDone) reasoningDone += 1;
        break;
      }
      case "assistant_message": {
        if (item.streaming || item.status === "running") replyActive = true;
        else if (isDone) replyDone = true;
        break;
      }
      case "file_search":
      case "web_search": {
        if (isDone) readsDone += 1;
        else if (isRunning) readsRunning += 1;
        break;
      }
      case "file_change": {
        if (isDone) {
          editsDone += 1;
          lastEditOrdinal = Math.max(lastEditOrdinal, item.ordinal);
        } else if (isRunning) {
          editsRunning += 1;
          lastEditOrdinal = Math.max(lastEditOrdinal, item.ordinal);
        }
        break;
      }
      case "dynamic_tool": {
        const name = (item.toolName ?? item.title ?? "").trim();
        const isRead = READ_ONLY_DYNAMIC_TOOL.test(name);
        if (isRead) {
          if (isDone) readsDone += 1;
          else if (isRunning) readsRunning += 1;
        } else {
          if (isDone) {
            editsDone += 1;
            lastEditOrdinal = Math.max(lastEditOrdinal, item.ordinal);
          } else if (isRunning) {
            editsRunning += 1;
          }
        }
        break;
      }
      case "command_execution": {
        const role = classifyCommandRole(item.input);
        if (role === "verify") {
          if (isRunning) {
            verifyRunning += 1;
          } else if (isCompletedVerifySuccess(item)) {
            verifyPassedCount += 1;
            if (item.ordinal >= lastVerifyOrdinal) {
              lastVerifyOrdinal = item.ordinal;
              lastVerifyPassed = true;
              lastVerifyFailed = false;
            }
          } else if (isVerifyFailure(item) && item.ordinal >= lastVerifyOrdinal) {
            lastVerifyOrdinal = item.ordinal;
            lastVerifyPassed = false;
            lastVerifyFailed = true;
          }
        } else if (role === "read") {
          if (isDone) readsDone += 1;
          else if (isRunning) readsRunning += 1;
        } else {
          if (isDone) {
            editsDone += 1;
            lastEditOrdinal = Math.max(lastEditOrdinal, item.ordinal);
          } else if (isRunning) {
            editsRunning += 1;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const verifiedCurrentEdits = lastVerifyPassed && lastVerifyOrdinal > lastEditOrdinal;

  if (subagentsTotal > 0) {
    const completedShare = subagentsDone / subagentsTotal;
    const runningShare = (subagentsRunning / subagentsTotal) * 0.22;
    const postSynthesis =
      subagentsDone === subagentsTotal && (editsDone > 0 || verifiedCurrentEdits) ? 6 : 0;
    return Math.min(
      88,
      Math.max(12, Math.round(10 + (completedShare + runningShare) * 72 + postSynthesis)),
    );
  }

  if (archetype === "implement") {
    const readUnits =
      readsDone +
      readsRunning * 0.45 +
      Math.min(0.6, reasoningDone * 0.3 + (reasoningRunning ? 0.25 : 0));
    if (editsDone === 0 && editsRunning === 0 && verifyPassedCount === 0 && verifyRunning === 0) {
      if (readUnits <= 0) return replyActive || replyDone ? 8 : 0;
      return Math.min(32, Math.max(6, Math.round((32 * readUnits) / (readUnits + 1.6))));
    }
    if (lastVerifyFailed) {
      if (verifyRunning > 0) return 68;
      return lastEditOrdinal > lastVerifyOrdinal ? 56 : 44;
    }
    if (verifiedCurrentEdits) {
      return verifyPassedCount >= 2 ? 88 : 84;
    }
    if (verifyRunning > 0) {
      return 76;
    }
    const prepCredit = Math.min(24, (24 * readUnits) / (readUnits + 1.5));
    const editUnits = editsDone + editsRunning * 0.45;
    const editCredit = (50 * editUnits) / (editUnits + 1.15);
    return Math.min(74, Math.max(36, Math.round(Math.max(20, prepCredit) + editCredit)));
  }

  if (archetype === "verify") {
    if (lastVerifyFailed) {
      if (verifyRunning > 0) return 66;
      return lastEditOrdinal > lastVerifyOrdinal ? 52 : 35;
    }
    if (verifyPassedCount > 0) {
      if (verifyRunning > 0) return 80;
      return verifyPassedCount >= 2 ? 88 : 72;
    }
    if (verifyRunning > 0) {
      return 36;
    }
    const prepUnits =
      readsDone +
      editsDone +
      (readsRunning + editsRunning) * 0.45 +
      Math.min(0.5, reasoningDone * 0.25 + (reasoningRunning ? 0.2 : 0));
    if (prepUnits <= 0) return 0;
    return Math.min(24, Math.max(6, Math.round((24 * prepUnits) / (prepUnits + 1.4))));
  }

  if (lastVerifyFailed && verifyRunning === 0) {
    return lastEditOrdinal > lastVerifyOrdinal ? 54 : 42;
  }
  if (verifiedCurrentEdits) {
    return 84;
  }
  const units =
    readsDone +
    editsDone * 1.5 +
    verifyPassedCount * 1.6 +
    (readsRunning + editsRunning + verifyRunning) * 0.45 +
    Math.min(0.7, reasoningDone * 0.35 + (reasoningRunning ? 0.25 : 0)) +
    (replyActive || replyDone ? 0.25 : 0);
  if (units <= 0) return 0;
  return Math.min(80, Math.max(8, Math.round((82 * units) / (units + 2))));
}

function computePlanProgress(input: {
  readonly steps: readonly {
    readonly id: string;
    readonly stage: "Done" | "Now" | "Next";
    readonly progressPercent?: number;
    readonly weight?: number;
  }[];
}): {
  readonly overallPercent: number;
  readonly stepPercents: ReadonlyMap<string, number>;
} {
  const { steps } = input;
  const stepPercents = new Map<string, number>();
  if (steps.length === 0) return { overallPercent: 0, stepPercents };

  let totalWeight = 0;
  let completedWeight = 0;
  let doneCount = 0;

  for (const step of steps) {
    const weight = step.weight !== undefined && step.weight > 0 ? step.weight : 1;
    totalWeight += weight;
    if (step.stage === "Done") {
      doneCount += 1;
      stepPercents.set(step.id, 100);
      completedWeight += weight;
    } else if (step.stage === "Now") {
      const pct = Math.min(99, Math.max(0, Math.round(step.progressPercent ?? 0)));
      stepPercents.set(step.id, pct);
      completedWeight += weight * (pct / 100);
    } else {
      stepPercents.set(step.id, 0);
    }
  }

  const overallPercent =
    doneCount === steps.length
      ? 100
      : totalWeight <= 0
        ? 0
        : Math.min(99, Math.round((100 * completedWeight) / totalWeight));
  return { overallPercent, stepPercents };
}

export function estimatePlanTiming(input: {
  readonly steps: readonly {
    readonly id: string;
    readonly stage: "Done" | "Now" | "Next";
    readonly weight?: number;
    readonly progressPercent?: number;
    readonly durationMs: number | null;
    readonly durationAnchorAt: string | null;
    readonly activeElapsedMs?: number | null;
  }[];
  readonly runStartedAtMs: number | null;
  readonly nowMs: number | null;
  readonly paused?: boolean;
}): {
  readonly referenceEtaMs: number | null;
  readonly stepEstimatedMs: ReadonlyMap<string, number>;
  readonly stepRemainingMs: ReadonlyMap<string, number>;
} {
  const { steps, runStartedAtMs, nowMs, paused = false } = input;
  const stepEstimatedMs = new Map<string, number>();
  const stepRemainingMs = new Map<string, number>();
  if (steps.length === 0) {
    return { referenceEtaMs: null, stepEstimatedMs, stepRemainingMs };
  }
  if (steps.every((step) => step.stage === "Done")) {
    return { referenceEtaMs: 0, stepEstimatedMs, stepRemainingMs };
  }

  const doneUnits: number[] = [];
  let doneDurationSum = 0;
  let doneWeightSum = 0;
  for (const step of steps) {
    if (step.stage !== "Done" || step.durationMs == null || step.durationMs <= 0) continue;
    const weight = step.weight !== undefined && step.weight > 0 ? step.weight : 1;
    doneDurationSum += step.durationMs;
    doneWeightSum += weight;
    doneUnits.push(step.durationMs / weight);
  }

  let doneUnitMs: number | null = null;
  if (doneUnits.length >= 3 && doneWeightSum > 0) {
    const sorted = doneUnits.toSorted((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    doneUnitMs = 0.6 * (doneDurationSum / doneWeightSum) + 0.4 * median;
  } else if (doneUnits.length > 0 && doneWeightSum > 0) {
    doneUnitMs = doneDurationSum / doneWeightSum;
  }

  const activeDetails: Array<{
    readonly id: string;
    readonly weight: number;
    readonly elapsedMs: number;
    readonly progress: number;
  }> = [];
  let liveDurationSum = 0;
  let liveWeightSum = 0;

  for (const step of steps) {
    if (step.stage !== "Now") continue;
    const weight = step.weight !== undefined && step.weight > 0 ? step.weight : 1;
    const anchorMs = timestampMs(step.durationAnchorAt) ?? runStartedAtMs;
    const elapsedMs = paused
      ? Math.max(0, step.activeElapsedMs ?? 0)
      : nowMs !== null && anchorMs !== null
        ? Math.max(0, nowMs - anchorMs)
        : Math.max(0, step.activeElapsedMs ?? 0);
    const progress = Math.min(0.92, Math.max(0, (step.progressPercent ?? 0) / 100));
    activeDetails.push({ id: step.id, weight, elapsedMs, progress });

    const minLiveElapsedMs = doneUnitMs === null ? 4_000 : 3_000;
    if (progress >= 0.25 && elapsedMs >= minLiveElapsedMs) {
      liveDurationSum += elapsedMs;
      liveWeightSum += weight * progress;
    } else if (doneUnitMs !== null && elapsedMs > doneUnitMs * weight) {
      liveDurationSum += elapsedMs;
      liveWeightSum += weight * Math.max(progress, 0.6);
    }
  }

  const totalCalibratedWeight = doneWeightSum + liveWeightSum;
  if (doneUnitMs === null && liveWeightSum <= 0) {
    return { referenceEtaMs: null, stepEstimatedMs, stepRemainingMs };
  }

  const rawUnitPaceMs =
    ((doneUnitMs !== null ? doneUnitMs * doneWeightSum : 0) + liveDurationSum) /
    totalCalibratedWeight;
  const unitPaceMs =
    doneUnitMs === null
      ? Math.min(MAX_SINGLE_STEP_UNIT_MS, Math.max(MIN_SINGLE_STEP_UNIT_MS, rawUnitPaceMs))
      : rawUnitPaceMs;

  let maxActiveRemaining = 0;
  for (const active of activeDetails) {
    const baselineTotal = unitPaceMs * active.weight;
    let remaining: number;
    if (active.elapsedMs <= 0 && active.progress <= 0) {
      remaining = baselineTotal;
    } else if (active.progress <= 0) {
      remaining = Math.max(
        baselineTotal - active.elapsedMs,
        baselineTotal * 0.25,
        active.elapsedMs * 0.35,
      );
    } else {
      const byProgress = baselineTotal * (1 - active.progress);
      const byBudget = Math.max(0, baselineTotal - active.elapsedMs);
      const blended =
        byProgress < byBudget
          ? 0.7 * byProgress + 0.3 * byBudget
          : 0.45 * byProgress + 0.55 * byBudget;
      const tailFloor = Math.max(
        baselineTotal * (1 - active.progress) * 0.35,
        active.elapsedMs > baselineTotal ? active.elapsedMs * 0.25 : 0,
      );
      remaining = Math.max(blended, tailFloor);
    }
    const roundedRemaining =
      active.elapsedMs <= 0 && active.progress <= 0
        ? Math.round(remaining)
        : Math.max(1_000, Math.round(remaining));
    stepRemainingMs.set(active.id, roundedRemaining);
    stepEstimatedMs.set(active.id, Math.round(active.elapsedMs + roundedRemaining));
    maxActiveRemaining = Math.max(maxActiveRemaining, roundedRemaining);
  }

  let pendingRemaining = 0;
  for (const step of steps) {
    if (step.stage !== "Next") continue;
    const weight = step.weight !== undefined && step.weight > 0 ? step.weight : 1;
    const estimated = Math.max(1_000, Math.round(unitPaceMs * weight));
    stepEstimatedMs.set(step.id, estimated);
    stepRemainingMs.set(step.id, estimated);
    pendingRemaining += estimated;
  }

  return {
    referenceEtaMs: Math.round(maxActiveRemaining + pendingRemaining),
    stepEstimatedMs,
    stepRemainingMs,
  };
}

function collectHumanWaitIntervals(
  projection: ThreadStructure,
  run: OrchestrationV2Run,
  windowEndMs: number | null,
): { readonly intervals: TimeInterval[]; readonly hasPendingWait: boolean } {
  const attempts = (projection.attempts ?? []).filter((attempt) => attempt.runId === run.id);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const turnIds = new Set(
    (projection.providerTurns ?? [])
      .filter((turn) => turn.runAttemptId !== null && attemptIds.has(turn.runAttemptId))
      .map((turn) => turn.id),
  );
  const otherRunTurnIds = new Set(
    (projection.providerTurns ?? [])
      .filter((turn) => turn.runAttemptId !== null && !attemptIds.has(turn.runAttemptId))
      .map((turn) => turn.id),
  );
  const nodeIds = new Set(attempts.map((attempt) => attempt.rootNodeId));
  if (run.rootNodeId != null) nodeIds.add(run.rootNodeId);
  for (const node of projection.nodes ?? []) if (node.runId === run.id) nodeIds.add(node.id);

  const raw: TimeInterval[] = [];
  let hasPendingWait = false;
  for (const request of projection.runtimeRequests ?? []) {
    const owned =
      request.providerTurnId != null
        ? turnIds.has(request.providerTurnId) ||
          (!otherRunTurnIds.has(request.providerTurnId) && nodeIds.has(request.nodeId))
        : nodeIds.has(request.nodeId);
    if (!owned || !isHumanRequest(request)) continue;
    if (request.status === "pending") hasPendingWait = true;
    const from = timestampMs(request.createdAt);
    const to =
      timestampMs(request.resolvedAt) ?? (request.status === "pending" ? windowEndMs : null);
    if (from !== null && to !== null && to > from) {
      raw.push([from, to]);
    }
  }
  return { intervals: mergeIntervals(raw), hasPendingWait };
}

function activeDurationExcludingWaits(
  startMs: number,
  endMs: number,
  waits: readonly TimeInterval[],
): number {
  if (endMs <= startMs) return 0;
  return intervalUnionMs(subtractIntervals([[startMs, endMs]], waits));
}

function stepKeysForList(steps: readonly RawTodoStep[]): readonly string[] {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const base = step.label.trim().toLowerCase();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `${base}#${count}`;
  });
}

export type LiveActivityAction = {
  readonly kind:
    | "queued"
    | "starting"
    | "thinking"
    | "replying"
    | "command"
    | "file_change"
    | "search"
    | "tool"
    | "subagent"
    | "needs_you";
  readonly detail: string | null;
};

const MAX_ACTION_DETAIL = 48;

function compactDetail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const collapsed = value.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length <= MAX_ACTION_DETAIL) return collapsed;
  return `${collapsed.slice(0, MAX_ACTION_DETAIL - 1).trimEnd()}…`;
}

function fileBasename(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/u, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function liveToolAction(item: ThreadStructureTurnItem): LiveActivityAction | null {
  switch (item.type) {
    case "command_execution":
      return { kind: "command", detail: compactDetail(item.title ?? item.input) };
    case "file_change":
      return { kind: "file_change", detail: compactDetail(fileBasename(item.fileName)) };
    case "file_search":
      return { kind: "search", detail: compactDetail(item.title ?? item.pattern ?? null) };
    case "web_search":
      return { kind: "search", detail: compactDetail(item.title ?? item.patterns?.[0] ?? null) };
    case "dynamic_tool":
      return { kind: "tool", detail: compactDetail(item.title ?? item.toolName ?? null) };
    default:
      return null;
  }
}

export function derivePlanSnapshot(projection: ThreadStructure, nowMs: number | null = null) {
  const runs = new Map((projection.runs ?? []).map((run) => [run.id, run]));
  const currentRun = latestDockRun(projection);
  const liveRun = currentRun && !isTerminalRun(currentRun) ? currentRun : null;
  let latestArtifactTodo:
    | {
        readonly ordinal: number;
        readonly steps: readonly RawTodoStep[];
      }
    | undefined;
  let proposed: Extract<OrchestrationV2PlanArtifact, { kind: "proposed_plan" }> | undefined;
  const rank = (plan: OrchestrationV2PlanArtifact | undefined) =>
    plan?.runId == null ? -1 : (runs.get(plan.runId)?.ordinal ?? -1);
  let planSequence = 0;
  for (const plan of projection.plans ?? []) {
    if (
      plan.status === "superseded" ||
      (plan.runId != null && runs.get(plan.runId)?.status === "rolled_back")
    )
      continue;
    if (plan.kind === "todo_list" && liveRun !== null && plan.runId === liveRun.id) {
      const sequence = planSequence++;
      if (latestArtifactTodo === undefined || sequence >= latestArtifactTodo.ordinal) {
        latestArtifactTodo = {
          ordinal: sequence,
          steps: mapArtifactSteps(plan.steps),
        };
      }
    }
    if (plan.kind === "proposed_plan" && rank(plan) >= rank(proposed)) proposed = plan;
  }

  if (liveRun === null) {
    return {
      todoStatus: "not_provided",
      todoScope: "none",
      todoRunOrdinal: null,
      steps: [] as PlanStep[],
      overallPercent: 0,
      referenceEtaMs: null,
      proposedPlan: proposed
        ? { id: proposed.id, status: proposed.status, markdown: proposed.markdown }
        : null,
    } satisfies PlanSnapshot & {
      readonly todoScope: PlanTodoScope;
      readonly todoRunOrdinal: number | null;
    };
  }

  const runStartMs = timestampMs(liveRun.workStartedAt ?? liveRun.startedAt);
  const runItems = (projection.turnItems ?? [])
    .filter((item) => item.runId === liveRun.id)
    .toSorted((a, b) => a.ordinal - b.ordinal);
  const { intervals: humanWaits, hasPendingWait } = collectHumanWaitIntervals(
    projection,
    liveRun,
    nowMs,
  );

  type PlanUpdateEvent = {
    readonly ordinal: number;
    readonly atMs: number | null;
    readonly sourceRank: 0 | 1;
    readonly steps: readonly RawTodoStep[];
  };

  const todoTurnEvents: PlanUpdateEvent[] = [];
  const updateStepEvents: PlanUpdateEvent[] = [];
  for (const item of runItems) {
    if (item.type === "todo_list") {
      todoTurnEvents.push({
        ordinal: item.ordinal,
        atMs: timestampMs(
          item.completedAt ?? ("updatedAt" in item ? item.updatedAt : null) ?? item.startedAt,
        ),
        sourceRank: 1,
        steps: mapArtifactSteps(item.steps),
      });
      continue;
    }
    const parsed = parseUpdateSteps(item);
    if (parsed !== null) {
      updateStepEvents.push({
        ordinal: item.ordinal,
        atMs: timestampMs(
          item.completedAt ?? ("updatedAt" in item ? item.updatedAt : null) ?? item.startedAt,
        ),
        sourceRank: 0,
        steps: parsed,
      });
    }
  }

  const useNativeTodo = latestArtifactTodo !== undefined || todoTurnEvents.length > 0;
  const replayEvents: PlanUpdateEvent[] = useNativeTodo
    ? todoTurnEvents.length === 1 && latestArtifactTodo !== undefined
      ? [
          {
            ordinal: -Infinity,
            atMs: todoTurnEvents[0]!.atMs,
            sourceRank: 1,
            steps: latestArtifactTodo.steps,
          },
        ]
      : todoTurnEvents.length > 0
        ? todoTurnEvents
        : latestArtifactTodo
          ? [{ ordinal: -Infinity, atMs: null, sourceRank: 1, steps: latestArtifactTodo.steps }]
          : []
    : updateStepEvents;

  const timingByKey = new Map<string, TimedStepRecord>();
  let previousUpdateAtMs = runStartMs;
  let firstPlanOrdinal: number | null = null;

  for (const event of replayEvents) {
    if (firstPlanOrdinal === null && Number.isFinite(event.ordinal)) {
      firstPlanOrdinal = event.ordinal;
    }
    const keys = stepKeysForList(event.steps);
    let unanchoredNewlyDone = 0;
    for (const [index, step] of event.steps.entries()) {
      if (step.stage !== "Done") continue;
      const existing = timingByKey.get(keys[index]!);
      if (
        existing?.durationMs == null &&
        step.durationMs == null &&
        existing?.startedAtMs == null
      ) {
        unanchoredNewlyDone += 1;
      }
    }

    for (const [index, step] of event.steps.entries()) {
      const key = keys[index]!;
      let record = timingByKey.get(key);
      if (!record) {
        record = {
          startedAtMs: null,
          startedAtOrdinal: event.ordinal,
          completedAtOrdinal: null,
          durationMs: null,
          explicitProgress: null,
        };
        timingByKey.set(key, record);
      }
      if (step.explicitProgress !== null) {
        record.explicitProgress = step.explicitProgress;
      }
      if (step.stage === "Now") {
        const artifactAnchorMs = timestampMs(step.durationAnchorAt);
        if (record.startedAtMs === null) {
          record.startedAtMs = artifactAnchorMs ?? event.atMs;
          record.startedAtOrdinal =
            firstPlanOrdinal === event.ordinal && !event.steps.some((s) => s.stage === "Done")
              ? -Infinity
              : event.ordinal;
        } else if (artifactAnchorMs !== null && artifactAnchorMs < record.startedAtMs) {
          record.startedAtMs = artifactAnchorMs;
        }
      } else if (step.stage === "Done") {
        if (record.completedAtOrdinal === null && Number.isFinite(event.ordinal)) {
          record.completedAtOrdinal = event.ordinal;
        }
        if (record.durationMs === null) {
          if (step.durationMs != null && step.durationMs > 0) {
            record.durationMs = step.durationMs;
          } else if (
            record.startedAtMs !== null &&
            event.atMs !== null &&
            event.atMs >= record.startedAtMs
          ) {
            record.durationMs = activeDurationExcludingWaits(
              record.startedAtMs,
              event.atMs,
              humanWaits,
            );
          } else if (
            previousUpdateAtMs !== null &&
            event.atMs !== null &&
            event.atMs > previousUpdateAtMs
          ) {
            const spanMs = activeDurationExcludingWaits(previousUpdateAtMs, event.atMs, humanWaits);
            if (spanMs > 0) {
              record.durationMs = Math.round(spanMs / Math.max(1, unanchoredNewlyDone));
            }
          }
        }
      }
    }

    if (event.atMs !== null) {
      previousUpdateAtMs = event.atMs;
    }
  }

  const finalRawSteps = useNativeTodo
    ? (latestArtifactTodo?.steps ?? todoTurnEvents.at(-1)?.steps ?? [])
    : (updateStepEvents.at(-1)?.steps ?? []);

  if (finalRawSteps.length === 0) {
    return {
      todoStatus: "not_provided",
      todoScope: "none",
      todoRunOrdinal: null,
      steps: [] as PlanStep[],
      overallPercent: 0,
      referenceEtaMs: null,
      proposedPlan: proposed
        ? { id: proposed.id, status: proposed.status, markdown: proposed.markdown }
        : null,
    } satisfies PlanSnapshot & {
      readonly todoScope: PlanTodoScope;
      readonly todoRunOrdinal: number | null;
    };
  }

  const finalKeys = stepKeysForList(finalRawSteps);
  const nowStepIndices = finalRawSteps.flatMap((step, index) =>
    step.stage === "Now" ? [index] : [],
  );

  const interimSteps = finalRawSteps.map((step, index) => {
    const key = finalKeys[index]!;
    const record = timingByKey.get(key);
    const { archetype, weight } = classifyTodoStep(step.label);

    if (step.stage === "Done") {
      const durationMs = record?.durationMs ?? step.durationMs ?? null;
      return {
        id: step.id,
        label: step.label,
        stage: "Done" as const,
        durationMs,
        durationAnchorAt: null,
        activeElapsedMs: null,
        progressPercent: 100,
        weight,
      };
    }

    if (step.stage === "Now") {
      const rawAnchorMs = record?.startedAtMs ?? timestampMs(step.durationAnchorAt);
      const startedAtOrdinal = record?.startedAtOrdinal ?? -Infinity;
      const hasCompletedPriorStep = finalRawSteps.some((candidate) => candidate.stage === "Done");
      const singleTodoFloorOrdinal =
        hasCompletedPriorStep && todoTurnEvents.length === 1
          ? todoTurnEvents[0]!.ordinal
          : -Infinity;
      const stepItems = runItems.filter((item) => {
        if (Number.isFinite(startedAtOrdinal)) {
          return item.ordinal > startedAtOrdinal;
        }
        if (Number.isFinite(singleTodoFloorOrdinal) && item.ordinal <= singleTodoFloorOrdinal) {
          return false;
        }
        if (rawAnchorMs !== null && hasCompletedPriorStep && replayEvents.length <= 1) {
          const isFinished = item.status === "completed" || item.status === "failed";
          const itemAnchorMs = isFinished
            ? timestampMs(
                ("completedAt" in item ? item.completedAt : null) ??
                  ("updatedAt" in item ? item.updatedAt : null) ??
                  ("startedAt" in item ? item.startedAt : null),
              )
            : timestampMs("startedAt" in item ? item.startedAt : null);
          if (itemAnchorMs !== null && itemAnchorMs < rawAnchorMs) return false;
        }
        return true;
      });

      const scopedItems =
        nowStepIndices.length > 1
          ? (() => {
              const subagents = stepItems.filter((item) => item.type === "subagent");
              const slot = nowStepIndices.indexOf(index);
              const assigned = subagents[slot];
              return subagents.length >= nowStepIndices.length && assigned !== undefined
                ? [assigned]
                : stepItems;
            })()
          : stepItems;

      const progressPercent = deriveActiveStepProgress({
        archetype,
        items: scopedItems,
        explicitProgress: record?.explicitProgress ?? step.explicitProgress,
      });

      let activeElapsedMs: number | null = null;
      let durationAnchorAt =
        step.durationAnchorAt ??
        (rawAnchorMs === null ? null : new Date(rawAnchorMs).toISOString());

      if (rawAnchorMs !== null && nowMs !== null && nowMs >= rawAnchorMs) {
        activeElapsedMs = activeDurationExcludingWaits(rawAnchorMs, nowMs, humanWaits);
        const resolvedWaitMs = Math.max(0, nowMs - rawAnchorMs - activeElapsedMs);
        if (resolvedWaitMs > 0 && !hasPendingWait) {
          durationAnchorAt = new Date(rawAnchorMs + resolvedWaitMs).toISOString();
        }
      }

      return {
        id: step.id,
        label: step.label,
        stage: "Now" as const,
        durationMs: null,
        durationAnchorAt,
        activeElapsedMs,
        progressPercent,
        weight,
      };
    }

    return {
      id: step.id,
      label: step.label,
      stage: "Next" as const,
      durationMs: null,
      durationAnchorAt: null,
      activeElapsedMs: null,
      progressPercent: 0,
      weight,
    };
  });

  const { overallPercent } = computePlanProgress({ steps: interimSteps });
  const { referenceEtaMs, stepEstimatedMs } = estimatePlanTiming({
    steps: interimSteps,
    runStartedAtMs: runStartMs,
    nowMs,
    paused: hasPendingWait,
  });

  const steps: PlanStep[] = interimSteps.map((step) => ({
    ...step,
    estimatedDurationMs: stepEstimatedMs.get(step.id) ?? null,
  }));

  return {
    todoStatus: "provided",
    todoScope: "current",
    todoRunOrdinal: liveRun.ordinal,
    steps,
    overallPercent,
    referenceEtaMs,
    proposedPlan: proposed
      ? { id: proposed.id, status: proposed.status, markdown: proposed.markdown }
      : null,
  } satisfies PlanSnapshot & {
    readonly todoScope: PlanTodoScope;
    readonly todoRunOrdinal: number | null;
  };
}

type DockFile = { path: string; additions?: number; deletions?: number };

type DockSubagent = {
  id: string;
  name: string | null;
  childThreadId: ScopedThreadRef["threadId"] | null;
  remoteChild?: OrchestrationV2RemoteTaskChild;
};

export function deriveActivitySnapshot(projection: ThreadStructure, nowMs: number) {
  const run = latestDockRun(projection);
  const active =
    run !== null && !isTerminalRun(run) && (run.status !== "queued" || run.startedAt != null);
  const items = (projection.turnItems ?? []).filter(
    (item) => run !== null && item.runId === run.id,
  );
  const ordered = items.toSorted((a, b) => a.ordinal - b.ordinal);
  const activeTool = ordered.findLast(
    (item) => isToolItem(item) && (item.status === "running" || item.status === "waiting"),
  );
  const activeSubagent = ordered.findLast(
    (item): item is Extract<typeof item, { type: "subagent" }> =>
      item.type === "subagent" &&
      (item.status === "pending" || item.status === "running" || item.status === "waiting"),
  );
  const toolCount = ordered.filter((item) => isToolItem(item) && !item.toolNonExecutionKind).length;
  const pending = (projection.runtimeRequests ?? []).some(
    (request) => request.status === "pending" && isHumanRequest(request),
  );
  const workers = projection.subagents ?? [];
  const background =
    workers.some(
      (worker) =>
        worker.status === "pending" || worker.status === "running" || worker.status === "waiting",
    ) ||
    (projection.providerThreads ?? []).some(
      (thread) => (thread.pendingBackgroundTasks?.length ?? 0) > 0,
    );
  let lastUpdate =
    timestampMs(run?.workStartedAt) ??
    timestampMs(run?.startedAt) ??
    timestampMs(run?.requestedAt) ??
    nowMs;
  for (const item of items) {
    if ("updatedAt" in item)
      lastUpdate = Math.max(lastUpdate, timestampMs(item.updatedAt) ?? lastUpdate);
  }
  const phase = pending
    ? "needs_you"
    : !active && run?.status === "failed"
      ? "error"
      : active
        ? nowMs - lastUpdate > 180_000
          ? "stuck"
          : "working"
        : background
          ? "background"
          : run?.status === "completed"
            ? "done"
            : "idle";
  const liveAction: LiveActivityAction | null = pending
    ? { kind: "needs_you", detail: null }
    : !active
      ? run?.status === "queued"
        ? { kind: "queued", detail: null }
        : null
      : activeTool !== undefined
        ? liveToolAction(activeTool)
        : activeSubagent !== undefined
          ? { kind: "subagent", detail: compactDetail(activeSubagent.title) }
          : ordered.some(
                (item) =>
                  item.type === "assistant_message" &&
                  (item.streaming || item.status === "running"),
              )
            ? { kind: "replying", detail: null }
            : ordered.some(
                  (item) =>
                    item.type === "reasoning" && (item.streaming || item.status === "running"),
                )
              ? { kind: "thinking", detail: null }
              : run?.status === "preparing" || run?.status === "starting"
                ? { kind: "starting", detail: null }
                : { kind: "thinking", detail: null };
  const files = new Map<string, DockFile>();
  let lastChange = -Infinity;
  for (const item of ordered) {
    if (item.type !== "file_change" || item.toolNonExecutionKind) continue;
    const { fileName, additions, deletions } = item;
    files.set(fileName, {
      path: fileName,
      ...(additions === undefined ? {} : { additions }),
      ...(deletions === undefined ? {} : { deletions }),
    });
    lastChange = item.ordinal;
  }
  if (run)
    for (const checkpoint of projection.checkpoints ?? []) {
      if (checkpoint.runId !== run.id || checkpoint.status !== "ready") continue;
      for (const { path, additions, deletions } of checkpoint.files)
        files.set(path, { path, additions, deletions });
    }
  const verificationCommand =
    lastChange === -Infinity
      ? undefined
      : ordered.findLast(
          (item): item is Extract<typeof item, { type: "command_execution" }> =>
            item.type === "command_execution" &&
            !item.toolNonExecutionKind &&
            item.ordinal > lastChange &&
            classifyCommandRole(item.input) === "verify",
        );
  const verification =
    files.size === 0
      ? "unknown"
      : !verificationCommand
        ? "unchecked"
        : isVerifyFailure(verificationCommand)
          ? "failed"
          : isCompletedVerifySuccess(verificationCommand)
            ? "passed"
            : "unknown";
  const subagents = new Map<string, DockSubagent>();
  for (const item of items)
    if (item.type === "subagent") {
      subagents.set(item.subagentId, {
        id: item.subagentId,
        name: item.title,
        childThreadId: item.childThreadId,
        ...(item.remoteChild ? { remoteChild: item.remoteChild } : {}),
      });
    }
  for (const worker of workers)
    if (run != null && worker.runId === run.id) {
      subagents.set(worker.id, {
        id: worker.id,
        name: worker.title,
        childThreadId: worker.childThreadId,
        ...(worker.remoteChild ? { remoteChild: worker.remoteChild } : {}),
      });
    }
  const snapshot = {
    phase,
    changedPaths: [...files.keys()],
    files: [...files.values()],
    subagents: [...subagents.values()],
    childLinks: [...subagents.values()].flatMap((worker) =>
      worker.remoteChild ? [worker.remoteChild] : [],
    ),
    verification,
    activeTool: activeTool?.title ?? null,
    liveAction,
    toolCount,
  } satisfies ActivitySnapshot & {
    files: readonly DockFile[];
    activeTool: string | null;
    liveAction: LiveActivityAction | null;
    toolCount: number;
  };
  return snapshot;
}
