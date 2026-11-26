import { useAtomValue } from "@effect/atom-react";
import { toServerClock } from "@t3tools/client-runtime/clock";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import {
  isMagpieGlmDriver,
  magpieGatewayOrigin,
  magpieQuotaFamily,
  type MagpieQuotaFamily,
  type MagpieQuotaBalancePart,
  type EnvironmentId,
  type MagpieGlmQuota,
  type MagpieGlmQuotaBinding,
  type MagpieGlmQuotaInput,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Clock3, Gauge, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import { Button } from "../../components/ui/button";
import { TooltipProvider } from "../../components/ui/tooltip";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useStableCallback } from "../../hooks/useStableCallback";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toQuotaWindowState } from "../core/geminiQuota";
import { QuotaProgressRow } from "./RightRailGeminiQuotaCard";
import { composerQuotaSelections } from "./composerQuotaSelection";
import { useDockCopy } from "./panelContext";

const MAGPIE_QUOTA_ACCENT = "#5468db";

type QuotaRead = (
  target: { readonly environmentId: EnvironmentId; readonly input: MagpieGlmQuotaInput },
  signal: AbortSignal,
) => Promise<MagpieGlmQuota>;

export function RightRailGlmQuotaSlot({ scope }: { readonly scope: ScopedThreadRef }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(scope.environmentId));
  const canRead = useAtomValue(
    serverEnvironment.readMagpieGlmQuota.permissionAtom(scope.environmentId),
  );
  const model = useStore(composerQuotaSelections, (selections) => selections.get(threadKey(scope)));
  const command = useAtomCommand(serverEnvironment.readMagpieGlmQuota, { reportFailure: false });
  const read = useStableCallback(async (...[target, signal]: Parameters<QuotaRead>) => {
    const result = await command(target, { signal });
    return result._tag === "Success" ? result.value : ({ status: "unreachable" } as const);
  });
  if (!canRead || !model) return null;
  const saved = config?.settings.magpieGlmQuota;
  const provider = config?.providers.find(
    (provider) => provider.enabled && provider.instanceId === model.instanceId,
  );
  const origin = saved && magpieGatewayOrigin(saved.url);
  const gateway =
    origin && provider && isMagpieGlmDriver(provider.driver)
      ? { instanceId: model.instanceId, origin }
      : undefined;
  const binding = saved
    ? saved.enabled && gateway
      ? { ...gateway, modelAliases: saved.modelAliases }
      : undefined
    : config?.magpieGlmQuota && config.magpieGlmQuota.origin === provider?.auth.endpoint
      ? config.magpieGlmQuota
      : undefined;
  const gptBinding =
    saved?.gpt?.enabled && gateway && provider?.auth.endpoint === gateway.origin
      ? { ...gateway, modelAliases: saved.gpt.modelAliases }
      : undefined;
  if (!binding && !gptBinding) return null;
  const modelName = provider?.models.find((entry) => entry.slug === model.model)?.name;
  return (
    <LiveGlmQuotaSelection
      key={saved?.revision}
      environmentId={scope.environmentId}
      binding={binding}
      gptBinding={gptBinding}
      model={model}
      modelName={modelName}
      read={read}
    />
  );
}

type GlmQuotaSelectionProps = {
  readonly environmentId: EnvironmentId;
  readonly binding: MagpieGlmQuotaBinding | undefined;
  readonly gptBinding?: MagpieGlmQuotaBinding | undefined;
  readonly model: MagpieGlmQuotaInput | undefined;
  readonly modelName?: string | undefined;
  readonly read: QuotaRead;
};

function LiveGlmQuotaSelection(props: GlmQuotaSelectionProps) {
  const minute = useNowMinute();
  const now = toServerClock(props.environmentId, Date.parse(`${minute}:00Z`));
  return <GlmQuotaSelection {...props} now={now} />;
}

export function GlmQuotaSelection({
  environmentId,
  binding,
  gptBinding,
  model,
  modelName,
  read,
  now,
}: GlmQuotaSelectionProps & { readonly now: number }) {
  if (!model) return null;
  const family = magpieQuotaFamily(
    model.model,
    modelName,
    binding?.instanceId === model.instanceId ? binding.modelAliases : undefined,
    gptBinding?.instanceId === model.instanceId ? gptBinding.modelAliases : undefined,
  );
  if (!family) return null;
  return (
    <MagpieQuotaReading
      key={JSON.stringify([environmentId, model.instanceId, model.model, family])}
      family={family}
      environmentId={environmentId}
      input={model}
      read={read}
      now={now}
    />
  );
}

