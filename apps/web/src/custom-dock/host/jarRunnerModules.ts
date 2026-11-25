export type JarRunnerCommand = "mvn-op" | "jar" | "mvn-p";

export interface JarRunnerModule {
  readonly id: string;
  readonly name: string;
  readonly relativeDir: string;
  readonly debugPort: number | null;
}

export interface JarRunnerModuleConfig {
  readonly profile: string;
  readonly serverPort: string;
  readonly debugPort: string;
}

export interface JarRunnerModuleConfigValidation {
  readonly profileValid: boolean;
  readonly serverPortValid: boolean;
  readonly debugPortValid: boolean;
  readonly isValid: boolean;
}

export interface JarRunnerEntryLike {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly ignored?: boolean | undefined;
}

export const EMPTY_MODULE_CONFIG: JarRunnerModuleConfig = {
  profile: "",
  serverPort: "",
  debugPort: "",
};

const DEFAULT_DEBUG_PORT = 50055;
const SAFE_JAR_BASENAME = /^[A-Za-z0-9._-]+$/;
const SAFE_PROFILE_PATTERN = /^[A-Za-z0-9._,-]+$/;
const PORT_DIGITS_PATTERN = /^\d+$/;
const PROFILE_FILE_PATTERN = /^application-([A-Za-z0-9._-]+)\.(?:yml|yaml|properties)$/i;
const STORAGE_KEY = "t3code:jar-runner-config:v1";
const MAX_STORED_PROJECTS = 40;

function normalizeEntryPath(entryPath: string): string {
  return entryPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function extractPomRelativeDir(entryPath: string): string | null {
  const normalized = normalizeEntryPath(entryPath);
  if (normalized === "pom.xml") return "";
  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1) return null;
  if (normalized.slice(slashIndex + 1) !== "pom.xml") return null;
  const dir = normalized.slice(0, slashIndex);
  return dir.length > 0 && dir !== "." && dir !== ".." ? dir : null;
}

export function extractTopLevelPomPaths(
  entries: ReadonlyArray<JarRunnerEntryLike>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file" || entry.ignored) continue;
    const relativeDir = extractPomRelativeDir(entry.path);
    if (relativeDir === null) continue;
    const canonicalPath = relativeDir === "" ? "pom.xml" : `${relativeDir}/pom.xml`;
    if (seen.has(canonicalPath)) continue;
    seen.add(canonicalPath);
    paths.push(canonicalPath);
  }
  return paths;
}

