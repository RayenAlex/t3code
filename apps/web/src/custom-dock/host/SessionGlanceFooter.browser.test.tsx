import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { DockRuntime, type DockSnapshot } from "./panelContext";
import { ComposerTaskPlan, panelDefinition } from "../panels/session-glance";

const snapshot: DockSnapshot = {
  threadMeta: { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("thread") },
  currentRun: {
    runId: RunId.make("current"),
    status: "complete",
    elapsedMs: 1000,
    queueMs: 0,
    waitingUserMs: 0,
    toolMs: 0,
    activeWorkMs: 1000,
    tokenUsage: {
      inputTokens: 811,
      cachedInputTokens: 738,
      cacheWriteInputTokens: 0,
      uncachedInputTokens: 73,
      outputTokens: 89,
      reasoningOutputTokens: null,
    },
    otherUsage: [],
    isLocalCommandOnly: false,
    cacheHitRate: 0.91,
    turnAvgOutputTps: 89,
    activeOutputTps: 89,
  },
  contextWindow: null,
  latestResponseTokens: null,
  liveOutputProgress: null,
  recentRuns: [],
  plans: {
    todoStatus: "provided",
    todoScope: "current",
    todoRunOrdinal: 17,
    overallPercent: 37,
    referenceEtaMs: null,
    proposedPlan: null,
    steps: [
      {
        id: "a",
        label: "Read source",
        stage: "Done",
        durationMs: null,
        durationAnchorAt: null,
        activeElapsedMs: null,
        progressPercent: 100,
        weight: 0.7,
        estimatedDurationMs: null,
      },
      {
        id: "b",
        label: "Run checks",
        stage: "Now",
        durationMs: null,
        durationAnchorAt: null,
        activeElapsedMs: null,
        progressPercent: 0,
        weight: 1.2,
        estimatedDurationMs: null,
      },
    ],
  },
  activity: {
    phase: "working",
    changedPaths: [],
    files: [],
    subagents: [],
    childLinks: [],
    verification: "unknown",
    activeTool: null,
    liveAction: null,
    toolCount: 0,
  },
};

function footer(
  data: DockSnapshot,
  runStartedAtMs: number | null = null,
  readLiveTps?: (nowMs: number) => number | null,
) {
  const value = {
    snapshot: data,
    runOrdinal: 17,
    runStartedAtMs,
    cwd: undefined,
    ...(readLiveTps === undefined ? {} : { readLiveTps }),
  };
  return (
    <DockRuntime value={value}>
      <div className="@container/dock-bar">{panelDefinition.renderComposerBar?.(data)}</div>
    </DockRuntime>
  );
}

it("distinguishes the run number from Todo progress and labels the current run's settled usage", async () => {
  await using screen = await render(footer(snapshot));
  await expect.element(screen.getByText("Run 17")).toBeVisible();
  await expect.element(screen.getByText("1/2 steps")).toBeVisible();
  await expect.element(screen.getByText("89 tok/s")).toBeVisible();
  await expect.element(screen.getByText("This run: 900 tokens")).toBeVisible();
  await expect.element(screen.getByText("Cache hit 91%")).toBeVisible();

  // Prefers model output TPS (excluding bash/tool time) over wall-time turn average in the footer.
  await screen.rerender(
    footer({
      ...snapshot,
      currentRun: {
        ...snapshot.currentRun!,
        turnAvgOutputTps: 12,
        activeOutputTps: 95,
      },
    }),
  );
  await expect.element(screen.getByText("95 tok/s")).toBeVisible();
});

it("does not turn a pending run into zero usage or display a stale rate", async () => {
  const run = snapshot.currentRun!;
  await using screen = await render(
    footer({
      ...snapshot,
      currentRun: {
        ...run,
        status: "pending",
        tokenUsage: null,
        cacheHitRate: null,
        turnAvgOutputTps: null,
        activeOutputTps: null,
      },
    }),
  );
  await expect.element(screen.getByText("Pending settlement")).toBeVisible();
  await expect.element(screen.getByText(/tok\/s|This run:|Cache hit/)).not.toBeInTheDocument();
});

