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
import { derivePlanSnapshot, estimatePlanTiming } from "../plans";
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
  const telemetry = deriveRunTelemetry(source, run, 70_000);
  expect(telemetry).toMatchObject({
    status: "complete",
    queueMs: 1500,
    elapsedMs: 10_000,
    waitingUserMs: 5000,
    toolMs: 2000,
    activeWorkMs: 3000,
    tokenUsage: { inputTokens: 1000, cachedInputTokens: 180, outputTokens: 100 },
    cacheHitRate: 0.18,
    turnAvgOutputTps: 10,
  });
  expect(telemetry.activeOutputTps).toBeCloseTo(100 / 3, 5);
});

it("excludes bash time from model output TPS while preserving parallel background streaming", () => {
  const { projection, run, turn, approval, command } = fixture();
  const longRun: OrchestrationV2Run = {
    ...run,
    workStartedAt: at(0),
    completedAt: at(40_000),
  };
  const overlapTool = command(5000, 35_000);
  const overlapApproval = approval(5000, 10_000);
  // 30s of bash (overlapping 5s approval) leaves 10s of model time -> 600 / 10s = 60 tok/s.
  expect(
    deriveRunTelemetry(
      {
        ...projection,
        runs: [longRun],
        providerTurns: [turn(1, settled(1000, 500, 600))],
        runtimeRequests: [overlapApproval],
        turnItems: [overlapTool],
      },
      longRun,
      50_000,
    ),
  ).toMatchObject({
    elapsedMs: 40_000,
    waitingUserMs: 5000,
    toolMs: 30_000,
    activeWorkMs: 10_000,
    turnAvgOutputTps: 15,
    activeOutputTps: 60,
  });

  // A background monitor command never subtracts from model work time.
  const monitorCmd = { ...command(0, 40_000), monitor: true as const };
  expect(
    deriveRunTelemetry(
      {
        ...projection,
        runs: [longRun],
        providerTurns: [turn(1, settled(1000, 500, 400))],
        turnItems: [monitorCmd],
      },
      longRun,
      50_000,
    ),
  ).toMatchObject({
    toolMs: 40_000,
    activeWorkMs: 40_000,
    activeOutputTps: 10,
  });

  // Settled Model Output TPS excludes both bash time AND multi-second TTFT/prefill gaps
  // when reasoning/assistant streaming spans are recorded (matching real decode speed).
  const ttftRun: OrchestrationV2Run = {
    ...run,
    workStartedAt: at(0),
    completedAt: at(65_000),
  };
  const reasoningBlock: Extract<OrchestrationV2TurnItem, { type: "reasoning" }> = {
    id: TurnItemId.make("reason-ttft"),
    threadId: run.threadId,
    runId: ttftRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: at(8000),
    completedAt: at(13_000),
    updatedAt: at(13_000),
    type: "reasoning",
    text: "Thinking...",
    streaming: false,
  };
  const bashMiddle = { ...command(13_000, 21_000), ordinal: 2, input: "vp test" };
  const answerBlock: Extract<OrchestrationV2TurnItem, { type: "assistant_message" }> = {
    id: TurnItemId.make("answer-ttft"),
    threadId: run.threadId,
    runId: ttftRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 3,
    status: "completed",
    title: null,
    startedAt: at(60_000),
    completedAt: at(65_000),
    updatedAt: at(65_000),
    type: "assistant_message",
    messageId: MessageId.make("answer-ttft-msg"),
    text: "Done.",
    streaming: false,
  };
  const ttftTelemetry = deriveRunTelemetry(
    {
      ...projection,
      runs: [ttftRun],
      providerTurns: [turn(1, settled(500_000, 490_000, 1018))],
      turnItems: [reasoningBlock, bashMiddle, answerBlock],
    },
    ttftRun,
    70_000,
  );
  // 5s reasoning + 5s answer = 10s streaming; 1018 output - ~18 bash tool input tokens = ~1000 tokens -> ~100 tok/s
  expect(ttftTelemetry.turnAvgOutputTps).toBeCloseTo(1018 / 65, 2);
  expect(ttftTelemetry.activeOutputTps).toBeCloseTo(100, 0);
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
      runs: [{ ...run, status: "running", completedAt: null }],
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

it("clears every Todo when its run ends without carrying it into the next run", () => {
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
  for (const plans of [[finishedPlan], [unfinishedPlan]]) {
    for (const status of ["completed", "failed", "interrupted", "cancelled"] as const) {
      expect(
        derivePlanSnapshot({ ...projection, runs: [{ ...run, status }], plans }),
      ).toMatchObject({
        todoStatus: "not_provided",
        steps: [],
        referenceEtaMs: null,
      });
    }
  }
  expect(
    derivePlanSnapshot({
      ...projection,
      runs: [run, nextRun],
      plans: [unfinishedPlan],
    }),
  ).toMatchObject({
    todoStatus: "not_provided",
    todoScope: "none",
    todoRunOrdinal: null,
    steps: [],
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

it("reports event-driven step progress without wall-clock creep to 95% and calibrates weighted ETA", () => {
  const { projection, run, turn, approval } = fixture();
  const activeRun: OrchestrationV2Run = { ...run, status: "running", completedAt: null };
  const updateSteps = (
    ordinal: number,
    steps: ReadonlyArray<{ readonly title: string; readonly status: string }>,
    atMs: number,
    targetRun: OrchestrationV2Run = activeRun,
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
    startedAt: at(atMs - 100),
    completedAt: at(atMs),
    updatedAt: at(atMs),
    type: "dynamic_tool",
    toolName: "Run update_steps",
    input: { steps },
  });

  // With zero real events in the active step, progress stays at 0% even 90s later instead of creeping to 95%.
  const idleActivePlan = derivePlanSnapshot(
    {
      ...projection,
      runs: [activeRun],
      turnItems: [
        updateSteps(
          10,
          [
            { title: "Inspect source", status: "in_progress" },
            { title: "Implement fix", status: "pending" },
            { title: "Run tests", status: "pending" },
          ],
          3000,
        ),
        updateSteps(
          20,
          [
            { title: "Inspect source", status: "done" },
            { title: "Implement fix", status: "in_progress" },
            { title: "Run tests", status: "pending" },
          ],
          10_000,
        ),
      ],
    },
    90_000,
  );
  expect(idleActivePlan.steps[0]).toMatchObject({
    label: "Inspect source",
    stage: "Done",
    durationMs: 7000,
    progressPercent: 100,
    weight: 0.7,
  });
  expect(idleActivePlan.steps[1]).toMatchObject({
    label: "Implement fix",
    stage: "Now",
    durationAnchorAt: "1970-01-01T00:00:10.000Z",
    progressPercent: 0,
    weight: 1.55,
  });
  // Light exploration step (0.7 / 3.45 = 20%), NOT 95%+ stuck waiting.
  expect(idleActivePlan.overallPercent).toBe(20);
  // Immediately after step 1 (7s / 0.7 = 10s unit pace), implementation (1.55) + verify (1.2) scale proportionally.
  const atTransition = estimatePlanTiming({
    steps: idleActivePlan.steps,
    runStartedAtMs: 2000,
    nowMs: 10_000,
  });
  expect(atTransition.stepEstimatedMs.get(idleActivePlan.steps[1]!.id)).toBe(15_500);
  expect(atTransition.stepEstimatedMs.get(idleActivePlan.steps[2]!.id)).toBe(12_000);
  expect(atTransition.referenceEtaMs).toBe(27_500);

  // When step 2 overruns to 40s elapsed, pace self-calibrates upward instead of hitting 0s remaining.
  expect(idleActivePlan.referenceEtaMs).toBeGreaterThan(30_000);

  // Real tool & verification events drive step progress and reflect test failures vs passes honestly.
  const fileEdit: Extract<OrchestrationV2TurnItem, { type: "file_change" }> = {
    id: TurnItemId.make("edit-impl"),
    threadId: run.threadId,
    runId: activeRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 25,
    status: "completed",
    title: null,
    startedAt: at(12_000),
    completedAt: at(16_000),
    updatedAt: at(16_000),
    type: "file_change",
    fileName: "apps/web/src/custom-dock/core/plans.ts",
  };
  const failedTest: Extract<OrchestrationV2TurnItem, { type: "command_execution" }> = {
    id: TurnItemId.make("test-fail"),
    threadId: run.threadId,
    runId: activeRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 26,
    status: "failed",
    title: null,
    startedAt: at(16_000),
    completedAt: at(20_000),
    updatedAt: at(20_000),
    type: "command_execution",
    input: "vp test run",
    exitCode: 1,
  };
  const passedTest: Extract<OrchestrationV2TurnItem, { type: "command_execution" }> = {
    ...failedTest,
    id: TurnItemId.make("test-pass"),
    ordinal: 28,
    status: "completed",
    startedAt: at(22_000),
    completedAt: at(25_000),
    updatedAt: at(25_000),
    exitCode: 0,
  };

  const editedPlan = derivePlanSnapshot(
    {
      ...projection,
      runs: [activeRun],
      turnItems: [
        updateSteps(
          10,
          [
            { title: "Inspect source", status: "in_progress" },
            { title: "Implement fix", status: "pending" },
          ],
          3000,
        ),
        updateSteps(
          20,
          [
            { title: "Inspect source", status: "done" },
            { title: "Implement fix", status: "in_progress" },
          ],
          10_000,
        ),
        fileEdit,
      ],
    },
    16_000,
  );
  expect(editedPlan.steps[1]!.progressPercent).toBe(43);

  const failedVerifyPlan = derivePlanSnapshot(
    {
      ...projection,
      runs: [activeRun],
      turnItems: [
        updateSteps(
          10,
          [
            { title: "Inspect source", status: "in_progress" },
            { title: "Implement fix", status: "pending" },
          ],
          3000,
        ),
        updateSteps(
          20,
          [
            { title: "Inspect source", status: "done" },
            { title: "Implement fix", status: "in_progress" },
          ],
          10_000,
        ),
        fileEdit,
        failedTest,
      ],
    },
    20_000,
  );
  expect(failedVerifyPlan.steps[1]!.progressPercent).toBe(44);

  const passedVerifyPlan = derivePlanSnapshot(
    {
      ...projection,
      runs: [activeRun],
      turnItems: [
        updateSteps(
          10,
          [
            { title: "Inspect source", status: "in_progress" },
            { title: "Implement fix", status: "pending" },
          ],
          3000,
        ),
        updateSteps(
          20,
          [
            { title: "Inspect source", status: "done" },
            { title: "Implement fix", status: "in_progress" },
          ],
          10_000,
        ),
        fileEdit,
        failedTest,
        passedTest,
      ],
    },
    25_000,
  );
  expect(passedVerifyPlan.steps[1]!.progressPercent).toBe(84);

  // Reconstructs step durations across multiple todo_list turnItems with distinct planIds and subtracts human wait time.
  const todoItem = (
    ordinal: number,
    planId: string,
    atMs: number,
    steps: ReadonlyArray<{
      readonly id: string;
      readonly text: string;
      readonly status: "pending" | "running" | "completed";
    }>,
  ): Extract<OrchestrationV2TurnItem, { type: "todo_list" }> => ({
    id: TurnItemId.make(`todo-item-${ordinal}`),
    threadId: run.threadId,
    runId: activeRun.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: "Todo list",
    startedAt: at(atMs),
    completedAt: at(atMs),
    updatedAt: at(atMs),
    type: "todo_list",
    planId: PlanId.make(planId),
    steps,
  });
  const latestTodoSteps = [
    { id: "1", text: "One", status: "completed" as const },
    { id: "2", text: "Two", status: "running" as const },
    { id: "3", text: "Three", status: "pending" as const },
  ];
  const multiPlanTodo = derivePlanSnapshot(
    {
      ...projection,
      runs: [activeRun],
      runtimeRequests: [approval(10_000, 70_000)],
      plans: [
        {
          id: PlanId.make("plan-call-2"),
          threadId: run.threadId,
          runId: activeRun.id,
          nodeId: run.rootNodeId!,
          kind: "todo_list",
          status: "active",
          steps: latestTodoSteps,
        },
      ],
      turnItems: [
        todoItem(5, "plan-call-1", 5000, [
          { id: "1", text: "One", status: "running" },
          { id: "2", text: "Two", status: "pending" },
          { id: "3", text: "Three", status: "pending" },
        ]),
        todoItem(15, "plan-call-2", 80_000, latestTodoSteps),
      ],
    },
    80_000,
  );
  // 80s - 5s = 75s wall time minus 60s human approval wait = 15s true active work duration.
  expect(multiPlanTodo.steps[0]!.durationMs).toBe(15_000);
  expect(multiPlanTodo.referenceEtaMs).toBe(30_000);

  // Single mutated-in-place todo_list turnItem (e.g. ACP plan) honors artifact durationAnchorAt
  // instead of step 1's startedAt and excludes prior steps' completed tools from the new active step.
  const mutatedInPlaceTodoItem: Extract<OrchestrationV2TurnItem, { type: "todo_list" }> = {
    ...todoItem(4, "acp-plan", 2000, [
      { id: "acp-1", text: "定位当前应用运行环境", status: "completed" },
      { id: "acp-2", text: "实现多工具事件进度演练", status: "completed" },
      { id: "acp-3", text: "运行浏览器测试验证校准", status: "completed" },
      { id: "acp-4", text: "读取并核对本轮实测指标", status: "running" },
    ]),
    status: "running",
    completedAt: null,
    updatedAt: at(125_000),
  };
  const priorStepVerifyCmd: Extract<OrchestrationV2TurnItem, { type: "command_execution" }> = {
    ...passedTest,
    id: TurnItemId.make("prior-verify"),
    runId: activeRun.id,
    ordinal: 13,
    startedAt: at(92_000),
    completedAt: at(100_000),
    updatedAt: at(100_000),
    input: "vp test run apps/web/src/custom-dock",
    exitCode: 0,
  };
  const mutatedProjection = {
    ...projection,
    runs: [activeRun],
    plans: [
      {
        id: PlanId.make("acp-plan"),
        threadId: run.threadId,
        runId: activeRun.id,
        nodeId: run.rootNodeId!,
        kind: "todo_list" as const,
        status: "active" as const,
        steps: [
          {
            id: "acp-1",
            text: "定位当前应用运行环境",
            status: "completed" as const,
            durationMs: 25_403,
          },
          {
            id: "acp-2",
            text: "实现多工具事件进度演练",
            status: "completed" as const,
            durationMs: 65_639,
          },
          {
            id: "acp-3",
            text: "运行浏览器测试验证校准",
            status: "completed" as const,
            durationMs: 32_313,
          },
          {
            id: "acp-4",
            text: "读取并核对本轮实测指标",
            status: "running" as const,
            durationAnchorAt: new Date(125_000).toISOString(),
          },
        ],
      },
    ],
    turnItems: [mutatedInPlaceTodoItem, priorStepVerifyCmd],
  };
  const atStep4Start = derivePlanSnapshot(mutatedProjection, 125_000);
  expect(atStep4Start.steps[3]!.activeElapsedMs).toBe(0);
  expect(atStep4Start.steps[3]!.progressPercent).toBe(0);
  expect(atStep4Start.steps[3]!.estimatedDurationMs).toBeGreaterThan(20_000);
  expect(atStep4Start.steps[3]!.estimatedDurationMs).toBeLessThan(30_000);

  const step4ReadCmd: Extract<OrchestrationV2TurnItem, { type: "command_execution" }> = {
    ...passedTest,
    id: TurnItemId.make("step4-read"),
    runId: activeRun.id,
    ordinal: 16,
    startedAt: at(126_000),
    completedAt: at(127_000),
    updatedAt: at(127_000),
    input: "git status --short",
    exitCode: 0,
  };
  const afterStep4Read = derivePlanSnapshot(
    {
      ...mutatedProjection,
      turnItems: [mutatedInPlaceTodoItem, priorStepVerifyCmd, step4ReadCmd],
    },
    127_000,
  );
  expect(afterStep4Read.steps[3]!.activeElapsedMs).toBe(2000);
  expect(afterStep4Read.steps[3]!.progressPercent).toBeGreaterThan(0);

  // Parallel active steps aggregate remaining time via max rather than sum.
  const parallelTiming = estimatePlanTiming({
    steps: [
      {
        id: "done",
        stage: "Done",
        weight: 1,
        progressPercent: 100,
        durationMs: 10_000,
        durationAnchorAt: null,
      },
      {
        id: "worker-a",
        stage: "Now",
        weight: 1,
        progressPercent: 0,
        durationMs: null,
        durationAnchorAt: "1970-01-01T00:00:10.000Z",
      },
      {
        id: "worker-b",
        stage: "Now",
        weight: 1,
        progressPercent: 0,
        durationMs: null,
        durationAnchorAt: "1970-01-01T00:00:10.000Z",
      },
      {
        id: "final",
        stage: "Next",
        weight: 1,
        progressPercent: 0,
        durationMs: null,
        durationAnchorAt: null,
      },
    ],
    runStartedAtMs: 2000,
    nowMs: 10_000,
  });
  expect(parallelTiming.referenceEtaMs).toBe(20_000);

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
        updateSteps(
          20,
          [
            { title: "Inspect source", status: "done" },
            { title: "Run tests", status: "done" },
          ],
          13_000,
          run,
        ),
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
    activeMs: 13_000,
    startedAtMs: 2000,
    reportedAtMs: 12000,
  });

  // Per-response live tokenUsage excludes an earlier bash execution from its active duration.
  const bashBeforeReply: OrchestrationV2TurnItem = {
    id: TurnItemId.make("bash-before-reply"),
    threadId: run.threadId,
    runId: active.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: runningTurn.id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: at(4000),
    completedAt: at(34_000),
    updatedAt: at(34_000),
    type: "command_execution",
    input: "vp test run",
    exitCode: 0,
  };
  const replyAfterBash: OrchestrationV2ProviderTurn = {
    ...turn(2),
    status: "running",
    completedAt: null,
    tokenUsage: {
      usedTokens: 5200,
      inputTokens: 5000,
      outputTokens: 160,
      updatedAt: "1970-01-01T00:00:36.000Z",
    },
  };
  const afterBashSnapshot = deriveDockSnapshot(
    {
      ...projection,
      runs: [active],
      attempts: projection.attempts.map((attempt) => ({ ...attempt, status: "running" })),
      providerTurns: [replyAfterBash],
      turnItems: [bashBeforeReply],
    },
    scope,
    50_000,
    [],
  );
  expect(afterBashSnapshot.liveOutputProgress).toEqual({
    outputTokens: 160,
    activeMs: 2000,
    startedAtMs: 2000,
    reportedAtMs: 36_000,
  });
  expect(
    deriveLiveStreamTps({
      projection: {
        ...projection,
        runs: [active],
        providerTurns: [replyAfterBash],
        turnItems: [bashBeforeReply],
      },
      runId: active.id,
      runStartedAtMs: 2000,
      providerProgress: afterBashSnapshot.liveOutputProgress,
      serverNowMs: 66_000,
    }),
  ).toBe(80);

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

  // While a bash command runs for 30s after reasoning finishes, live TPS stays at the real
  // model output speed (60 tok/s) instead of decaying across bash execution time.
  const finishedReasoning: Extract<OrchestrationV2TurnItem, { type: "reasoning" }> = {
    ...streamingReasoning,
    status: "completed",
    streaming: false,
    completedAt: at(6000),
    updatedAt: at(6000),
  };
  const runningBash: Extract<OrchestrationV2TurnItem, { type: "command_execution" }> = {
    id: TurnItemId.make("bash-running"),
    threadId: run.threadId,
    runId: run.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 2,
    status: "running",
    title: null,
    startedAt: at(6000),
    completedAt: null,
    updatedAt: at(36_000),
    type: "command_execution",
    input: "sleep 30",
  };
  expect(
    deriveLiveStreamTps({
      projection: { ...projection, turnItems: [finishedReasoning, runningBash] },
      runId: run.id,
      runStartedAtMs: 2000,
      providerProgress: {
        outputTokens: 120,
        activeMs: 2000,
        startedAtMs: 2000,
        reportedAtMs: 6000,
      },
      serverNowMs: 36_000,
    }),
  ).toBe(60);

  // Even if a streaming item stayed open across a bash call, the bash interval is excluded.
  const completedBash = { ...runningBash, status: "completed" as const, completedAt: at(36_000) };
  const resumedReply: Extract<OrchestrationV2TurnItem, { type: "assistant_message" }> = {
    id: TurnItemId.make("reply-1"),
    threadId: run.threadId,
    runId: run.id,
    nodeId: run.rootNodeId!,
    providerThreadId: run.providerThreadId!,
    providerTurnId: turn(1).id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 3,
    status: "running",
    title: null,
    startedAt: at(37_000),
    completedAt: null,
    updatedAt: at(39_000),
    type: "assistant_message",
    messageId: MessageId.make("msg-1"),
    text: "abcd".repeat(200),
    streaming: true,
  };
  expect(
    deriveLiveStreamTps({
      projection: { ...projection, turnItems: [finishedReasoning, completedBash, resumedReply] },
      runId: run.id,
      runStartedAtMs: 2000,
      providerProgress: null,
      serverNowMs: 39_000,
    }),
  ).toBe(100);
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
