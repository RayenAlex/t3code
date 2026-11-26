import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Terminal,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  buildMvnOpCommand,
  buildNpmShellCommand,
  EMPTY_MODULE_CONFIG,
  formatProxyTargetBadge,
  hasCustomModuleConfig,
  isJarModule,
  isNpmRunnerCommand,
  NPM_DEV_SCRIPT,
  npmRunnerCommand,
  npmRunnerScript,
  resolveProxyTarget,
  validateJarRunnerModuleConfig,
  type JarRunnerCommand,
  type JarRunnerModule,
  type NpmRunnerProject,
  type RunnerCommand,
  type RunnerModule,
  type RunnerModuleConfig,
} from "./jarRunnerModules";
import { useDockCopy } from "./panelContext";

export type {
  JarRunnerCommand,
  JarRunnerModule,
  NpmRunnerProject,
  RunnerCommand,
  RunnerModule,
  RunnerModuleConfig,
} from "./jarRunnerModules";

export interface RunnerModuleRun {
  readonly command: RunnerCommand;
  readonly terminalId: string;
  readonly running: boolean;
}

export interface RunnerModuleView {
  readonly module: RunnerModule;
  readonly run: RunnerModuleRun | null;
  readonly config: RunnerModuleConfig;
  readonly availableProfiles: ReadonlyArray<string>;
}

function formatRunBadge(run: RunnerModuleRun, copy: ReturnType<typeof useDockCopy>): string {
  if (isNpmRunnerCommand(run.command)) return npmRunnerScript(run.command);
  if (run.command === "jar") return copy.jarActionNativeStart;
  if (run.command === "mvn-op") return copy.jarActionStart;
  return copy.jarActionPackage;
}