it("shows elapsed time, an updated Todo and the latest response while the run is still pending", async () => {
  const run = snapshot.currentRun!;
  const pending = {
    ...snapshot,
    latestResponseTokens: 120,
    currentRun: {
      ...run,
      status: "pending" as const,
      tokenUsage: null,
      cacheHitRate: null,
      turnAvgOutputTps: null,
      activeOutputTps: null,
    },
  };
  await using screen = await render(footer(snapshot));
  using _timers = fakeTimers({ now: 6000 });
  await screen.rerender(footer(pending, 3000));
  await expect.element(screen.getByText("3s", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Latest response: 120 tokens")).toBeVisible();

  await act(() => vi.advanceTimersByTime(1000));
  await expect.element(screen.getByText("4s", { exact: true })).toBeVisible();
  await screen.rerender(
    footer(
      {
        ...pending,
        latestResponseTokens: 145,
        plans: {
          ...pending.plans,
          steps: pending.plans.steps.map((step) => ({ ...step, stage: "Done" as const })),
        },
      },
      3000,
    ),
  );
  await expect.element(screen.getByText("2/2 steps")).toBeVisible();
  await expect.element(screen.getByText("Latest response: 145 tokens")).toBeVisible();
  await expect.element(screen.getByText(/tok\/s|This run:|Cache hit/)).not.toBeInTheDocument();

  await screen.rerender(footer(snapshot));
  await expect.element(screen.getByText("This run: 900 tokens")).toBeVisible();
  await expect.element(screen.getByText(/Latest response:|^4s$/)).not.toBeInTheDocument();
});

it("shows live objective action in the footer and waiting state in task coordination when no Todo exists for the new run", async () => {
  const active: DockSnapshot = {
    ...snapshot,
    plans: {
      todoStatus: "not_provided",
      todoScope: "none",
      todoRunOrdinal: null,
      overallPercent: 0,
      referenceEtaMs: null,
      proposedPlan: null,
      steps: [],
    },
    activity: {
      ...snapshot.activity,
      phase: "working",
      files: [{ path: "apps/web/src/custom-dock/core/plans.ts", additions: 12, deletions: 2 }],
      changedPaths: ["apps/web/src/custom-dock/core/plans.ts"],
      liveAction: { kind: "file_change", detail: "plans.ts" },
      toolCount: 2,
    },
  };
  await using screen = await render(
    <DockRuntime
      value={{
        snapshot: active,
        runOrdinal: 18,
        runStartedAtMs: null,
        cwd: undefined,
      }}
    >
      <div className="@container/dock-bar">{panelDefinition.renderComposerBar?.(active)}</div>
      <ComposerTaskPlan snapshot={active} />
    </DockRuntime>,
  );
  await expect.element(screen.getByText("Run 18")).toBeVisible();
  await expect.element(screen.getByText("Editing plans.ts").first()).toBeVisible();
  await expect.element(screen.getByText("Waiting for this run's plan")).toBeVisible();
  await expect.element(screen.getByText("2 tool calls")).toBeVisible();
  await expect.element(screen.getByText("1 files changed")).toBeVisible();
  await expect.element(screen.getByText(/steps/)).not.toBeInTheDocument();
});

it("keeps live output TPS steady while tools run and updates when active streaming speed changes", async () => {
  const run = snapshot.currentRun!;
  const live: DockSnapshot = {
    ...snapshot,
    latestResponseTokens: 120,
    liveOutputProgress: {
      outputTokens: 120,
      activeMs: 3000,
      startedAtMs: 3000,
      reportedAtMs: 6000,
    },
    currentRun: {
      ...run,
      status: "pending",
      tokenUsage: null,
      cacheHitRate: null,
      turnAvgOutputTps: null,
      activeOutputTps: null,
    },
  };
  using _timers = fakeTimers({ now: 6000 });
  await using screen = await render(footer(live, 3000));
  await expect.element(screen.getByText("~40 tok/s")).toBeVisible();

  // Advancing wall time during a tool run without new tokens must not decay the displayed rate.
  await act(() => vi.advanceTimersByTime(5000));
  await expect.element(screen.getByText("~40 tok/s")).toBeVisible();

  // When live streaming updates via readLiveTps, the footer reflects the latest model rate.
  let rate = 85;
  await screen.rerender(footer(live, 3000, () => rate));
  await expect.element(screen.getByText("~85 tok/s")).toBeVisible();
  rate = 110;
  await act(() => vi.advanceTimersByTime(1000));
  await expect.element(screen.getByText("~110 tok/s")).toBeVisible();
});

it("shows context window progress, percentage, and used/max ratio in the footer when reported", async () => {
  const withLimit: DockSnapshot = {
    ...snapshot,
    contextWindow: {
      usedTokens: 124_000,
      maxTokens: 200_000,
      usedPercentage: 62,
      remainingTokens: 76_000,
      autoCompactThreshold: 180_000,
    },
  };
  await using screen = await render(footer(withLimit));
  await expect.element(screen.getByText(/62%/)).toBeVisible();
  await expect.element(screen.getByText(/\(124K\/200K\)/)).toBeVisible();
  await expect.element(screen.getByText(/Context 62%/)).not.toBeInTheDocument();

  await screen.rerender(
    footer({
      ...snapshot,
      contextWindow: {
        usedTokens: 900,
        maxTokens: null,
        usedPercentage: null,
        remainingTokens: null,
        autoCompactThreshold: null,
      },
    }),
  );
  await expect.element(screen.getByLabelText("Context window 900")).toBeVisible();
});

it("keeps task coordination progress bars event-driven while updating calibrated step estimates and pausing on user wait", async () => {
  const planSnapshot: DockSnapshot = {
    ...snapshot,
    plans: {
      todoStatus: "provided",
      todoScope: "current",
      todoRunOrdinal: 17,
      overallPercent: 20,
      referenceEtaMs: 28_000,
      proposedPlan: null,
      steps: [
        {
          id: "step-1",
          label: "定位任务统筹代码",
          stage: "Done",
          durationMs: 7000,
          durationAnchorAt: null,
          activeElapsedMs: null,
          progressPercent: 100,
          weight: 0.7,
          estimatedDurationMs: 7000,
        },
        {
          id: "step-2",
          label: "实现精准进度计算",
          stage: "Now",
          durationMs: null,
          durationAnchorAt: new Date(8000).toISOString(),
          activeElapsedMs: 2000,
          progressPercent: 0,
          weight: 1.65,
          estimatedDurationMs: 16_500,
        },
        {
          id: "step-3",
          label: "运行单测与类型验证",
          stage: "Next",
          durationMs: null,
          durationAnchorAt: null,
          activeElapsedMs: null,
          progressPercent: 0,
          weight: 1.2,
          estimatedDurationMs: 12_000,
        },
      ],
    },
  };

  using _timers = fakeTimers({ now: 10_000 });
  await using screen = await render(
    <DockRuntime
      value={{
        snapshot: planSnapshot,
        runOrdinal: 17,
        runStartedAtMs: 1000,
        cwd: undefined,
      }}
    >
      <ComposerTaskPlan snapshot={planSnapshot} />
    </DockRuntime>,
  );

  await expect.element(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  await expect.element(screen.getByText("0%", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("2s / ~16s")).toBeVisible();
  await expect.element(screen.getByText("~12s")).toBeVisible();

  // Wall-clock ticks advance elapsed time and self-calibrate overrun estimates,
  // but never creep overall or step progress bars toward 95%.
  await act(() => vi.advanceTimersByTime(25_000));
  await expect.element(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  await expect.element(screen.getByText("0%", { exact: true })).toBeVisible();
  await expect.element(screen.getByText(/27s \/ ~\d+s/)).toBeVisible();

  // Real execution events advance step and overall progress immediately.
  const progressed: DockSnapshot = {
    ...planSnapshot,
    plans: {
      ...planSnapshot.plans,
      overallPercent: 48,
      steps: planSnapshot.plans.steps.map((step) =>
        step.id === "step-2" ? { ...step, activeElapsedMs: 27_000, progressPercent: 60 } : step,
      ),
    },
  };
  await screen.rerender(
    <DockRuntime
      value={{
        snapshot: progressed,
        runOrdinal: 17,
        runStartedAtMs: 1000,
        cwd: undefined,
      }}
    >
      <ComposerTaskPlan snapshot={progressed} />
    </DockRuntime>,
  );
  await expect.element(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "48");
  await expect.element(screen.getByText("60%", { exact: true })).toBeVisible();

  // Waiting on user input pauses active step elapsed ticking.
  const pausedSnapshot: DockSnapshot = {
    ...progressed,
    activity: {
      ...progressed.activity,
      phase: "needs_you",
    },
  };
  await screen.rerender(
    <DockRuntime
      value={{
        snapshot: pausedSnapshot,
        runOrdinal: 17,
        runStartedAtMs: 1000,
        cwd: undefined,
      }}
    >
      <ComposerTaskPlan snapshot={pausedSnapshot} />
    </DockRuntime>,
  );
  await act(() => vi.advanceTimersByTime(10_000));
  await expect.element(screen.getByText(/27s \//)).toBeVisible();
});
