import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationV2Run, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";

export type RunId = OrchestrationV2Run["id"];
export type ThreadMeta = { environmentId: EnvironmentId; threadId: ThreadId };
export type ContextWindowMetrics = {
  usedTokens: number;
  maxTokens: number | null;
  usedPercentage: number | null;
  remainingTokens: number | null;
  autoCompactThreshold: number | null;
};
export type TokenCounters = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  uncachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
};
export type RunTelemetry = {
  runId: RunId;
  status: "pending" | "complete" | "partial" | "unavailable";
  elapsedMs: number;
  queueMs: number | null;
  waitingUserMs: number;
  toolMs: number;
  activeWorkMs: number;
  tokenUsage: TokenCounters | null;
  otherUsage: readonly unknown[];
  isLocalCommandOnly: boolean;
  cacheHitRate: number | null;
  turnAvgOutputTps: number | null;
  activeOutputTps: number | null;
};
export type RunSummary = RunTelemetry & {
  status: "complete";
  completedAt: string;
};
export type PlanStep = {
  id: string;
  label: string;
  stage: "Done" | "Now" | "Next";
  durationMs: number | null;
  durationAnchorAt: string | null;
  activeElapsedMs: number | null;
  progressPercent: number;
  weight: number;
  estimatedDurationMs: number | null;
};
export type PlanSnapshot = {
  todoStatus: "provided" | "not_provided";
  steps: readonly PlanStep[];
  overallPercent: number;
  referenceEtaMs: number | null;
  proposedPlan: { id: string; status: string; markdown: string } | null;
};
export type ActivitySnapshot = {
  phase: "needs_you" | "error" | "stuck" | "working" | "background" | "done" | "idle";
  changedPaths: readonly string[];
  subagents: readonly unknown[];
  childLinks: readonly ThreadMeta[];
  verification: "passed" | "failed" | "unchecked" | "unknown";
};
export type CustomDockThreadSnapshot = {
  threadMeta: ThreadMeta;
  contextWindow: ContextWindowMetrics | null;
  currentRun: RunTelemetry | null;
  recentRuns: readonly RunTelemetry[];
  plans: PlanSnapshot;
  activity: ActivitySnapshot;
};
export type CustomDockPanelDefinition = {
  id: string;
  title: string;
  icon: "activity" | "globe" | "list-todo" | "gauge" | "prototype";
  order?: number;
  renderPanel: (snapshot: CustomDockThreadSnapshot) => ReactNode;
  renderComposerBar?: (snapshot: CustomDockThreadSnapshot) => ReactNode;
};
export type ExternalWebPanelConfig = {
  id: string;
  title: string;
  url: string;
  sendReadonlySnapshot: boolean;
};
export interface RunHistory {
  list(scope: ThreadMeta): Promise<readonly RunSummary[]>;
  put(scope: ThreadMeta, summary: RunSummary): Promise<void>;
}
export type ReadThreadStructure = (scope: ThreadMeta) => ThreadStructure | null;
