import {
  ClaudeSettings,
  type ProviderInstanceConfig,
  ProviderDriverKind,
  ProviderInstanceId,
  TrimmedNonEmptyString,
  isMagpieGlmDriver,
  magpieGatewayOrigin,
  magpieQuotaFamily,
  matchesMagpieGptRoute,
  MagpieQuotaBalancePart,
  type MagpieQuotaFamily,
  type MagpieGlmQuota as Quota,
  type MagpieGlmQuotaBinding,
  type MagpieGlmQuotaInput,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Chunk from "effect/Chunk";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import {
  makeClaudeEnvironment,
  mergeClaudeProcessEnvironment,
} from "../provider/Drivers/ClaudeHome.ts";
import { readClaudeSettingsEnv } from "../provider/Drivers/ClaudeSkills.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";

const CONFIG_ENV = "T3CODE_MAGPIE_GLM_QUOTA";
const CARDS_PATH = "/v1/magpie/quotas/cards";
const MAX_CACHE_AGE_MS = 15 * 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const NANOS_PER_MINUTE = 60_000_000_000;
const Config = Schema.fromJsonString(
  Schema.Struct({
    url: TrimmedNonEmptyString,
    instanceId: ProviderInstanceId,
    provider: TrimmedNonEmptyString,
    user: Schema.optional(Schema.String),
    kind: Schema.optional(Schema.Literals(["plan", "subscription"])),
    modelAliases: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  }),
);
const CardIdentity = Schema.Struct({
  provider: Schema.String,
  user: Schema.optional(Schema.String),
  alias: Schema.optional(Schema.String),
  kind: Schema.String,
  from: Schema.optional(Schema.String),
});
const CardReading = Schema.Struct({
  readAt: Schema.optional(Schema.String),
  asOf: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  balance: Schema.optional(Schema.String),
  balanceParts: Schema.optional(Schema.Array(Schema.Unknown)),
  windows: Schema.Array(Schema.Unknown),
  routing: Schema.optional(Schema.Array(Schema.Unknown)),
});
const Window = Schema.Struct({
  name: Schema.String,
  used: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  resetsAt: Schema.optional(Schema.String),
  text: Schema.optional(Schema.Boolean),
  unlimited: Schema.optional(Schema.Boolean),
  balance: Schema.optional(Schema.Number),
});
const WalletWindow = Schema.Struct({
  balance: Schema.Finite,
  unit: Schema.optional(Schema.String),
});
const decodeWalletWindow = Schema.decodeUnknownOption(WalletWindow);

const Routing = Schema.Struct({
  span: Schema.optional(Schema.Finite),
  aside: Schema.optional(Schema.Boolean),
});
const decodeConfig = Schema.decodeUnknownOption(Config);
const decodeCardIdentity = Schema.decodeUnknownOption(CardIdentity);
const decodeCardReading = Schema.decodeUnknownOption(CardReading);
const decodeBalancePart = Schema.decodeUnknownOption(MagpieQuotaBalancePart);
const decodeWindow = Schema.decodeUnknownOption(Window);
const decodeRouting = Schema.decodeUnknownOption(Routing);
const decodeReply = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      data: Schema.Array(Schema.Unknown),
    }),
  ),
);

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);

/**
 * The gateway credential a session on this instance sends: Claude's settings `env`, else the instance's
 * process environment, each under the header Claude Code gives its variable. Claude Code does not
 * document which it favors when both are set, so both go out.
 */