function StatusDot({ state }: { readonly state: "running" | "stopped" | "idle" }) {
  const tone =
    state === "running"
      ? "bg-success"
      : state === "stopped"
        ? "bg-muted-foreground/45"
        : "border border-muted-foreground/35";
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${tone}`} />;
}

function ScriptLabel({ script }: { readonly script: string }) {
  const colonIndex = script.indexOf(":");
  if (colonIndex <= 0 || colonIndex === script.length - 1) {
    return <span className="truncate font-mono text-xs">{script}</span>;
  }
  return (
    <span className="truncate font-mono text-xs">
      <span className="text-muted-foreground/60">{script.slice(0, colonIndex + 1)}</span>
      <span>{script.slice(colonIndex + 1)}</span>
    </span>
  );
}

function ConfigSummaryLine({
  config,
  onToggleEditor,
}: {
  readonly config: RunnerModuleConfig;
  readonly onToggleEditor: () => void;
}) {
  const copy = useDockCopy();
  if (!hasCustomModuleConfig(config)) return null;
  const profile = config.profile.trim();
  const serverPort = config.serverPort.trim();
  const debugPort = config.debugPort.trim();
  const proxyTarget = config.proxyTarget.trim();

  const items: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (proxyTarget.length > 0) {
    items.push({
      key: "proxy",
      node: (
        <Tooltip>
          <TooltipTrigger render={<span className="truncate font-mono" />}>
            {proxyTarget}
          </TooltipTrigger>
          <TooltipPopup side="top">{proxyTarget}</TooltipPopup>
        </Tooltip>
      ),
    });
  }
  if (profile.length > 0) {
    items.push({ key: "profile", node: <span className="shrink-0 font-mono">{profile}</span> });
  }
  if (serverPort.length > 0) {
    items.push({
      key: "serverPort",
      node: <span className="shrink-0 font-mono">:{serverPort}</span>,
    });
  }
  if (debugPort.length > 0) {
    items.push({
      key: "debugPort",
      node: (
        <span className="shrink-0 tabular-nums">
          {copy.jarDebugPortShort.replace("{port}", debugPort)}
        </span>
      ),
    });
  }

  return (
    <button
      type="button"
      onClick={onToggleEditor}
      className="mb-2.5 flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded pl-3.5 text-left text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {items.map((item, index) => (
        <span key={item.key} className="inline-flex min-w-0 items-center gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-muted-foreground/35">
              ·
            </span>
          )}
          {item.node}
        </span>
      ))}
    </button>
  );
}

function JarModuleConfigEditor({
  module,
  config,
  availableProfiles,
  onChangeConfig,
}: {
  readonly module: JarRunnerModule;
  readonly config: RunnerModuleConfig;
  readonly availableProfiles: ReadonlyArray<string>;
  readonly onChangeConfig: (moduleId: string, next: RunnerModuleConfig) => void;
}) {
  const copy = useDockCopy();
  const validation = validateJarRunnerModuleConfig(config);
  const previewCommand = buildMvnOpCommand(module, config);
  const hasCustom = hasCustomModuleConfig(config);
  const activeProfile = config.profile.trim();

  return (
    <div
      data-jar-config-editor={module.name}
      className="mt-2 space-y-2 rounded-lg bg-muted/45 p-2.5"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <label
            htmlFor={`jar-profile-${module.id || "root"}`}
            className="text-2xs font-medium text-muted-foreground"
          >
            {copy.jarProfileLabel}
          </label>
          {hasCustom && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-micro"
                    aria-label={copy.jarResetConfig}
                    onClick={() => onChangeConfig(module.id, EMPTY_MODULE_CONFIG)}
                  />
                }
              >
                <RotateCcw aria-hidden="true" />
              </TooltipTrigger>
              <TooltipPopup side="top">{copy.jarResetConfig}</TooltipPopup>
            </Tooltip>
          )}
        </div>
        <Input
          id={`jar-profile-${module.id || "root"}`}
          size="compact"
          font="mono"
          aria-invalid={!validation.profileValid || undefined}
          placeholder={copy.jarProfilePlaceholder}
          value={config.profile}
          onChange={(event) =>
            onChangeConfig(module.id, {
              ...config,
              profile: event.currentTarget.value,
            })
          }
        />
        {availableProfiles.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {availableProfiles.map((profile) => {
              const selected = activeProfile === profile;
              return (
                <button
                  key={profile}
                  type="button"
                  onClick={() =>
                    onChangeConfig(module.id, {
                      ...config,
                      profile: selected ? "" : profile,
                    })
                  }
                  className={
                    selected
                      ? "cursor-pointer rounded-md bg-foreground px-1.5 py-0.5 font-mono text-2xs font-medium text-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      : "cursor-pointer rounded-md bg-background/75 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  }
                >
                  {profile}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <label
            htmlFor={`jar-server-port-${module.id || "root"}`}
            className="block text-2xs font-medium text-muted-foreground"
          >
            {copy.jarServerPortLabel}
          </label>
          <Input
            id={`jar-server-port-${module.id || "root"}`}
            size="compact"
            font="mono"
            inputMode="numeric"
            aria-invalid={!validation.serverPortValid || undefined}
            placeholder={copy.jarServerPortPlaceholder}
            value={config.serverPort}
            onChange={(event) =>
              onChangeConfig(module.id, {
                ...config,
                serverPort: event.currentTarget.value,
              })
            }
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`jar-debug-port-${module.id || "root"}`}
            className="block text-2xs font-medium text-muted-foreground"
          >
            {copy.jarDebugPortLabel}
          </label>
          <Input
            id={`jar-debug-port-${module.id || "root"}`}
            size="compact"
            font="mono"
            inputMode="numeric"
            aria-invalid={!validation.debugPortValid || undefined}
            placeholder={String(module.debugPort ?? 50055)}
            value={config.debugPort}
            onChange={(event) =>
              onChangeConfig(module.id, {
                ...config,
                debugPort: event.currentTarget.value,
              })
            }
          />
        </div>
      </div>

      {!validation.isValid && (
        <p role="status" className="text-2xs leading-snug text-destructive-foreground">
          {copy.jarInvalidConfig}
        </p>
      )}

      <p className="rounded-md bg-background/65 px-2 py-1 font-mono text-2xs break-all text-muted-foreground">
        {previewCommand}
      </p>
    </div>
  );
}

interface BackendPortSuggestion {
  readonly label: string;
  readonly port: string;
}

function NpmProjectConfigEditor({
  project,
  config,
  backendPortSuggestions,
  onChangeConfig,
}: {
  readonly project: NpmRunnerProject;
  readonly config: RunnerModuleConfig;
  readonly backendPortSuggestions: ReadonlyArray<BackendPortSuggestion>;
  readonly onChangeConfig: (moduleId: string, next: RunnerModuleConfig) => void;
}) {
  const copy = useDockCopy();
  const resolvedProxy = resolveProxyTarget(config.proxyTarget);
  const proxyTargetValid = resolvedProxy !== null;
  const inputId = `npm-proxy-${project.id}`;

  return (
    <div
      data-jar-config-editor={project.name}
      className="mt-2 space-y-2 rounded-lg bg-muted/45 p-2.5"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <label htmlFor={inputId} className="text-2xs font-medium text-muted-foreground">
            {copy.npmProxyTargetLabel}
          </label>
          {config.proxyTarget.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-micro"
                    aria-label={copy.jarResetConfig}
                    onClick={() => onChangeConfig(project.id, EMPTY_MODULE_CONFIG)}
                  />
                }
              >
                <RotateCcw aria-hidden="true" />
              </TooltipTrigger>
              <TooltipPopup side="top">{copy.jarResetConfig}</TooltipPopup>
            </Tooltip>
          )}
        </div>
        <Input
          id={inputId}
          size="compact"
          font="mono"
          aria-invalid={!proxyTargetValid || undefined}
          placeholder={copy.npmProxyTargetPlaceholder}
          value={config.proxyTarget}
          onChange={(event) =>
            onChangeConfig(project.id, {
              ...config,
              proxyTarget: event.currentTarget.value,
            })
          }
        />
        {backendPortSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {backendPortSuggestions.map((suggestion) => {
              const targetUrl = `http://localhost:${suggestion.port}`;
              const selected = resolvedProxy === targetUrl;
              return (
                <button
                  key={`${suggestion.label}:${suggestion.port}`}
                  type="button"
                  onClick={() =>
                    onChangeConfig(project.id, {
                      ...config,
                      proxyTarget: selected ? "" : suggestion.port,
                    })
                  }
                  className={
                    selected
                      ? "cursor-pointer rounded-md bg-foreground px-1.5 py-0.5 font-mono text-2xs font-medium text-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      : "cursor-pointer rounded-md bg-background/75 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  }
                >
                  {`${suggestion.label} :${suggestion.port}`}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!proxyTargetValid && (
        <p role="status" className="text-2xs leading-snug text-destructive-foreground">
          {copy.npmInvalidProxyTarget}
        </p>
      )}

      <p className="rounded-md bg-background/65 px-2 py-1 font-mono text-2xs break-all text-muted-foreground">
        {buildNpmShellCommand(NPM_DEV_SCRIPT, config)}
      </p>
    </div>
  );
}

