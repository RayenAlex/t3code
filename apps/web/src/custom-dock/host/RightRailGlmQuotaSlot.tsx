import { useAtomValue } from "@effect/atom-react";
import { toServerClock } from "@t3tools/client-runtime/clock";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import {
  isMagpieGlmDriver,
  magpieGatewayOrigin,
  magpieQuotaFamily,
  type MagpieQuotaFamily,
  type EnvironmentId,
  type MagpieGlmQuota,
  type MagpieGlmQuotaBinding,
  type MagpieGlmQuotaInput,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Gauge, RefreshCw } from "lucide-react";
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
  const windows =
    quota?.status === "ready" && Date.parse(quota.expiresAt) > now
      ? quota.windows.filter((window) => Date.parse(window.resetsAt ?? "") > now)
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
        <header className="flex items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            <Gauge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </span>
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
        <div className="space-y-2.5 px-3 py-2.5">
          <p className="text-2xs text-muted-foreground">{copy.glmQuotaAccount}</p>
          {windows.length > 0 && quota?.status === "ready" ? (
            <>
              {windows.map((window) => (
                <QuotaProgressRow
                  key={window.id}
                  label={window.kind === "session" ? copy.quotaFiveHour : copy.glmQuotaWeekly}
                  windowState={toQuotaWindowState(window, now)}
                  accentColor={MAGPIE_QUOTA_ACCENT}
                  now={now}
                />
              ))}
              <time dateTime={quota.checkedAt} className="block text-2xs text-muted-foreground">
                {copy.glmQuotaReadAt.replace("{time}", new Date(quota.checkedAt).toLocaleString())}
              </time>
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