export function extractProfilesByModule(
  entries: ReadonlyArray<JarRunnerEntryLike>,
  moduleRelativeDirs: ReadonlyArray<string>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  const allowedDirs = new Set(moduleRelativeDirs);
  const profilesMap = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (entry.kind !== "file" || entry.ignored) continue;
    const normalized = normalizeEntryPath(entry.path);
    const segments = normalized.split("/");
    const fileName = segments.at(-1);
    if (!fileName) continue;
    const match = PROFILE_FILE_PATTERN.exec(fileName);
    const profile = match?.[1];
    if (!profile) continue;

    let moduleDir: string | null = null;
    if (
      segments.length === 1 ||
      (segments.length === 4 &&
        segments[0] === "src" &&
        segments[1] === "main" &&
        segments[2] === "resources")
    ) {
      moduleDir = "";
    } else if (
      segments.length === 2 ||
      (segments.length === 5 &&
        segments[1] === "src" &&
        segments[2] === "main" &&
        segments[3] === "resources")
    ) {
      moduleDir = segments[0] ?? null;
    }

    if (moduleDir === null || !allowedDirs.has(moduleDir)) continue;
    let bucket = profilesMap.get(moduleDir);
    if (!bucket) {
      bucket = new Set<string>();
      profilesMap.set(moduleDir, bucket);
    }
    bucket.add(profile);
  }

  const result: Record<string, ReadonlyArray<string>> = {};
  for (const [moduleDir, bucket] of profilesMap) {
    result[moduleDir] = [...bucket].toSorted((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  }
  return result;
}

export function resolveJarRunnerModules(input: {
  readonly projectName: string;
  readonly pomPaths: ReadonlyArray<string>;
  readonly springBootPomPaths?: ReadonlySet<string> | null;
}): ReadonlyArray<JarRunnerModule> {
  const fallbackName = input.projectName.trim() || "project";
  const normalizedPoms = input.pomPaths
    .map((pomPath) => ({
      pomPath: normalizeEntryPath(pomPath),
      relativeDir: extractPomRelativeDir(pomPath),
    }))
    .filter(
      (item): item is { readonly pomPath: string; readonly relativeDir: string } =>
        item.relativeDir !== null,
    );

  const springBootFiltered =
    input.springBootPomPaths && input.springBootPomPaths.size > 0
      ? normalizedPoms.filter((item) => input.springBootPomPaths?.has(item.pomPath))
      : [];
  const chosen = springBootFiltered.length > 0 ? springBootFiltered : normalizedPoms;

  if (chosen.length === 0) {
    return [];
  }

  const projectNameLower = fallbackName.toLowerCase();
  const sorted = chosen.toSorted((left, right) => {
    const leftName = left.relativeDir === "" ? fallbackName : left.relativeDir;
    const rightName = right.relativeDir === "" ? fallbackName : right.relativeDir;
    const leftPriority =
      left.relativeDir === "" ? 0 : leftName.toLowerCase() === projectNameLower ? 1 : 2;
    const rightPriority =
      right.relativeDir === "" ? 0 : rightName.toLowerCase() === projectNameLower ? 1 : 2;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return leftName.localeCompare(rightName);
  });

  // Multiple concurrent mvn-op runs kill each other if they share the default 50055 debug port.
  const assignDebugPorts = sorted.length > 1;
  return sorted.map((item, index) => ({
    id: item.relativeDir,
    name: item.relativeDir === "" ? fallbackName : item.relativeDir,
    relativeDir: item.relativeDir,
    debugPort: assignDebugPorts ? DEFAULT_DEBUG_PORT + index : null,
  }));
}

function parseOptionalPort(
  raw: string,
): { readonly ok: true; readonly port: number | null } | { readonly ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, port: null };
  if (!PORT_DIGITS_PATTERN.test(trimmed)) return { ok: false };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return { ok: false };
  return { ok: true, port: parsed };
}

export function validateJarRunnerModuleConfig(
  config: JarRunnerModuleConfig,
): JarRunnerModuleConfigValidation {
  const profileTrimmed = config.profile.trim();
  const profileValid = profileTrimmed.length === 0 || SAFE_PROFILE_PATTERN.test(profileTrimmed);
  const serverPortValid = parseOptionalPort(config.serverPort).ok;
  const debugPortValid = parseOptionalPort(config.debugPort).ok;
  return {
    profileValid,
    serverPortValid,
    debugPortValid,
    isValid: profileValid && serverPortValid && debugPortValid,
  };
}

export function hasCustomModuleConfig(config: JarRunnerModuleConfig): boolean {
  return (
    config.profile.trim().length > 0 ||
    config.serverPort.trim().length > 0 ||
    config.debugPort.trim().length > 0
  );
}

export function resolveEffectiveDebugPort(
  module: JarRunnerModule,
  config?: JarRunnerModuleConfig,
): number | null {
  if (config) {
    const parsed = parseOptionalPort(config.debugPort);
    if (parsed.ok && parsed.port !== null) return parsed.port;
  }
  return module.debugPort;
}

export function resolveModuleCwd(rootCwd: string, relativeDir: string): string {
  if (relativeDir.length === 0) return rootCwd;
  const separator = rootCwd.includes("\\") && !rootCwd.includes("/") ? "\\" : "/";
  const trimmedRoot = rootCwd.replace(/[\\/]+$/, "");
  const normalizedRelative = relativeDir
    .replaceAll(separator === "/" ? "\\" : "/", separator)
    .replace(/^[\\/]+/, "");
  return `${trimmedRoot}${separator}${normalizedRelative}`;
}

