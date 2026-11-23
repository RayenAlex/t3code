import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "@t3tools/client-runtime/state/context-window";
import { ProviderThreadId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";

it("keeps the active provider's compacted usage without assuming a window limit", () => {
  const current = ProviderThreadId.make("current");
  const previous = ProviderThreadId.make("previous");
  const compactedAt = DateTime.makeUnsafe("2026-01-01T00:01:00.000Z");
  const provider = { id: current, contextUsage: null, updatedAt: compactedAt };
  const usage = latestProviderTurnTokenUsage(
    [
      {
        providerThreadId: current,
        tokenUsage: { usedTokens: 3_000, updatedAt: "2026-01-01T00:00:00.000Z" },
      },
      {
        providerThreadId: previous,
        tokenUsage: {
          usedTokens: 50_000,
          maxTokens: 100_000,
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      },
    ],
    null,
    provider,
  );
  expect(usage?.usedTokens).toBe(3_000);

  const snapshot = deriveLatestContextWindowSnapshot(
    [
      {
        item: {
          id: TurnItemId.make("compact-current"),
          threadId: ThreadId.make("thread"),
          runId: null,
          nodeId: null,
          providerThreadId: current,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: compactedAt,
          completedAt: compactedAt,
          updatedAt: compactedAt,
          type: "compaction",
          driver: null,
          beforeTokenCount: 3_000,
          afterTokenCount: 900,
        },
      },
    ],
    usage,
    provider,
  );
  expect(snapshot).toMatchObject({
    usedTokens: 900,
    maxTokens: null,
    usedPercentage: null,
    remainingTokens: null,
  });
});
