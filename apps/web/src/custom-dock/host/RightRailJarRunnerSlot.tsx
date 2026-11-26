import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthTerminalReadScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import { AsyncResult, Atom } from "effect/reactivity";
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
  buildNpmShellCommand,
  EMPTY_MODULE_CONFIG,
  extractProfilesByModule,
  extractTopLevelPackageJsonDirs,
  extractTopLevelPomPaths,
  isJarModule,
  isProxyTargetValid,
  loadProjectJarRunnerConfigs,
  NPM_DEV_SCRIPT,
  npmRunnerCommand,
  parseNpmRunnerScripts,
  resolveJarRunnerModules,
  resolveModuleCwd,
  resolveNpmRunnerProjects,
  saveProjectJarRunnerConfigs,
  validateJarRunnerModuleConfig,
  type JarRunnerCommand,
  type JarRunnerModule,
  type RunnerCommand,
  type RunnerModule,
  type RunnerModuleConfig,
} from "./jarRunnerModules";
import { useDockCopy } from "./panelContext";
import {
  RightRailJarRunnerCard,
  type RunnerModuleRun,
  type RunnerModuleView,
} from "./RightRailJarRunnerCard";

const RUNNER_TERMINAL_COLS = 120;
const RUNNER_TERMINAL_ROWS = 30;
const POM_SEARCH_LIMIT = 50;
const PROFILE_SEARCH_LIMIT = 100;
const PACKAGE_JSON_SEARCH_LIMIT = 200;

const readPackageJson = (environmentId: EnvironmentId, cwd: string) =>
  projectEnvironment.readFile({
    environmentId,
    input: { cwd, relativePath: "package.json", allowMissing: true },
  });

const packageJsonContents = Atom.family((key: string) => {
  const [environmentId, rootCwd, relativeDirs] = JSON.parse(key) as [
    EnvironmentId,
    string,
    ReadonlyArray<string>,
  ];
  const reads = relativeDirs.map((relativeDir) =>
    readPackageJson(environmentId, resolveModuleCwd(rootCwd, relativeDir)),
  );
  return Atom.make((get) => reads.map((read) => get(read))).pipe(
    Atom.setIdleTTL(0),
    Atom.withLabel(`web:custom-dock:package-json:${key}`),
  );
});

const EMPTY_PACKAGE_JSON_READS = Atom.make<
  ReadonlyArray<Atom.Type<ReturnType<typeof readPackageJson>>>
>([]).pipe(Atom.withLabel("web:custom-dock:package-json:empty"));

interface ModuleRunRecord {
  readonly command: RunnerCommand;
  readonly terminalId: string;
}

interface RunnerScopeState {
  readonly scopeKey: string;
  readonly runsByModuleId: Readonly<Record<string, ModuleRunRecord>>;
  readonly error: string | null;
}

interface ConfigScopeState {
  readonly projectKey: string;
  readonly configsByModuleId: Readonly<Record<string, RunnerModuleConfig>>;
}

interface RunnerCommandActions {
  /** Names the command in failure messages, such as `mvn-op` or `npm run dev`. */
  readonly label: string;
  /** Null when the command ignores module settings. */
  readonly invalidConfigMessage: string | null;
  readonly isConfigValid: (config: RunnerModuleConfig) => boolean;
  readonly buildShellCommand: (config: RunnerModuleConfig) => string;
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

  const packageJsonSearchResult = useEnvironmentQuery(
    fileAccess.canReadFiles && rootCwd !== null
      ? projectEnvironment.searchEntries({
          environmentId: scope.environmentId,
          input: {
            cwd: rootCwd,
            query: "package.json",
            kind: "file",
            limit: PACKAGE_JSON_SEARCH_LIMIT,
          },
        })
      : null,
    m,
  );
  const packageJsonDirs = extractTopLevelPackageJsonDirs(
    packageJsonSearchResult.data?.entries ?? [],
  );

