import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FetchHttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as MagpieGlmQuota from "./MagpieGlmQuota.ts";

const INSTANCE = ProviderInstanceId.make("magpie");
const CLAUDE_INSTANCE = ProviderInstanceId.make("claudeAgent");
const ORIGIN = "http://127.0.0.1:24819";
const LAN_ORIGIN = "http://192.168.100.100:3425";
const NOW = "2026-11-25T12:00:00Z";
const READ_AT = "2026-11-25T11:58:00.000Z";
const RESET = "2026-11-25T15:00:00.000Z";
const WEEKLY_RESET = "2026-11-28T00:00:00.000Z";
const WINDOWS = [
  { name: "5 hours", used: 23, resetsAt: RESET },
  { name: "7 days", used: 64, resetsAt: WEEKLY_RESET },
  { name: "MCP · Month", used: 9, resetsAt: WEEKLY_RESET },
];
const CARD = {
  provider: "zhipu",
  user: "work",
  kind: "plan",
  readAt: READ_AT,
  windows: WINDOWS,
  routing: [{ span: 18_000_000_000_000 }, { span: 604_800_000_000_000 }, { aside: true }],
};
const CONFIG = {
  url: ORIGIN,
  instanceId: INSTANCE,
  provider: "zhipu",
  user: "work",
  modelAliases: ["daily"],
};

interface ClaudeInstance {
  /** The `env` of Claude's own settings for this instance's home. */
  readonly settingsEnv?: Readonly<Record<string, unknown>>;
  /** Variables configured on the T3 instance. */
  readonly environment?: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
    readonly sensitive: boolean;
  }>;
}

interface Call {
  readonly url: string;
  readonly method: string | undefined;
  readonly redirect: string | undefined;
  readonly authorization: string | null;
  readonly apiKey: string | null;
}

function readWith(input: {
  readonly cards?: readonly unknown[];
  readonly config?: unknown;
  readonly endpoint?: string;
  readonly model?: string;
  readonly respond?: () => Response;
  readonly instance?: ClaudeInstance;
}) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = input.instance
      ? yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-magpie-glm-quota-" })
      : undefined;
    if (home && input.instance?.settingsEnv) {
      yield* fileSystem.writeFileString(
        path.join(home, "settings.json"),
        JSON.stringify({ env: input.instance.settingsEnv }),
      );
    }
    const instanceId = input.instance ? CLAUDE_INSTANCE : INSTANCE;
    const calls: Array<Call> = [];
    const result = yield* Effect.gen(function* () {
      const quota = yield* MagpieGlmQuota.MagpieGlmQuota;
      return yield* quota.read({ instanceId, model: input.model ?? "zhipu/glm-5" });
    }).pipe(
      Effect.provide(
        MagpieGlmQuota.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderRegistry.ProviderRegistry)({
                getProviders: Effect.succeed([
                  {
                    instanceId,
                    enabled: true,
                    auth: { endpoint: input.endpoint ?? ORIGIN },
                  } as ServerProvider,
                ]),
              }),
              ServerSettings.ServerSettingsService.layerTest({
                providerInstances: input.instance
                  ? {
                      [CLAUDE_INSTANCE]: {
                        driver: ProviderDriverKind.make("claudeAgent"),
                        config: { homePath: home },
                        environment: input.instance.environment ?? [],
                      },
                    }
                  : {},
              }),
              FetchHttpClient.layer,
            ),
          ),
        ),
      ),
      Effect.provideService(HostProcess.Environment, {
        T3CODE_MAGPIE_GLM_QUOTA: JSON.stringify({ ...(input.config ?? CONFIG), instanceId }),
      }),
      Effect.provideService(FetchHttpClient.Fetch, async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(url),
          method: init?.method,
          redirect: init?.redirect,
          authorization: headers.get("authorization"),
          apiKey: headers.get("x-api-key"),
        });
        return input.respond?.() ?? Response.json({ object: "list", data: input.cards ?? [CARD] });
      }),
    );
    return { result, calls };
  });
}

