import { ProviderInstanceId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import type { GeminiQuotaCardState } from "../core/geminiQuota";
import { RightRailGeminiQuotaCard } from "./RightRailGeminiQuotaCard";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");

const readyCard: GeminiQuotaCardState = {
  status: "ready",
  instanceId: ProviderInstanceId.make("antigravity_2"),
  accountLabel: "rayen",
  email: "rayen@example.com",
  accentColor: "#8c7bd1",
  checkedAt: "2026-11-24T11:55:00.000Z",
  fiveHour: {
    window: {
      id: "gemini-5h",
      kind: "session",
      label: "Gemini · 5-hour",
      usedPercent: 18,
      resetsAt: "2026-11-24T15:30:00.000Z",
      windowDurationMins: 300,
    },
    remainingPercent: 82,
    usedPercent: 18,
    paceRemainingPercent: 70,
    pace: "under",
    tone: "normal",
  },
  weekly: {
    window: {
      id: "gemini-weekly",
      kind: "weekly",
      label: "Gemini · Weekly",
      usedPercent: 92,
      resetsAt: "2026-11-27T12:00:00.000Z",
      windowDurationMins: 10080,
    },
    remainingPercent: 8,
    usedPercent: 92,
    paceRemainingPercent: 43,
    pace: "ahead",
    tone: "error",
  },
};

it("renders 5-hour and weekly Gemini quota progress bars with account badge and actions", async () => {
  const onRefresh = vi.fn();
  const onOpenUsage = vi.fn();
  await using screen = await render(
    <RightRailGeminiQuotaCard
      card={readyCard}
      now={NOW}
      refreshing={false}
      onRefresh={onRefresh}
      onOpenUsage={onOpenUsage}
    />,
  );

  await expect.element(screen.getByText("rayen")).toBeVisible();
  await expect.element(screen.getByText("82% left")).toBeVisible();
  await expect.element(screen.getByText("8% left")).toBeVisible();

  const fiveHourBar = screen.getByRole("progressbar", { name: "5-hour" });
  const weeklyBar = screen.getByRole("progressbar", { name: "Weekly" });
  await expect.element(fiveHourBar).toHaveAttribute("aria-valuenow", "82");
  await expect.element(weeklyBar).toHaveAttribute("aria-valuenow", "8");

  await screen.getByRole("button", { name: "Refresh Gemini quota" }).click();
  await screen.getByRole("button", { name: "Open usage page" }).click();
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(onOpenUsage).toHaveBeenCalledTimes(1);
});

it("shows an unavailable notice when the current Antigravity account cannot read quota", async () => {
  const unavailableCard: GeminiQuotaCardState = {
    status: "unavailable",
    instanceId: ProviderInstanceId.make("antigravity_3"),
    accountLabel: "6200",
    email: null,
    accentColor: "#8c7bd1",
    message: "Sign in with Google to see Antigravity limits.",
  };
  await using screen = await render(
    <RightRailGeminiQuotaCard
      card={unavailableCard}
      now={NOW}
      refreshing={false}
      onRefresh={vi.fn()}
      onOpenUsage={vi.fn()}
    />,
  );

  await expect.element(screen.getByText("6200")).toBeVisible();
  await expect
    .element(screen.getByText("Sign in with Google to see Antigravity limits."))
    .toBeVisible();
});
