import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { RunSummary } from "../../host/types";
import { createRunHistory } from "../historyDb";

it("reads a completed settlement from a new IndexedDB history instance", async () => {
  const scope = {
    environmentId: EnvironmentId.make("history-browser-env"),
    threadId: ThreadId.make("history-browser-thread"),
  };
  const row: RunSummary = {
    runId: RunId.make("history-browser-run"),
    completedAt: "2026-01-01T00:01:00.000Z",
    status: "complete",
    queueMs: 0,
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
  };
  await createRunHistory(indexedDB).put(scope, row);
  expect(await createRunHistory(indexedDB).list(scope)).toEqual([row]);
  expect(
    await createRunHistory(indexedDB).list({
      ...scope,
      environmentId: EnvironmentId.make("other-env"),
    }),
  ).toEqual([]);
});