it.layer(NodeServices.layer)("Magpie GLM quota", (it) => {
  it.effect("applies saved settings to Claude and Codex without rebuilding the quota service", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const codex = ProviderInstanceId.make("codex");
      const other = ProviderInstanceId.make("other");
      const providers = [
        {
          instanceId: CLAUDE_INSTANCE,
          driver: "claudeAgent",
          auth: { endpoint: LAN_ORIGIN },
          models: [
            {
              slug: "anthropic/magpie-7099366880",
              name: "GLM-5.4 · Zhipu GLM",
              isCustom: false,
              capabilities: null,
            },
            {
              slug: "anthropic/magpie-3326817965",
              name: "Prewalk route · Prewalk provider",
              isCustom: false,
              capabilities: null,
            },
          ],
        },
        { instanceId: codex, driver: "codex", auth: { endpoint: LAN_ORIGIN }, models: [] },
        { instanceId: other, driver: "codex", auth: { endpoint: ORIGIN }, models: [] },
        { instanceId: INSTANCE, driver: "pi", auth: { endpoint: LAN_ORIGIN }, models: [] },
      ].map((value) => ({ enabled: true, ...value }) as unknown as ServerProvider);
      const calls: Array<readonly [string, string | null]> = [];
      yield* Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        const quota = yield* MagpieGlmQuota.MagpieGlmQuota;
        const model = "anthropic/magpie-model";
        const read = (instanceId: ProviderInstanceId) => quota.read({ instanceId, model });
        expect(yield* read(codex)).toEqual({ status: "notConfigured" });
        const saved = {
          enabled: true,
          url: LAN_ORIGIN,
          provider: "zhipu",
          user: "work",
          kind: "plan" as const,
          modelAliases: [model],
          gatewayKey: "fake-magpie-key",
          revision: "one",
        };
        yield* settings.updateSettings({ magpieGlmQuota: saved });
        expect((yield* read(CLAUDE_INSTANCE)).status).toBe("ready");
        expect((yield* read(codex)).status).toBe("ready");
        expect((yield* read(other)).status).toBe("ready");
        expect(
          (yield* quota.read({ instanceId: CLAUDE_INSTANCE, model: "claude-glm-5.3" })).status,
        ).toBe("ready");
        expect(
          (yield* quota.read({ instanceId: CLAUDE_INSTANCE, model: "claude-glm-5-3-flash" }))
            .status,
        ).toBe("ready");
        expect(
          (yield* quota.read({
            instanceId: CLAUDE_INSTANCE,
            model: "anthropic/magpie-7099366880",
          })).status,
        ).toBe("ready");
        expect(
          yield* quota.read({
            instanceId: CLAUDE_INSTANCE,
            model: "anthropic/magpie-3326817965",
          }),
        ).toEqual({
          status: "notApplicable",
        });
        expect(yield* quota.read({ instanceId: CLAUDE_INSTANCE, model: "my-glamour-1" })).toEqual({
          status: "notApplicable",
        });
        expect(yield* read(INSTANCE)).toEqual({ status: "notApplicable" });
        yield* settings.updateSettings({ magpieGlmQuota: { ...saved, enabled: false } });
        expect(yield* read(codex)).toEqual({ status: "notConfigured" });
      }).pipe(
        Effect.provide(
          MagpieGlmQuota.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                ServerSettings.layerTest(),
                Layer.mock(ProviderRegistry.ProviderRegistry)({
                  getProviders: Effect.succeed(providers),
                }),
                FetchHttpClient.layer,
              ),
            ),
          ),
        ),
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provideService(FetchHttpClient.Fetch, async (url, init) => {
          calls.push([String(url), new Headers(init?.headers).get("authorization")]);
          return Response.json({ data: [CARD] });
        }),
      );
      expect(calls).toEqual([
        [`${LAN_ORIGIN}/v1/magpie/quotas/cards`, "Bearer fake-magpie-key"],
        [`${LAN_ORIGIN}/v1/magpie/quotas/cards`, "Bearer fake-magpie-key"],
        [`${LAN_ORIGIN}/v1/magpie/quotas/cards`, "Bearer fake-magpie-key"],
        [`${LAN_ORIGIN}/v1/magpie/quotas/cards`, "Bearer fake-magpie-key"],
        [`${LAN_ORIGIN}/v1/magpie/quotas/cards`, "Bearer fake-magpie-key"],
        [`${LAN_ORIGIN}/v1/magpie/quotas/cards`, "Bearer fake-magpie-key"],
      ]);
    }),
  );

  it.effect(
    "selects the configured Codex subscription without mixing it with GLM or another gateway",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const provider = (instanceId: ProviderInstanceId, endpoint: string | undefined) =>
          ({
            instanceId,
            enabled: true,
            driver: "codex",
            auth: { endpoint },
            models: [
              {
                slug: "openai/magpie-route",
                name: "GPT-6.1 · Codex",
                isCustom: false,
                capabilities: null,
              },
            ],
          }) as unknown as ServerProvider;
        const native = ProviderInstanceId.make("native-codex");
        const other = ProviderInstanceId.make("other-gateway");
        const codex = {
          provider: "codex",
          kind: "subscription",
          user: "work",
          alias: "Work Codex",
          readAt: READ_AT,
          windows: [
            { ...WINDOWS[0], used: 38 },
            { ...WINDOWS[1], used: 72 },
            { name: "Image generation", used: 100, text: true },
          ],
          routing: CARD.routing,
        };
        let cards: readonly unknown[] = [
          CARD,
          codex,
          { ...codex, user: "other", alias: "Other Codex" },
          { ...codex, from: "remote" },
          { ...codex, kind: "plan" },
        ];
        const calls: Array<readonly [string, string | null]> = [];
        yield* Effect.gen(function* () {
          const settings = yield* ServerSettings.ServerSettingsService;
          const quota = yield* MagpieGlmQuota.MagpieGlmQuota;
          const read = (model: string, instanceId = INSTANCE) => quota.read({ instanceId, model });
          const saved = {
            ...CONFIG,
            enabled: true,
            kind: "plan" as const,
            gatewayKey: "test-gpt-gateway-key",
            revision: "gpt",
          };
          yield* settings.updateSettings({ magpieGlmQuota: saved });
          expect(yield* read("gpt-6.1")).toEqual({ status: "notApplicable" });
          const gpt = {
            enabled: true,
            user: "Work Codex",
            modelAliases: ["gpt-custom-alias", "daily-route"],
          };
          yield* settings.updateSettings({ magpieGlmQuota: { ...saved, gpt } });
          expect(yield* read("gpt-6.1", native)).toEqual({ status: "notApplicable" });
          expect(yield* read("gpt-6.1", other)).toEqual({ status: "notApplicable" });
          expect(calls).toEqual([]);
          expect(yield* read("zhipu/glm-5")).toMatchObject({
            status: "ready",
            windows: [{ id: "glm-5h" }, { id: "glm-weekly" }],
          });
          const snapshot = {
            status: "ready",
            checkedAt: READ_AT,
            windows: [
              { id: "gpt-5h", kind: "session", usedPercent: 38, resetsAt: RESET },
              { id: "gpt-weekly", kind: "weekly", usedPercent: 72, resetsAt: WEEKLY_RESET },
            ],
          };
          expect(yield* read("openai/gpt-6.1")).toMatchObject(snapshot);
          expect(yield* read("openai/magpie-route")).toMatchObject(snapshot);
          expect(yield* read("daily-route")).toMatchObject(snapshot);
          expect(calls).toEqual(
            Array.from({ length: 4 }, () => [
              `${ORIGIN}/v1/magpie/quotas/cards`,
              "Bearer test-gpt-gateway-key",
            ]),
          );
          yield* settings.updateSettings({
            magpieGlmQuota: { ...saved, enabled: false, gpt: { ...gpt, user: "" } },
          });
          expect(yield* read("gpt-6.1")).toEqual({ status: "ambiguous" });
          cards = [CARD, codex];
          expect(yield* read("gpt-6.1")).toMatchObject(snapshot);
          cards = [{ ...codex, readAt: "2026-11-25T11:00:00Z" }];
          expect(yield* read("gpt-6.1")).toEqual({ status: "unconfirmed" });
          cards = [{ ...codex, from: "remote" }];
          expect(yield* read("gpt-6.1")).toEqual({ status: "noCard" });

          const cpaCard = {
            provider: "cpa",
            kind: "balance",
            user: "work",
            alias: "Work CPA",
            readAt: READ_AT,
            windows: [],
            balance: "≈¥88.00",
          };
          cards = [CARD, codex, { ...cpaCard, user: "other", alias: "Other CPA" }, cpaCard];
          yield* settings.updateSettings({
            magpieGlmQuota: { ...saved, gpt: { ...gpt, provider: "cpa", user: "Work CPA" } },
          });
          expect(yield* read("gpt-6.1")).toEqual({
            status: "ready",
            checkedAt: READ_AT,
            expiresAt: "2026-11-25T12:13:00.000Z",
            windows: [],
            balance: "≈¥88.00",
          });
          expect(calls.at(-1)).toEqual([
            `${ORIGIN}/v1/magpie/quotas/cards`,
            "Bearer test-gpt-gateway-key",
          ]);
          cards = [
            {
              ...cpaCard,
              balance: "5h 63% · 周 94% · 账号 1.00",
              balanceParts: [
                { label: "5h", text: "63%", percent: 63 },
                { label: "周", text: "94%", percent: 94 },
                { label: "账号", text: "1.00" },
                { label: "无效百分比", text: "125%", percent: 125 },
              ],
            },
          ];
          expect(yield* read("gpt-6.1")).toMatchObject({
            status: "ready",
            windows: [],
            balanceParts: [
              { label: "5h", text: "63%", percent: 63 },
              { label: "周", text: "94%", percent: 94 },
              { label: "账号", text: "1.00" },
              { label: "无效百分比", text: "125%" },
            ],
          });
          cards = [
            {
              ...cpaCard,
              balance: "",
              windows: [{ name: "wallet", used: 0, balance: 0, unit: "USD" }],
            },
          ];
          expect(yield* read("gpt-6.1")).toMatchObject({
            status: "ready",
            windows: [],
            balance: "0 USD",
          });
          cards = [{ ...cpaCard, readAt: "2026-11-25T11:00:00Z" }];
          expect(yield* read("gpt-6.1")).toEqual({ status: "unconfirmed" });
          cards = [codex];
          expect(yield* read("gpt-6.1")).toEqual({ status: "noCard" });
        }).pipe(
          Effect.provide(
            MagpieGlmQuota.layer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(
                  ServerSettings.layerTest(),
                  Layer.mock(ProviderRegistry.ProviderRegistry)({
                    getProviders: Effect.succeed([
                      provider(INSTANCE, ORIGIN),
                      provider(native, undefined),
                      provider(other, LAN_ORIGIN),
                    ]),
                  }),
                  FetchHttpClient.layer,
                ),
              ),
            ),
          ),
          Effect.provideService(HostProcess.Environment, {}),
          Effect.provideService(FetchHttpClient.Fetch, async (url, init) => {
            calls.push([String(url), new Headers(init?.headers).get("authorization")]);
            return Response.json({ data: cards });
          }),
        );
      }),
  );

  it.effect("loads only the bound plan's model windows through the fixed read-only endpoint", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* readWith({ cards: [{ ...CARD, user: "other" }, CARD] });
      expect(calls).toEqual([
        {
          url: `${ORIGIN}/v1/magpie/quotas/cards`,
          method: "GET",
          redirect: "error",
          authorization: null,
          apiKey: null,
        },
      ]);
      expect(result).toEqual({
        status: "ready",
        checkedAt: READ_AT,
        expiresAt: "2026-11-25T12:13:00.000Z",
        windows: [
          {
            id: "glm-5h",
            kind: "session",
            label: "5 hours",
            usedPercent: 23,
            windowDurationMins: 300,
            resetsAt: RESET,
          },
          {
            id: "glm-weekly",
            kind: "weekly",
            label: "7 days",
            usedPercent: 64,
            windowDurationMins: 10_080,
            resetsAt: WEEKLY_RESET,
          },
        ],
      });
    }),
  );

  it.effect("reads a gateway on the local network when it is the bound instance's endpoint", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* readWith({
        config: { ...CONFIG, url: LAN_ORIGIN },
        endpoint: LAN_ORIGIN,
      });
      expect(calls).toEqual([
        {
          url: `${LAN_ORIGIN}/v1/magpie/quotas/cards`,
          method: "GET",
          redirect: "error",
          authorization: null,
          apiKey: null,
        },
      ]);
      expect(result.status).toBe("ready");
    }),
  );

  it.effect.each([
    { name: "another model", model: "claude-sonnet", expected: "notApplicable" },
    { name: "a different gateway", endpoint: "https://example.invalid", expected: "notApplicable" },
    {
      name: "a gateway URL with a path",
      config: { ...CONFIG, url: `${LAN_ORIGIN}/v1` },
      endpoint: LAN_ORIGIN,
      expected: "notConfigured",
    },
    {
      name: "a gateway URL with credentials",
      config: { ...CONFIG, url: "http://user:secret@192.168.100.100:3425" },
      endpoint: "http://192.168.100.100:3425",
      expected: "notConfigured",
    },
    {
      name: "a gateway URL without http",
      config: { ...CONFIG, url: "ftp://192.168.100.100:3425" },
      expected: "notConfigured",
    },
  ])("does not request quota for $name", ({ expected, ...input }) =>
    Effect.gen(function* () {
      expect(yield* readWith(input)).toEqual({ result: { status: expected }, calls: [] });
    }),
  );

  it.effect.each([
    {
      name: "a token in Claude's settings",
      settingsEnv: { ANTHROPIC_AUTH_TOKEN: "settings-token" },
      authorization: "Bearer settings-token",
      apiKey: null,
    },
    {
      name: "an API key in Claude's settings",
      settingsEnv: { ANTHROPIC_API_KEY: "settings-key" },
      authorization: null,
      apiKey: "settings-key",
    },
    {
      name: "a token on the T3 instance",
      environment: [{ name: "ANTHROPIC_AUTH_TOKEN", value: "instance-token", sensitive: true }],
      authorization: "Bearer instance-token",
      apiKey: null,
    },
    {
      name: "an API key on the T3 instance",
      environment: [{ name: "ANTHROPIC_API_KEY", value: "instance-key", sensitive: true }],
      authorization: null,
      apiKey: "instance-key",
    },
    {
      name: "both credentials",
      settingsEnv: { ANTHROPIC_AUTH_TOKEN: "settings-token" },
      environment: [{ name: "ANTHROPIC_API_KEY", value: "instance-key", sensitive: true }],
      authorization: "Bearer settings-token",
      apiKey: "instance-key",
    },
    {
      name: "Claude's settings over the T3 instance",
      settingsEnv: { ANTHROPIC_AUTH_TOKEN: "settings-token" },
      environment: [{ name: "ANTHROPIC_AUTH_TOKEN", value: "instance-token", sensitive: true }],
      authorization: "Bearer settings-token",
      apiKey: null,
    },
    {
      name: "a non-string token",
      settingsEnv: { ANTHROPIC_AUTH_TOKEN: 123 },
      authorization: null,
      apiKey: null,
    },
    {
      name: "no credential",
      settingsEnv: { ANTHROPIC_MODEL: "any" },
      authorization: null,
      apiKey: null,
    },
  ])(
    "sends $name in the headers a session sends its gateway",
    ({ apiKey, authorization, ...instance }) =>
      Effect.gen(function* () {
        const { result, calls } = yield* readWith({
          instance,
          config: { ...CONFIG, url: LAN_ORIGIN },
          endpoint: LAN_ORIGIN,
        });
        expect(calls).toEqual([
          {
            url: `${LAN_ORIGIN}/v1/magpie/quotas/cards`,
            method: "GET",
            redirect: "error",
            authorization,
            apiKey,
          },
        ]);
        expect(result.status).toBe("ready");
      }),
  );

  it.effect("keeps the instance's credential off a gateway that is not its endpoint", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* readWith({
        instance: { settingsEnv: { ANTHROPIC_AUTH_TOKEN: "settings-token" } },
        config: { ...CONFIG, url: LAN_ORIGIN },
        endpoint: ORIGIN,
      });
      expect(result).toEqual({ status: "notApplicable" });
      expect(calls).toEqual([]);
    }),
  );

  it.effect.each([
    { name: "two matching cards", cards: [CARD, CARD], expected: "ambiguous" },
    { name: "no cache", cards: [], expected: "noCard" },
    { name: "an undated card", cards: [{ ...CARD, readAt: undefined }], expected: "unconfirmed" },
    {
      name: "an elapsed window",
      cards: [
        {
          ...CARD,
          windows: [{ ...WINDOWS[0], used: 0, resetsAt: "2026-11-25T11:59:00Z" }],
          routing: [CARD.routing[0]],
        },
      ],
      expected: "unconfirmed",
    },
    {
      name: "a reset cleared out of a kept window",
      cards: [
        {
          ...CARD,
          readAt: undefined,
          asOf: READ_AT,
          windows: [{ name: "5 hours", used: 0 }],
          routing: [CARD.routing[0]],
        },
      ],
      expected: "unconfirmed",
    },
    {
      name: "an old cache with a future reset",
      cards: [{ ...CARD, readAt: "2026-11-25T11:00:00Z" }],
      expected: "unconfirmed",
    },
    {
      name: "a refused upstream read",
      cards: [{ ...CARD, error: "RAW UPSTREAM ERROR" }],
      expected: "unconfirmed",
    },
    {
      name: "a redirect",
      respond: () => Response.redirect("http://127.0.0.1:24819/other", 302),
      expected: "unreachable",
    },
  ])("does not invent quota for $name", ({ expected, ...input }) =>
    Effect.gen(function* () {
      const { result, calls } = yield* readWith(input);
      expect(calls).toHaveLength(1);
      expect(result).toEqual({ status: expected });
    }),
  );

  it.effect("supports explicitly configured aliases on the bound gateway", () =>
    Effect.gen(function* () {
      expect((yield* readWith({ model: "daily" })).result.status).toBe("ready");
    }),
  );
});
