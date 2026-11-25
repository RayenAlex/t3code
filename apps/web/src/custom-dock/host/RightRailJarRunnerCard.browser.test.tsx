import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { EMPTY_MODULE_CONFIG, type JarRunnerModuleConfig } from "./jarRunnerModules";
import { RightRailJarRunnerCard, type JarRunnerModuleView } from "./RightRailJarRunnerCard";

const SINGLE_MODULE: ReadonlyArray<JarRunnerModuleView> = [
  {
    module: { id: "", name: "zjfricp", relativeDir: "", debugPort: null },
    run: null,
    config: EMPTY_MODULE_CONFIG,
    availableProfiles: ["dev", "local2"],
  },
];

const MULTI_MODULES: ReadonlyArray<JarRunnerModuleView> = [
  {
    module: { id: "gznqi", name: "gznqi", relativeDir: "gznqi", debugPort: 50055 },
    run: { command: "mvn-op", terminalId: "term-1", running: true },
    config: { profile: "local2", serverPort: "9021", debugPort: "50058" },
    availableProfiles: ["dev", "local", "local2", "prod"],
  },
  {
    module: {
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
    module: { id: "sms", name: "sms", relativeDir: "sms", debugPort: 50057 },
    run: null,
    config: EMPTY_MODULE_CONFIG,
    availableProfiles: ["local", "prod"],
  },
];

it("runs mvn-op, JAR, and mvn-p actions in single-module mode and toggles collapse", async () => {
  const onRun = vi.fn();
  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={SINGLE_MODULE}
      error={null}
      onRun={onRun}
      onRunAll={vi.fn()}
      onOpenTerminal={vi.fn()}
      onStop={vi.fn()}
      onStopAll={vi.fn()}
      onChangeConfig={vi.fn()}
    />,
  );

  await screen.getByRole("button", { name: "mvn-op" }).click();
  await screen.getByRole("button", { name: "JAR" }).click();
  await screen.getByRole("button", { name: "mvn-p" }).click();
  expect(onRun).toHaveBeenNthCalledWith(1, SINGLE_MODULE[0]!.module, "mvn-op");
  expect(onRun).toHaveBeenNthCalledWith(2, SINGLE_MODULE[0]!.module, "jar");
  expect(onRun).toHaveBeenNthCalledWith(3, SINGLE_MODULE[0]!.module, "mvn-p");

  await screen.getByRole("button", { name: "Collapse JAR runner" }).click();
  await expect.element(screen.getByRole("button", { name: "mvn-op" })).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Expand JAR runner" }).click();
  await expect.element(screen.getByRole("button", { name: "mvn-op" })).toBeVisible();
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
      onRunAll={onRunAll}
      onOpenTerminal={onOpenTerminal}
      onStop={onStop}
      onStopAll={onStopAll}
      onChangeConfig={vi.fn()}
    />,
  );

  await expect.element(screen.getByText("1/3 running")).toBeVisible();
  await expect.element(screen.getByText("gznqi")).toBeVisible();
  await expect.element(screen.getByText("mvn-op :50058")).toBeVisible();
  await expect.element(screen.getByText("local2")).toBeVisible();
  await expect.element(screen.getByText(":9021")).toBeVisible();
  await expect.element(screen.getByText("dbg:50058")).toBeVisible();
  await expect.element(screen.getByText("sms failed")).toBeVisible();

  await screen.getByRole("button", { name: "Start all with mvn-op (unique debug ports)" }).click();
  await screen.getByRole("button", { name: "Start all built JARs (java-op -jar)" }).click();
  await screen.getByRole("button", { name: "Stop all running modules (Ctrl+C)" }).click();
  expect(onRunAll).toHaveBeenNthCalledWith(1, "mvn-op");
  expect(onRunAll).toHaveBeenNthCalledWith(2, "jar");
  expect(onStopAll).toHaveBeenCalledTimes(1);

  await screen.getByRole("button", { name: "sms JAR" }).click();
  expect(onRun).toHaveBeenCalledWith(MULTI_MODULES[2]!.module, "jar");

  await screen.getByRole("button", { name: "Stop gznqi (Ctrl+C)" }).click();
  expect(onStop).toHaveBeenCalledWith("gznqi", "term-1");

  await screen.getByRole("button", { name: "Open gznqi-websocket terminal" }).click();
  expect(onOpenTerminal).toHaveBeenCalledWith("term-2");
});

it("edits module profile and ports inline and previews the resulting mvn-op command", async () => {
  function StatefulHarness() {
    const [config, setConfig] = useState<JarRunnerModuleConfig>(EMPTY_MODULE_CONFIG);
    return (
      <RightRailJarRunnerCard
        canRun
        busyKey={null}
        modules={[
          {
            module: { id: "gznqi", name: "gznqi", relativeDir: "gznqi", debugPort: 50055 },
            run: null,
            config,
            availableProfiles: ["dev", "local2"],
          },
          {
            module: { id: "sms", name: "sms", relativeDir: "sms", debugPort: 50056 },
            run: null,
            config: EMPTY_MODULE_CONFIG,
            availableProfiles: ["local"],
          },
        ]}
        error={null}
        onRun={vi.fn()}
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

it("renders nothing when no Java modules are detected", async () => {
  await using screen = await render(
    <RightRailJarRunnerCard
      canRun
      busyKey={null}
      modules={[]}
      error={null}
      onRun={vi.fn()}
      onRunAll={vi.fn()}
      onOpenTerminal={vi.fn()}
      onStop={vi.fn()}
      onStopAll={vi.fn()}
      onChangeConfig={vi.fn()}
    />,
  );

  await expect.element(screen.getByRole("region", { name: "JAR runner" })).not.toBeInTheDocument();
});
