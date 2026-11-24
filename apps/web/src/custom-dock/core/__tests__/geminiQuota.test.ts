import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveGeminiQuotaCard } from "../geminiQuota";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");

function makeProvider(input: {
  readonly instanceId: string;
  readonly driver?: "antigravity" | "codex" | "claudeAgent";
  readonly displayName?: string;
  readonly email?: string;
  readonly accentColor?: string;
  readonly usageLimits?: ServerProviderUsageLimits;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver ?? "antigravity"),
    enabled: true,
    installed: true,
    version: "1.5.16",
    status: "ready",
    auth: {
      status: "authenticated",
      ...(input.email ? { email: input.email } : {}),
    },
    checkedAt: "2026-11-24T11:55:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
  };
}

describe("resolveGeminiQuotaCard", () => {
  it("extracts only the current Antigravity instance's 5h and weekly Gemini quotas", () => {
    const rayen = makeProvider({
      instanceId: "antigravity_2",
      displayName: "rayen",
      email: "rayen@example.com",
      usageLimits: {
        checkedAt: "2026-11-24T11:55:00.000Z",
        windows: [
          {
            id: "gemini-5h",
            kind: "session",
            label: "Gemini · 5-hour",
            usedPercent: 18,
            resetsAt: "2026-11-24T15:30:00.000Z",
            windowDurationMins: 300,
          },
          {
            id: "gemini-weekly",
            kind: "weekly",
            label: "Gemini · Weekly",
            usedPercent: 85,
            resetsAt: "2026-11-28T12:00:00.000Z",
            windowDurationMins: 10080,
          },
          {
            id: "3p-5h",
            kind: "session",
            label: "Claude & GPT (shared) · 5-hour",
            usedPercent: 99,
            windowDurationMins: 300,
          },
        ],
      },
    });
    const other = makeProvider({
      instanceId: "antigravity_3",
      displayName: "6200",
      email: "6200@example.com",
      usageLimits: {
        checkedAt: "2026-11-24T11:59:00.000Z",
        windows: [
          {
            id: "gemini-5h",
            kind: "session",
            label: "Gemini · 5-hour",
            usedPercent: 4,
            windowDurationMins: 300,
          },
          {
            id: "gemini-weekly",
            kind: "weekly",
            label: "Gemini · Weekly",
            usedPercent: 10,
            windowDurationMins: 10080,
          },
        ],
      },
    });

    const card = resolveGeminiQuotaCard({
      providerInstanceId: ProviderInstanceId.make("antigravity_2"),
      model: "gemini-4-neon",
      providers: [rayen, other],
      sources: [],
      now: NOW,
    });

    expect(card).toMatchObject({
      status: "ready",
      instanceId: "antigravity_2",
      accountLabel: "rayen",
      email: "rayen@example.com",
      fiveHour: {
        remainingPercent: 82,
        usedPercent: 18,
        tone: "normal",
      },
      weekly: {
        remainingPercent: 15,
        usedPercent: 85,
        tone: "warning",
      },
    });
  });

  it("prefers matching Gemini family buckets when using Argon or Carbon models", () => {
    const provider = makeProvider({
      instanceId: "antigravity_2",
      displayName: "rayen",
      usageLimits: {
        checkedAt: "2026-11-24T11:55:00.000Z",
        windows: [
          {
            id: "gemini-5h",
            kind: "session",
            label: "Gemini · 5-hour",
            usedPercent: 20,
            windowDurationMins: 300,
          },
          {
            id: "gemini-argon-5h",
            kind: "session",
            label: "Gemini Argon · 5-hour",
            usedPercent: 94,
            windowDurationMins: 300,
          },
          {
            id: "gemini-argon-weekly",
            kind: "weekly",
            label: "Gemini Argon · Weekly",
            usedPercent: 50,
            windowDurationMins: 10080,
          },
        ],
      },
    });

    const card = resolveGeminiQuotaCard({
      providerInstanceId: ProviderInstanceId.make("antigravity_2"),
      model: "gemini-argon-preview",
      providers: [provider],
      sources: [],
      now: NOW,
    });

    expect(card).toMatchObject({
      status: "ready",
      fiveHour: {
        window: { id: "gemini-argon-5h" },
        remainingPercent: 6,
        tone: "error",
      },
      weekly: {
        window: { id: "gemini-argon-weekly" },
        remainingPercent: 50,
        tone: "normal",
      },
    });
  });

  it("returns unavailable with message when the current Antigravity instance cannot read limits", () => {
    const provider = makeProvider({
      instanceId: "antigravity_3",
      displayName: "6200",
      usageLimits: {
        checkedAt: "2026-11-24T11:55:00.000Z",
        windows: [],
        unavailable: {
          reason: "probeFailed",
          message: "Antigravity's saved sign-in has expired.",
        },
      },
    });

    const card = resolveGeminiQuotaCard({
      providerInstanceId: ProviderInstanceId.make("antigravity_3"),
      model: "gemini-4-neon",
      providers: [provider],
      sources: [],
      now: NOW,
    });

    expect(card).toMatchObject({
      status: "unavailable",
      instanceId: "antigravity_3",
      accountLabel: "6200",
      message: "Antigravity's saved sign-in has expired.",
    });
  });

  it("returns null for non-Antigravity providers without Gemini windows", () => {
    const codex = makeProvider({
      instanceId: "codex",
      driver: "codex",
      displayName: "Codex",
      usageLimits: {
        checkedAt: "2026-11-24T11:55:00.000Z",
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "5-hour",
            usedPercent: 30,
            windowDurationMins: 300,
          },
        ],
      },
    });

    expect(
      resolveGeminiQuotaCard({
        providerInstanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        providers: [codex],
        sources: [],
        now: NOW,
      }),
    ).toBeNull();
  });
});
