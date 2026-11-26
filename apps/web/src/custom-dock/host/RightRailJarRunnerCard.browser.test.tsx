import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import {
  EMPTY_MODULE_CONFIG,
  loadProjectJarRunnerConfigs,
  saveProjectJarRunnerConfigs,
  type RunnerModuleConfig,
} from "./jarRunnerModules";
import { RightRailJarRunnerCard, type RunnerModuleView } from "./RightRailJarRunnerCard";

const SINGLE_MODULE: ReadonlyArray<RunnerModuleView> = [
  {
    module: { kind: "jar", id: "", name: "zjfricp", relativeDir: "", debugPort: null },
    run: null,
    config: EMPTY_MODULE_CONFIG,
    availableProfiles: ["dev", "local2"],
  },
];

const MULTI_MODULES: ReadonlyArray<RunnerModuleView> = [
  {
    module: { kind: "jar", id: "gznqi", name: "gznqi", relativeDir: "gznqi", debugPort: 50055 },
    run: { command: "mvn-op", terminalId: "term-1", running: true },
    config: { profile: "local2", serverPort: "9021", debugPort: "50058", proxyTarget: "" },
    availableProfiles: ["dev", "local", "local2", "prod"],
  },
  {
    module: {
      kind: "jar",
      id: "gznqi-websocket",
      name: "gznqi-websocket",
      relativeDir: "gznqi-websocket",
      debugPort: 50056,
    },
    run: { command: "jar", terminalId: "term-2", running: false },
    config: EMPTY_MODULE_CONFIG,
    availableProfiles: ["dev", "local"],
  },
  {
    module: { kind: "jar", id: "sms", name: "sms", relativeDir: "sms", debugPort: 50057 },
    run: null,
    config: EMPTY_MODULE_CONFIG,
    availableProfiles: ["local", "prod"],
  },
];

const WEB_PROJECT = {
  kind: "npm",
  id: "npm:web",
  name: "web",
  relativeDir: "web",
  scripts: ["dev", "build:prod", "build:stage"],
} as const;

it("runs mvn-op, JAR, and mvn-p actions in single-module mode and toggles collapse", async () => {
  const onRun = vi.fn();
  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={SINGLE_MODULE}
      error={null}
      onRun={onRun}
      onRunNpm={vi.fn()}
      onRunAll={vi.fn()}
      onOpenTerminal={vi.fn()}
      onStop={vi.fn()}
      onStopAll={vi.fn()}
      onChangeConfig={vi.fn()}
    />,
  );

  await screen.getByRole("button", { name: "Run" }).click();
  await screen.getByRole("button", { name: "JAR run" }).click();
  await screen.getByRole("button", { name: "Package" }).click();
  expect(onRun).toHaveBeenNthCalledWith(1, SINGLE_MODULE[0]!.module, "mvn-op");
  expect(onRun).toHaveBeenNthCalledWith(2, SINGLE_MODULE[0]!.module, "jar");
  expect(onRun).toHaveBeenNthCalledWith(3, SINGLE_MODULE[0]!.module, "mvn-p");

  await screen.getByRole("button", { name: "Collapse JAR runner" }).click();
  await expect.element(screen.getByRole("button", { name: "Run" })).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Expand JAR runner" }).click();
  await expect.element(screen.getByRole("button", { name: "Run" })).toBeVisible();
});

it("lists multiple modules with independent controls, custom config chips, and batch actions", async () => {
  const onRun = vi.fn();
  const onRunAll = vi.fn();
  const onOpenTerminal = vi.fn();
  const onStop = vi.fn();
  const onStopAll = vi.fn();

  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={MULTI_MODULES}
      error="sms failed"
      onRun={onRun}
      onRunNpm={vi.fn()}
      onRunAll={onRunAll}
      onOpenTerminal={onOpenTerminal}
      onStop={onStop}
      onStopAll={onStopAll}
      onChangeConfig={vi.fn()}
    />,
  );

  await expect.element(screen.getByText("1/3 running")).toBeVisible();
  await expect.element(screen.getByText("gznqi")).toBeVisible();
  await expect.element(screen.getByText("local2")).toBeVisible();
  await expect.element(screen.getByText(":9021")).toBeVisible();
  await expect.element(screen.getByText("debug 50058")).toBeVisible();
  await expect.element(screen.getByText("sms failed")).toBeVisible();

  await screen.getByRole("button", { name: "Start all (mvn-op, unique debug ports)" }).click();
  await screen.getByRole("button", { name: "Native start all (java-op -jar)" }).click();
  await screen.getByRole("button", { name: "Stop all running modules (Ctrl+C)" }).click();
  expect(onRunAll).toHaveBeenNthCalledWith(1, "mvn-op");
  expect(onRunAll).toHaveBeenNthCalledWith(2, "jar");
  expect(onStopAll).toHaveBeenCalledTimes(1);

  await screen.getByRole("button", { name: "sms JAR run" }).click();
  expect(onRun).toHaveBeenCalledWith(MULTI_MODULES[2]!.module, "jar");

  await screen.getByRole("button", { name: "Stop gznqi (Ctrl+C)" }).click();
  expect(onStop).toHaveBeenCalledWith("gznqi", "term-1");

  await screen.getByRole("button", { name: "Open gznqi-websocket terminal" }).click();
  expect(onOpenTerminal).toHaveBeenCalledWith("term-2");
});

