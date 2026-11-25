// @effect-diagnostics-next-line nodeBuiltinImport:off -- Windows system proxy lookup runs reg.exe without requiring Effect services.
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

import type * as Undici from "undici";

// undici is external to the CLI bundle; Node single-executables can load it from disk only with require.
const requireUndici = NodeModule.createRequire(import.meta.url);

const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1"] as const;
const WINDOWS_PROXY_REGISTRY_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

export interface HttpProxySettings {
  readonly httpProxy?: string;
  readonly httpsProxy?: string;
  readonly noProxy?: string;
}

export function parseHttpProxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function buildNoProxy(value: string | undefined): string {
  const entries = (value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const existing = new Set(entries.map((entry) => entry.toLowerCase()));
  for (const host of LOOPBACK_NO_PROXY) {
    if (!existing.has(host)) entries.push(host);
  }
  return entries.join(",");
}

export function resolveEnvHttpProxy(
  env: NodeJS.ProcessEnv = process.env,
): HttpProxySettings | undefined {
  if (env.NODE_USE_ENV_PROXY?.trim() === "0") return undefined;
  const httpProxy = parseHttpProxyUrl(env.http_proxy ?? env.HTTP_PROXY);
  const httpsProxy = parseHttpProxyUrl(env.https_proxy ?? env.HTTPS_PROXY);
  if (!httpProxy && !httpsProxy) return undefined;
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    noProxy: buildNoProxy(env.no_proxy ?? env.NO_PROXY),
  };
}

function normalizeWindowsProxyHost(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return parseHttpProxyUrl(withScheme);
}

/** Parses `reg.exe query` output for WinINET's `Internet Settings` key. */
export function parseWindowsSystemProxy(registryOutput: string): HttpProxySettings | undefined {
  let enabled = false;
  let proxyServer: string | undefined;
  let proxyOverride: string | undefined;
  for (const line of registryOutput.split(/\r?\n/)) {
    const match = line.match(/^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.*)$/i);
    if (!match) continue;
    const key = match[1]?.toLowerCase();
    const rawValue = match[2]?.trim() ?? "";
    if (key === "proxyenable") {
      enabled = rawValue === "0x1" || rawValue === "1";
    } else if (key === "proxyserver") {
      proxyServer = rawValue;
    } else if (key === "proxyoverride") {
      proxyOverride = rawValue;
    }
  }
  if (!enabled || !proxyServer) return undefined;

  let httpProxy: string | undefined;
  let httpsProxy: string | undefined;
  if (proxyServer.includes("=")) {
    for (const part of proxyServer.split(";")) {
      const separator = part.indexOf("=");
      if (separator === -1) continue;
      const scheme = part.slice(0, separator).trim().toLowerCase();
      const target = normalizeWindowsProxyHost(part.slice(separator + 1));
      if (!target) continue;
      if (scheme === "http") httpProxy = target;
      else if (scheme === "https") httpsProxy = target;
    }
  } else {
    const target = normalizeWindowsProxyHost(proxyServer);
    if (target) {
      httpProxy = target;
      httpsProxy = target;
    }
  }
  if (!httpProxy && !httpsProxy) return undefined;

  const overrides = (proxyOverride ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.toLowerCase() !== "<local>")
    .join(",");
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    noProxy: buildNoProxy(overrides),
  };
}

export function readWindowsSystemProxy(
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Defaults to current host platform when called outside Effect.
  platform: NodeJS.Platform = process.platform,
): Promise<HttpProxySettings | undefined> {
  if (platform !== "win32") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    try {
      NodeChildProcess.execFile(
        "reg.exe",
        ["query", WINDOWS_PROXY_REGISTRY_KEY],
        { encoding: "utf8", timeout: 2_000, windowsHide: true },
        (error, stdout) => {
          resolve(error ? undefined : parseWindowsSystemProxy(stdout));
        },
      );
    } catch {
      resolve(undefined);
    }
  });
}

