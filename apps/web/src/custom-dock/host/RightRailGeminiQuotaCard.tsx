import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { ArrowUpRight, Gauge, RefreshCw } from "lucide-react";
import { useMessages } from "gt-react";

import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { GeminiQuotaCardState, GeminiQuotaWindowState } from "../core/geminiQuota";
import { useDockCopy } from "./panelContext";

// oxlint-disable-next-line t3code/no-em-dash-copy -- missing metric indicator matching Session Glance
const DASH = "\u2014";

function valueToneClass(tone: GeminiQuotaWindowState["tone"] | null): string {
  if (tone === "error") return "text-destructive-foreground";
  if (tone === "warning") return "text-warning-foreground";
  if (tone === "normal") return "text-foreground";
  return "text-muted-foreground";
}

function fillToneClass(tone: GeminiQuotaWindowState["tone"]): string {
  if (tone === "error") return "bg-destructive-foreground";
  if (tone === "warning") return "bg-warning-foreground";
  return "";
}

function QuotaProgressRow({
  label,
  windowState,
  accentColor,
  now,
}: {
  readonly label: string;
  readonly windowState: GeminiQuotaWindowState | null;
  readonly accentColor: string;
  readonly now: number;
}) {
  const copy = useDockCopy();
  const messages = useMessages();
  const resetsIn = windowState ? formatResetsIn(windowState.window, now, messages, "refill") : null;
  const remainingText = windowState
    ? copy.quotaRemaining.replace("{value}", String(windowState.remainingPercent))
    : DASH;
  const tooltip = windowState
    ? [
        copy.quotaRowTooltip
          .replace("{label}", label)
          .replace("{remaining}", String(windowState.remainingPercent))
          .replace("{used}", String(windowState.usedPercent)),
        resetsIn,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ")
    : label;

  return (
    <Tooltip>
      <TooltipTrigger render={<div className="space-y-1" />}>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-medium text-foreground/90">{label}</span>
            {resetsIn && (
              <span className="truncate text-2xs text-muted-foreground tabular-nums">
                {resetsIn}
              </span>
            )}
          </span>
          <span
            className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${valueToneClass(windowState?.tone ?? null)}`}
          >
            {remainingText}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={windowState?.remainingPercent ?? 0}
          aria-valuetext={remainingText}
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {windowState && windowState.remainingPercent > 0 && (
            <span
              className={`absolute inset-y-0 left-0 rounded-full ${fillToneClass(windowState.tone)}`}
              style={{
                width: `${windowState.remainingPercent}%`,
                ...(windowState.tone === "normal" ? { backgroundColor: accentColor } : {}),
              }}
            />
          )}
          {windowState && windowState.paceRemainingPercent !== null && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/65"
              style={{
                left: `clamp(1px, ${windowState.paceRemainingPercent}%, calc(100% - 1px))`,
              }}
            />
          )}
        </div>
      </TooltipTrigger>
      <TooltipPopup side="left" sideOffset={12}>
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

export function RightRailGeminiQuotaCard({
  card,
  now,
  refreshing,
  onRefresh,
  onOpenUsage,
}: {
  readonly card: GeminiQuotaCardState;
  readonly now: number;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onOpenUsage: () => void;
}) {
  const copy = useDockCopy();
  return (
    <TooltipProvider>
      <section
        data-custom-dock-gemini-quota="inline"
        aria-label={copy.geminiQuota}
        className="dropdown-glass pointer-events-auto shrink-0 overflow-hidden rounded-2xl border border-border/75 bg-card/95 text-card-foreground shadow-sm"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            <Gauge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{copy.geminiQuota}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex max-w-24 shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground" />
                }
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: card.accentColor }}
                  aria-hidden="true"
                />
                <span className="truncate">{card.accountLabel}</span>
              </TooltipTrigger>
              <TooltipPopup side="left" sideOffset={12}>
                {card.email ?? card.accountLabel}
              </TooltipPopup>
            </Tooltip>
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={refreshing}
                    aria-label={copy.refreshQuota}
                    onClick={onRefresh}
                  />
                }
              >
                <RefreshCw aria-hidden="true" className={refreshing ? "opacity-45" : undefined} />
              </TooltipTrigger>
              <TooltipPopup side="top">{copy.refreshQuota}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={copy.openUsage}
                    onClick={onOpenUsage}
                  />
                }
              >
                <ArrowUpRight aria-hidden="true" />
              </TooltipTrigger>
              <TooltipPopup side="top">{copy.openUsage}</TooltipPopup>
            </Tooltip>
          </div>
        </header>
        <div className="px-3 py-2.5">
          {card.status === "ready" ? (
            <div className="space-y-2.5">
              <QuotaProgressRow
                label={copy.quotaFiveHour}
                windowState={card.fiveHour}
                accentColor={card.accentColor}
                now={now}
              />
              <QuotaProgressRow
                label={copy.quotaWeekly}
                windowState={card.weekly}
                accentColor={card.accentColor}
                now={now}
              />
            </div>
          ) : (
            <p className="text-xs leading-snug text-muted-foreground">
              {card.message ?? copy.quotaUnavailable}
            </p>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
