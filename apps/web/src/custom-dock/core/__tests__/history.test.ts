import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { RunSummary } from "../../host/types";
import { createRunHistory } from "../historyDb";

it("preserves only the newest 50 settlements per scoped thread when IndexedDB is unavailable", async () => {
  const history = createRunHistory(null);
  const scope = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("same") };
  const remote = { ...scope, environmentId: EnvironmentId.make("remote") };
  const makeSummary = (n: number): RunSummary => ({
    runId: RunId.make(`run-${n}`),
    completedAt: new Date(n * 1000).toISOString(),
    status: "complete",
    queueMs: null,
    elapsedMs: 1000,
    waitingUserMs: 0,
    toolMs: 0,
    activeWorkMs: 1000,
    tokenUsage: null,
    otherUsage: [],
    isLocalCommandOnly: true,
    cacheHitRate: null,
    turnAvgOutputTps: null,
    activeOutputTps: null,
  });
  for (let n = 51; n >= 1; n--) await history.put(scope, makeSummary(n));
  await history.put(remote, makeSummary(1));
  const rows = await history.list(scope);
  expect(rows).toHaveLength(50);
  expect(rows[0]?.runId).toBe("run-51");
  expect(rows.at(-1)?.runId).toBe("run-2");
  expect(await history.list(remote)).toEqual([makeSummary(1)]);
});
