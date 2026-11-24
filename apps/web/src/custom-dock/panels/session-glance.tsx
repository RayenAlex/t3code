import { Tabs } from "@base-ui/react/tabs";
import { secondTick, toServerClock } from "@t3tools/client-runtime/clock";
import type { EnvironmentId } from "@t3tools/contracts";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/shell";
import { isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";
import { useMessages } from "gt-react";
import {
  Activity,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  FileCode2,
  GitCompare,
  ListTodo,
  Timer,
} from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { Button } from "../../components/ui/button";
import { tickTextContent } from "../../lib/tickTextContent";
import { useRightPanelStore } from "../../rightPanelStore";
import { computePlanProgress, type LiveActivityAction } from "../core/plans";
import type { LiveOutputProgress } from "../core/threadObserver";
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
  environmentId,
}: {
  readonly elapsedMs: number;
  readonly startedAtMs: number | null;
  readonly environmentId?: EnvironmentId;
}) {
  const messages = useMessages();
  return (
    <span
      className="tabular-nums"
      ref={tickTextContent(
        (now) =>
          formatWorkingDurationLabel(
            startedAtMs === null
              ? elapsedMs
              : Math.max(
                  0,
                  (environmentId === undefined ? now : toServerClock(environmentId, now)) -
                    startedAtMs,
                ),
            messages,
          ),
        startedAtMs !== null,
      )}
    >
      {formatWorkingDurationLabel(elapsedMs, messages)}
    </span>
  );
}

function providerRateAt(
  progress: LiveOutputProgress | null,
  environmentId: EnvironmentId | undefined,
  nowMs: number,
): number | null {
  if (progress === null || progress.outputTokens <= 0) return null;
  const serverNow = environmentId === undefined ? nowMs : toServerClock(environmentId, nowMs);
  const elapsedMs = Math.max(
    progress.reportedAtMs - progress.startedAtMs,
    serverNow - progress.startedAtMs,
  );
  return elapsedMs >= 200 ? (progress.outputTokens * 1000) / elapsedMs : null;
}

function initialProviderRate(progress: LiveOutputProgress | null): number | null {
  if (progress === null || progress.outputTokens <= 0) return null;
  const elapsedMs = Math.max(0, progress.reportedAtMs - progress.startedAtMs);
  return elapsedMs >= 200 ? (progress.outputTokens * 1000) / elapsedMs : null;
}

function LiveRateLabel({
  progress,
  readLiveTps,
  environmentId,
  template,
  fallback,
}: {
  readonly progress: LiveOutputProgress | null;
  readonly readLiveTps?: ((nowMs: number) => number | null) | undefined;
  readonly environmentId?: EnvironmentId;
  readonly template: string;
  readonly fallback: string;
}) {
  const formatRate = (rate: number | null) =>
    rate === null ? fallback : template.replace("{value}", number(rate));
  const initial = initialProviderRate(progress);
  return (
    <span
      className="tabular-nums"
      ref={tickTextContent((nowMs) => {
        const rate = readLiveTps
          ? readLiveTps(nowMs)
          : providerRateAt(progress, environmentId, nowMs);
        return formatRate(rate);
      }, true)}
    >
      {formatRate(initial)}
    </span>
  );
}

