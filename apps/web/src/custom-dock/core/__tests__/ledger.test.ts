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
import { observeThread } from "../threadObserver";
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
    steps: [
      { stage: "Done", durationMs: 4000 },
      { stage: "Now", durationAnchorAt: anchor },
      { stage: "Next" },
    ],
    referenceEtaMs: 8000,
  });
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
  const measure = () => observeThread(() => source, history, scope, 12000);
  expect(await measure()).toMatchObject({ threadMeta: scope, currentRun: { status: "complete" } });
  await measure();
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
  await measure();
  await vi.runAllTimersAsync();
  expect(put).toHaveBeenCalledTimes(1);
});
