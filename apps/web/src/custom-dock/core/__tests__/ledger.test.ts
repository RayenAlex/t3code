import {
  EnvironmentId,
  MessageId,
  NodeId,
  PlanId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";

import { makeThreadProjectionFixture } from "../../../test-fixtures";
import { derivePlanSnapshot } from "../plans";
import { deriveLiveStreamTps, estimateTextTokens } from "../streamRate";
import { deriveDockSnapshot, rememberDockRuns } from "../threadObserver";
import {
  deriveActivitySnapshot,
  deriveRecentRunsTelemetry,
  deriveRunTelemetry,
} from "../telemetry";

const at = (ms: number) => DateTime.makeUnsafe(ms);

function fixture() {
  const projection = makeThreadProjectionFixture();
  const thread = projection.thread;
  const attemptId = RunAttemptId.make("attempt");
  const providerThreadId = ProviderThreadId.make("provider-thread");
  const nodeId = NodeId.make("root");
  const run: OrchestrationV2Run = {
    id: RunId.make("run"),
    threadId: thread.id,
    ordinal: 1,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    providerThreadId,
    rootNodeId: nodeId,
    userMessageId: MessageId.make("message"),
    activeAttemptId: attemptId,
    checkpointId: null,
    contextHandoffId: null,
    status: "completed",
    requestedAt: at(0),
    startedAt: at(1500),
    workStartedAt: at(2000),
    completedAt: at(12000),
  };
  const attempt: OrchestrationV2RunAttempt = {
    id: attemptId,
    runId: run.id,
    attemptOrdinal: 1,
    providerInstanceId: run.providerInstanceId,
    providerThreadId,
    providerTurnId: null,
    rootNodeId: nodeId,
    reason: "initial",
    status: "completed",
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
  const turn = (ordinal: number, turnTokenUsage?: TurnTokenUsage): OrchestrationV2ProviderTurn => ({
    id: ProviderTurnId.make(`turn-${ordinal}`),
    providerThreadId,
    nodeId,
    runAttemptId: attemptId,
    nativeTurnRef: null,
    ordinal,
    status: "completed",
    startedAt: at(2000),
    completedAt: at(12000),
    ...(turnTokenUsage === undefined ? {} : { turnTokenUsage }),
  });
  const approval = (start: number, end: number): OrchestrationV2RuntimeRequest => ({
    id: RuntimeRequestId.make(`approval-${start}`),
    nodeId,
    providerTurnId: turn(1).id,
    nativeRequestRef: null,
    kind: "permission",
    status: "resolved",
    responseCapability: { type: "message" },
    createdAt: at(start),
    resolvedAt: at(end),
  });
  const command = (
    start: number,
    end: number,
  ): Extract<OrchestrationV2TurnItem, { type: "command_execution" }> => ({
    id: TurnItemId.make(`command-${start}`),
    threadId: thread.id,
    runId: run.id,
    nodeId,
    providerThreadId,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: start,
    status: "completed",
    title: null,
    startedAt: at(start),
    completedAt: at(end),
    updatedAt: at(end),
    type: "command_execution",
    input: "vp test run",
    exitCode: 0,
  });
  return {
    projection: { ...projection, runs: [run], attempts: [attempt] },
    run,
    turn,
    approval,
    command,
  };
}

function settled(inputTokens: number, cachedInputTokens: number, outputTokens: number) {
  return {
    usageScope: "main_agent",
    usageStatus: "complete",
    hasSubagents: false,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens: 0,
    outputTokens,
  } as const;
}

it("weights settled cache reads and clips overlapping wait and tool intervals separately", () => {
  const { projection, run, turn, approval, command } = fixture();
  const a = settled(100, 90, 25);
  const b = settled(900, 90, 75);
  const source = {
    ...projection,
    providerTurns: [
      turn(1, a),
      turn(2, b),
      { ...turn(3, a), promptDropped: true as const },
      turn(4, { ...a, localCommand: true }),
      { ...turn(5, a), runAttemptId: RunAttemptId.make("some-other-run") },
    ],
    runtimeRequests: [approval(4000, 7000), approval(6000, 9000)],
    turnItems: [command(1000, 3000), command(2500, 4000)],
  };
  expect(deriveRunTelemetry(source, run, 70_000)).toMatchObject({
    status: "complete",
    queueMs: 1500,
    elapsedMs: 10_000,
    waitingUserMs: 5000,
    toolMs: 2000,
    activeWorkMs: 5000,
    tokenUsage: { inputTokens: 1000, cachedInputTokens: 180, outputTokens: 100 },
    cacheHitRate: 0.18,
    turnAvgOutputTps: 10,
    activeOutputTps: 20,
  });
});

it("leaves live last-response counters pending and never invents a missing cache ratio", () => {
  const { projection, run, turn } = fixture();
  const current = { ...run, status: "running" as const, completedAt: null };
  expect(
    deriveRunTelemetry(
      {
        ...projection,
        providerTurns: [
          {
            ...turn(1),
            tokenUsage: {
              usedTokens: 300,
              inputTokens: 250,
              outputTokens: 50,
              updatedAt: at(2000).toString(),
            },
          },
        ],
      },
      current,
      2500,
    ),
  ).toMatchObject({ status: "pending", tokenUsage: null, turnAvgOutputTps: null });
  const { cachedInputTokens: _, ...missingCache } = settled(100, 90, 20);
  expect(
    deriveRunTelemetry(
      { ...projection, providerTurns: [turn(1, missingCache)] },
      { ...run, completedAt: at(2199) },
      9000,
    ),
  ).toMatchObject({
    cacheHitRate: null,
    turnAvgOutputTps: null,
    activeOutputTps: null,
  });
});

it("keeps only structured Todo steps with measured reference time", () => {
  const { projection, run } = fixture();
  expect(derivePlanSnapshot(projection).todoStatus).toBe("not_provided");
  const anchor = "2026-01-01T00:00:00.000Z";
  expect(
    derivePlanSnapshot({
      ...projection,
      plans: [
        {
          id: PlanId.make("todo"),
          threadId: run.threadId,
          runId: run.id,
          nodeId: run.rootNodeId!,
          kind: "todo_list",
          status: "active",
          steps: [
            { id: "one", text: "One", status: "completed", durationMs: 4000 },
            { id: "two", text: "Two", status: "running", durationAnchorAt: anchor },
            { id: "three", text: "Three", status: "pending" },
          ],
        },
      ],
    }),
  ).toMatchObject({
    todoStatus: "provided",
    todoScope: "current",
    todoRunOrdinal: 1,
    steps: [
      { stage: "Done", durationMs: 4000 },
      { stage: "Now", durationAnchorAt: anchor },
      { stage: "Next" },
    ],
    referenceEtaMs: 8000,
  });
});

it("retires a finished previous plan on a new run while carrying unfinished multi-turn plans", () => {
  const { projection, run } = fixture();
  const nextRun: OrchestrationV2Run = {
    ...run,
    id: RunId.make("run-2"),
    ordinal: 2,
    status: "running",
    completedAt: null,
  };
  const finishedPlan = {
    id: PlanId.make("todo-1"),
    threadId: run.threadId,
    runId: run.id,
    nodeId: run.rootNodeId!,
    kind: "todo_list" as const,
    status: "completed" as const,
    steps: [
      { id: "one", text: "One", status: "completed" as const, durationMs: 1000 },
      { id: "two", text: "Two", status: "completed" as const, durationMs: 1500 },
    ],
  };
  expect(
    derivePlanSnapshot({
      ...projection,
      runs: [run, nextRun],
      plans: [finishedPlan],
    }),
  ).toMatchObject({
    todoStatus: "not_provided",
    todoScope: "none",
    todoRunOrdinal: null,
    steps: [],
    referenceEtaMs: null,
  });

  const unfinishedPlan = {
    ...finishedPlan,
    status: "active" as const,
    steps: [
      { id: "one", text: "One", status: "completed" as const, durationMs: 1000 },
      { id: "two", text: "Two", status: "pending" as const },
    ],
  };
  expect(
    derivePlanSnapshot({
      ...projection,
      runs: [run, nextRun],
      plans: [unfinishedPlan],
    }),
  ).toMatchObject({
    todoStatus: "provided",
    todoScope: "carried",
    todoRunOrdinal: 1,
    steps: [{ stage: "Done" }, { stage: "Next" }],
  });

  const nextRunPlan = {
    id: PlanId.make("todo-2"),
    threadId: run.threadId,
    runId: nextRun.id,
    nodeId: nextRun.rootNodeId!,
    kind: "todo_list" as const,
    status: "active" as const,
    steps: [{ id: "a", text: "Fresh step", status: "running" as const }],
  };
  expect(
    derivePlanSnapshot({
      ...projection,
      runs: [run, nextRun],
      plans: [unfinishedPlan, nextRunPlan],
    }),
  ).toMatchObject({
    todoStatus: "provided",
    todoScope: "current",
    todoRunOrdinal: 2,
    steps: [{ label: "Fresh step", stage: "Now" }],
  });
});

it("derives objective live activity without reading streamed reasoning text", () => {
  const { projection, run, turn, command } = fixture();
  const { workStartedAt: _workStartedAt, ...runWithoutWorkStart } = run;
  const queuedRun: OrchestrationV2Run = {
    ...runWithoutWorkStart,
    id: RunId.make("run-queued"),
    ordinal: 2,
    status: "queued",
    startedAt: null,
    completedAt: null,
  };
  expect(
    deriveActivitySnapshot({ ...projection, runs: [run, queuedRun] }, 20_000).liveAction,
  ).toEqual({ kind: "queued", detail: null });

  const activeRun: OrchestrationV2Run = {
    ...run,
    status: "running",
    completedAt: null,
  };
  const runningCommand = {
    ...command(2100, 2200),
    status: "running" as const,
    completedAt: null,
  };
  expect(
    deriveActivitySnapshot({ ...projection, runs: [activeRun], turnItems: [runningCommand] }, 3000),
  ).toMatchObject({
    liveAction: { kind: "command", detail: "vp test run" },
    toolCount: 1,
  });

  const fileEdit: Extract<OrchestrationV2TurnItem, { type: "file_change" }> = {
    id: TurnItemId.make("edit-1"),
    threadId: run.threadId,
    runId: activeRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 3000,
    status: "running",
    title: null,
    startedAt: at(2500),
    completedAt: null,
    updatedAt: at(2500),
    type: "file_change",
    fileName: "apps/web/src/custom-dock/core/plans.ts",
  };
  expect(
    deriveActivitySnapshot(
      { ...projection, runs: [activeRun], turnItems: [command(2100, 2400), fileEdit] },
      3000,
    ),
  ).toMatchObject({
    liveAction: { kind: "file_change", detail: "plans.ts" },
    toolCount: 2,
  });

  expect(deriveActivitySnapshot(projection, 20_000).liveAction).toBeNull();
});

it("parses structured Run update_steps dynamic_tool calls when no native todo_list exists", () => {
  const { projection, run, turn } = fixture();
  const updateSteps = (
    ordinal: number,
    steps: ReadonlyArray<{ readonly title: string; readonly status: string }>,
    targetRun: OrchestrationV2Run = run,
  ): Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }> => ({
    id: TurnItemId.make(`steps-${ordinal}`),
    threadId: run.threadId,
    runId: targetRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: "Run update_steps",
    startedAt: at(2500),
    completedAt: at(2600),
    updatedAt: at(2600),
    type: "dynamic_tool",
    toolName: "Run update_steps",
    input: { steps },
  });

  expect(
    derivePlanSnapshot({
      ...projection,
      turnItems: [
        updateSteps(10, [
          { title: "Inspect source", status: "in_progress" },
          { title: "Run tests", status: "pending" },
        ]),
        updateSteps(20, [
          { title: "Inspect source", status: "done" },
          { title: "Run tests", status: "in_progress" },
        ]),
      ],
    }),
  ).toMatchObject({
    todoStatus: "provided",
    todoScope: "current",
    todoRunOrdinal: 1,
    steps: [
      { label: "Inspect source", stage: "Done", durationMs: null },
      { label: "Run tests", stage: "Now", durationMs: null },
    ],
  });

  const nextRun: OrchestrationV2Run = {
    ...run,
    id: RunId.make("run-2"),
    ordinal: 2,
    status: "running",
    completedAt: null,
  };
  expect(
    derivePlanSnapshot({
      ...projection,
      runs: [run, nextRun],
      turnItems: [
        updateSteps(20, [
          { title: "Inspect source", status: "done" },
          { title: "Run tests", status: "done" },
        ]),
      ],
    }),
  ).toMatchObject({
    todoStatus: "not_provided",
    todoScope: "none",
    steps: [],
  });
});

it("tracks live output progress across settled and running turns for active runs", () => {
  const { projection, run, turn } = fixture();
  const active = { ...run, status: "running" as const, completedAt: null };
  const scope = { environmentId: EnvironmentId.make("local"), threadId: run.threadId };
  const runningTurn: OrchestrationV2ProviderTurn = {
    ...turn(2),
    status: "running",
    completedAt: null,
    tokenUsage: {
      usedTokens: 5000,
      inputTokens: 4800,
      outputTokens: 80,
      updatedAt: "1970-01-01T00:00:05.000Z",
    },
  };
  const liveSnapshot = deriveDockSnapshot(
    {
      ...projection,
      runs: [active],
      attempts: projection.attempts.map((attempt) => ({ ...attempt, status: "running" })),
      providerTurns: [turn(1, settled(200, 100, 40)), runningTurn],
    },
    scope,
    6000,
    [],
  );
  expect(liveSnapshot.liveOutputProgress).toEqual({
    outputTokens: 120,
    startedAtMs: 2000,
    reportedAtMs: 12000,
  });

  const completedSnapshot = deriveDockSnapshot(
    { ...projection, runs: [run], providerTurns: [turn(1, settled(200, 100, 40))] },
    scope,
    12000,
    [],
  );
  expect(completedSnapshot.liveOutputProgress).toBeNull();
});

it("estimates live streaming TPS from active reasoning and assistant text without provider usage", () => {
  const { projection, run, turn } = fixture();
  expect(estimateTextTokens("abcd".repeat(10))).toBe(10);
  expect(estimateTextTokens("中文测试九个字吧哈")).toBe(6);

  const streamingReasoning: Extract<OrchestrationV2TurnItem, { type: "reasoning" }> = {
    id: TurnItemId.make("reason-1"),
    threadId: run.threadId,
    runId: run.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "running",
    title: null,
    startedAt: at(4000),
    completedAt: null,
    updatedAt: at(6000),
    type: "reasoning",
    text: "abcd".repeat(120),
    streaming: true,
  };
  expect(
    deriveLiveStreamTps({
      projection: { ...projection, turnItems: [streamingReasoning] },
      runId: run.id,
      runStartedAtMs: 2000,
      providerProgress: null,
      serverNowMs: 6000,
    }),
  ).toBe(60);

  // Silent thinking with empty text stays null rather than fabricating zero or noise.
  expect(
    deriveLiveStreamTps({
      projection: { ...projection, turnItems: [{ ...streamingReasoning, text: "" }] },
      runId: run.id,
      runStartedAtMs: 2000,
      providerProgress: null,
      serverNowMs: 6000,
    }),
  ).toBeNull();
});

it("does not resurrect a cached rolled-back run or mistake waiting for working", () => {
  const { projection, run, approval, turn } = fixture();
  const finished = { ...projection, providerTurns: [turn(1, settled(200, 100, 40))] };
  const summary = {
    ...deriveRunTelemetry(finished, run, 12_000),
    status: "complete" as const,
    completedAt: "1970-01-01T00:00:12.000Z",
  };
  expect(
    deriveRecentRunsTelemetry(
      { ...finished, runs: [{ ...run, status: "rolled_back" }] },
      [summary],
      12_000,
    ),
  ).toEqual([]);
  expect(
    deriveActivitySnapshot(
      {
        ...projection,
        runtimeRequests: [{ ...approval(2000, 3000), status: "pending", resolvedAt: null }],
      },
      30_000,
    ).phase,
  ).toBe("needs_you");
});

it("coalesces completed ledger writes for a scoped thread even when its projection repeats", async () => {
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  const { projection, run, turn } = fixture();
  const source = { ...projection, providerTurns: [turn(1, settled(200, 100, 40))] };
  const scope = { environmentId: EnvironmentId.make("local"), threadId: run.threadId };
  const put = vi.fn(() => Promise.resolve());
  const history = { list: () => Promise.resolve([]), put };
  const measure = () => {
    const snapshot = deriveDockSnapshot(source, scope, 12000, []);
    rememberDockRuns(history, scope, source.runs, snapshot.recentRuns);
    return snapshot;
  };
  expect(measure()).toMatchObject({ threadMeta: scope, currentRun: { status: "complete" } });
  measure();
  expect(put).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(put).toHaveBeenCalledExactlyOnceWith(
    scope,
    expect.objectContaining({
      runId: run.id,
      status: "complete",
      completedAt: "1970-01-01T00:00:12.000Z",
    }),
  );
  measure();
  await vi.runAllTimersAsync();
  expect(put).toHaveBeenCalledTimes(1);
});

it("reports a live response separately from the run ledger and replaces it on each update", () => {
  const { projection, run, turn } = fixture();
  const active = { ...run, status: "running" as const, completedAt: null };
  const scope = { environmentId: EnvironmentId.make("local"), threadId: run.threadId };
  const report = (outputTokens: number) => ({
    usedTokens: 10_000 + outputTokens,
    inputTokens: 110,
    outputTokens,
    updatedAt: "1970-01-01T00:00:04.000Z",
  });
  const running = {
    ...turn(1),
    status: "running" as const,
    completedAt: null,
  };
  const unrelated = {
    ...running,
    id: ProviderTurnId.make("other-turn"),
    runAttemptId: RunAttemptId.make("old-attempt"),
    tokenUsage: { ...report(940), updatedAt: "1970-01-01T00:00:05.000Z" },
  };
  const observe = (
    providerTurns: readonly OrchestrationV2ProviderTurn[],
    current: OrchestrationV2Run = active,
  ) =>
    deriveDockSnapshot(
      {
        ...projection,
        attempts: projection.attempts.map((attempt) => ({ ...attempt, status: "running" })),
        runs: [current],
        providerTurns,
      },
      scope,
      6000,
      [],
    );

  expect(observe([{ ...running, tokenUsage: report(10) }, unrelated])).toMatchObject({
    latestResponseTokens: 120,
    currentRun: { status: "pending", tokenUsage: null, cacheHitRate: null, turnAvgOutputTps: null },
  });
  expect(observe([{ ...running, tokenUsage: report(35) }, unrelated])).toMatchObject({
    latestResponseTokens: 145,
    currentRun: { status: "pending", tokenUsage: null },
  });
  expect(observe([unrelated])).toMatchObject({ latestResponseTokens: null });
  expect(
    observe([{ ...running, tokenUsage: { usedTokens: 10_000, updatedAt: report(0).updatedAt } }]),
  ).toMatchObject({ latestResponseTokens: null });
  expect(
    observe([{ ...running, tokenUsage: { ...report(10), updatedAt: "1970-01-01T00:00:01.000Z" } }]),
  ).toMatchObject({ latestResponseTokens: null });
  expect(
    observe([{ ...turn(1, settled(220, 110, 60)), tokenUsage: report(35) }], run),
  ).toMatchObject({
    latestResponseTokens: null,
    currentRun: {
      status: "complete",
      tokenUsage: { inputTokens: 220, outputTokens: 60 },
      cacheHitRate: 0.5,
    },
  });
});
