import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { DockRuntime, type DockSnapshot } from "./panelContext";
import { panelDefinition } from "../panels/session-glance";

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
  recentRuns: [],
  plans: {
    todoStatus: "provided",
    referenceEtaMs: null,
    proposedPlan: null,
    steps: [
      { id: "a", label: "Read source", stage: "Done", durationMs: null, durationAnchorAt: null },
      { id: "b", label: "Run checks", stage: "Now", durationMs: null, durationAnchorAt: null },
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
  },
};

function footer(data: DockSnapshot, runStartedAtMs: number | null = null) {
  const value = {
    snapshot: data,
    runOrdinal: 17,
    runStartedAtMs,
    claude: false,
    cwd: undefined,
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
          steps: pending.plans.steps.map((step) => ({ ...step, stage: "Done" })),
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
