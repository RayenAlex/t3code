import { Tabs } from "@base-ui/react/tabs";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/shell";
import { isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";
import { useMessages } from "gt-react";
import { Activity, ChevronRight, FileCode2, GitCompare, ListTodo, Timer } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { Button } from "../../components/ui/button";
import { tickTextContent } from "../../lib/tickTextContent";
import { useRightPanelStore } from "../../rightPanelStore";
import { DockTab, DockTabList } from "../host/DockTabs";
import {
  dockPreferences,
  useDockCopy,
  useDockRuntime,
  type DockSnapshot,
} from "../host/panelContext";
import type {
  CustomDockPanelDefinition,
  PlanStep,
  RunTelemetry,
  TokenCounters,
} from "../host/types";
import en from "../copy/en.json";
import { SessionGlanceCharts } from "./session-glance-charts";

const Markdown = lazy(() => import("../../components/ChatMarkdown"));
const STAGES = ["Done", "Now", "Next"] as const;
// oxlint-disable-next-line t3code/no-em-dash-copy -- the telemetry contract uses this glyph for a missing metric, not punctuation in copy
const DASH = "\u2014";
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const PHASE = {
  needs_you: "bg-warning-foreground",
  error: "bg-destructive-foreground",
  stuck: "bg-warning-foreground",
  working: "bg-info-foreground",
  background: "bg-guest-foreground",
  done: "bg-success-foreground",
  idle: "bg-muted-foreground",
};
const SEGMENTS = [
  ["cachedInputTokens", "cacheRead", "var(--chart-2,var(--success-foreground))"],
  ["cacheWriteInputTokens", "cacheWrite", "var(--chart-3,var(--warning-foreground))"],
  ["uncachedInputTokens", "uncached", "var(--chart-4,var(--info-foreground))"],
  ["outputTokens", "output", "var(--chart-5,var(--guest-foreground))"],
] as const;

function number(value: number | null | undefined) {
  return value == null ? DASH : NUMBER.format(value);
}

function percent(value: number | null | undefined) {
  return value == null ? DASH : PERCENT.format(value);
}

function ClockLabel({
  elapsedMs,
  startedAtMs,
}: {
  readonly elapsedMs: number;
  readonly startedAtMs: number | null;
}) {
  const messages = useMessages();
  return (
    <span
      className="tabular-nums"
      ref={tickTextContent(
        (now) =>
          formatWorkingDurationLabel(
            startedAtMs === null ? elapsedMs : Math.max(0, now - startedAtMs),
            messages,
          ),
        startedAtMs !== null,
      )}
    >
      {formatWorkingDurationLabel(elapsedMs, messages)}
    </span>
  );
}

function Phase({ phase }: { readonly phase: DockSnapshot["activity"]["phase"] }) {
  const copy = useDockCopy();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium">
      <span className={`size-1.5 rounded-full ${PHASE[phase]}`} />
      {copy[phase]}
    </span>
  );
}