it("edits module profile and ports inline and previews the resulting mvn-op command", async () => {
  function StatefulHarness() {
    const [config, setConfig] = useState<RunnerModuleConfig>(EMPTY_MODULE_CONFIG);
    return (
      <RightRailJarRunnerCard
        canRun
        busyKey={null}
        modules={[
          {
            module: {
              kind: "jar",
              id: "gznqi",
              name: "gznqi",
              relativeDir: "gznqi",
              debugPort: 50055,
            },
            run: null,
            config,
            availableProfiles: ["dev", "local2"],
          },
          {
            module: { kind: "jar", id: "sms", name: "sms", relativeDir: "sms", debugPort: 50056 },
            run: null,
            config: EMPTY_MODULE_CONFIG,
            availableProfiles: ["local"],
          },
        ]}
        error={null}
        onRun={vi.fn()}
        onRunNpm={vi.fn()}
        onRunAll={vi.fn()}
        onOpenTerminal={vi.fn()}
        onStop={vi.fn()}
        onStopAll={vi.fn()}
        onChangeConfig={(_moduleId, next) => setConfig(next)}
      />
    );
  }

  await using screen = await render(<StatefulHarness />);

  await screen.getByRole("button", { name: "Configure gznqi profile and ports" }).click();
  await screen.getByRole("button", { name: "local2" }).click();
  await screen.getByLabelText("Server port").fill("9021");
  await screen.getByLabelText("Debug port").fill("50058");

  await expect
    .element(
      screen.getByText(
        "mvn-op --debug-port=50058 --server.port=9021 --spring.profiles.active=local2",
      ),
    )
    .toBeVisible();

  await screen.getByRole("button", { name: "Reset defaults" }).click();
  await expect.element(screen.getByText("mvn-op --debug-port=50055")).toBeVisible();
});

it("runs npm dev and build scripts for a lone front-end project", async () => {
  const onRun = vi.fn();
  const onRunNpm = vi.fn();
  const onStop = vi.fn();
  const onOpenTerminal = vi.fn();

  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={[
        {
          module: WEB_PROJECT,
          run: { command: "npm:dev", terminalId: "term-1", running: true },
          config: EMPTY_MODULE_CONFIG,
          availableProfiles: [],
        },
      ]}
      error={null}
      onRun={onRun}
      onRunNpm={onRunNpm}
      onRunAll={vi.fn()}
      onOpenTerminal={onOpenTerminal}
      onStop={onStop}
      onStopAll={vi.fn()}
      onChangeConfig={vi.fn()}
    />,
  );

  await expect.element(screen.getByRole("region", { name: "Quick run" })).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Run" })).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "dev" }).click();
  await screen.getByRole("button", { name: "build:prod" }).click();
  await screen.getByRole("button", { name: "build:stage" }).click();
  expect(onRunNpm).toHaveBeenNthCalledWith(1, WEB_PROJECT, "dev");
  expect(onRunNpm).toHaveBeenNthCalledWith(2, WEB_PROJECT, "build:prod");
  expect(onRunNpm).toHaveBeenNthCalledWith(3, WEB_PROJECT, "build:stage");
  expect(onRun).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Stop running process (Ctrl+C)" }).click();
  expect(onStop).toHaveBeenCalledWith("npm:web", "term-1");
  await screen.getByRole("button", { name: "Open runner terminal" }).click();
  expect(onOpenTerminal).toHaveBeenCalledWith("term-1");

  await screen.getByRole("button", { name: "Collapse quick run" }).click();
  await expect.element(screen.getByRole("button", { name: "dev" })).not.toBeInTheDocument();
});

