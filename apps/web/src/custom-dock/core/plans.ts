import type { ThreadStructure, ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2RemoteTaskChild,
  ScopedThreadRef,
} from "@t3tools/contracts";

import type { ActivitySnapshot, PlanSnapshot } from "../host/types";
import {
  isHumanRequest,
  isTerminalRun,
  isToolItem,
  latestDockRun,
  timestampMs,
} from "./runStructure";

type PlanTodoScope = "current" | "carried" | "none";

type ParsedTodoStep = {
  readonly id: string;
  readonly label: string;
  readonly stage: "Done" | "Now" | "Next";
  readonly durationMs: number | null;
  readonly durationAnchorAt: string | null;
};

type TodoCandidate = {
  readonly runId: OrchestrationV2PlanArtifact["runId"];
  readonly runOrdinal: number;
  readonly ordinal: number;
  readonly sourceRank: 0 | 1;
  readonly steps: readonly ParsedTodoStep[];
};

const UPDATE_STEPS_TOOL_NAMES = new Set(["update_steps", "run update_steps"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUpdateStepsItem(
  item: ThreadStructureTurnItem,
): item is Extract<ThreadStructureTurnItem, { type: "dynamic_tool" }> {
  if (item.type !== "dynamic_tool" || item.toolNonExecutionKind) return false;
  const toolName = item.toolName?.trim().toLowerCase();
  const title = item.title?.trim().toLowerCase();
  return (
    (toolName !== undefined && UPDATE_STEPS_TOOL_NAMES.has(toolName)) ||
    (title !== undefined && UPDATE_STEPS_TOOL_NAMES.has(title))
  );
}

function parseUpdateSteps(item: ThreadStructureTurnItem): readonly ParsedTodoStep[] | null {
  if (!isUpdateStepsItem(item) || !isRecord(item.input) || !Array.isArray(item.input.steps)) {
    return null;
  }
  const steps: ParsedTodoStep[] = [];
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
    });
  }
  return steps.length > 0 ? steps : null;
}

function compareCandidates(next: TodoCandidate, current: TodoCandidate | undefined): boolean {
  if (current === undefined) return true;
  if (next.runOrdinal !== current.runOrdinal) return next.runOrdinal > current.runOrdinal;
  if (next.sourceRank !== current.sourceRank) return next.sourceRank > current.sourceRank;
  return next.ordinal >= current.ordinal;
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

export function derivePlanSnapshot(projection: ThreadStructure) {
  const runs = new Map((projection.runs ?? []).map((run) => [run.id, run]));
  const currentRun = latestDockRun(projection);
  let currentRunTodo: TodoCandidate | undefined;
  let latestTodo: TodoCandidate | undefined;
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
    if (plan.kind === "todo_list") {
      const candidate: TodoCandidate = {
        runId: plan.runId,
        runOrdinal: rank(plan),
        ordinal: planSequence++,
        sourceRank: 1,
        steps: plan.steps.map((step) => ({
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
        })),
      };
      if (
        currentRun !== null &&
        plan.runId === currentRun.id &&
        compareCandidates(candidate, currentRunTodo)
      ) {
        currentRunTodo = candidate;
      }
      if (compareCandidates(candidate, latestTodo)) latestTodo = candidate;
    }
    if (plan.kind === "proposed_plan" && rank(plan) >= rank(proposed)) proposed = plan;
  }

  for (const item of projection.turnItems ?? []) {
    if (item.runId != null && runs.get(item.runId)?.status === "rolled_back") continue;
    const parsedSteps = parseUpdateSteps(item);
    if (parsedSteps === null) continue;
    const candidate: TodoCandidate = {
      runId: item.runId,
      runOrdinal: item.runId == null ? -1 : (runs.get(item.runId)?.ordinal ?? -1),
      ordinal: item.ordinal,
      sourceRank: 0,
      steps: parsedSteps,
    };
    if (
      currentRun !== null &&
      item.runId === currentRun.id &&
      compareCandidates(candidate, currentRunTodo)
    ) {
      currentRunTodo = candidate;
    }
    if (compareCandidates(candidate, latestTodo)) latestTodo = candidate;
  }

  let todo: TodoCandidate | undefined;
  let todoScope: PlanTodoScope = "none";
  let todoRunOrdinal: number | null = null;
  if (currentRunTodo !== undefined) {
    todo = currentRunTodo;
    todoScope = "current";
    todoRunOrdinal = currentRun?.ordinal ?? null;
  } else if (currentRun === null && latestTodo !== undefined) {
    todo = latestTodo;
    todoScope = "current";
    todoRunOrdinal = latestTodo.runOrdinal >= 0 ? latestTodo.runOrdinal : null;
  } else if (latestTodo !== undefined && latestTodo.steps.some((step) => step.stage !== "Done")) {
    // Carry unfinished multi-turn plans across follow-up runs until the agent replaces them.
    todo = latestTodo;
    todoScope = "carried";
    todoRunOrdinal = latestTodo.runOrdinal >= 0 ? latestTodo.runOrdinal : null;
  }

  const steps = todo?.steps ?? [];
  const completed = steps.filter((step) => step.stage === "Done");
  const measured = completed.flatMap((step) => (step.durationMs == null ? [] : [step.durationMs]));
  return {
    todoStatus: todo ? "provided" : "not_provided",
    todoScope,
    todoRunOrdinal,
    steps,
    referenceEtaMs:
      measured.length === 0
        ? null
        : (measured.reduce((sum, n) => sum + n, 0) / measured.length) *
          (steps.length - completed.length),
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

const VERIFY_COMMAND =
  /^(?:(?:(?:npm|pnpm|bun|yarn|vp|npx)\s+(?:run\s+)?)?(?:test(?:\s|:|$)|typecheck(?:\s|:|$)|build(?:\s|:|$)|vitest\b|jest\b|tsc\b|pytest\b)|(?:go|cargo)\s+test\b)/;

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
            VERIFY_COMMAND.test(item.input.trim()),
        );
  const verification =
    files.size === 0
      ? "unknown"
      : !verificationCommand
        ? "unchecked"
        : verificationCommand.status === "failed" ||
            verificationCommand.outputIndicatesFailure === true ||
            (verificationCommand.exitCode != null && verificationCommand.exitCode !== 0)
          ? "failed"
          : verificationCommand.status === "completed" && verificationCommand.exitCode === 0
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