function Progress({ done, total }: { readonly done: number; readonly total: number }) {
  return (
    <progress
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-success-foreground [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-success-foreground"
      max={Math.max(1, total)}
      value={done}
      aria-label={`${done}/${total}`}
    />
  );
}

function SessionGlanceBar() {
  const copy = useDockCopy();
  const { snapshot, runStartedAtMs } = useDockRuntime();
  const metrics = useStore(dockPreferences, (state) => state.visibleMetrics);
  if (!snapshot) return null;
  const steps = snapshot.plans.steps;
  const done = steps.filter((step) => step.stage === "Done").length;
  const active =
    steps.find((step) => step.stage === "Now")?.label ??
    snapshot.activity.activeTool ??
    copy[snapshot.activity.phase];
  const run = snapshot.currentRun;
  const ctx = snapshot.contextWindow;
  const ctxLabel =
    ctx &&
    (ctx.usedPercentage === null
      ? COMPACT.format(ctx.usedTokens)
      : percent(ctx.usedPercentage / 100));
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <Phase phase={snapshot.activity.phase} />
        {steps.length > 0 && (
          <span
            className="flex shrink-0 items-center gap-1.5 font-mono text-3xs text-muted-foreground"
            aria-label={copy.plan}
          >
            <span className="hidden w-8 sm:inline-flex">
              <Progress done={done} total={steps.length} />
            </span>
            {done}/{steps.length}
          </span>
        )}
        <span className="truncate text-muted-foreground" aria-label={active}>
          {active}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 font-mono text-3xs text-muted-foreground lg:flex">
        {metrics.includes("context") && ctxLabel && (
          <MetricPill help={copy.context}>
            {copy.contextShort} {ctxLabel}
          </MetricPill>
        )}
        {metrics.includes("elapsed") && run && (
          <MetricPill help={copy.wallTime}>
            <ClockLabel elapsedMs={run.elapsedMs} startedAtMs={runStartedAtMs} />
          </MetricPill>
        )}
        {metrics.includes("tokens") && run && (
          <MetricPill help={copy.tokens}>
            {run.status === "pending" ? copy.pending : number(run.tokenUsage?.outputTokens)}
          </MetricPill>
        )}
        {metrics.includes("cache") && run && (
          <MetricPill help={copy.cache}>{percent(run.cacheHitRate)}</MetricPill>
        )}
        {metrics.includes("output-rate") && run && (
          <MetricPill help={`${copy.avgTps} · ${copy.wallTime}`}>
            {run.turnAvgOutputTps === null ? DASH : `${number(run.turnAvgOutputTps)} TPS`}
          </MetricPill>
        )}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

function MetricPill({ help, children }: { readonly help: string; readonly children: ReactNode }) {
  return (
    <span aria-label={help} className="rounded-md bg-muted px-1.5 py-0.5 whitespace-nowrap">
      {children}
    </span>
  );
}

function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-xl border border-border bg-card p-3">
      <h3 className="text-xs font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Measure({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{name}</dt>
      <dd className="shrink-0 text-right font-mono text-xs font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function TodoStep({
  item,
  index,
  live,
}: {
  readonly item: PlanStep;
  readonly index: number;
  readonly live: boolean;
}) {
  const anchor = item.durationAnchorAt === null ? null : Date.parse(item.durationAnchorAt);
  const ticking =
    item.stage === "Now" && live && anchor != null && Number.isFinite(anchor) ? anchor : null;
  return (
    <li className="flex items-baseline gap-2.5 rounded-md py-1.5 text-xs">
      <span className="w-3 shrink-0 font-mono text-3xs text-muted-foreground">{index + 1}</span>
      <span className="min-w-0 flex-1 wrap-break-word">{item.label}</span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
        {item.durationMs !== null || ticking !== null ? (
          <ClockLabel elapsedMs={item.durationMs ?? 0} startedAtMs={ticking} />
        ) : (
          DASH
        )}
      </span>
    </li>
  );
}

