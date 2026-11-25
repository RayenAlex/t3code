import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthTerminalReadScope, type ScopedThreadRef } from "@t3tools/contracts";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import { useState } from "react";

import { closingTerminalIds } from "../../components/terminal/closingTerminals";
import { useThreadTerminalActions } from "../../components/terminal/useThreadTerminalActions";
import { m } from "../../i18n/messages";
import { revealThreadTerminal } from "../../lib/revealThreadTerminal";
import { focusTerminal } from "../../lib/terminalFocus";
import { randomUUID } from "../../lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { useFilesystemReadAccess } from "../../state/filesystem";
import { projectContentSearch, projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import {
  useKnownTerminalSessions,
  useThreadRunningTerminalIds,
} from "../../state/terminalSessions";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import {
  buildJarRunnerShellCommand,
  EMPTY_MODULE_CONFIG,
  extractProfilesByModule,
  extractTopLevelPomPaths,
  loadProjectJarRunnerConfigs,
  resolveJarRunnerModules,
  resolveModuleCwd,
  saveProjectJarRunnerConfigs,
  validateJarRunnerModuleConfig,
  type JarRunnerCommand,
  type JarRunnerModule,
  type JarRunnerModuleConfig,
} from "./jarRunnerModules";
import { useDockCopy } from "./panelContext";
import {
  RightRailJarRunnerCard,
  type JarRunnerModuleRun,
  type JarRunnerModuleView,
} from "./RightRailJarRunnerCard";

const RUNNER_TERMINAL_COLS = 120;
const RUNNER_TERMINAL_ROWS = 30;
const POM_SEARCH_LIMIT = 50;
const PROFILE_SEARCH_LIMIT = 100;

interface ModuleRunRecord {
  readonly command: JarRunnerCommand;
  readonly terminalId: string;
}

interface RunnerScopeState {
  readonly scopeKey: string;
  readonly runsByModuleId: Readonly<Record<string, ModuleRunRecord>>;
  readonly error: string | null;
}

interface ConfigScopeState {
  readonly projectKey: string;
  readonly configsByModuleId: Readonly<Record<string, JarRunnerModuleConfig>>;
}

const EMPTY_RUNS: Readonly<Record<string, ModuleRunRecord>> = {};
const EMPTY_PROFILES: ReadonlyArray<string> = [];

export function RightRailJarRunnerSlot({ scope }: { readonly scope: ScopedThreadRef }) {
  const copy = useDockCopy();
  const canOpen = useAtomValue(terminalEnvironment.open.permissionAtom(scope.environmentId));
  const canWrite = useAtomValue(terminalEnvironment.write.permissionAtom(scope.environmentId));
  const canReadTerminal = useEnvironmentScope(scope.environmentId, AuthTerminalReadScope);
  const fileAccess = useFilesystemReadAccess(scope.environmentId, m);
  const shell = useQuietThreadShell(scope);
  const project = useProject(shell ? scopeProjectRef(scope.environmentId, shell.projectId) : null);
  const terminalActions = useThreadTerminalActions(scope);
  const knownSessions = useKnownTerminalSessions({
    environmentId: scope.environmentId,
    threadId: scope.threadId,
  });
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: scope.environmentId,
    threadId: scope.threadId,
  });
  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, scope),
  );
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, scope).surfaces,
  );
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const storeNewTerminal = useTerminalUiStateStore((state) => state.newTerminal);

  const worktreePath = shell?.worktreePath ?? null;
  const rootCwd = project
    ? projectScriptCwd({
        project: { cwd: project.workspaceRoot },
        worktreePath,
      })
    : null;

  const pomSearchResult = useEnvironmentQuery(
    fileAccess.canReadFiles && rootCwd !== null
      ? projectEnvironment.searchEntries({
          environmentId: scope.environmentId,
          input: {
            cwd: rootCwd,
            query: "pom.xml",
            kind: "file",
            limit: POM_SEARCH_LIMIT,
          },
        })
      : null,
    m,
  );
  const topLevelPomPaths = extractTopLevelPomPaths(pomSearchResult.data?.entries ?? []);

  const springBootSearchResult = useEnvironmentQuery(
    fileAccess.canReadFiles && rootCwd !== null && topLevelPomPaths.length > 1
      ? projectContentSearch({
          environmentId: scope.environmentId,
          input: {
            cwd: rootCwd,
            query: "spring-boot-maven-plugin",
            limit: POM_SEARCH_LIMIT,
            caseSensitive: false,
            wholeWord: false,
            useRegex: false,
          },
        })
      : null,
    m,
  );

  const profileSearchResult = useEnvironmentQuery(
    fileAccess.canReadFiles && rootCwd !== null && topLevelPomPaths.length > 0
      ? projectEnvironment.searchEntries({
          environmentId: scope.environmentId,
          input: {
            cwd: rootCwd,
            query: "application-",
            kind: "file",
            limit: PROFILE_SEARCH_LIMIT,
          },
        })
      : null,
    m,
  );

  const scopeKey = `${scope.environmentId}:${scope.threadId}:${rootCwd ?? ""}`;
  const projectConfigKey = `${scope.environmentId}:${project?.workspaceRoot ?? ""}`;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [runnerState, setRunnerState] = useState<RunnerScopeState>({
    scopeKey,
    runsByModuleId: EMPTY_RUNS,
    error: null,
  });
  const [configState, setConfigState] = useState<ConfigScopeState>(() => ({
    projectKey: projectConfigKey,
    configsByModuleId: loadProjectJarRunnerConfigs(projectConfigKey),
  }));

  if (!canOpen || !canWrite || !project || rootCwd === null || topLevelPomPaths.length === 0) {
    return null;
  }

  const currentRuns = runnerState.scopeKey === scopeKey ? runnerState.runsByModuleId : EMPTY_RUNS;
  const currentError = runnerState.scopeKey === scopeKey ? runnerState.error : null;
  const currentConfigs =
    configState.projectKey === projectConfigKey
      ? configState.configsByModuleId
      : loadProjectJarRunnerConfigs(projectConfigKey);

  const springBootPomPaths = new Set(
    (springBootSearchResult.data?.matches ?? [])
      .map((match) => match.path.replaceAll("\\", "/").replace(/^\.\//, ""))
      .filter((matchPath) => matchPath === "pom.xml" || matchPath.endsWith("/pom.xml")),
  );

  const modules = resolveJarRunnerModules({
    projectName: project.title,
    pomPaths: topLevelPomPaths,
    springBootPomPaths: springBootPomPaths.size > 0 ? springBootPomPaths : null,
  });

  const profilesByModule = extractProfilesByModule(
    profileSearchResult.data?.entries ?? [],
    modules.map((module) => module.relativeDir),
  );

  const panelTerminalIds = new Set(
    panelSurfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : [])),
  );
  const serverTerminalIds = (knownSessions ?? []).map((session) => session.target.terminalId);
  const knownIds = new Set([
    ...terminalUiState.terminalIds,
    ...panelTerminalIds,
    ...serverTerminalIds,
  ]);
  const closingIds = new Set(closingTerminalIds(scope));

  const moduleViews: ReadonlyArray<JarRunnerModuleView> = modules.map((module) => {
    const saved = currentRuns[module.id];
    const run: JarRunnerModuleRun | null =
      saved && (knownSessions === null || knownIds.has(saved.terminalId))
        ? {
            command: saved.command,
            terminalId: saved.terminalId,
            running: runningTerminalIds.includes(saved.terminalId),
          }
        : null;
    return {
      module,
      run,
      config: currentConfigs[module.id] ?? EMPTY_MODULE_CONFIG,
      availableProfiles: profilesByModule[module.relativeDir] ?? EMPTY_PROFILES,
    };
  });

  function setScopeError(nextError: string | null) {
    setRunnerState((previous) => ({
      scopeKey,
      runsByModuleId: previous.scopeKey === scopeKey ? previous.runsByModuleId : EMPTY_RUNS,
      error: nextError,
    }));
  }

  function recordModuleRun(moduleId: string, record: ModuleRunRecord) {
    setRunnerState((previous) => ({
      scopeKey,
      runsByModuleId: {
        ...(previous.scopeKey === scopeKey ? previous.runsByModuleId : EMPTY_RUNS),
        [moduleId]: record,
      },
      error: previous.scopeKey === scopeKey ? previous.error : null,
    }));
  }

  function updateModuleConfig(moduleId: string, nextConfig: JarRunnerModuleConfig) {
    const nextMap: Record<string, JarRunnerModuleConfig> = {
      ...currentConfigs,
      [moduleId]: nextConfig,
    };
    saveProjectJarRunnerConfigs(projectConfigKey, nextMap);
    setConfigState({
      projectKey: projectConfigKey,
      configsByModuleId: nextMap,
    });
  }

  function pickModuleTerminalId(
    moduleId: string,
    reservedIds: Set<string>,
  ): { readonly terminalId: string; readonly reused: boolean } {
    const existing = currentRuns[moduleId];
    if (
      existing &&
      canReadTerminal &&
      knownSessions !== null &&
      knownIds.has(existing.terminalId) &&
      !panelTerminalIds.has(existing.terminalId) &&
      !runningTerminalIds.includes(existing.terminalId) &&
      !closingIds.has(existing.terminalId) &&
      !reservedIds.has(existing.terminalId)
    ) {
      reservedIds.add(existing.terminalId);
      return { terminalId: existing.terminalId, reused: true };
    }

    const canReuseSequential = knownSessions !== null && canReadTerminal;
    const allocated = nextTerminalId(
      [...knownIds, ...closingIds, ...reservedIds],
      canReuseSequential ? undefined : randomUUID(),
    );
    reservedIds.add(allocated);
    return { terminalId: allocated, reused: false };
  }

  async function launchModuleCommand(
    module: JarRunnerModule,
    command: JarRunnerCommand,
    reservedIds: Set<string>,
    focusAfterOpen: boolean,
  ): Promise<string | null> {
    if (rootCwd === null) return null;
    const config = currentConfigs[module.id] ?? EMPTY_MODULE_CONFIG;
    if (command !== "mvn-p" && !validateJarRunnerModuleConfig(config).isValid) {
      return copy.jarInvalidConfig;
    }

    const shellCommand = buildJarRunnerShellCommand(
      command,
      module,
      copy.jarMissingBuiltJar,
      config,
    );
    const moduleCwd = resolveModuleCwd(rootCwd, module.relativeDir);
    const { terminalId, reused } = pickModuleTerminalId(module.id, reservedIds);

    const launched = terminalActions.launchTerminal({
      place: (id) =>
        reused ? storeEnsureTerminal(scope, id, { open: true }) : storeNewTerminal(scope, id),
      terminalId,
      ...(reused ? {} : { size: { cols: RUNNER_TERMINAL_COLS, rows: RUNNER_TERMINAL_ROWS } }),
      location: { cwd: moduleCwd, worktreePath },
    });
    if (!launched) {
      return copy.jarRunFailed.replace("{command}", `${module.name}: ${command}`);
    }

    if (focusAfterOpen) {
      focusTerminal(scope, launched.terminalId);
    }

    const openResult = await launched.result;
    if (openResult._tag === "Failure") {
      if (isAtomCommandInterrupted(openResult)) return null;
      const failure = squashAtomCommandFailure(openResult);
      return (
        thrownErrorMessage(failure, m) ??
        copy.jarRunFailed.replace("{command}", `${module.name}: ${command}`)
      );
    }

    const writeResult = await terminalActions.writeToTerminal(
      launched.terminalId,
      `${shellCommand}\r`,
    );
    if (!writeResult) return null;
    if (writeResult._tag === "Failure") {
      if (isAtomCommandInterrupted(writeResult)) return null;
      const failure = squashAtomCommandFailure(writeResult);
      return (
        thrownErrorMessage(failure, m) ??
        copy.jarRunFailed.replace("{command}", `${module.name}: ${command}`)
      );
    }

    recordModuleRun(module.id, { command, terminalId: launched.terminalId });
    return null;
  }

  async function runSingleModule(module: JarRunnerModule, command: JarRunnerCommand) {
    if (busyKey !== null) return;
    setBusyKey(`${module.id}:${command}`);
    setScopeError(null);
    const reservedIds = new Set<string>();
    const failureMessage = await launchModuleCommand(module, command, reservedIds, true);
    setBusyKey(null);
    if (failureMessage !== null) {
      setScopeError(failureMessage);
    }
  }

  async function runAllModules(command: "mvn-op" | "jar") {
    if (busyKey !== null) return;
    const targets = moduleViews.filter((item) => !item.run?.running).map((item) => item.module);
    if (targets.length === 0) return;

    setBusyKey(`all:${command}`);
    setScopeError(null);
    const reservedIds = new Set<string>();
    const results = await Promise.all(
      targets.map((module, index) =>
        launchModuleCommand(module, command, reservedIds, index === 0),
      ),
    );
    setBusyKey(null);
    const firstError = results.find((message): message is string => message !== null) ?? null;
    if (firstError !== null) {
      setScopeError(firstError);
    }
  }

  function openModuleTerminal(terminalId: string) {
    revealThreadTerminal(scope, terminalId);
  }

  async function stopModuleRun(_moduleId: string, terminalId: string) {
    revealThreadTerminal(scope, terminalId);
    await terminalActions.writeToTerminal(terminalId, "\u0003");
  }

  async function stopAllRuns() {
    const runningTerminalIdList = [
      ...new Set(
        moduleViews
          .filter((item) => item.run?.running)
          .map((item) => item.run?.terminalId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    if (runningTerminalIdList.length === 0) return;
    await Promise.all(
      runningTerminalIdList.map((terminalId) =>
        terminalActions.writeToTerminal(terminalId, "\u0003"),
      ),
    );
  }

  return (
    <RightRailJarRunnerCard
      canRun={canOpen && canWrite}
      busyKey={busyKey}
      modules={moduleViews}
      error={currentError}
      onRun={(module, command) => void runSingleModule(module, command)}
      onRunAll={(command) => void runAllModules(command)}
      onOpenTerminal={openModuleTerminal}
      onStop={(moduleId, terminalId) => void stopModuleRun(moduleId, terminalId)}
      onStopAll={() => void stopAllRuns()}
      onChangeConfig={updateModuleConfig}
    />
  );
}