export function buildMvnOpCommand(module: JarRunnerModule, config?: JarRunnerModuleConfig): string {
  const parts = ["mvn-op"];
  const effectiveDebugPort = resolveEffectiveDebugPort(module, config);
  if (effectiveDebugPort !== null) {
    parts.push(`--debug-port=${effectiveDebugPort}`);
  }
  const serverPortResult = config ? parseOptionalPort(config.serverPort) : null;
  if (serverPortResult?.ok && serverPortResult.port !== null) {
    parts.push(`--server.port=${serverPortResult.port}`);
  }
  const profile = config?.profile.trim() ?? "";
  if (profile.length > 0 && SAFE_PROFILE_PATTERN.test(profile)) {
    parts.push(`--spring.profiles.active=${profile}`);
  }
  return parts.join(" ");
}

export function buildJarRunnerShellCommand(
  command: JarRunnerCommand,
  module: JarRunnerModule,
  missingJarMessage: string,
  config?: JarRunnerModuleConfig,
): string {
  if (command === "mvn-op") {
    return buildMvnOpCommand(module, config);
  }
  if (command === "mvn-p") {
    return "mvn-p";
  }

  const jarArgs: string[] = [];
  const serverPortResult = config ? parseOptionalPort(config.serverPort) : null;
  if (serverPortResult?.ok && serverPortResult.port !== null) {
    jarArgs.push(`--server.port=${serverPortResult.port}`);
  }
  const profile = config?.profile.trim() ?? "";
  if (profile.length > 0 && SAFE_PROFILE_PATTERN.test(profile)) {
    jarArgs.push(`--spring.profiles.active=${profile}`);
  }
  const jarArgsSuffix = jarArgs.length > 0 ? ` ${jarArgs.join(" ")}` : "";

  const findJar =
    "find target -maxdepth 1 -type f -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' ! -name '*-tests.jar' 2>/dev/null | head -n 1";
  const resolveJar = SAFE_JAR_BASENAME.test(module.name)
    ? `jar="target/${module.name}.jar"; [ -f "$jar" ] || jar=$(${findJar})`
    : `jar=$(${findJar})`;
  const escapedMessage = missingJarMessage.replaceAll("'", "'\\''");
  return `${resolveJar}; if [ -n "$jar" ]; then java-op -jar "$jar"${jarArgsSuffix}; else printf '%s\\n' '${escapedMessage}'; fi`;
}

type StoredConfigsByProject = Record<string, Record<string, JarRunnerModuleConfig>>;

function sanitizeConfig(value: unknown): JarRunnerModuleConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const profile = typeof record.profile === "string" ? record.profile : "";
  const serverPort = typeof record.serverPort === "string" ? record.serverPort : "";
  const debugPort = typeof record.debugPort === "string" ? record.debugPort : "";
  if (profile.length === 0 && serverPort.length === 0 && debugPort.length === 0) return null;
  return { profile, serverPort, debugPort };
}

function readAllStoredConfigs(): StoredConfigsByProject {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: StoredConfigsByProject = {};
    for (const [projectKey, projectValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (!projectValue || typeof projectValue !== "object") continue;
      const modules: Record<string, JarRunnerModuleConfig> = {};
      for (const [moduleId, moduleValue] of Object.entries(
        projectValue as Record<string, unknown>,
      )) {
        const clean = sanitizeConfig(moduleValue);
        if (clean) modules[moduleId] = clean;
      }
      if (Object.keys(modules).length > 0) out[projectKey] = modules;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadProjectJarRunnerConfigs(
  projectKey: string,
): Readonly<Record<string, JarRunnerModuleConfig>> {
  const all = readAllStoredConfigs();
  return all[projectKey] ?? {};
}

export function saveProjectJarRunnerConfigs(
  projectKey: string,
  configs: Readonly<Record<string, JarRunnerModuleConfig>>,
): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const all = readAllStoredConfigs();
    const cleaned: Record<string, JarRunnerModuleConfig> = {};
    for (const [moduleId, config] of Object.entries(configs)) {
      const clean = sanitizeConfig(config);
      if (clean) cleaned[moduleId] = clean;
    }
    delete all[projectKey];
    if (Object.keys(cleaned).length > 0) {
      all[projectKey] = cleaned;
    }
    const keys = Object.keys(all);
    while (keys.length > MAX_STORED_PROJECTS) {
      const oldest = keys.shift();
      if (oldest !== undefined) delete all[oldest];
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage quota or restricted context errors.
  }
}