export function createHttp1ProxyDispatcher(proxy: HttpProxySettings): Undici.Dispatcher {
  const undici = requireUndici("undici") as typeof Undici;
  return new undici.EnvHttpProxyAgent({
    // Pass empty strings for absent sides so EnvHttpProxyAgent never falls back to an invalid process.env value.
    httpProxy: proxy.httpProxy ?? "",
    httpsProxy: proxy.httpsProxy ?? "",
    noProxy: proxy.noProxy ?? LOOPBACK_NO_PROXY.join(","),
    allowH2: false,
    // ProxyAgent's connector forces h2 and ignores allowH2; replace it for HTTPS proxies.
    clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
  });
}

export function makeProxyFetch(proxy: HttpProxySettings): {
  readonly fetch: typeof globalThis.fetch;
  readonly close: () => Promise<void>;
} {
  const undici = requireUndici("undici") as typeof Undici;
  const dispatcher = createHttp1ProxyDispatcher(proxy);
  const proxyFetch = ((
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) =>
    undici.fetch(input as Parameters<typeof undici.fetch>[0], {
      ...(init as Parameters<typeof undici.fetch>[1]),
      dispatcher,
    })) as unknown as typeof globalThis.fetch;
  return {
    fetch: proxyFetch,
    close: () => dispatcher.close().catch(() => undefined),
  };
}

/** Node 26 bundles h2-capable undici 8; Node 22/24 and Electron stay on HTTP/1.1 with 6/7. */
export const builtinFetchUsesHttp2 = (bundledUndiciVersion: string | undefined) =>
  Number.parseInt(bundledUndiciVersion ?? "", 10) >= 8;

/** Preserves the EnvHttpProxyAgent installed by --use-env-proxy / NODE_USE_ENV_PROXY. */
export function installHttp1FetchDispatcher(): void {
  const undici = requireUndici("undici") as typeof Undici;
  // Node's agent comes from its internal undici copy, so `instanceof` against the npm class is false.
  const usesEnvProxy = undici.getGlobalDispatcher().constructor.name === "EnvHttpProxyAgent";
  undici.setGlobalDispatcher(
    usesEnvProxy
      ? new undici.EnvHttpProxyAgent({
          allowH2: false,
          // ProxyAgent's connector forces h2 and ignores allowH2; replace it for HTTPS proxies.
          clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
        })
      : new undici.Agent({ allowH2: false }),
  );
}

/** Honors HTTP_PROXY/HTTPS_PROXY across Node/Electron versions while keeping fetch on HTTP/1.1. */
export function configureOutboundFetch(env: NodeJS.ProcessEnv = process.env): void {
  const proxy = resolveEnvHttpProxy(env);
  if (proxy) {
    const undici = requireUndici("undici") as typeof Undici;
    undici.setGlobalDispatcher(createHttp1ProxyDispatcher(proxy));
    return;
  }
  if (builtinFetchUsesHttp2(process.versions.undici)) installHttp1FetchDispatcher();
}

/** Avoids uncaught idle-timeout errors on h2 streams (https://github.com/nodejs/undici/issues/5936). */
export function keepOutboundFetchOnHttp1(): void {
  configureOutboundFetch();
}

// @types/node does not declare setTypeOfService yet.
type TypeOfServiceSocket = {
  setTypeOfService?: (this: NodeNet.Socket, typeOfService: number) => NodeNet.Socket;
};

// Bundled undici calls this from a socket callback without catching. On macOS,
// EINVAL after a peer reset must not exit the server over an optional QoS hint.
export function ignoreMacosTypeOfServiceEinval(
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Runs before ACP dispatch without loading the Effect graph.
  platform = process.platform,
  socketPrototype: TypeOfServiceSocket = NodeNet.Socket.prototype as TypeOfServiceSocket,
): void {
  if (platform !== "darwin") return;
  const setTypeOfService = socketPrototype.setTypeOfService;
  if (typeof setTypeOfService !== "function") return;
  socketPrototype.setTypeOfService = function (...args) {
    try {
      return setTypeOfService.apply(this, args);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EINVAL") return this;
      throw error;
    }
  };
}

/**
 * Node's 250 ms Happy Eyeballs attempt timeout abandons a working-but-slow IPv4
 * connect when IPv6 is advertised but unroutable, which broke the ACP registry
 * fetch. A larger `--network-family-autoselection-attempt-timeout` still wins.
 */
export function extendConnectionAttemptTimeout(): void {
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(
    Math.max(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout(), 1_000),
  );
}