function MagpieQuotaReading({
  family,
  environmentId,
  input,
  read,
  now,
}: {
  readonly family: MagpieQuotaFamily;
  readonly environmentId: EnvironmentId;
  readonly input: MagpieGlmQuotaInput;
  readonly read: QuotaRead;
  readonly now: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [sample, setSample] = useState<{
    readonly attempt: number;
    readonly quota: MagpieGlmQuota;
  }>();
  const { instanceId, model } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the on-demand RPC and aborts it when the selection leaves the rail
  useEffect(() => {
    const cancellation = new AbortController();
    void read({ environmentId, input: { instanceId, model } }, cancellation.signal).then(
      (quota) => {
        if (!cancellation.signal.aborted) setSample({ attempt, quota });
      },
      () => {
        if (!cancellation.signal.aborted) setSample({ attempt, quota: { status: "unreachable" } });
      },
    );
    return () => cancellation.abort();
  }, [attempt, environmentId, instanceId, model, read]);
  const quota = sample?.attempt === attempt ? sample.quota : undefined;
  return (
    <MagpieQuotaCard
      family={family}
      quota={quota}
      now={now}
      readAgain={() => setAttempt((value) => value + 1)}
    />
  );
}

function MagpieBalanceRows({ parts }: { readonly parts: readonly MagpieQuotaBalancePart[] }) {
  const copy = useDockCopy();
  const entries = new Map(
    parts.map((part) => [JSON.stringify([part.label, part.text, part.percent]), part]),
  );
  return (
    <dl className="space-y-2.5">
      {Array.from(entries, ([key, { label, text, percent }]) => {
        const name = label ?? copy.gptQuotaBalance;
        // Magpie sends used percentages; this card always shows remaining quota.
        const remaining = percent === undefined ? undefined : 100 - percent;
        const display = remaining === undefined ? text : `${Number(remaining.toFixed(1))}%`;
        return (
          <div
            key={key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-baseline gap-x-2 gap-y-1"
          >
            <dt className="text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
              {name}
            </dt>
            <dd className="text-right text-xs font-semibold tabular-nums [overflow-wrap:anywhere]">
              {display}
            </dd>
            {remaining !== undefined ? (
              <dd className="col-span-2">
                <div
                  role="progressbar"
                  aria-label={name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={remaining}
                  aria-valuetext={display}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full bg-foreground/70"
                    style={{ width: `${remaining}%` }}
                  />
                </div>
              </dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

function MagpieQuotaCard({
  family,
  quota,
  now,
  readAgain,
}: {
  readonly family: MagpieQuotaFamily;
  readonly quota: MagpieGlmQuota | undefined;
  readonly now: number;
  readonly readAgain: () => void;
}) {
  const copy = useDockCopy();
  const title = family === "gpt" ? copy.gptQuota : copy.glmQuota;
  const fresh = quota?.status === "ready" && Date.parse(quota.expiresAt) > now ? quota : undefined;
  const windows = fresh?.windows.filter((window) => Date.parse(window.resetsAt ?? "") > now) ?? [];
  const parts = fresh?.balanceParts?.length
    ? fresh.balanceParts
    : fresh?.balance !== undefined
      ? [{ text: fresh.balance }]
      : [];
  if (quota?.status === "notApplicable" || quota?.status === "notConfigured") return null;
  const message =
    quota?.status === "noCard"
      ? copy.glmQuotaNoCard
      : quota?.status === "ambiguous"
        ? copy.glmQuotaAmbiguous
        : quota?.status === "unreachable"
          ? copy.glmQuotaUnreachable
          : quota === undefined
            ? copy.glmQuotaReading
            : copy.glmQuotaUnconfirmed;
  return (
    <TooltipProvider>
      <section
        aria-label={title}
        aria-busy={quota === undefined}
        className="dropdown-glass pointer-events-auto shrink-0 overflow-hidden rounded-2xl border border-border/75 bg-card/95 text-card-foreground shadow-sm"
      >
        <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
              <Gauge className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 leading-tight">
              <span className="block text-xs font-semibold">{title}</span>
              <span className="mt-0.5 block text-2xs text-muted-foreground">
                {copy.glmQuotaAccount}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={copy.glmQuotaReadAgain}
            title={copy.glmQuotaReadAgain}
            onClick={readAgain}
            disabled={quota === undefined}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </header>
        <div className="space-y-2.5 px-3 pt-1 pb-2.5">
          {fresh && (windows.length > 0 || parts.length > 0) ? (
            <>
              {parts.length > 0 ? <MagpieBalanceRows parts={parts} /> : null}
              {windows.map((window) => (
                <QuotaProgressRow
                  key={window.id}
                  label={window.kind === "session" ? copy.quotaFiveHour : copy.glmQuotaWeekly}
                  windowState={toQuotaWindowState(window, now)}
                  accentColor={MAGPIE_QUOTA_ACCENT}
                  now={now}
                />
              ))}
              <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
                <Clock3 className="size-3 shrink-0" aria-hidden="true" />
                <time dateTime={fresh.checkedAt} className="min-w-0 tabular-nums">
                  {copy.glmQuotaReadAt.replace(
                    "{time}",
                    new Date(fresh.checkedAt).toLocaleString(),
                  )}
                </time>
              </div>
            </>
          ) : (
            <p role="status" className="text-xs leading-snug text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