function ModuleConfigEditor({
  view,
  backendPortSuggestions,
  onChangeConfig,
}: {
  readonly view: RunnerModuleView;
  readonly backendPortSuggestions: ReadonlyArray<BackendPortSuggestion>;
  readonly onChangeConfig: (moduleId: string, next: RunnerModuleConfig) => void;
}) {
  const { module, config } = view;
  return module.kind === "jar" ? (
    <JarModuleConfigEditor
      module={module}
      config={config}
      availableProfiles={view.availableProfiles}
      onChangeConfig={onChangeConfig}
    />
  ) : (
    <NpmProjectConfigEditor
      project={module}
      config={config}
      backendPortSuggestions={backendPortSuggestions}
      onChangeConfig={onChangeConfig}
    />
  );
}

const SEGMENT_BASE =
  "inline-flex h-7 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45";

function JarModuleActions({
  module,
  run,
  config,
  disabled,
  named,
  onRun,
}: {
  readonly module: JarRunnerModule;
  readonly run: RunnerModuleRun | null;
  readonly config: RunnerModuleConfig;
  readonly disabled: boolean;
  readonly named: boolean;
  readonly onRun: (module: JarRunnerModule, command: JarRunnerCommand) => void;
}) {
  const copy = useDockCopy();
  const configDisabled = disabled || !validateJarRunnerModuleConfig(config).isValid;
  const mvnOpCommand = buildMvnOpCommand(module, config);
  const activeCommand = run?.running ? run.command : null;

  const actions: ReadonlyArray<{
    readonly command: JarRunnerCommand;
    readonly label: string;
    readonly primary?: boolean;
    readonly isDisabled: boolean;
    readonly tooltip: string;
  }> = [
    {
      command: "mvn-op",
      label: copy.jarActionStart,
      primary: true,
      isDisabled: configDisabled,
      tooltip: copy.jarRunMvnOpTooltip.replace("{command}", mvnOpCommand),
    },
    {
      command: "jar",
      label: copy.jarActionNativeStart,
      isDisabled: configDisabled,
      tooltip: copy.jarRunJarTooltip,
    },
    {
      command: "mvn-p",
      label: copy.jarActionPackage,
      isDisabled: disabled,
      tooltip: copy.jarRunMvnPTooltip,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted/60 p-0.5 dark:bg-foreground/[0.05]">
      {actions.map((action) => {
        const isRunning = activeCommand === action.command;
        const elevated = isRunning || (activeCommand === null && action.primary);
        const tone = elevated
          ? "bg-card font-medium text-foreground shadow-2xs hover:bg-card/90 dark:bg-foreground/[0.11] dark:hover:bg-foreground/[0.15]"
          : "text-muted-foreground hover:bg-card/70 hover:text-foreground dark:hover:bg-foreground/[0.07]";
        return (
          <Tooltip key={action.command}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={action.isDisabled}
                  aria-label={
                    named
                      ? copy.jarRunModuleAction
                          .replace("{module}", module.name)
                          .replace("{action}", action.label)
                      : undefined
                  }
                  onClick={() => onRun(module, action.command)}
                  className={`${SEGMENT_BASE} ${tone}`}
                />
              }
            >
              {isRunning ? (
                <StatusDot state="running" />
              ) : action.primary ? (
                <Play className="size-2.5 shrink-0 fill-current opacity-75" aria-hidden="true" />
              ) : null}
              <span className="truncate">{action.label}</span>
            </TooltipTrigger>
            <TooltipPopup side="top">{action.tooltip}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

function NpmProjectActions({
  project,
  run,
  config,
  disabled,
  named,
  editing,
  editor,
  onToggleEditor,
  onRunNpm,
}: {
  readonly project: NpmRunnerProject;
  readonly run: RunnerModuleRun | null;
  readonly config: RunnerModuleConfig;
  readonly disabled: boolean;
  readonly named: boolean;
  readonly editing: boolean;
  readonly editor: ReactNode;
  readonly onToggleEditor: () => void;
  readonly onRunNpm: (project: NpmRunnerProject, script: string) => void;
}) {
  const copy = useDockCopy();
  const hasDev = project.scripts.includes(NPM_DEV_SCRIPT);
  const otherScripts = project.scripts.filter((script) => script !== NPM_DEV_SCRIPT);
  const activeCommand = run?.running ? run.command : null;
  const resolvedProxy = resolveProxyTarget(config.proxyTarget);
  const proxyValid = resolvedProxy !== null;
  const proxyBadge = formatProxyTargetBadge(config.proxyTarget);
  const devDisabled = disabled || !proxyValid;
  const devRunning = activeCommand === npmRunnerCommand(NPM_DEV_SCRIPT);
  const configureLabel = named
    ? copy.npmConfigureModule.replace("{module}", project.name)
    : copy.npmConfigure;

  function scriptAriaLabel(script: string): string | undefined {
    return named
      ? copy.npmRunModuleScript.replace("{module}", project.name).replace("{script}", script)
      : undefined;
  }

  return (
    <div>
      {hasDev && (
        <div className="flex h-8 w-full items-center overflow-hidden rounded-lg bg-muted/70 dark:bg-foreground/[0.08]">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={devDisabled}
                  aria-label={scriptAriaLabel(NPM_DEV_SCRIPT)}
                  onClick={() => onRunNpm(project, NPM_DEV_SCRIPT)}
                  className="group flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 dark:hover:bg-foreground/[0.06]"
                />
              }
            >
              {devRunning ? (
                <StatusDot state="running" />
              ) : (
                <Play
                  className="size-3 shrink-0 fill-current text-foreground/75 transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="truncate font-mono text-xs font-medium text-foreground">
                {NPM_DEV_SCRIPT}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {copy.npmRunScriptTooltip.replace(
                "{command}",
                buildNpmShellCommand(NPM_DEV_SCRIPT, config),
              )}
            </TooltipPopup>
          </Tooltip>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/65" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={configureLabel}
                  aria-expanded={editing}
                  onClick={onToggleEditor}
                  className={
                    editing
                      ? "flex h-full max-w-[58%] shrink-0 cursor-pointer items-center gap-1 bg-foreground/[0.07] px-2 text-2xs font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-foreground/[0.12]"
                      : !proxyValid
                        ? "flex h-full max-w-[58%] shrink-0 cursor-pointer items-center gap-1 px-2 text-2xs font-medium text-destructive-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-foreground/[0.06]"
                        : proxyBadge
                          ? "flex h-full max-w-[58%] shrink-0 cursor-pointer items-center gap-1 px-2 text-2xs font-medium text-foreground/85 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-foreground/[0.06]"
                          : "flex h-full max-w-[58%] shrink-0 cursor-pointer items-center gap-1 px-2 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-foreground/[0.06]"
                  }
                />
              }
            >
              {proxyBadge ? (
                <>
                  <ArrowRight className="size-2.5 shrink-0 opacity-60" aria-hidden="true" />
                  <span className="truncate font-mono">{proxyBadge}</span>
                </>
              ) : (
                <span className="truncate">{copy.npmBackendPortShort}</span>
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{resolvedProxy || configureLabel}</TooltipPopup>
          </Tooltip>
        </div>
      )}

      {hasDev && editing && editor}

      {otherScripts.length > 0 && (
        <div className={hasDev ? "mt-1.5 space-y-0.5" : "space-y-0.5"}>
          {otherScripts.map((script) => {
            const command = buildNpmShellCommand(script, config);
            const isRunning = activeCommand === npmRunnerCommand(script);
            return (
              <Tooltip key={script}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={scriptAriaLabel(script)}
                      onClick={() => onRunNpm(project, script)}
                      className="group flex h-7 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-left text-foreground/85 transition-colors hover:bg-muted/65 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 dark:hover:bg-foreground/[0.07]"
                    />
                  }
                >
                  <ScriptLabel script={script} />
                  {isRunning ? (
                    <StatusDot state="running" />
                  ) : (
                    <Play
                      className="size-2.5 shrink-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden="true"
                    />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {copy.npmRunScriptTooltip.replace("{command}", command)}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModuleActions({
  view,
  disabled,
  named,
  editing,
  editor,
  onToggleEditor,
  onRun,
  onRunNpm,
}: {
  readonly view: RunnerModuleView;
  readonly disabled: boolean;
  readonly named: boolean;
  readonly editing: boolean;
  readonly editor: ReactNode;
  readonly onToggleEditor: () => void;
  readonly onRun: (module: JarRunnerModule, command: JarRunnerCommand) => void;
  readonly onRunNpm: (project: NpmRunnerProject, script: string) => void;
}) {
  const { module, run, config } = view;
  return module.kind === "jar" ? (
    <JarModuleActions
      module={module}
      run={run}
      config={config}
      disabled={disabled}
      named={named}
      onRun={onRun}
    />
  ) : (
    <NpmProjectActions
      project={module}
      run={run}
      config={config}
      disabled={disabled}
      named={named}
      editing={editing}
      editor={editor}
      onToggleEditor={onToggleEditor}
      onRunNpm={onRunNpm}
    />
  );
}

function ModuleControls({
  view,
  canRun,
  editing,
  size,
  named,
  onToggleEditor,
  onStop,
  onOpenTerminal,
}: {
  readonly view: RunnerModuleView;
  readonly canRun: boolean;
  readonly editing: boolean;
  readonly size: "icon-xs" | "icon-micro";
  /** Rows name controls after their module; a lone module keeps the short labels. */
  readonly named: boolean;
  readonly onToggleEditor: () => void;
  readonly onStop: (terminalId: string) => void;
  readonly onOpenTerminal: (terminalId: string) => void;
}) {
  const copy = useDockCopy();
  const { module, run, config } = view;
  const isJar = module.kind === "jar";
  const withModule = (text: string) => text.replace("{module}", module.name);
  const configureLabel = named ? withModule(copy.jarConfigureModule) : copy.jarConfigure;
  const stopLabel = named ? withModule(copy.jarStopModuleRun) : copy.jarStopRun;
  const openTerminalLabel = named ? withModule(copy.jarOpenModuleTerminal) : copy.jarOpenTerminal;

  return (
    <>
      {isJar && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={editing || hasCustomModuleConfig(config) ? "secondary" : "ghost-muted"}
                size={size}
                aria-label={configureLabel}
                aria-expanded={editing}
                onClick={onToggleEditor}
              />
            }
          >
            <SlidersHorizontal aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">{configureLabel}</TooltipPopup>
        </Tooltip>
      )}
      {run?.running && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-destructive"
                size={size}
                disabled={!canRun}
                aria-label={stopLabel}
                onClick={() => onStop(run.terminalId)}
              />
            }
          >
            <Square aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">{stopLabel}</TooltipPopup>
        </Tooltip>
      )}
      {run && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size={size}
                aria-label={openTerminalLabel}
                onClick={() => onOpenTerminal(run.terminalId)}
              />
            }
          >
            <Terminal aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">{openTerminalLabel}</TooltipPopup>
        </Tooltip>
      )}
    </>
  );
}

export function RightRailJarRunnerCard({
  canRun,
  busyKey,
  modules,
  error,
  onRun,
  onRunNpm,
  onRunAll,
  onOpenTerminal,
  onStop,
  onStopAll,
  onChangeConfig,
}: {
  readonly canRun: boolean;
  readonly busyKey: string | null;
  readonly modules: ReadonlyArray<RunnerModuleView>;
  readonly error: string | null;
  readonly onRun: (module: JarRunnerModule, command: JarRunnerCommand) => void;
  readonly onRunNpm: (project: NpmRunnerProject, script: string) => void;
  readonly onRunAll: (command: "mvn-op" | "jar") => void;
  readonly onOpenTerminal: (terminalId: string) => void;
  readonly onStop: (moduleId: string, terminalId: string) => void;
  readonly onStopAll: () => void;
  readonly onChangeConfig: (moduleId: string, next: RunnerModuleConfig) => void;
}) {
  const copy = useDockCopy();
  const [minimized, setMinimized] = useState(false);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);

  if (modules.length === 0) return null;

  const isMultiModule = modules.length > 1;
  const includesNpm = modules.some((item) => !isJarModule(item.module));
  const title = includesNpm ? copy.runnerTitle : copy.jarRunner;
  const expandLabel = includesNpm ? copy.runnerExpand : copy.jarExpand;
  const collapseLabel = includesNpm ? copy.runnerCollapse : copy.jarCollapse;
  const jarModules = modules.filter((item) => isJarModule(item.module));
  const backendPortSuggestions: ReadonlyArray<BackendPortSuggestion> = jarModules.flatMap(
    (item) => {
      const port = item.config.serverPort.trim();
      if (!port || !validateJarRunnerModuleConfig(item.config).serverPortValid) return [];
      return [{ label: item.module.name, port }];
    },
  );
  const allJarRunning = jarModules.every((item) => item.run?.running);
  const runningCount = modules.filter((item) => item.run?.running).length;
  const singleItem = modules[0];
  const actionsDisabled = !canRun || busyKey !== null;
  const hasInvalidConfig = jarModules.some(
    (item) => !validateJarRunnerModuleConfig(item.config).isValid,
  );

  function toggleEditor(moduleId: string) {
    setEditingModuleId((current) => (current === moduleId ? null : moduleId));
  }

  return (
    <TooltipProvider>
      <section
        data-custom-dock-jar-runner="inline"
        aria-label={title}
        className="dropdown-glass pointer-events-auto shrink-0 overflow-hidden rounded-2xl border border-border/75 bg-card/95 text-card-foreground shadow-sm"
      >
        <header
          className={
            !minimized && isMultiModule
              ? "flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2"
              : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"
          }
        >
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{title}</span>
            {isMultiModule ? (
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs font-normal text-muted-foreground tabular-nums">
                <StatusDot state={runningCount > 0 ? "running" : "stopped"} />
                <span>
                  {copy.jarRunningCount
                    .replace("{running}", String(runningCount))
                    .replace("{total}", String(modules.length))}
                </span>
              </span>
            ) : (
              singleItem?.run && (
                <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-normal text-muted-foreground">
                  <StatusDot state={singleItem.run.running ? "running" : "stopped"} />
                  <span>{formatRunBadge(singleItem.run, copy)}</span>
                </span>
              )
            )}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {isMultiModule ? (
              <>
                {jarModules.length > 1 && (
                  <>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost-muted"
                            size="icon-xs"
                            disabled={actionsDisabled || allJarRunning || hasInvalidConfig}
                            aria-label={copy.jarStartAllMvnOp}
                            onClick={() => onRunAll("mvn-op")}
                          />
                        }
                      >
                        <Play aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">{copy.jarStartAllMvnOp}</TooltipPopup>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost-muted"
                            size="icon-xs"
                            disabled={actionsDisabled || allJarRunning || hasInvalidConfig}
                            aria-label={copy.jarStartAllJar}
                            onClick={() => onRunAll("jar")}
                          />
                        }
                      >
                        <Zap aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">{copy.jarStartAllJar}</TooltipPopup>
                    </Tooltip>
                  </>
                )}
                {runningCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost-destructive"
                          size="icon-xs"
                          disabled={!canRun}
                          aria-label={copy.jarStopAll}
                          onClick={onStopAll}
                        />
                      }
                    >
                      <Square aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{copy.jarStopAll}</TooltipPopup>
                  </Tooltip>
                )}
              </>
            ) : (
              singleItem && (
                <ModuleControls
                  view={singleItem}
                  canRun={canRun}
                  editing={editingModuleId === singleItem.module.id}
                  size="icon-xs"
                  named={false}
                  onToggleEditor={() => {
                    if (minimized) setMinimized(false);
                    toggleEditor(singleItem.module.id);
                  }}
                  onStop={(_terminalId) => {
                    if (singleItem.run) onStop(singleItem.module.id, singleItem.run.terminalId);
                  }}
                  onOpenTerminal={onOpenTerminal}
                />
              )
            )}
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={minimized ? expandLabel : collapseLabel}
              aria-expanded={!minimized}
              onClick={() => setMinimized((value) => !value)}
            >
              {minimized ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            </Button>
          </div>
        </header>

        {!minimized && (
          <div className="max-h-96 overflow-y-auto">
            {isMultiModule ? (
              <div className="divide-y divide-border/45">
                {modules.map((view) => {
                  const { module, run } = view;
                  const isEditing = editingModuleId === module.id;
                  return (
                    <div
                      key={module.id || "__root__"}
                      data-jar-module={module.name}
                      className="px-3 py-3"
                    >
                      <div
                        className={
                          isJarModule(module) && !isEditing && hasCustomModuleConfig(view.config)
                            ? "mb-1 flex items-center justify-between gap-2"
                            : "mb-2 flex items-center justify-between gap-2"
                        }
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <StatusDot state={run?.running ? "running" : run ? "stopped" : "idle"} />
                          <span className="truncate font-mono text-xs font-medium text-foreground">
                            {module.name}
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <ModuleControls
                            view={view}
                            canRun={canRun}
                            editing={isEditing}
                            size="icon-micro"
                            named
                            onToggleEditor={() => toggleEditor(module.id)}
                            onStop={(terminalId) => onStop(module.id, terminalId)}
                            onOpenTerminal={onOpenTerminal}
                          />
                        </div>
                      </div>
                      {isJarModule(module) && !isEditing && (
                        <ConfigSummaryLine
                          config={view.config}
                          onToggleEditor={() => toggleEditor(module.id)}
                        />
                      )}
                      <ModuleActions
                        view={view}
                        disabled={actionsDisabled}
                        named
                        editing={isEditing}
                        editor={
                          <ModuleConfigEditor
                            view={view}
                            backendPortSuggestions={backendPortSuggestions}
                            onChangeConfig={onChangeConfig}
                          />
                        }
                        onToggleEditor={() => toggleEditor(module.id)}
                        onRun={onRun}
                        onRunNpm={onRunNpm}
                      />
                      {isJarModule(module) && isEditing && (
                        <ModuleConfigEditor
                          view={view}
                          backendPortSuggestions={backendPortSuggestions}
                          onChangeConfig={onChangeConfig}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              singleItem && (
                <div className="px-2.5 pt-0.5 pb-2.5">
                  {isJarModule(singleItem.module) && editingModuleId !== singleItem.module.id && (
                    <ConfigSummaryLine
                      config={singleItem.config}
                      onToggleEditor={() => toggleEditor(singleItem.module.id)}
                    />
                  )}
                  <ModuleActions
                    view={singleItem}
                    disabled={actionsDisabled}
                    named={false}
                    editing={editingModuleId === singleItem.module.id}
                    editor={
                      <ModuleConfigEditor
                        view={singleItem}
                        backendPortSuggestions={backendPortSuggestions}
                        onChangeConfig={onChangeConfig}
                      />
                    }
                    onToggleEditor={() => toggleEditor(singleItem.module.id)}
                    onRun={onRun}
                    onRunNpm={onRunNpm}
                  />
                  {isJarModule(singleItem.module) && editingModuleId === singleItem.module.id && (
                    <ModuleConfigEditor
                      view={singleItem}
                      backendPortSuggestions={backendPortSuggestions}
                      onChangeConfig={onChangeConfig}
                    />
                  )}
                </div>
              )
            )}
            {error && (
              <p
                role="status"
                className="border-t border-border/50 px-3 py-2 text-2xs leading-snug text-destructive-foreground"
              >
                {error}
              </p>
            )}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
