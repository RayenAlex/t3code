import { ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";

import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { randomUUID } from "../../lib/utils";
import en from "../copy/en.json";
import { parseExternalPanelUrl } from "../host/externalUrl";
import { dockPreferences, useDockCopy, useDockRuntime } from "../host/panelContext";
import type {
  CustomDockPanelDefinition,
  CustomDockThreadSnapshot,
  ExternalWebPanelConfig,
} from "../host/types";

function readonlyMetrics(snapshot: CustomDockThreadSnapshot) {
  const run = snapshot.currentRun;
  return {
    contextWindow: snapshot.contextWindow,
    phase: snapshot.activity.phase,
    currentRun: run && {
      status: run.status,
      elapsedMs: run.elapsedMs,
      waitingUserMs: run.waitingUserMs,
      toolMs: run.toolMs,
      tokenUsage: run.tokenUsage,
      cacheHitRate: run.cacheHitRate,
      turnAvgOutputTps: run.turnAvgOutputTps,
      activeOutputTps: run.activeOutputTps,
    },
    todo: {
      status: snapshot.plans.todoStatus,
      done: snapshot.plans.steps.filter((step) => step.stage === "Done").length,
      total: snapshot.plans.steps.length,
      referenceEtaMs: snapshot.plans.referenceEtaMs,
    },
  };
}

export function ExternalPanelFrame({ config }: { readonly config: ExternalWebPanelConfig }) {
  const copy = useDockCopy();
  const { snapshot } = useDockRuntime();
  const url = parseExternalPanelUrl(config.url);
  const ref = useRef<HTMLIFrameElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const lastSend = useRef(-Infinity);
  const origin = url?.origin;
  const href = url?.href;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends opted-in numeric metrics to the loaded frame at its configured origin
  useEffect(() => {
    if (!config.sendReadonlySnapshot || !snapshot || !origin || !href || loadedUrl !== href) return;
    const delay = Math.max(0, 500 - (performance.now() - lastSend.current));
    const timer = setTimeout(() => {
      const recipient = ref.current?.contentWindow;
      if (!recipient) return;
      recipient.postMessage(
        { protocol: "t3-custom-dock/1", type: "snapshot", payload: readonlyMetrics(snapshot) },
        origin,
      );
      lastSend.current = performance.now();
    }, delay);
    return () => clearTimeout(timer);
  }, [config.sendReadonlySnapshot, href, loadedUrl, origin, snapshot]);
  if (!url) return <p className="p-3 text-xs text-destructive-foreground">{copy.invalidUrl}</p>;
  return (
    <div className="flex h-full min-h-56 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <p
          className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground"
          aria-label={url.origin}
        >
          {url.origin}
        </p>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={copy.openOutside}
          render={<a href={url.href} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLink />
        </Button>
      </div>
      <iframe
        key={url.href}
        ref={ref}
        src={url.href}
        title={config.title}
        // oxlint-disable-next-line react/iframe-missing-sandbox -- only explicit cross-origin URLs are loaded; the recipient needs a real origin for exact-origin messaging
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() => setLoadedUrl(url.href)}
        className="min-h-0 w-full flex-1 bg-background"
      />
    </div>
  );
}

function ExternalForm({
  panel,
  onDone,
}: {
  readonly panel: ExternalWebPanelConfig | null;
  readonly onDone: () => void;
}) {
  const copy = useDockCopy();
  const nameId = useId();
  const urlId = useId();
  const [name, setName] = useState(panel?.title ?? "");
  const [url, setUrl] = useState(panel?.url ?? "");
  const [share, setShare] = useState(panel?.sendReadonlySnapshot ?? false);
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && parseExternalPanelUrl(url) === null;
  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        const safe = parseExternalPanelUrl(url);
        if (!safe || name.trim() === "") return;
        const dock = dockPreferences.getState();
        dock.upsertExternalPanel({
          id: panel?.id ?? `external-${randomUUID()}`,
          title: name.trim(),
          url: safe.href,
          sendReadonlySnapshot: share,
        });
        onDone();
      }}
    >
      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor={nameId}>
          {copy.panelTitle}
        </label>
        <Input
          id={nameId}
          nativeInput
          required
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor={urlId}>
          {copy.panelUrl}
        </label>
        <Input
          id={urlId}
          nativeInput
          required
          type="url"
          value={url}
          aria-invalid={invalid}
          onChange={(event) => {
            setUrl(event.currentTarget.value);
            setShare(false);
          }}
        />
        {invalid && (
          <p role="alert" className="text-xs text-destructive-foreground">
            {copy.invalidUrl}
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs font-medium">
        <Checkbox checked={share} onCheckedChange={setShare} />
        {copy.snapshotOptIn}
      </label>
      <p className="text-xs text-muted-foreground">{copy.snapshotHelp}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {copy.cancel}
        </Button>
        <Button type="submit" size="sm">
          {copy.save}
        </Button>
      </div>
    </form>
  );
}

export function ExternalWebSettings() {
  const copy = useDockCopy();
  const panels = useStore(dockPreferences, (state) => state.externalPanels);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const current = panels.find((panel) => panel.id === editing) ?? null;
  return (
    <section className="space-y-3 p-3">
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.noExternal}</p>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus />
          {copy.addPanel}
        </Button>
      </div>
      {editing && <ExternalForm key={editing} panel={current} onDone={() => setEditing(null)} />}
      {panels.map((panel) => (
        <div key={panel.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex min-w-0 items-start gap-2">
            <Globe className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium">{panel.title}</h3>
              <p
                className="truncate font-mono text-2xs text-muted-foreground"
                aria-label={panel.url}
              >
                {panel.url}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-1">
            <Button size="xs" variant="ghost" onClick={() => setEditing(panel.id)}>
              {copy.editPanel}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost-destructive"
              aria-label={copy.deletePanel}
              onClick={() => {
                if (editing === panel.id) setEditing(null);
                dockPreferences.getState().removeExternalPanel(panel.id);
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground">{copy.frameNotice}</p>
    </section>
  );
}

export const panelDefinition: CustomDockPanelDefinition = {
  id: "external-web",
  title: en.external,
  icon: "globe",
  order: 20,
  renderPanel: () => <ExternalWebSettings />,
};