function TodoPanel({
  snapshot,
  details,
}: {
  readonly snapshot: DockSnapshot;
  readonly details: boolean;
}) {
  const copy = useDockCopy();
  const { claude, cwd, runStartedAtMs } = useDockRuntime();
  const { plans, activity, threadMeta } = snapshot;
  const done = plans.steps.filter((step) => step.stage === "Done").length;
  const referenceEtaMs = plans.referenceEtaMs;
  const proposed = plans.proposedPlan;
  return (
    <div className="space-y-2.5">
      <Card title={copy.plan}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <Phase phase={activity.phase} />
          {plans.todoStatus === "provided" && (
            <span className="font-mono text-muted-foreground">
              {done}/{plans.steps.length}
            </span>
          )}
        </div>
        {plans.todoStatus === "provided" ? (
          <>
            <Progress done={done} total={plans.steps.length} />
            <p aria-description={copy.etaHelp} className="text-2xs text-muted-foreground">
              {copy.eta}:{" "}
              {referenceEtaMs === null ? (
                DASH
              ) : (
                <ClockLabel elapsedMs={referenceEtaMs} startedAtMs={null} />
              )}
            </p>
          </>
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{copy.todoNotProvided}</p>
            {claude && (
              <p>
                {copy.claudeTodoHelp}{" "}
                <code className="wrap-anywhere">CLAUDE_CODE_ENABLE_TODO_TOOLS=1</code>
              </p>
            )}
          </div>
        )}
      </Card>
      {plans.todoStatus === "provided" && (
        <Card title={copy.plan}>
          {STAGES.map((stage) => {
            const steps = plans.steps.filter((step) => step.stage === stage);
            return (
              <div key={stage}>
                <h4 className="flex items-center gap-1.5 border-b border-border pb-1 text-xs font-semibold text-muted-foreground">
                  {copy[stage]} <span className="font-mono text-3xs">{steps.length}</span>
                </h4>
                {steps.length === 0 ? (
                  <span className="py-1 text-xs text-muted-foreground">{DASH}</span>
                ) : (
                  <ol>
                    {steps.map((item, index) => (
                      <TodoStep
                        key={item.id}
                        item={item}
                        index={index}
                        live={runStartedAtMs !== null}
                      />
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </Card>
      )}
      {proposed && (
        <details className="rounded-xl border border-border px-3 py-2.5">
          <summary className="cursor-pointer text-xs font-semibold">{copy.proposedPlan}</summary>
          <div className="mt-3 text-xs">
            <Suspense fallback={null}>
              <Markdown
                text={proposed.markdown}
                cwd={cwd}
                parseRawHtml={false}
                renderInsights={false}
              />
            </Suspense>
          </div>
        </details>
      )}
      {(details || activity.files.length > 0) && (
        <Card title={copy.changes}>
          {activity.files.length === 0 ? (
            <p className="text-xs text-muted-foreground">{DASH}</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {activity.files.map((file) => {
                  const relative = isAbsolutePath(file.path)
                    ? workspaceRelativeFilePath(file.path, cwd)
                    : file.path;
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        disabled={relative === null}
                        className="flex w-full items-center gap-1.5 rounded-md py-1.5 text-left text-xs outline-none enabled:hover:bg-muted focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-75"
                        onClick={() => {
                          if (relative === null) return;
                          dockPreferences.getState().setDrawerOpen(false);
                          useRightPanelStore.getState().openFile(threadMeta, relative);
                        }}
                        aria-label={relative ?? file.path}
                      >
                        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {relative ?? file.path}
                        </span>
                        {file.additions !== undefined && (
                          <span className="shrink-0 font-mono text-3xs text-success-foreground">
                            +{file.additions}
                          </span>
                        )}
                        {file.deletions !== undefined && (
                          <span className="shrink-0 font-mono text-3xs text-destructive-foreground">
                            −{file.deletions}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  dockPreferences.getState().setDrawerOpen(false);
                  useRightPanelStore.getState().open(threadMeta, "diff");
                }}
              >
                <GitCompare />
                {copy.openDiff}
              </Button>
            </>
          )}
        </Card>
      )}
      {(details || activity.subagents.length > 0) && (
        <Card title={copy.subagents}>
          {activity.subagents.length === 0 ? (
            <p className="text-xs text-muted-foreground">{DASH}</p>
          ) : (
            <ul className="space-y-1">
              {activity.subagents.map((agent) => (
                <li key={agent.id}>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={agent.childThreadId === null && agent.remoteChild === undefined}
                    onClick={() => {
                      dockPreferences.getState().setDrawerOpen(false);
                      if (agent.childThreadId)
                        useRightPanelStore.getState().openThread(threadMeta, agent.childThreadId);
                      else if (agent.remoteChild)
                        useRightPanelStore.getState().openLinkedThread(threadMeta, {
                          ...agent.remoteChild,
                          viaEnvironmentId: threadMeta.environmentId,
                          label: agent.remoteChild.label,
                          title: agent.remoteChild.title ?? agent.name,
                        });
                    }}
                  >
                    {agent.name ?? copy.subagent}
                    <ChevronRight />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-2xs text-muted-foreground">
        <span>{copy.verification}</span>
        <span
          className={
            activity.verification === "passed"
              ? "font-medium text-success-foreground"
              : activity.verification === "failed"
                ? "font-medium text-destructive-foreground"
                : "font-medium"
          }
        >
          {copy[activity.verification]}
        </span>
      </div>
    </div>
  );
}

function TokenBreakdown({
  counters,
  more,
}: {
  readonly counters: TokenCounters;
  readonly more: boolean;
}) {
  const copy = useDockCopy();
  const known = SEGMENTS.flatMap(([key, label, color]) =>
    counters[key] == null ? [] : [{ label, color, value: counters[key] }],
  );
  const total = known.reduce((sum, row) => sum + row.value, 0);
  return (
    <>
      {total > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {known.map((row) => (
            <span
              key={row.label}
              style={{ backgroundColor: row.color, width: `${(row.value / total) * 100}%` }}
            />
          ))}
        </div>
      )}
      <dl className="space-y-1.5">
        <Measure name={copy.input}>{number(counters.inputTokens)}</Measure>
        {SEGMENTS.map(([key, label, color]) => (
          <Measure key={key} name={copy[label]}>
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />{" "}
            {number(counters[key])}
          </Measure>
        ))}
        {(more || counters.reasoningOutputTokens !== null) && (
          <Measure name={copy.reasoning}>{number(counters.reasoningOutputTokens)}</Measure>
        )}
      </dl>
    </>
  );
}

function OtherUsage({ rows }: { readonly rows: RunTelemetry["otherUsage"] }) {
  const copy = useDockCopy();
  const usage = rows.reduce<{ input: number; output: number }>(
    (totals, row) => {
      if (
        typeof row !== "object" ||
        !row ||
        !("inputTokens" in row) ||
        !("outputTokens" in row) ||
        typeof row.inputTokens !== "number" ||
        typeof row.outputTokens !== "number"
      )
        return totals;
      return { input: totals.input + row.inputTokens, output: totals.output + row.outputTokens };
    },
    { input: 0, output: 0 },
  );
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1.5 border-t border-border pt-2">
      <h4 className="text-2xs font-medium text-muted-foreground">{copy.otherUsage}</h4>
      <dl className="space-y-1">
        <Measure name={copy.input}>{number(usage.input)}</Measure>
        <Measure name={copy.output}>{number(usage.output)}</Measure>
      </dl>
    </section>
  );
}

function TelemetryPanel({
  snapshot,
  details,
}: {
  readonly snapshot: DockSnapshot;
  readonly details: boolean;
}) {
  const copy = useDockCopy();
  const { runStartedAtMs } = useDockRuntime();
  const context = snapshot.contextWindow;
  const run = snapshot.currentRun;
  const local =
    run && (run.isLocalCommandOnly || ("localCommand" in run && run.localCommand === true));
  return (
    <div className="space-y-2.5">
      <Card title={copy.context}>
        {context ? (
          <>
            <p className="flex items-baseline justify-between gap-2 text-sm font-semibold tabular-nums">
              <span>
                {number(context.usedTokens)}
                {context.maxTokens !== null && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}
                    / {number(context.maxTokens)}
                  </span>
                )}
              </span>
              {context.usedPercentage !== null && (
                <span className="text-xs font-medium text-muted-foreground">
                  {percent(context.usedPercentage / 100)}
                </span>
              )}
            </p>
            {context.maxTokens !== null && context.usedPercentage !== null && (
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${context.usedPercentage}%` }}
                />
                {context.autoCompactThreshold !== null && (
                  <span
                    aria-label={copy.compactThreshold}
                    className="absolute inset-y-0 w-0.5 bg-warning-foreground"
                    style={{
                      left: `${Math.min(99, (context.autoCompactThreshold / context.maxTokens) * 100)}%`,
                    }}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{DASH}</p>
        )}
      </Card>
      <Card title={copy.elapsed}>
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">
            {run ? <ClockLabel elapsedMs={run.elapsedMs} startedAtMs={runStartedAtMs} /> : DASH}
          </span>
          <span className="text-2xs text-muted-foreground">{copy.wallTime}</span>
        </p>
        {run && (
          <dl className="space-y-1.5">
            {run.queueMs !== null && run.queueMs > 1000 && (
              <Measure name={copy.queue}>
                <ClockLabel elapsedMs={run.queueMs} startedAtMs={null} />
              </Measure>
            )}
            <Measure name={copy.userWait}>
              <ClockLabel elapsedMs={run.waitingUserMs} startedAtMs={null} />
            </Measure>
            <Measure name={copy.tools}>
              <ClockLabel elapsedMs={run.toolMs} startedAtMs={null} />
            </Measure>
          </dl>
        )}
      </Card>
      <Card title={copy.tokens}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-muted-foreground">{run ? copy[run.status] : DASH}</p>
          <span
            aria-label={copy.cache}
            className="font-mono text-xs font-semibold text-success-foreground"
          >
            {percent(run?.cacheHitRate)}
          </span>
        </div>
        {local && <p className="text-xs text-muted-foreground">{copy.local}</p>}
        {run?.tokenUsage && <TokenBreakdown counters={run.tokenUsage} more={details} />}
        {run && <OtherUsage rows={run.otherUsage} />}
      </Card>
      <Card title={copy["output-rate"]}>
        <div className="grid grid-cols-2 gap-2" aria-description={copy.rateHelp}>
          <Rate name={copy.avgTps} scope={copy.wallTime} value={run?.turnAvgOutputTps} />
          <Rate name={copy.activeTps} scope={copy.activeTime} value={run?.activeOutputTps} />
        </div>
      </Card>
      <SessionGlanceCharts runs={snapshot.recentRuns} />
    </div>
  );
}

function Rate({
  name,
  scope,
  value,
}: {
  readonly name: string;
  readonly scope: string;
  readonly value: number | null | undefined;
}) {
  return (
    <div className="space-y-0.5 rounded-md bg-muted px-2 py-1.5">
      <p className="text-2xs font-medium">{name}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">{number(value)}</p>
      <p className="text-3xs leading-snug text-muted-foreground">{scope}</p>
    </div>
  );
}

function SessionGlancePanel() {
  const copy = useDockCopy();
  const { snapshot } = useDockRuntime();
  const [details, setDetails] = useState(false);
  if (!snapshot) return null;
  return (
    <section aria-label={copy.glance} className="p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Activity className="size-3.5 text-primary" />
          {copy.glance}
        </h3>
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={details}
          onClick={() => setDetails((value) => !value)}
        >
          {details ? copy.details : copy.compact}
        </Button>
      </div>
      <Tabs.Root defaultValue="plan">
        <DockTabList aria-label={copy.glance}>
          <DockTab value="plan">
            <ListTodo className="size-3.5" />
            {copy.plan}
          </DockTab>
          <DockTab value="telemetry">
            <Timer className="size-3.5" />
            {copy.telemetry}
          </DockTab>
        </DockTabList>
        <Tabs.Panel value="plan" className="mt-2.5 outline-none">
          <TodoPanel snapshot={snapshot} details={details} />
        </Tabs.Panel>
        <Tabs.Panel value="telemetry" className="mt-2.5 outline-none">
          <TelemetryPanel snapshot={snapshot} details={details} />
        </Tabs.Panel>
      </Tabs.Root>
    </section>
  );
}

export const panelDefinition: CustomDockPanelDefinition = {
  id: "session-glance",
  title: en.glance,
  icon: "activity",
  order: 10,
  renderPanel: () => <SessionGlancePanel />,
  renderComposerBar: () => <SessionGlanceBar />,
};
