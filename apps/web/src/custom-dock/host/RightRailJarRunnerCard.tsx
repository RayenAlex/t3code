import {
  ChevronDown,
  ChevronUp,
  Package,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Terminal,
  Zap,
} from "lucide-react";
import { useState } from "react";

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
  EMPTY_MODULE_CONFIG,
  hasCustomModuleConfig,
  resolveEffectiveDebugPort,
  validateJarRunnerModuleConfig,
  type JarRunnerCommand,
  type JarRunnerModule,
  type JarRunnerModuleConfig,
} from "./jarRunnerModules";
import { useDockCopy } from "./panelContext";

export type { JarRunnerCommand, JarRunnerModule, JarRunnerModuleConfig } from "./jarRunnerModules";

export interface JarRunnerModuleRun {
  readonly command: JarRunnerCommand;
  readonly terminalId: string;
  readonly running: boolean;
}

export interface JarRunnerModuleView {
  readonly module: JarRunnerModule;
  readonly run: JarRunnerModuleRun | null;
  readonly config: JarRunnerModuleConfig;
  readonly availableProfiles: ReadonlyArray<string>;
}

function formatRunBadge(
  run: JarRunnerModuleRun,
  module: JarRunnerModule,
  config: JarRunnerModuleConfig,
): string {
  if (run.command === "jar") return "JAR";
  if (run.command === "mvn-op") {
    const debugPort = resolveEffectiveDebugPort(module, config);
    return debugPort !== null ? `mvn-op :${debugPort}` : "mvn-op";
  }
  return run.command;
}

function ConfigSummaryChips({
  config,
  onToggleEditor,
}: {
  readonly config: JarRunnerModuleConfig;
  readonly onToggleEditor: () => void;
}) {
  if (!hasCustomModuleConfig(config)) return null;
  const profile = config.profile.trim();
  const serverPort = config.serverPort.trim();
  const debugPort = config.debugPort.trim();

  return (
    <button
      type="button"
      onClick={onToggleEditor}
      className="mb-1.5 flex w-full flex-wrap items-center gap-1 text-left transition-opacity hover:opacity-80"
    >
      {profile.length > 0 && (
        <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-2xs text-secondary-foreground">
          {profile}
        </span>
      )}
      {serverPort.length > 0 && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
          :{serverPort}
        </span>
      )}
      {debugPort.length > 0 && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
          dbg:{debugPort}
        </span>
      )}
    </button>
  );
}

function ModuleConfigEditor({
  module,
  config,
  availableProfiles,
  onChangeConfig,
}: {
  readonly module: JarRunnerModule;
  readonly config: JarRunnerModuleConfig;
  readonly availableProfiles: ReadonlyArray<string>;
  readonly onChangeConfig: (moduleId: string, next: JarRunnerModuleConfig) => void;
}) {
  const copy = useDockCopy();
  const validation = validateJarRunnerModuleConfig(config);
  const previewCommand = buildMvnOpCommand(module, config);
  const hasCustom = hasCustomModuleConfig(config);
  const activeProfile = config.profile.trim();

  return (
    <div
      data-jar-config-editor={module.name}
      className="mt-2 space-y-2 rounded-lg border border-border/65 bg-muted/35 p-2"
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
                    variant="ghost"
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
                <Button
                  key={profile}
                  variant={selected ? "secondary" : "outline"}
                  size="micro"
                  onClick={() =>
                    onChangeConfig(module.id, {
                      ...config,
                      profile: selected ? "" : profile,
                    })
                  }
                >
                  <span className="font-mono">{profile}</span>
                </Button>
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

      <p className="rounded bg-background/70 px-1.5 py-1 font-mono text-2xs break-all text-muted-foreground">
        {previewCommand}
      </p>
    </div>
  );
}

