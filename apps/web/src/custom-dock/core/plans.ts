import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2PlanArtifact, ScopedThreadRef } from "@t3tools/contracts";

import type { ActivitySnapshot, PlanSnapshot } from "../host/types";
import {
  isHumanRequest,
  isTerminalRun,
  isToolItem,
  latestDockRun,
  timestampMs,
} from "./runStructure";

export function derivePlanSnapshot(projection: ThreadStructure): PlanSnapshot {
  const runs = new Map((projection.runs ?? []).map((run) => [run.id, run]));
  let todo: Extract<OrchestrationV2PlanArtifact, { kind: "todo_list" }> | undefined;
  let proposed: Extract<OrchestrationV2PlanArtifact, { kind: "proposed_plan" }> | undefined;
  const rank = (plan: OrchestrationV2PlanArtifact | undefined) =>
    plan?.runId == null ? -1 : (runs.get(plan.runId)?.ordinal ?? -1);
  for (const plan of projection.plans ?? []) {
    if (
      plan.status === "superseded" ||
      (plan.runId != null && runs.get(plan.runId)?.status === "rolled_back")
    )
      continue;
    if (plan.kind === "todo_list" && rank(plan) >= rank(todo)) todo = plan;
    if (plan.kind === "proposed_plan" && rank(plan) >= rank(proposed)) proposed = plan;
  }
  const steps = (todo?.steps ?? []).map((step) => ({
    label: step.text,
    stage:
      step.status === "completed"
        ? ("Done" as const)
        : step.status === "running"
          ? ("Now" as const)
          : ("Next" as const),
    durationMs: step.durationMs ?? null,
    durationAnchorAt: step.durationAnchorAt ?? null,
  }));
  const completed = steps.filter((step) => step.stage === "Done");
  const measured = completed.flatMap((step) => (step.durationMs == null ? [] : [step.durationMs]));
  return {
    todoStatus: todo ? "provided" : "not_provided",
    steps,
    referenceEtaMs:
      measured.length === 0
        ? null
        : (measured.reduce((sum, n) => sum + n, 0) / measured.length) *
          (steps.length - completed.length),
    proposedPlan: proposed
      ? { id: proposed.id, status: proposed.status, markdown: proposed.markdown }
      : null,
  };
}

type DockFile = { path: string; additions?: number; deletions?: number };

type DockSubagent = {
  id: string;
  name: string | null;
  childThreadId: ScopedThreadRef["threadId"] | null;
  remoteChild?: ScopedThreadRef;
};

const VERIFY_COMMAND =
  /^(?:(?:(?:npm|pnpm|bun|yarn|vp|npx)\s+(?:run\s+)?)?(?:test(?:\s|:|$)|typecheck(?:\s|:|$)|build(?:\s|:|$)|vitest\b|jest\b|tsc\b|pytest\b)|(?:go|cargo)\s+test\b)/;

export function deriveActivitySnapshot(
  projection: ThreadStructure,
  nowMs: number,
): ActivitySnapshot & {
  files: readonly DockFile[];
  subagents: readonly DockSubagent[];
  activeTool: string | null;
} {
  const run = latestDockRun(projection);
  const active =
    run !== null && !isTerminalRun(run) && (run.status !== "queued" || run.startedAt != null);
  const items = (projection.turnItems ?? []).filter(
    (item) => run !== null && item.runId === run.id,
  );
  const activeTool = items.findLast(
    (item) => isToolItem(item) && (item.status === "running" || item.status === "waiting"),
  );
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
  const files = new Map<string, DockFile>();
  const ordered = items.toSorted((a, b) => a.ordinal - b.ordinal);
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
  return {
    phase,
    changedPaths: [...files.keys()],
    files: [...files.values()],
    subagents: [...subagents.values()],
    childLinks: [...subagents.values()].flatMap((worker) =>
      worker.remoteChild ? [worker.remoteChild] : [],
    ),
    verification,
    activeTool: activeTool?.title ?? null,
  };
}