it("edits the npm proxy target inline and previews the dev command that carries it", async () => {
  function StatefulHarness() {
    const [config, setConfig] = useState<RunnerModuleConfig>(EMPTY_MODULE_CONFIG);
    return (
      <RightRailJarRunnerCard
        canRun
        busyKey={null}
        modules={[{ module: WEB_PROJECT, run: null, config, availableProfiles: [] }]}
        error={null}
        onRun={vi.fn()}
        onRunNpm={vi.fn()}
        onRunAll={vi.fn()}
        onOpenTerminal={vi.fn()}
        onStop={vi.fn()}
        onStopAll={vi.fn()}
        onChangeConfig={(_moduleId, next) => setConfig(next)}
      />
    );
  }

  await using screen = await render(<StatefulHarness />);
  const proxyInput = screen.getByLabelText("Backend URL / port (PROXY_TARGET)");

  await screen.getByRole("button", { name: "Configure backend target" }).click();
  await expect.element(screen.getByText("npm run dev")).toBeVisible();

  await proxyInput.fill("9021");
  await expect
    .element(screen.getByText('PROXY_TARGET="http://localhost:9021" npm run dev'))
    .toBeVisible();
  await expect.element(screen.getByText(":9021")).toBeVisible();

  await proxyInput.fill("192.168.1.50:9021");
  await expect
    .element(screen.getByText('PROXY_TARGET="http://192.168.1.50:9021" npm run dev'))
    .toBeVisible();
  await expect.element(screen.getByText("192.168.1.50:9021")).toBeVisible();

  await proxyInput.fill("http://10.0.0.1:9021");
  await expect
    .element(screen.getByText('PROXY_TARGET="http://10.0.0.1:9021" npm run dev'))
    .toBeVisible();
  await expect.element(screen.getByText("10.0.0.1:9021")).toBeVisible();

  await proxyInput.fill("http://10.0.0.1:9021; npm run build");
  await expect.element(screen.getByText("Enter a port, host:port, or http(s) URL")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "dev" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "build:prod" })).toBeEnabled();

  await screen.getByRole("button", { name: "Reset defaults" }).click();
  await expect.element(screen.getByText("npm run dev")).toBeVisible();
});

it("lists an npm project beside JAR modules with its own controls and backend port picks", async () => {
  const onRunAll = vi.fn();
  const onRunNpm = vi.fn();
  const onStop = vi.fn();
  const onChangeConfig = vi.fn();

  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={[
        MULTI_MODULES[0]!,
        {
          module: WEB_PROJECT,
          run: { command: "npm:dev", terminalId: "term-3", running: true },
          config: { ...EMPTY_MODULE_CONFIG, proxyTarget: "http://10.0.0.1:9021" },
          availableProfiles: [],
        },
      ]}
      error={null}
      onRun={vi.fn()}
      onRunNpm={onRunNpm}
      onRunAll={onRunAll}
      onOpenTerminal={vi.fn()}
      onStop={onStop}
      onStopAll={vi.fn()}
      onChangeConfig={onChangeConfig}
    />,
  );

  await expect.element(screen.getByRole("region", { name: "Quick run" })).toBeInTheDocument();
  await expect.element(screen.getByText("2/2 running")).toBeVisible();
  await expect.element(screen.getByText("10.0.0.1:9021")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Start all (mvn-op, unique debug ports)" }))
    .not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Configure web backend target" }).click();
  await screen.getByRole("button", { name: "gznqi :9021" }).click();
  expect(onChangeConfig).toHaveBeenCalledWith("npm:web", {
    ...EMPTY_MODULE_CONFIG,
    proxyTarget: "9021",
  });

  await screen.getByRole("button", { name: "web npm run build:stage" }).click();
  expect(onRunNpm).toHaveBeenCalledWith(WEB_PROJECT, "build:stage");
  expect(onRunAll).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Stop web (Ctrl+C)" }).click();
  expect(onStop).toHaveBeenCalledWith("npm:web", "term-3");
});

it("hides the proxy settings for an npm project without a dev script", async () => {
  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={[
        {
          module: { ...WEB_PROJECT, scripts: ["build"] },
          run: null,
          config: EMPTY_MODULE_CONFIG,
          availableProfiles: [],
        },
      ]}
      error={null}
      onRun={vi.fn()}
      onRunNpm={vi.fn()}
      onRunAll={vi.fn()}
      onOpenTerminal={vi.fn()}
      onStop={vi.fn()}
      onStopAll={vi.fn()}
      onChangeConfig={vi.fn()}
    />,
  );

  await expect
    .element(screen.getByRole("button", { name: "Configure backend target" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "build" })).toBeVisible();
});

it("stores npm proxy targets next to JAR module settings", () => {
  const projectKey = "jar-runner-card-test:storage";
  const configs = {
    gznqi: { ...EMPTY_MODULE_CONFIG, profile: "local2" },
    "npm:web": { ...EMPTY_MODULE_CONFIG, proxyTarget: "http://10.0.0.1:9021" },
  };
  try {
    saveProjectJarRunnerConfigs(projectKey, configs);
    expect(loadProjectJarRunnerConfigs(projectKey)).toEqual(configs);
  } finally {
    globalThis.localStorage.removeItem("t3code:jar-runner-config:v1");
  }
});

it("renders nothing when no modules are detected", async () => {
  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={[]}
      error={null}
      onRun={vi.fn()}
      onRunNpm={vi.fn()}
      onRunAll={vi.fn()}
      onOpenTerminal={vi.fn()}
      onStop={vi.fn()}
      onStopAll={vi.fn()}
      onChangeConfig={vi.fn()}
    />,
  );

  await expect.element(screen.getByRole("region", { name: "JAR runner" })).not.toBeInTheDocument();
});