  const packageJsonReads = useAtomValue(
    fileAccess.canReadFiles && rootCwd !== null && packageJsonDirs.length > 0
      ? packageJsonContents(JSON.stringify([scope.environmentId, rootCwd, packageJsonDirs]))
      : EMPTY_PACKAGE_JSON_READS,
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

  const scriptsByDir: Record<string, ReadonlyArray<string>> = {};
  packageJsonReads.forEach((result, index) => {
    const relativeDir = packageJsonDirs[index];
    const read = relativeDir === undefined ? null : AsyncResult.getOrElse(result, () => null);
    if (relativeDir === undefined || read === null) return;
    scriptsByDir[relativeDir] = parseNpmRunnerScripts(read.contents);
  });

  if (!canOpen || !canWrite || !project || rootCwd === null) {
    return null;
  }

  const npmProjects = resolveNpmRunnerProjects({
    projectName: project.title,
    packageJsonDirs,
    scriptsByDir,
  });
  if (topLevelPomPaths.length === 0 && npmProjects.length === 0) {
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

  const modules: ReadonlyArray<RunnerModule> = [
    ...resolveJarRunnerModules({
      projectName: project.title,
      pomPaths: topLevelPomPaths,
      springBootPomPaths: springBootPomPaths.size > 0 ? springBootPomPaths : null,
    }),
    ...npmProjects,
  ];

  const profilesByModule = extractProfilesByModule(
    profileSearchResult.data?.entries ?? [],
    modules.flatMap((module) => (isJarModule(module) ? [module.relativeDir] : [])),
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

  const moduleViews: ReadonlyArray<RunnerModuleView> = modules.map((module) => {
    const saved = currentRuns[module.id];
    const run: RunnerModuleRun | null =
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

  function updateModuleConfig(moduleId: string, nextConfig: RunnerModuleConfig) {
    const nextMap: Record<string, RunnerModuleConfig> = {
      ...currentConfigs,
      [moduleId]: nextConfig,
    };
    saveProjectJarRunnerConfigs(projectConfigKey, nextMap);
    setConfigState({
      projectKey: projectConfigKey,
      configsByModuleId: nextMap,
    });
  }

  function jarCommandActions(
    module: JarRunnerModule,
    command: JarRunnerCommand,
  ): RunnerCommandActions {
    return {
      label: command,
      invalidConfigMessage: command === "mvn-p" ? null : copy.jarInvalidConfig,
      isConfigValid: (config) => validateJarRunnerModuleConfig(config).isValid,
      buildShellCommand: (config) =>
        buildJarRunnerShellCommand(command, module, copy.jarMissingBuiltJar, config),
    };
  }

  function npmScriptActions(script: string): RunnerCommandActions {
    return {
      label: buildNpmShellCommand(script),
      invalidConfigMessage: script === NPM_DEV_SCRIPT ? copy.npmInvalidProxyTarget : null,
      isConfigValid: (config) => isProxyTargetValid(config.proxyTarget),
      buildShellCommand: (config) => buildNpmShellCommand(script, config),
    };
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
    module: RunnerModule,
    command: RunnerCommand,
    actions: RunnerCommandActions,
    reservedIds: Set<string>,
    focusAfterOpen: boolean,
  ): Promise<string | null> {
    if (rootCwd === null) return null;
    const config = currentConfigs[module.id] ?? EMPTY_MODULE_CONFIG;
    if (actions.invalidConfigMessage !== null && !actions.isConfigValid(config)) {
      return actions.invalidConfigMessage;
    }

    const shellCommand = actions.buildShellCommand(config);
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
      return copy.jarRunFailed.replace("{command}", `${module.name}: ${actions.label}`);
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
        copy.jarRunFailed.replace("{command}", `${module.name}: ${actions.label}`)
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
        copy.jarRunFailed.replace("{command}", `${module.name}: ${actions.label}`)
      );
    }

    recordModuleRun(module.id, { command, terminalId: launched.terminalId });
    return null;
  }

  async function runModuleCommand(
    module: RunnerModule,
    command: RunnerCommand,
    actions: RunnerCommandActions,
  ) {
    if (busyKey !== null) return;
    setBusyKey(`${module.id}:${command}`);
    setScopeError(null);
    const failureMessage = await launchModuleCommand(
      module,
      command,
      actions,
      new Set<string>(),
      true,
    );
    setBusyKey(null);
    if (failureMessage !== null) {
      setScopeError(failureMessage);
    }
  }

  async function runAllModules(command: "mvn-op" | "jar") {
    if (busyKey !== null) return;
    const targets = moduleViews.flatMap((item) =>
      isJarModule(item.module) && !item.run?.running ? [item.module] : [],
    );
    if (targets.length === 0) return;

    setBusyKey(`all:${command}`);
    setScopeError(null);
    const reservedIds = new Set<string>();
    const results = await Promise.all(
      targets.map((module, index) =>
        launchModuleCommand(
          module,
          command,
          jarCommandActions(module, command),
          reservedIds,
          index === 0,
        ),
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
      onRun={(module, command) =>
        void runModuleCommand(module, command, jarCommandActions(module, command))
      }
      onRunNpm={(project, script) =>
        void runModuleCommand(project, npmRunnerCommand(script), npmScriptActions(script))
      }
      onRunAll={(command) => void runAllModules(command)}
      onOpenTerminal={openModuleTerminal}
      onStop={(moduleId, terminalId) => void stopModuleRun(moduleId, terminalId)}
      onStopAll={() => void stopAllRuns()}
      onChangeConfig={updateModuleConfig}
    />
  );
}
