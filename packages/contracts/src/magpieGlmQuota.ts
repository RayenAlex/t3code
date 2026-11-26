import * as Schema from "effect/Schema";

import { ForwardCompatibleOptional, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ServerProviderUsageWindow } from "./providerUsageLimits.ts";

export const MagpieGlmQuotaBinding = Schema.Struct({
  instanceId: ProviderInstanceId,
  origin: TrimmedNonEmptyString,
  modelAliases: Schema.Array(TrimmedNonEmptyString),
});
export type MagpieGlmQuotaBinding = typeof MagpieGlmQuotaBinding.Type;

export const MagpieGlmQuotaInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type MagpieGlmQuotaInput = typeof MagpieGlmQuotaInput.Type;

export const MagpieQuotaBalancePart = Schema.Struct({
  label: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  percent: ForwardCompatibleOptional(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  ),
});
export type MagpieQuotaBalancePart = typeof MagpieQuotaBalancePart.Type;

export const MagpieGlmQuota = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    checkedAt: IsoDateTime,
    expiresAt: IsoDateTime,
    windows: Schema.Array(ServerProviderUsageWindow),
    balance: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
    balanceParts: Schema.optionalKey(Schema.Array(MagpieQuotaBalancePart)),
  }),
  Schema.Struct({
    status: Schema.Literals([
      "notConfigured",
      "notApplicable",
      "noCard",
      "ambiguous",
      "unconfirmed",
      "unreachable",
    ]),
  }),
]);
export type MagpieGlmQuota = typeof MagpieGlmQuota.Type;

export function magpieGatewayOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function isMagpieGlmDriver(driver: string): boolean {
  return driver === "claudeAgent" || driver === "codex";
}

const GLM_MODEL_PATTERN = /(?:^|[-_/\s])glm(?=[-_.0-9\s]|$)/i;

export type MagpieQuotaFamily = "glm" | "gpt";

const GPT_MODEL_PATTERN = /(?:^|[-_/\s])gpt(?=[-_.0-9\s]|$)/i;

export function magpieQuotaFamily(
  model: string,
  modelName: string | undefined,
  glmAliases: readonly string[] | undefined,
  gptAliases: readonly string[] | undefined,
): MagpieQuotaFamily | undefined {
  if (
    glmAliases &&
    (GLM_MODEL_PATTERN.test(model) ||
      (modelName !== undefined && GLM_MODEL_PATTERN.test(modelName)) ||
      glmAliases.includes(model))
  ) {
    return "glm";
  }
  if (
    gptAliases &&
    (GPT_MODEL_PATTERN.test(model) ||
      (modelName !== undefined && GPT_MODEL_PATTERN.test(modelName)) ||
      gptAliases.includes(model))
  ) {
    return "gpt";
  }
  return undefined;
}
