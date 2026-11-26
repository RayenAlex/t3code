import { describe, expect, it } from "vite-plus/test";

import {
  buildJarRunnerShellCommand,
  buildMvnOpCommand,
  buildNpmShellCommand,
  EMPTY_MODULE_CONFIG,
  extractProfilesByModule,
  extractTopLevelPackageJsonDirs,
  extractTopLevelPomPaths,
  formatProxyTargetBadge,
  isJarModule,
  isNpmRunnerCommand,
  isProxyTargetValid,
  npmRunnerCommand,
  npmRunnerScript,
  parseNpmRunnerScripts,
  resolveJarRunnerModules,
  resolveModuleCwd,
  resolveNpmRunnerProjects,
  resolveProxyTarget,
  validateJarRunnerModuleConfig,
} from "./jarRunnerModules";

describe("jarRunnerModules", () => {
  it("extracts only root and direct child pom.xml files and skips ignored or nested ones", () => {
    expect(
      extractTopLevelPomPaths([
        { path: "gznqi/pom.xml", kind: "file" },
        { path: "sms/pom.xml", kind: "file" },
        { path: "gznqi-websocket/pom.xml", kind: "file" },
        { path: "gznqi-log/pom.xml", kind: "file", ignored: true },
        { path: "gznqi/src/test/resources/pom.xml", kind: "file" },
        { path: "sms/pom.xml", kind: "file" },
        { path: "gznqi", kind: "directory" },
      ]),
    ).toEqual(["gznqi/pom.xml", "sms/pom.xml", "gznqi-websocket/pom.xml"]);
  });

  it("extracts available Spring profiles per module from application-* files", () => {
    expect(
      extractProfilesByModule(
        [
          { path: "gznqi/src/main/resources/application-local2.yml", kind: "file" },
          { path: "gznqi/src/main/resources/application-dev.yml", kind: "file" },
          { path: "gznqi/src/main/resources/application-local.yml", kind: "file" },
          { path: "gznqi/src/main/resources/application.yml", kind: "file" },
          { path: "sms/src/main/resources/application-prod.properties", kind: "file" },
          { path: "sms/src/main/resources/application-local.yml", kind: "file" },
          { path: "gznqi-log/src/main/resources/application-dev.yml", kind: "file", ignored: true },
          { path: "src/main/resources/application-staging.yml", kind: "file" },
        ],
        ["gznqi", "sms", ""],
      ),
    ).toEqual({
      gznqi: ["dev", "local", "local2"],
      sms: ["local", "prod"],
      "": ["staging"],
    });
  });

  it("extracts only root and direct child package.json files", () => {
    expect(
      extractTopLevelPackageJsonDirs([
        { path: "web/package.json", kind: "file" },
        { path: "package.json", kind: "file" },
        { path: "gznqi-websocket/package.json", kind: "file" },
        { path: "web/package-lock.json", kind: "file" },
        { path: "web/public/lib/package.json", kind: "file" },
        { path: "web/node_modules/vue/package.json", kind: "file", ignored: true },
        { path: "web", kind: "directory" },
        { path: "web/package.json", kind: "file" },
      ]),
    ).toEqual(["web", "", "gznqi-websocket"]);
  });

  it("prioritizes the main project module and assigns unique debug ports for multi-module repos", () => {
    const modules = resolveJarRunnerModules({
      projectName: "gznqi",
      pomPaths: ["sms/pom.xml", "gznqi-websocket/pom.xml", "gznqi/pom.xml"],
      springBootPomPaths: new Set(["gznqi/pom.xml", "sms/pom.xml", "gznqi-websocket/pom.xml"]),
    });

    expect(modules).toEqual([
      { kind: "jar", id: "gznqi", name: "gznqi", relativeDir: "gznqi", debugPort: 50055 },
      {
        kind: "jar",
        id: "gznqi-websocket",
        name: "gznqi-websocket",
        relativeDir: "gznqi-websocket",
        debugPort: 50056,
      },
      { kind: "jar", id: "sms", name: "sms", relativeDir: "sms", debugPort: 50057 },
    ]);
  });

  it("filters multi-module repos down to Spring Boot runnable modules when detected", () => {
    const modules = resolveJarRunnerModules({
      projectName: "dbsyncer",
      pomPaths: ["pom.xml", "dbsyncer-common/pom.xml", "dbsyncer-web/pom.xml"],
      springBootPomPaths: new Set(["dbsyncer-web/pom.xml"]),
    });

    expect(modules).toEqual([
      {
        kind: "jar",
        id: "dbsyncer-web",
        name: "dbsyncer-web",
        relativeDir: "dbsyncer-web",
        debugPort: null,
      },
    ]);
  });

  it("returns no modules when no pom.xml is found so non-Java projects hide the runner", () => {
    expect(
      resolveJarRunnerModules({
        projectName: "demo-app",
        pomPaths: [],
      }),
    ).toEqual([]);
  });

  it("lists dev first and then build scripts in package.json order, skipping the rest", () => {
    expect(
      parseNpmRunnerScripts(
        JSON.stringify({
          name: "blb-web",
          scripts: {
            lint: "eslint --ext .js,.vue src",
            "build:prod": "vue-cli-service build",
            dev: "vue-cli-service serve",
            "build:stage": "vue-cli-service build --mode staging",
            build: "vite build",
            preview: "node build/index.js --preview",
            "build:bad name": "echo unsafe",
          },
        }),
      ),
    ).toEqual(["dev", "build:prod", "build:stage", "build"]);
    expect(parseNpmRunnerScripts("not json")).toEqual([]);
    expect(parseNpmRunnerScripts(JSON.stringify({ name: "no-scripts" }))).toEqual([]);
    expect(parseNpmRunnerScripts(JSON.stringify({ scripts: "npm run build" }))).toEqual([]);
  });

  it("resolves npm projects that have a build or dev script and drops the rest", () => {
    const projects = resolveNpmRunnerProjects({
      projectName: "gznqi",
      packageJsonDirs: ["web", "", "tooling"],
      scriptsByDir: {
        web: ["dev", "build:prod", "build:stage"],
        "": ["build"],
        tooling: [],
      },
    });

    expect(projects).toEqual([
      {
        kind: "npm",
        id: "npm:",
        name: "gznqi",
        relativeDir: "",
        scripts: ["build"],
      },
      {
        kind: "npm",
        id: "npm:web",
        name: "web",
        relativeDir: "web",
        scripts: ["dev", "build:prod", "build:stage"],
      },
    ]);
    expect(projects.every((project) => !isJarModule(project))).toBe(true);
  });

  it("resolves module working directories on unix and windows paths", () => {
    expect(resolveModuleCwd("/home/rayen/projects/gznqi", "")).toBe("/home/rayen/projects/gznqi");
    expect(resolveModuleCwd("/home/rayen/projects/gznqi/", "sms")).toBe(
      "/home/rayen/projects/gznqi/sms",
    );
    expect(resolveModuleCwd("C:\\work\\gznqi\\", "gznqi-websocket")).toBe(
      "C:\\work\\gznqi\\gznqi-websocket",
    );
  });

  it("builds mvn-op, jar, and mvn-p commands with custom debug port, server port, and Spring profile", () => {
    const single = {
      kind: "jar" as const,
      id: "",
      name: "zjfricp",
      relativeDir: "",
      debugPort: null,
    };
    const child = {
      kind: "jar" as const,
      id: "gznqi",
      name: "gznqi",
      relativeDir: "gznqi",
      debugPort: 50055,
    };
    const customConfig = {
      profile: "local2",
      serverPort: "9021",
      debugPort: "50058",
      proxyTarget: "",
    };

    expect(buildJarRunnerShellCommand("mvn-op", single, "missing")).toBe("mvn-op");
    expect(buildJarRunnerShellCommand("mvn-op", child, "missing")).toBe(
      "mvn-op --debug-port=50055",
    );
    expect(buildMvnOpCommand(child, customConfig)).toBe(
      "mvn-op --debug-port=50058 --server.port=9021 --spring.profiles.active=local2",
    );
    expect(buildJarRunnerShellCommand("mvn-op", child, "missing", customConfig)).toBe(
      "mvn-op --debug-port=50058 --server.port=9021 --spring.profiles.active=local2",
    );
    expect(buildJarRunnerShellCommand("mvn-p", child, "missing", customConfig)).toBe("mvn-p");

    const jarCmd = buildJarRunnerShellCommand("jar", child, "missing jar", customConfig);
    expect(jarCmd).toContain('jar="target/gznqi.jar"');
    expect(jarCmd).toContain(
      'java-op -jar "$jar" --server.port=9021 --spring.profiles.active=local2',
    );
    expect(jarCmd).toContain("missing jar");
  });

  it("builds npm commands and sends PROXY_TARGET only to dev", () => {
    const config = { ...EMPTY_MODULE_CONFIG, proxyTarget: " http://10.0.0.1:9021 " };
    const portConfig = { ...EMPTY_MODULE_CONFIG, proxyTarget: "9021" };

    expect(buildNpmShellCommand("dev")).toBe("npm run dev");
    expect(buildNpmShellCommand("dev", config)).toBe(
      'PROXY_TARGET="http://10.0.0.1:9021" npm run dev',
    );
    expect(buildNpmShellCommand("dev", portConfig)).toBe(
      'PROXY_TARGET="http://localhost:9021" npm run dev',
    );
    expect(buildNpmShellCommand("build:stage", config)).toBe("npm run build:stage");
    expect(
      buildNpmShellCommand("dev", { ...config, proxyTarget: "http://host:9021; npm run build" }),
    ).toBe("npm run dev");

    expect(resolveProxyTarget("9021")).toBe("http://localhost:9021");
    expect(resolveProxyTarget("192.168.1.50:9021")).toBe("http://192.168.1.50:9021");
    expect(
      buildNpmShellCommand("dev", { ...EMPTY_MODULE_CONFIG, proxyTarget: "10.0.0.1:9021" }),
    ).toBe('PROXY_TARGET="http://10.0.0.1:9021" npm run dev');
    expect(formatProxyTargetBadge("9021")).toBe(":9021");
    expect(formatProxyTargetBadge("http://localhost:9021")).toBe(":9021");
    expect(formatProxyTargetBadge("http://127.0.0.1:8080/")).toBe(":8080");
    expect(formatProxyTargetBadge("192.168.1.50:9021")).toBe("192.168.1.50:9021");
    expect(formatProxyTargetBadge("http://10.0.0.1:9021")).toBe("10.0.0.1:9021");

    expect(npmRunnerCommand("dev")).toBe("npm:dev");
    expect(isNpmRunnerCommand("npm:build:prod")).toBe(true);
    expect(isNpmRunnerCommand("mvn-op")).toBe(false);
    expect(npmRunnerScript("npm:build:prod")).toBe("build:prod");
  });

  it("accepts bare ports, host:port, and http(s) proxy targets that are safe to type into a shell", () => {
    for (const valid of [
      "",
      "9021",
      "8080",
      "192.168.1.50:9021",
      "localhost:9021",
      "[::1]:9021",
      "http://10.0.0.1:9021",
      "https://api.example.com/gznqi/",
      "http://[::1]:9021",
    ]) {
      expect(isProxyTargetValid(valid)).toBe(true);
    }
    for (const invalid of [
      "0",
      "99999",
      "10.0.0.1:0",
      "10.0.0.1:99999",
      "ftp://10.0.0.1",
      "http://host:9021; npm run build",
      "http://host/$(id)",
      "http://host/`id`",
      "http://user:secret@host",
    ]) {
      expect(isProxyTargetValid(invalid)).toBe(false);
    }
  });

  it("validates custom port ranges and profile syntax", () => {
    expect(
      validateJarRunnerModuleConfig({
        profile: "local2,debug",
        serverPort: "9021",
        debugPort: "50058",
        proxyTarget: "",
      }),
    ).toEqual({
      profileValid: true,
      serverPortValid: true,
      debugPortValid: true,
      isValid: true,
    });

    expect(
      validateJarRunnerModuleConfig({
        profile: "bad space",
        serverPort: "99999",
        debugPort: "abc",
        proxyTarget: "",
      }),
    ).toEqual({
      profileValid: false,
      serverPortValid: false,
      debugPortValid: false,
      isValid: false,
    });
  });
});