function LiveFooterRate({
  separated,
  progress,
  readLiveTps,
  environmentId,
  template,
  ariaLabel,
}: {
  readonly separated: boolean;
  readonly progress: LiveOutputProgress | null;
  readonly readLiveTps?: ((nowMs: number) => number | null) | undefined;
  readonly environmentId?: EnvironmentId;
  readonly template: string;
  readonly ariaLabel: string;
}) {
  const initial = initialProviderRate(progress);
  const initialText = initial === null ? "" : template.replace("{value}", number(initial));
  return (
    <span
      className="hidden shrink-0 @xs/dock-bar:inline-flex"
      aria-label={ariaLabel}
      style={initialText === "" ? { display: "none" } : undefined}
      ref={(node) => {
        if (!node) return;
        const valueNode = node.querySelector("[data-live-rate-value]");
        const write = () => {
          const nowMs = Date.now();
          const rate = readLiveTps
            ? readLiveTps(nowMs)
            : providerRateAt(progress, environmentId, nowMs);
          const next = rate === null ? "" : template.replace("{value}", number(rate));
          node.style.display = next === "" ? "none" : "";
          if (valueNode && valueNode.textContent !== next) valueNode.textContent = next;
        };
        write();
        return secondTick.subscribe(write);
      }}
    >
      <FooterMetric separated={separated}>
        <span data-live-rate-value className="tabular-nums">
          {initialText}
        </span>
      </FooterMetric>
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

function LivePlanProgress({
  steps,
  runStartedAtMs,
  environmentId,
  label,
}: {
  readonly steps: DockSnapshot["plans"]["steps"];
  readonly runStartedAtMs: number | null;
  readonly environmentId?: EnvironmentId;
  readonly label?: ReactNode;
}) {
  const done = steps.filter((step) => step.stage === "Done").length;
  const total = steps.length;
  const isComplete = total > 0 && done === total;
  const isLive =
    runStartedAtMs !== null && !isComplete && steps.some((step) => step.stage === "Now");
  const initialPercent = total > 0 ? Math.round((100 * done) / total) : 0;
  return (
    <div
      className="space-y-1.5"
      ref={(node) => {
        if (!node) return;
        const pctNode = node.querySelector<HTMLElement>("[data-plan-percent]");
        const fillNode = node.querySelector<HTMLElement>("[data-plan-fill]");
        const barNode = node.querySelector<HTMLElement>("[role='progressbar']");
        const write = () => {
          const nowMs = Date.now();
          const serverNow =
            environmentId === undefined ? nowMs : toServerClock(environmentId, nowMs);
          const { overallPercent } = computePlanProgress({
            steps,
            runStartedAtMs,
            nowMs: serverNow,
          });
          const pct = isLive ? overallPercent : initialPercent;
          if (pctNode) pctNode.textContent = `${pct}%`;
          if (fillNode) fillNode.style.width = `${pct}%`;
          if (barNode) barNode.setAttribute("aria-valuenow", String(pct));
        };
        write();
        return isLive ? secondTick.subscribe(write) : undefined;
      }}
    >
      {label !== undefined && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {label}
          <span
            data-plan-percent
            className="shrink-0 font-mono text-2xs font-medium text-foreground tabular-nums"
          >
            {initialPercent}%
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={initialPercent}
        aria-label={`${done}/${total}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          data-plan-fill
          className={`h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none ${
            isComplete ? "bg-success-foreground" : "bg-info-foreground"
          }`}
          style={{ width: `${initialPercent}%` }}
        />
      </div>
    </div>
  );
}

function ActiveStepProgress({
  steps,
  stepId,
  runStartedAtMs,
  environmentId,
}: {
  readonly steps: DockSnapshot["plans"]["steps"];
  readonly stepId: string;
  readonly runStartedAtMs: number | null;
  readonly environmentId?: EnvironmentId;
}) {
  const isLive = runStartedAtMs !== null;
  return (
    <div
      className="mt-1 flex items-center gap-2"
      ref={(node) => {
        if (!node) return;
        const fillNode = node.querySelector<HTMLElement>("[data-step-fill]");
        const pctNode = node.querySelector<HTMLElement>("[data-step-percent]");
        const write = () => {
          const nowMs = Date.now();
          const serverNow =
            environmentId === undefined ? nowMs : toServerClock(environmentId, nowMs);
          const { stepPercents } = computePlanProgress({
            steps,
            runStartedAtMs,
            nowMs: serverNow,
          });
          const pct = stepPercents.get(stepId) ?? 0;
          if (fillNode) fillNode.style.width = `${Math.max(pct, 6)}%`;
          if (pctNode) pctNode.textContent = `${pct}%`;
        };
        write();
        return isLive ? secondTick.subscribe(write) : undefined;
      }}
    >
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          data-step-fill
          className="h-full rounded-full bg-warning-foreground transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: "6%" }}
        />
      </div>
      <span
        data-step-percent
        className="w-7 shrink-0 text-right font-mono text-3xs text-muted-foreground tabular-nums"
      >
        0%
      </span>
    </div>
  );
}

function formatLiveAction(
  action: LiveActivityAction | null,
  copy: ReturnType<typeof useDockCopy>,
): string | null {
  if (action === null) return null;
  switch (action.kind) {
    case "needs_you":
      return copy.needs_you;
    case "queued":
      return copy.actionQueued;
    case "starting":
      return copy.actionStarting;
    case "thinking":
      return copy.actionThinking;
    case "replying":
      return copy.actionReplying;
    case "command":
      return action.detail
        ? copy.actionCommand.replace("{detail}", action.detail)
        : copy.actionCommandBare;
    case "file_change":
      return action.detail
        ? copy.actionFileChange.replace("{detail}", action.detail)
        : copy.actionFileChangeBare;
    case "search":
      return action.detail
        ? copy.actionSearch.replace("{detail}", action.detail)
        : copy.actionSearchBare;
    case "tool":
      return action.detail
        ? copy.actionTool.replace("{detail}", action.detail)
        : copy.actionToolBare;
    case "subagent":
      return action.detail
        ? copy.actionSubagent.replace("{detail}", action.detail)
        : copy.actionSubagentBare;
  }
}

function carriedPlanLabel(
  plans: DockSnapshot["plans"],
  copy: ReturnType<typeof useDockCopy>,
): string | null {
  if (plans.todoScope !== "carried") return null;
  return plans.todoRunOrdinal !== null
    ? copy.todoCarried.replace("{count}", number(plans.todoRunOrdinal))
    : copy.todoCarriedGeneric;
}

function SessionGlanceBar() {
  const copy = useDockCopy();
  const { snapshot, runOrdinal, runStartedAtMs, readLiveTps } = useDockRuntime();
  const metrics = useStore(dockPreferences, (state) => state.visibleMetrics);
  if (!snapshot) return null;
  const { phase, liveAction } = snapshot.activity;
  const liveLabel = formatLiveAction(liveAction, copy);
  const Status =
    phase === "done"
      ? CircleCheck
      : phase === "error" || phase === "needs_you" || phase === "stuck"
        ? CircleAlert
        : CircleDot;
  const statusTone =
    phase === "done"
      ? "text-success-foreground"
      : phase === "error"
        ? "text-destructive-foreground"
        : phase === "needs_you" || phase === "stuck"
          ? "text-warning-foreground"
          : phase === "working"
            ? "text-info-foreground"
            : "text-muted-foreground";
  const steps = snapshot.plans.steps;
  const done = steps.filter((step) => step.stage === "Done").length;
  const run = snapshot.currentRun;
  const counters = run?.tokenUsage;
  const totalTokens =
    counters?.inputTokens != null && counters.outputTokens != null
      ? counters.inputTokens + counters.outputTokens
      : null;
  const liveOutput = runStartedAtMs !== null ? snapshot.liveOutputProgress : null;
  const showLiveRate =
    metrics.includes("output-rate") &&
    runStartedAtMs !== null &&
    (liveOutput !== null || readLiveTps !== undefined);
  const showSettledRate =
    metrics.includes("output-rate") && !showLiveRate && run?.turnAvgOutputTps != null;
  const showTokens = metrics.includes("tokens") && totalTokens !== null;
  const showCache = metrics.includes("cache") && run?.cacheHitRate != null;
  const contextWindow = snapshot.contextWindow;
  const showContext = metrics.includes("context") && contextWindow !== null;
  const usageState =
    run?.status === "pending"
      ? copy.pending
      : run?.isLocalCommandOnly
        ? copy.local
        : run?.status === "unavailable"
          ? copy.unavailable
          : null;
  const latestResponseTokens = snapshot.latestResponseTokens;
  const showLatestResponse =
    metrics.includes("tokens") && !showTokens && latestResponseTokens != null;
  const showUsageState =
    (metrics.includes("tokens") || metrics.includes("cache")) &&
    !showTokens &&
    !showCache &&
    !showLatestResponse;
  const showClock = runStartedAtMs !== null;
  const showPrimaryLiveAction = steps.length === 0 && liveLabel !== null;
  const showSecondaryLiveAction = steps.length > 0 && liveLabel !== null;
  const hasProgress = runOrdinal !== null || steps.length > 0 || liveLabel !== null;
  const showRightMetrics =
    showContext || showTokens || showCache || showLatestResponse || (showUsageState && usageState);
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <Status className={`size-3.5 shrink-0 ${statusTone}`} aria-hidden="true" />
        <span className={hasProgress ? "sr-only" : "truncate"}>{copy[phase]}</span>
        {runOrdinal !== null && (
          <span className="shrink-0">{copy.footerRun.replace("{count}", number(runOrdinal))}</span>
        )}
        {steps.length > 0 && (
          <FooterMetric separated={runOrdinal !== null}>
            {copy.footerSteps
              .replace("{done}", number(done))
              .replace("{total}", number(steps.length))}
          </FooterMetric>
        )}
        {showPrimaryLiveAction && (
          <FooterMetric separated={runOrdinal !== null}>{liveLabel}</FooterMetric>
        )}
        {showClock && (
          <FooterMetric separated={hasProgress}>
            <ClockLabel
              elapsedMs={run?.elapsedMs ?? 0}
              startedAtMs={runStartedAtMs}
              environmentId={snapshot.threadMeta.environmentId}
            />
          </FooterMetric>
        )}
        {showSecondaryLiveAction && (
          <span className="hidden min-w-0 @sm/dock-bar:inline-flex">
            <FooterMetric separated={hasProgress || showClock}>{liveLabel}</FooterMetric>
          </span>
        )}
        {showLiveRate && (
          <LiveFooterRate
            separated={hasProgress || showClock}
            progress={liveOutput}
            readLiveTps={readLiveTps}
            environmentId={snapshot.threadMeta.environmentId}
            template={copy.footerLiveRate}
            ariaLabel={`${copy.avgTps} · ${copy.liveRateHelp}`}
          />
        )}
        {showSettledRate && (
          <span
            className="hidden shrink-0 @xs/dock-bar:inline-flex"
            aria-label={`${copy.avgTps} · ${copy.wallTime}`}
          >
            <FooterMetric separated={hasProgress || showClock}>
              {copy.footerRate.replace("{value}", number(run.turnAvgOutputTps))}
            </FooterMetric>
          </span>
        )}
      </span>
      {showRightMetrics && (
        <span className="flex min-w-0 max-w-3/5 shrink-0 items-center justify-end gap-1.5 whitespace-nowrap">
          {showContext && <FooterContextMetric context={contextWindow} />}
          {showTokens && (
            <FooterMetric separated={showContext}>
              {(run?.status === "partial" ? copy.footerReportedTokens : copy.footerTokens).replace(
                "{value}",
                COMPACT.format(totalTokens),
              )}
            </FooterMetric>
          )}
          {showCache && (
            <span
              className={
                showContext || showTokens ? "hidden shrink-0 @xs/dock-bar:inline-flex" : "shrink-0"
              }
            >
              <FooterMetric separated={showContext || showTokens}>
                {copy.footerCache.replace("{value}", percent(run.cacheHitRate))}
              </FooterMetric>
            </span>
          )}
          {showLatestResponse && (
            <FooterMetric separated={showContext}>
              {copy.footerLatestResponse.replace("{value}", COMPACT.format(latestResponseTokens))}
            </FooterMetric>
          )}
          {showUsageState && usageState && (
            <FooterMetric separated={showContext}>{usageState}</FooterMetric>
          )}
        </span>
      )}
    </>
  );
}

function FooterContextMetric({
  context,
}: {
  readonly context: NonNullable<DockSnapshot["contextWindow"]>;
}) {
  const copy = useDockCopy();
  const pct =
    context.usedPercentage === null ? null : Math.min(100, Math.max(0, context.usedPercentage));
  const isCritical = pct !== null && pct >= 90;
  const isWarning =
    !isCritical &&
    ((pct !== null && pct >= 75) ||
      (context.autoCompactThreshold !== null &&
        context.usedTokens >= context.autoCompactThreshold));
  const textTone = isCritical
    ? "text-destructive-foreground"
    : isWarning
      ? "text-warning-foreground"
      : undefined;
  const fillTone = isCritical
    ? "bg-destructive-foreground"
    : isWarning
      ? "bg-warning-foreground"
      : "bg-primary";
  const detail =
    context.maxTokens !== null && pct !== null
      ? `${copy.context} ${number(context.usedTokens)} / ${number(context.maxTokens)} (${percent(pct / 100)})`
      : `${copy.context} ${number(context.usedTokens)}`;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 tabular-nums ${textTone ?? ""}`}
      aria-label={detail}
    >
      {pct !== null && (
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-7 shrink-0 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={`block h-full rounded-full ${fillTone}`}
            style={{ width: `${Math.max(pct, pct > 0 ? 6 : 0)}%` }}
          />
        </span>
      )}
      <span>
        {pct !== null ? percent(pct / 100) : COMPACT.format(context.usedTokens)}
        {context.maxTokens !== null && pct !== null && (
          <span className="hidden text-muted-foreground/80 @xs/dock-bar:inline">
            {" "}
            ({COMPACT.format(context.usedTokens)}/{COMPACT.format(context.maxTokens)})
          </span>
        )}
      </span>
    </span>
  );
}

function FooterMetric({
  separated,
  children,
}: {
  readonly separated?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {separated && (
        <span aria-hidden="true" className="opacity-55">
          ·
        </span>
      )}
      <span className="truncate">{children}</span>
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

const STEP_ICON = {
  Done: { Icon: Check, tone: "bg-foreground text-background" },
  Now: { Icon: CircleDot, tone: "text-warning-foreground" },
  Next: { Icon: Circle, tone: "text-muted-foreground" },
};

export function ComposerTaskPlan({
  snapshot,
  compact = false,
}: {
  readonly snapshot: DockSnapshot;
  readonly compact?: boolean;
}) {
  const copy = useDockCopy();
  const { runStartedAtMs } = useDockRuntime();
  const { plans, activity } = snapshot;
  const liveLabel = formatLiveAction(activity.liveAction, copy);
  const carriedLabel = carriedPlanLabel(plans, copy);
  const showActivityStrip =
    liveLabel !== null || activity.files.length > 0 || activity.toolCount > 0;
  const activityStrip = showActivityStrip ? (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/65 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Phase phase={activity.phase} />
      {liveLabel !== null && liveLabel !== copy[activity.phase] && (
        <span className="min-w-0 truncate text-foreground">{liveLabel}</span>
      )}
      {activity.toolCount > 0 && (
        <FooterMetric separated>
          {copy.summaryTools.replace("{count}", number(activity.toolCount))}
        </FooterMetric>
      )}
      {activity.files.length > 0 && (
        <FooterMetric separated>
          {copy.summaryFiles.replace("{count}", number(activity.files.length))}
        </FooterMetric>
      )}
    </div>
  ) : null;
  const pad = compact ? "px-3 py-2.5" : "px-4 py-3";
  if (plans.todoStatus === "not_provided")
    return (
      <div className={`space-y-2 ${pad} ${compact ? "text-xs" : "text-sm"} text-muted-foreground`}>
        {activityStrip}
        <p>{liveLabel !== null ? copy.todoWaiting : copy.todoNotProvided}</p>
      </div>
    );
  const done = plans.steps.filter((step) => step.stage === "Done").length;
  return (
    <div className={pad}>
      {activityStrip}
      <LivePlanProgress
        steps={plans.steps}
        runStartedAtMs={runStartedAtMs}
        environmentId={snapshot.threadMeta.environmentId}
        label={
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-mono tabular-nums">
              {done}/{plans.steps.length}
            </span>
            {carriedLabel !== null && <FooterMetric separated>{carriedLabel}</FooterMetric>}
            {plans.referenceEtaMs !== null && (
              <FooterMetric separated>
                {copy.eta}: <ClockLabel elapsedMs={plans.referenceEtaMs} startedAtMs={null} />
              </FooterMetric>
            )}
          </span>
        }
      />
      <ol className="mt-2 space-y-0.5">
        {plans.steps.map((step) => {
          const { Icon, tone } = STEP_ICON[step.stage];
          const anchor = step.durationAnchorAt === null ? null : Date.parse(step.durationAnchorAt);
          const activeClock =
            step.stage === "Now" &&
            runStartedAtMs !== null &&
            anchor !== null &&
            Number.isFinite(anchor)
              ? anchor
              : null;
          return (
            <li
              key={step.id}
              className={`flex items-start gap-2 ${compact ? "min-h-8 py-1" : "min-h-10 gap-2.5 py-1.5"}`}
            >
              <span
                className={`mt-0.5 grid shrink-0 place-items-center rounded-full ${compact ? "size-4" : "size-5"} ${tone}`}
              >
                <Icon
                  aria-hidden="true"
                  className={
                    step.stage === "Done"
                      ? compact
                        ? "size-2.5"
                        : "size-3"
                      : compact
                        ? "size-4"
                        : "size-5"
                  }
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 wrap-break-word font-medium ${compact ? "text-xs leading-snug" : "text-sm"}`}
                  >
                    <span className="sr-only">{copy[step.stage]}: </span>
                    {step.label}
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                    {step.durationMs !== null || activeClock !== null ? (
                      <ClockLabel elapsedMs={step.durationMs ?? 0} startedAtMs={activeClock} />
                    ) : (
                      copy[step.stage]
                    )}
                  </span>
                </div>
                {step.stage === "Now" && (
                  <ActiveStepProgress
                    steps={plans.steps}
                    stepId={step.id}
                    runStartedAtMs={runStartedAtMs}
                    environmentId={snapshot.threadMeta.environmentId}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
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
  const { cwd, runStartedAtMs } = useDockRuntime();
  const { plans, activity, threadMeta } = snapshot;
  const done = plans.steps.filter((step) => step.stage === "Done").length;
  const referenceEtaMs = plans.referenceEtaMs;
  const proposed = plans.proposedPlan;
  const liveLabel = formatLiveAction(activity.liveAction, copy);
  const carriedLabel = carriedPlanLabel(plans, copy);
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
        {liveLabel !== null && liveLabel !== copy[activity.phase] && (
          <p className="truncate text-xs text-muted-foreground">{liveLabel}</p>
        )}
        {plans.todoStatus === "provided" ? (
          <>
            {carriedLabel !== null && (
              <p className="text-2xs text-muted-foreground">{carriedLabel}</p>
            )}
            <LivePlanProgress
              steps={plans.steps}
              runStartedAtMs={runStartedAtMs}
              environmentId={threadMeta.environmentId}
              label={
                <span className="font-mono tabular-nums">
                  {done}/{plans.steps.length}
                </span>
              }
            />
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
            <p>{liveLabel !== null ? copy.todoWaiting : copy.todoNotProvided}</p>
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
  const { runStartedAtMs, readLiveTps } = useDockRuntime();
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
            {run ? (
              <ClockLabel
                elapsedMs={run.elapsedMs}
                startedAtMs={runStartedAtMs}
                environmentId={snapshot.threadMeta.environmentId}
              />
            ) : (
              DASH
            )}
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
          <Rate
            name={copy.avgTps}
            scope={
              runStartedAtMs !== null &&
              (snapshot.liveOutputProgress !== null || readLiveTps !== undefined)
                ? copy.liveRateHelp
                : copy.wallTime
            }
            value={run?.turnAvgOutputTps}
            live={
              runStartedAtMs !== null &&
              (snapshot.liveOutputProgress !== null || readLiveTps !== undefined) ? (
                <LiveRateLabel
                  progress={snapshot.liveOutputProgress}
                  readLiveTps={readLiveTps}
                  environmentId={snapshot.threadMeta.environmentId}
                  template="~{value}"
                  fallback={number(run?.turnAvgOutputTps)}
                />
              ) : null
            }
          />
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
  live,
}: {
  readonly name: string;
  readonly scope: string;
  readonly value: number | null | undefined;
  readonly live?: ReactNode;
}) {
  return (
    <div className="space-y-0.5 rounded-md bg-muted px-2 py-1.5">
      <p className="text-2xs font-medium">{name}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">{live ?? number(value)}</p>
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