export function RightRailJarRunnerCard({
  canRun,
  busyKey,
  modules,
  error,
  onRun,
  onRunAll,
  onOpenTerminal,
  onStop,
  onStopAll,
  onChangeConfig,
}: {
  readonly canRun: boolean;
  readonly busyKey: string | null;
  readonly modules: ReadonlyArray<JarRunnerModuleView>;
  readonly error: string | null;
  readonly onRun: (module: JarRunnerModule, command: JarRunnerCommand) => void;
  readonly onRunAll: (command: "mvn-op" | "jar") => void;
  readonly onOpenTerminal: (terminalId: string) => void;
  readonly onStop: (moduleId: string, terminalId: string) => void;
  readonly onStopAll: () => void;
  readonly onChangeConfig: (moduleId: string, next: JarRunnerModuleConfig) => void;
}) {
  const copy = useDockCopy();
  const [minimized, setMinimized] = useState(false);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);

  if (modules.length === 0) return null;

  const isMultiModule = modules.length > 1;
  const runningModules = modules.filter((item) => item.run?.running);
  const runningCount = runningModules.length;
  const singleItem = modules[0];
  const actionsDisabled = !canRun || busyKey !== null;
  const hasInvalidConfig = modules.some(
    (item) => !validateJarRunnerModuleConfig(item.config).isValid,
  );

  function toggleEditor(moduleId: string) {
    setEditingModuleId((current) => (current === moduleId ? null : moduleId));
  }

  return (
    <TooltipProvider>
      <section
        data-custom-dock-jar-runner="inline"
        aria-label={copy.jarRunner}
        className="dropdown-glass pointer-events-auto shrink-0 overflow-hidden rounded-2xl border border-border/75 bg-card/95 text-card-foreground shadow-sm"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            <Package className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{copy.jarRunner}</span>
            {isMultiModule ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-mono text-2xs font-medium text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={
                    runningCount > 0
                      ? "size-1.5 shrink-0 rounded-full bg-success"
                      : "size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                  }
                />
                <span>
                  {copy.jarRunningCount
                    .replace("{running}", String(runningCount))
                    .replace("{total}", String(modules.length))}
                </span>
              </span>
            ) : (
              singleItem?.run && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-mono text-2xs font-medium text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={
                      singleItem.run.running
                        ? "size-1.5 shrink-0 rounded-full bg-success"
                        : "size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                    }
                  />
                  <span>
                    {formatRunBadge(singleItem.run, singleItem.module, singleItem.config)}
                  </span>
                </span>
              )
            )}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {isMultiModule ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={
                          actionsDisabled || runningCount >= modules.length || hasInvalidConfig
                        }
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
                        variant="ghost"
                        size="icon-xs"
                        disabled={
                          actionsDisabled || runningCount >= modules.length || hasInvalidConfig
                        }
                        aria-label={copy.jarStartAllJar}
                        onClick={() => onRunAll("jar")}
                      />
                    }
                  >
                    <Zap aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{copy.jarStartAllJar}</TooltipPopup>
                </Tooltip>
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
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={
                            editingModuleId === singleItem.module.id ||
                            hasCustomModuleConfig(singleItem.config)
                              ? "secondary"
                              : "ghost"
                          }
                          size="icon-xs"
                          aria-label={copy.jarConfigure}
                          aria-expanded={editingModuleId === singleItem.module.id}
                          onClick={() => {
                            if (minimized) setMinimized(false);
                            toggleEditor(singleItem.module.id);
                          }}
                        />
                      }
                    >
                      <SlidersHorizontal aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{copy.jarConfigure}</TooltipPopup>
                  </Tooltip>
                  {singleItem.run?.running && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost-destructive"
                            size="icon-xs"
                            disabled={!canRun}
                            aria-label={copy.jarStopRun}
                            onClick={() => {
                              if (singleItem.run) {
                                onStop(singleItem.module.id, singleItem.run.terminalId);
                              }
                            }}
                          />
                        }
                      >
                        <Square aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">{copy.jarStopRun}</TooltipPopup>
                    </Tooltip>
                  )}
                  {singleItem.run && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={copy.jarOpenTerminal}
                            onClick={() => {
                              if (singleItem.run) {
                                onOpenTerminal(singleItem.run.terminalId);
                              }
                            }}
                          />
                        }
                      >
                        <Terminal aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">{copy.jarOpenTerminal}</TooltipPopup>
                    </Tooltip>
                  )}
                </>
              )
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={minimized ? copy.jarExpand : copy.jarCollapse}
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
              <div className="divide-y divide-border/55">
                {modules.map(({ module, run, config, availableProfiles }) => {
                  const isEditing = editingModuleId === module.id;
                  const configValid = validateJarRunnerModuleConfig(config).isValid;
                  const mvnOpCmd = buildMvnOpCommand(module, config);
                  return (
                    <div
                      key={module.id || "__root__"}
                      data-jar-module={module.name}
                      className="px-3 py-2"
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-1.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={
                              run?.running
                                ? "size-1.5 shrink-0 rounded-full bg-success"
                                : run
                                  ? "size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                                  : "size-1.5 shrink-0 rounded-full border border-muted-foreground/45"
                            }
                          />
                          <span className="truncate font-mono text-xs font-medium text-foreground">
                            {module.name}
                          </span>
                          {run && (
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                              {formatRunBadge(run, module, config)}
                            </span>
                          )}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant={
                                    isEditing || hasCustomModuleConfig(config)
                                      ? "secondary"
                                      : "ghost"
                                  }
                                  size="icon-micro"
                                  aria-label={copy.jarConfigureModule.replace(
                                    "{module}",
                                    module.name,
                                  )}
                                  aria-expanded={isEditing}
                                  onClick={() => toggleEditor(module.id)}
                                />
                              }
                            >
                              <SlidersHorizontal aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {copy.jarConfigureModule.replace("{module}", module.name)}
                            </TooltipPopup>
                          </Tooltip>
                          {run?.running && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost-destructive"
                                    size="icon-micro"
                                    disabled={!canRun}
                                    aria-label={copy.jarStopModuleRun.replace(
                                      "{module}",
                                      module.name,
                                    )}
                                    onClick={() => onStop(module.id, run.terminalId)}
                                  />
                                }
                              >
                                <Square aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">
                                {copy.jarStopModuleRun.replace("{module}", module.name)}
                              </TooltipPopup>
                            </Tooltip>
                          )}
                          {run && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-micro"
                                    aria-label={copy.jarOpenModuleTerminal.replace(
                                      "{module}",
                                      module.name,
                                    )}
                                    onClick={() => onOpenTerminal(run.terminalId)}
                                  />
                                }
                              >
                                <Terminal aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">
                                {copy.jarOpenModuleTerminal.replace("{module}", module.name)}
                              </TooltipPopup>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                      {!isEditing && (
                        <ConfigSummaryChips
                          config={config}
                          onToggleEditor={() => toggleEditor(module.id)}
                        />
                      )}
                      <div className="grid grid-cols-3 gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="compact"
                                disabled={actionsDisabled || !configValid}
                                aria-label={`${module.name} mvn-op`}
                                onClick={() => onRun(module, "mvn-op")}
                              />
                            }
                          >
                            <Play aria-hidden="true" />
                            <span className="font-mono">mvn-op</span>
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            {copy.jarRunMvnOpTooltip.replace("{command}", mvnOpCmd)}
                          </TooltipPopup>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="outline"
                                size="compact"
                                disabled={actionsDisabled || !configValid}
                                aria-label={`${module.name} JAR`}
                                onClick={() => onRun(module, "jar")}
                              />
                            }
                          >
                            <Zap aria-hidden="true" />
                            <span className="font-mono">JAR</span>
                          </TooltipTrigger>
                          <TooltipPopup side="top">{copy.jarRunJarTooltip}</TooltipPopup>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="outline"
                                size="compact"
                                disabled={actionsDisabled}
                                aria-label={`${module.name} mvn-p`}
                                onClick={() => onRun(module, "mvn-p")}
                              />
                            }
                          >
                            <Package aria-hidden="true" />
                            <span className="font-mono">mvn-p</span>
                          </TooltipTrigger>
                          <TooltipPopup side="top">{copy.jarRunMvnPTooltip}</TooltipPopup>
                        </Tooltip>
                      </div>
                      {isEditing && (
                        <ModuleConfigEditor
                          module={module}
                          config={config}
                          availableProfiles={availableProfiles}
                          onChangeConfig={onChangeConfig}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              singleItem && (
                <div className="px-3 py-2.5">
                  {editingModuleId !== singleItem.module.id && (
                    <ConfigSummaryChips
                      config={singleItem.config}
                      onToggleEditor={() => toggleEditor(singleItem.module.id)}
                    />
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={
                              actionsDisabled ||
                              !validateJarRunnerModuleConfig(singleItem.config).isValid
                            }
                            onClick={() => onRun(singleItem.module, "mvn-op")}
                          />
                        }
                      >
                        <Play aria-hidden="true" />
                        <span className="font-mono">mvn-op</span>
                      </TooltipTrigger>
                      <TooltipPopup side="top">
                        {copy.jarRunMvnOpTooltip.replace(
                          "{command}",
                          buildMvnOpCommand(singleItem.module, singleItem.config),
                        )}
                      </TooltipPopup>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="compact"
                            disabled={
                              actionsDisabled ||
                              !validateJarRunnerModuleConfig(singleItem.config).isValid
                            }
                            onClick={() => onRun(singleItem.module, "jar")}
                          />
                        }
                      >
                        <Zap aria-hidden="true" />
                        <span className="font-mono">JAR</span>
                      </TooltipTrigger>
                      <TooltipPopup side="top">{copy.jarRunJarTooltip}</TooltipPopup>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="compact"
                            disabled={actionsDisabled}
                            onClick={() => onRun(singleItem.module, "mvn-p")}
                          />
                        }
                      >
                        <Package aria-hidden="true" />
                        <span className="font-mono">mvn-p</span>
                      </TooltipTrigger>
                      <TooltipPopup side="top">{copy.jarRunMvnPTooltip}</TooltipPopup>
                    </Tooltip>
                  </div>
                  {editingModuleId === singleItem.module.id && (
                    <ModuleConfigEditor
                      module={singleItem.module}
                      config={singleItem.config}
                      availableProfiles={singleItem.availableProfiles}
                      onChangeConfig={onChangeConfig}
                    />
                  )}
                </div>
              )
            )}
            {error && (
              <p
                role="status"
                className="border-t border-border/55 px-3 py-2 text-2xs leading-snug text-destructive-foreground"
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
