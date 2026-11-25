import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  type LimitPace,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { limitsNotice } from "@t3tools/shared/usageLimitsCopy";

import { resolveThreadDetailsLimits } from "../../components/chat/ThreadDetailsUsage.logic";

const FIVE_HOUR_MINS = 5 * 60;
const WEEKLY_MINS = 7 * 24 * 60;
const ANTIGRAVITY_DEFAULT_COLOR = "#8c7bd1";

export type GeminiQuotaTone = "normal" | "warning" | "error";

export interface GeminiQuotaWindowState {
  readonly window: ServerProviderUsageWindow;
  readonly remainingPercent: number;
  readonly usedPercent: number;
  readonly paceRemainingPercent: number | null;
  readonly pace: LimitPace | null;
  readonly tone: GeminiQuotaTone;
}

export type GeminiQuotaCardState =
  | {
      readonly status: "ready";
      readonly instanceId: ProviderInstanceId;
      readonly accountLabel: string;
      readonly email: string | null;
      readonly accentColor: string;
      readonly checkedAt: string;
      readonly fiveHour: GeminiQuotaWindowState | null;
      readonly weekly: GeminiQuotaWindowState | null;
    }
  | {
      readonly status: "unavailable";
      readonly instanceId: ProviderInstanceId;
      readonly accountLabel: string;
      readonly email: string | null;
      readonly accentColor: string;
      readonly message: string | null;
    };

type GeminiFamily = "default" | "argon" | "carbon";

function modelGeminiFamily(model: string | null): GeminiFamily {
  const base = model?.slice(model.lastIndexOf("/") + 1).toLowerCase() ?? "";
  if (!base.startsWith("gemini")) return "default";
  if (base.includes("argon")) return "argon";
  if (base.includes("carbon")) return "carbon";
  return "default";
}

function windowGeminiFamily(id: string): GeminiFamily | null {
  const lower = id.toLowerCase();
  if (!lower.startsWith("gemini")) return null;
  if (lower.includes("argon")) return "argon";
  if (lower.includes("carbon")) return "carbon";
  return "default";
}

function isFiveHourWindow(window: ServerProviderUsageWindow): boolean {
  return (
    window.kind === "session" ||
    window.windowDurationMins === FIVE_HOUR_MINS ||
    window.id.toLowerCase().endsWith("-5h")
  );
}

function isWeeklyWindow(window: ServerProviderUsageWindow): boolean {
  return (
    window.kind === "weekly" ||
    window.windowDurationMins === WEEKLY_MINS ||
    window.id.toLowerCase().endsWith("-weekly")
  );
}

function pickGeminiWindow(
  windows: readonly ServerProviderUsageWindow[],
  preferredFamily: GeminiFamily,
  matchesCadence: (window: ServerProviderUsageWindow) => boolean,
): ServerProviderUsageWindow | null {
  const candidates = windows.filter(
    (window) => windowGeminiFamily(window.id) !== null && matchesCadence(window),
  );
  if (candidates.length === 0) return null;
  return (
    candidates.find((window) => windowGeminiFamily(window.id) === preferredFamily) ??
    candidates.find((window) => windowGeminiFamily(window.id) === "default") ??
    candidates[0] ??
    null
  );
}

export function toQuotaWindowState(
  window: ServerProviderUsageWindow,
  now: number,
): GeminiQuotaWindowState {
  const remaining = remainingPercent(window);
  const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  return {
    window,
    remainingPercent: remaining,
    usedPercent: used,
    paceRemainingPercent: paceRemainingPercent(window, now),
    pace: paceOf(window, now),
    tone: remaining <= 10 ? "error" : remaining <= 20 ? "warning" : "normal",
  };
}

function resolveWindowsFromLimits(
  limits: ServerProviderUsageLimits,
  preferredFamily: GeminiFamily,
  now: number,
): {
  readonly fiveHour: GeminiQuotaWindowState | null;
  readonly weekly: GeminiQuotaWindowState | null;
} {
  const fiveHour = pickGeminiWindow(limits.windows, preferredFamily, isFiveHourWindow);
  const weekly = pickGeminiWindow(limits.windows, preferredFamily, isWeeklyWindow);
  return {
    fiveHour: fiveHour ? toQuotaWindowState(fiveHour, now) : null,
    weekly: weekly ? toQuotaWindowState(weekly, now) : null,
  };
}

export function resolveGeminiQuotaCard(input: {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly now: number;
}): GeminiQuotaCardState | null {
  if (input.providerInstanceId === null) return null;
  const provider = input.providers.find((entry) => entry.instanceId === input.providerInstanceId);
  if (!provider) return null;

  const hasGeminiWindow = (provider.usageLimits?.windows ?? []).some(
    (window) => windowGeminiFamily(window.id) !== null,
  );
  if (provider.driver !== "antigravity" && !hasGeminiWindow) return null;

  const accountLabel = provider.displayName?.trim() || provider.auth.email?.trim() || "Antigravity";
  const email = provider.auth.email?.trim() || null;
  const accentColor =
    normalizeProviderAccentColor(provider.accentColor) ?? ANTIGRAVITY_DEFAULT_COLOR;
  const preferredFamily = modelGeminiFamily(input.model);

  const resolved = resolveThreadDetailsLimits(
    provider.instanceId,
    input.model,
    input.providers,
    input.sources,
    input.now,
  );

  if (resolved === null) {
    return {
      status: "unavailable",
      instanceId: provider.instanceId,
      accountLabel,
      email,
      accentColor,
      message: null,
    };
  }

  if (resolved.kind === "pool") {
    const poolWindows: ServerProviderUsageWindow[] = resolved.windows.map((window) => ({
      id: window.id,
      kind: window.kind,
      label: window.label,
      usedPercent: window.usedPercent,
      ...(window.resets[0]?.member.window.resetsAt
        ? { resetsAt: window.resets[0].member.window.resetsAt }
        : {}),
      ...(window.members[0]?.window.windowDurationMins !== undefined
        ? { windowDurationMins: window.members[0].window.windowDurationMins }
        : {}),
    }));
    const fiveHour = pickGeminiWindow(poolWindows, preferredFamily, isFiveHourWindow);
    const weekly = pickGeminiWindow(poolWindows, preferredFamily, isWeeklyWindow);
    if (fiveHour === null && weekly === null) {
      return {
        status: "unavailable",
        instanceId: provider.instanceId,
        accountLabel,
        email,
        accentColor,
        message: null,
      };
    }
    return {
      status: "ready",
      instanceId: provider.instanceId,
      accountLabel,
      email,
      accentColor,
      checkedAt: provider.usageLimits?.checkedAt ?? new Date(input.now).toISOString(),
      fiveHour: fiveHour ? toQuotaWindowState(fiveHour, input.now) : null,
      weekly: weekly ? toQuotaWindowState(weekly, input.now) : null,
    };
  }

  const notice = limitsNotice(resolved.limits);
  if (notice !== null) {
    return {
      status: "unavailable",
      instanceId: provider.instanceId,
      accountLabel,
      email,
      accentColor,
      message: notice,
    };
  }

  const { fiveHour, weekly } = resolveWindowsFromLimits(
    resolved.limits,
    preferredFamily,
    input.now,
  );
  if (fiveHour === null && weekly === null) {
    return {
      status: "unavailable",
      instanceId: provider.instanceId,
      accountLabel,
      email,
      accentColor,
      message: null,
    };
  }

  return {
    status: "ready",
    instanceId: provider.instanceId,
    accountLabel,
    email,
    accentColor,
    checkedAt: resolved.limits.checkedAt,
    fiveHour,
    weekly,
  };
}