const gatewayHeaders = Effect.fn("MagpieGlmQuota.gatewayHeaders")(function* (
  instance: ProviderInstanceConfig | undefined,
): Effect.fn.Return<Readonly<Record<string, string>>, never, FileSystem.FileSystem | Path.Path> {
  if (instance?.driver !== CLAUDE_DRIVER) return {};
  const claudeSettings = Option.getOrUndefined(decodeClaudeSettings(instance.config ?? {}));
  if (!claudeSettings) return {};
  const processEnvironment = yield* mergeClaudeProcessEnvironment(
    claudeSettings,
    instance.environment,
    yield* HostProcess.Environment,
  );
  const sessionEnvironment = yield* makeClaudeEnvironment(claudeSettings, processEnvironment);
  const settingsEnv = yield* readClaudeSettingsEnv(claudeSettings, undefined, sessionEnvironment);
  const credential = (name: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY") =>
    settingsEnv[name] ?? sessionEnvironment[name];
  const token = credential("ANTHROPIC_AUTH_TOKEN");
  const apiKey = credential("ANTHROPIC_API_KEY");
  return {
    ...(typeof token === "string" && token ? { authorization: `Bearer ${token}` } : {}),
    ...(typeof apiKey === "string" && apiKey ? { "x-api-key": apiKey } : {}),
  };
});

const CADENCES = [
  { id: "5h", kind: "session", label: "5 hours", windowDurationMins: 300 },
  { id: "weekly", kind: "weekly", label: "7 days", windowDurationMins: 10_080 },
] as const;

function toWindow(
  raw: unknown,
  routing: unknown,
  now: number,
  family: MagpieQuotaFamily,
): ServerProviderUsageWindow | undefined {
  const window = Option.getOrUndefined(decodeWindow(raw));
  const route = Option.getOrUndefined(decodeRouting(routing));
  if (!window || window.text || window.unlimited || window.balance !== undefined || route?.aside)
    return;
  const cadence = CADENCES.find((entry) =>
    route?.span
      ? route.span === entry.windowDurationMins * NANOS_PER_MINUTE
      : window.name === entry.label,
  );
  // Kept Magpie windows may be zeroed and lose their reset clock after the old window elapses.
  const resetsAt = Date.parse(window.resetsAt ?? "");
  if (!cadence || !Number.isFinite(resetsAt) || resetsAt <= now) return;
  return {
    ...cadence,
    id: `${family}-${cadence.id}`,
    usedPercent: window.used,
    resetsAt: DateTime.formatIso(DateTime.makeUnsafe(resetsAt)),
  };
}

function quotaBalance(
  cardBalance: string | undefined,
  windows: readonly unknown[],
): string | undefined {
  const summary = cardBalance?.trim();
  if (summary && summary.length <= 512) return summary;
  const balances = windows.flatMap((raw) => {
    const window = Option.getOrUndefined(decodeWalletWindow(raw));
    if (!window) return [];
    const unit = window.unit?.trim();
    return [unit ? `${window.balance} ${unit}` : String(window.balance)];
  });
  const balance = balances.join(" · ");
  return balance && balance.length <= 512 ? balance : undefined;
}

function toQuota(card: unknown, now: number, family: MagpieQuotaFamily): Quota {
  const reading = Option.getOrUndefined(decodeCardReading(card));
  if (!reading || reading.error) return { status: "unconfirmed" };
  const readAt = Date.parse(reading.readAt ?? reading.asOf ?? "");
  const expiresAt = readAt + MAX_CACHE_AGE_MS;
  if (!Number.isFinite(readAt) || readAt > now || expiresAt <= now)
    return { status: "unconfirmed" };
  const routing = reading.routing?.length === reading.windows.length ? reading.routing : undefined;
  const parsed = reading.windows.flatMap((raw, index) => {
    const window = toWindow(raw, routing?.[index], now, family);
    return window ? [window] : [];
  });
  const windows = CADENCES.flatMap(({ id }) => {
    const matches = parsed.filter((window) => window.id === `${family}-${id}`);
    return matches.length === 1 ? matches : [];
  });
  const balance = family === "gpt" ? quotaBalance(reading.balance, reading.windows) : undefined;
  const balanceParts =
    family === "gpt"
      ? (reading.balanceParts ?? []).flatMap((raw) => {
          const part = Option.getOrUndefined(decodeBalancePart(raw));
          return part ? [part] : [];
        })
      : [];
  return windows.length === 0 && balance === undefined && balanceParts.length === 0
    ? { status: "unconfirmed" }
    : {
        status: "ready",
        checkedAt: DateTime.formatIso(DateTime.makeUnsafe(readAt)),
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
        windows,
        ...(balance !== undefined ? { balance } : {}),
        ...(balanceParts.length > 0 ? { balanceParts } : {}),
      };
}

function readCards(response: HttpClientResponse.HttpClientResponse) {
  return response.stream.pipe(
    Stream.runFoldEffect(
      () => ({ size: 0, chunks: Chunk.empty<Uint8Array>() }),
      (acc, bytes) => {
        const size = acc.size + bytes.byteLength;
        return size > MAX_RESPONSE_BYTES
          ? Effect.fail("oversized" as const)
          : Effect.succeed({ size, chunks: Chunk.append(acc.chunks, bytes) });
      },
    ),
    Effect.flatMap(({ size, chunks }) => {
      const body = new Uint8Array(size);
      let offset = 0;
      for (const bytes of chunks) {
        body.set(bytes, offset);
        offset += bytes.byteLength;
      }
      return decodeReply(new TextDecoder().decode(body));
    }),
  );
}

export class MagpieGlmQuota extends Context.Service<
  MagpieGlmQuota,
  {
    readonly binding: MagpieGlmQuotaBinding | undefined;
    readonly read: (
      input: MagpieGlmQuotaInput,
    ) => Effect.Effect<Quota, never, FileSystem.FileSystem | Path.Path>;
  }
>()("t3/usage/MagpieGlmQuota") {}

const make = Effect.gen(function* () {
  const { getProviders } = yield* ProviderRegistry.ProviderRegistry;
  const { getSettings } = yield* ServerSettings.ServerSettingsService;
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  const environment = yield* HostProcess.Environment;
  const legacy = Option.getOrUndefined(decodeConfig(environment[CONFIG_ENV]));
  const legacyOrigin = legacy && magpieGatewayOrigin(legacy.url);
  const read = Effect.fn("MagpieGlmQuota.read")(function* (
    input: MagpieGlmQuotaInput,
  ): Effect.fn.Return<Quota, never, FileSystem.FileSystem | Path.Path> {
    const settings = yield* getSettings.pipe(Effect.option);
    if (Option.isNone(settings)) return { status: "unreachable" };
    const saved = settings.value.magpieGlmQuota;
    if (saved && !saved.enabled && !saved.gpt?.enabled) return { status: "notConfigured" };
    const config = saved ?? legacy;
    const origin = saved ? magpieGatewayOrigin(saved.url) : legacyOrigin;
    if (!origin || !config) return { status: "notConfigured" };
    if (!saved && legacy?.instanceId !== input.instanceId) {
      return { status: "notApplicable" };
    }
    const providers = yield* getProviders;
    const provider = providers.find(
      (entry) => entry.enabled && entry.instanceId === input.instanceId,
    );
    if (
      !provider ||
      (saved ? !isMagpieGlmDriver(provider.driver) : provider.auth.endpoint !== origin)
    ) {
      return { status: "notApplicable" };
    }
    const modelName = provider.models?.find((entry) => entry.slug === input.model)?.name;
    const gpt =
      saved?.gpt?.enabled &&
      matchesMagpieGptRoute(provider.auth.endpoint, origin, saved.gpt.routeOrigin)
        ? saved.gpt
        : undefined;
    const family = magpieQuotaFamily(
      input.model,
      modelName,
      !saved || saved.enabled ? (config.modelAliases ?? []) : undefined,
      gpt?.modelAliases,
    );
    if (!family) return { status: "notApplicable" };
    const gptProvider = gpt?.provider;
    const cardProvider = family === "gpt" ? (gptProvider ?? "codex") : config.provider;
    const cardKinds =
      family === "gpt"
        ? gptProvider && gptProvider !== "codex"
          ? ["subscription", "plan", "balance"]
          : ["subscription"]
        : [config.kind ?? "plan"];
    const cardUser = family === "gpt" ? gpt?.user : (config.user ?? "");
    const headers = saved
      ? saved.gatewayKey && saved.gatewayKey !== SECRET_REDACTED
        ? { authorization: `Bearer ${saved.gatewayKey}` }
        : {}
      : yield* gatewayHeaders(settings.value.providerInstances[input.instanceId]);
    const reply = yield* http
      .execute(
        HttpClientRequest.get(`${origin}${CARDS_PATH}`).pipe(HttpClientRequest.setHeaders(headers)),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(readCards),
        Effect.scoped,
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.timeout("2 seconds"),
        Effect.option,
      );
    if (Option.isNone(reply)) return { status: "unreachable" };
    const matches = reply.value.data.filter((raw) => {
      const card = Option.getOrUndefined(decodeCardIdentity(raw));
      return (
        card &&
        !card.from &&
        card.provider === cardProvider &&
        cardKinds.includes(card.kind) &&
        ((card.user ?? "") === cardUser ||
          (family === "gpt" && (!cardUser || card.alias === cardUser)))
      );
    });
    if (matches.length === 0) return { status: "noCard" };
    if (matches.length > 1) return { status: "ambiguous" };
    return toQuota(
      matches[0],
      yield* DateTime.nowAsDate.pipe(Effect.map((date) => date.getTime())),
      family,
    );
  });
  return MagpieGlmQuota.of({
    read,
    binding:
      legacyOrigin && legacy
        ? {
            instanceId: legacy.instanceId,
            origin: legacyOrigin,
            modelAliases: legacy.modelAliases ?? [],
          }
        : undefined,
  });
});

export const layer = Layer.effect(MagpieGlmQuota, make);
