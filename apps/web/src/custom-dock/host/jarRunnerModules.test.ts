import { describe, expect, it } from "vite-plus/test";

import {
  buildJarRunnerShellCommand,
  buildMvnOpCommand,
  extractProfilesByModule,
  extractTopLevelPomPaths,
  resolveJarRunnerModules,
  resolveModuleCwd,
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

  it("prioritizes the main project module and assigns unique debug ports for multi-module repos", () => {
    const modules = resolveJarRunnerModules({
      projectName: "gznqi",
      pomPaths: ["sms/pom.xml", "gznqi-websocket/pom.xml", "gznqi/pom.xml"],
      springBootPomPaths: new Set(["gznqi/pom.xml", "sms/pom.xml", "gznqi-websocket/pom.xml"]),
    });

    expect(modules).toEqual([
      { id: "gznqi", name: "gznqi", relativeDir: "gznqi", debugPort: 50055 },
      {
        id: "gznqi-websocket",
        name: "gznqi-websocket",
        relativeDir: "gznqi-websocket",
        debugPort: 50056,
      },
      { id: "sms", name: "sms", relativeDir: "sms", debugPort: 50057 },
    ]);
  });

  it("filters multi-module repos down to Spring Boot runnable modules when detected", () => {
    const modules = resolveJarRunnerModules({
      projectName: "dbsyncer",
      pomPaths: ["pom.xml", "dbsyncer-common/pom.xml", "dbsyncer-web/pom.xml"],
      springBootPomPaths: new Set(["dbsyncer-web/pom.xml"]),
    });

    expect(modules).toEqual([
      { id: "dbsyncer-web", name: "dbsyncer-web", relativeDir: "dbsyncer-web", debugPort: null },
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
    const single = { id: "", name: "zjfricp", relativeDir: "", debugPort: null };
    const child = { id: "gznqi", name: "gznqi", relativeDir: "gznqi", debugPort: 50055 };
    const customConfig = {
      profile: "local2",
      serverPort: "9021",
      debugPort: "50058",
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

  it("validates custom port ranges and profile syntax", () => {
    expect(
      validateJarRunnerModuleConfig({
        profile: "local2,debug",
        serverPort: "9021",
        debugPort: "50058",
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
      }),
    ).toEqual({
      profileValid: false,
      serverPortValid: false,
      debugPortValid: false,
      isValid: false,
    });
  });
});
