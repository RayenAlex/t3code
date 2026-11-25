import {
  magpieGatewayOrigin,
  type EnvironmentId,
  type MagpieGlmQuotaSettings as QuotaSettings,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useId, useState } from "react";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./settingsLayout";

interface Props {
  readonly environmentId: EnvironmentId;
  readonly config: QuotaSettings | null;
  readonly readOnly: boolean;
}

export function MagpieGlmQuotaSettings({ environmentId, config, readOnly }: Props) {
  const gt = useGT();
  return (
    <SettingsSection title={gt("Magpie GLM")}>
      <MagpieGlmQuotaForm
        key={`${environmentId}:${config?.revision ?? "new"}`}
        {...{ environmentId, config, readOnly }}
      />
    </SettingsSection>
  );
}

function MagpieGlmQuotaForm({ environmentId, config, readOnly }: Props) {
  const gt = useGT();
  const id = useId();
  const update = useUpdateEnvironmentSettings(environmentId);
  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [url, setUrl] = useState(config?.url ?? "");
  const [provider, setProvider] = useState(config?.provider ?? "zhipu");
  const [user, setUser] = useState(config?.user ?? "");
  const [subscription, setSubscription] = useState(config?.kind === "subscription");
  const [aliases, setAliases] = useState(config?.modelAliases.join(", ") ?? "");
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const origin = magpieGatewayOrigin(url.trim());
  const keepKey = !removeKey && config !== null && origin === magpieGatewayOrigin(config.url);
  const modelAliases = [
    ...new Set(
      aliases
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const canSave =
    !readOnly &&
    !saving &&
    origin !== undefined &&
    provider.trim() !== "" &&
    modelAliases.every((alias) => alias.length <= 512);

  return (
    <form
      className="grid max-w-xl gap-3 px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave || origin === undefined) return;
        setSaving(true);
        update(
          {
            magpieGlmQuota: {
              enabled,
              url: origin,
              provider: provider.trim(),
              user: user.trim(),
              kind: subscription ? "subscription" : "plan",
              modelAliases,
              gatewayKey: key.trim() || (keepKey ? config.gatewayKey : ""),
              revision: randomUUID(),
            },
          },
          {
            onSaved: () => {
              setKey("");
              setSaving(false);
            },
            onFailed: () => setSaving(false),
          },
        );
      }}
    >
      <p className="text-xs text-muted-foreground">
        <T>
          Show cached GLM quota for Claude Code and Codex instances using this gateway. Saving does
          not change model routing.
        </T>
      </p>
      <fieldset className="grid min-w-0 gap-3" disabled={readOnly || saving}>
        <Label htmlFor={`${id}-enabled`}>
          <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
          <T>Show GLM quota</T>
        </Label>
        <Label className="grid">
          <T>Magpie gateway URL</T>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://127.0.0.1:3425"
            required
          />
        </Label>
        <Label className="grid">
          <T>Magpie quota provider</T>
          <Input value={provider} onChange={(event) => setProvider(event.target.value)} required />
        </Label>
        <Label className="grid">
          <T>Magpie account name (optional)</T>
          <Input value={user} onChange={(event) => setUser(event.target.value)} />
        </Label>
        <Label htmlFor={`${id}-subscription`}>
          <Switch
            id={`${id}-subscription`}
            checked={subscription}
            onCheckedChange={setSubscription}
          />
          <T>Use a subscription card instead of a plan card</T>
        </Label>
        <Label className="grid">
          <T>GLM model aliases (comma-separated)</T>
          <Input value={aliases} onChange={(event) => setAliases(event.target.value)} />
        </Label>
        <Label className="grid">
          <T>Magpie gateway key (if required)</T>
          <Input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setRemoveKey(false);
            }}
            placeholder={keepKey && config.gatewayKey ? gt("Key saved") : undefined}
          />
        </Label>
        {keepKey && config.gatewayKey && !key ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => setRemoveKey(true)}
          >
            <T>Clear saved key</T>
          </Button>
        ) : null}
      </fieldset>
      <Button size="sm" type="submit" className="justify-self-start" disabled={!canSave}>
        <T>Save Magpie settings</T>
      </Button>
    </form>
  );
}
