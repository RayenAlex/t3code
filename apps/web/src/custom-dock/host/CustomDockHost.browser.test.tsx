import { createMemoryHistory } from "@tanstack/react-router";
import { NodeId, PlanId, type OrchestrationV2PlanArtifact } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/components/ChatView";
import stylesheet from "~/index.css?inline";

import {
  emitThreadEvent,
  ENVIRONMENT_ID,
  installFakeEnvironment,
  runningRun,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act, render } from "../../../test/render";
import { AppRoot } from "../../AppRoot";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { getRouter } from "../../router";
import { CustomDockHost } from "./CustomDockHost";
import { dockPreferences } from "./panelContext";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

function installStyles(): Disposable {
  const style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.append(style);
  return { [Symbol.dispose]: () => style.remove() };
}

it("keeps the dock close action below the native window controls", async () => {
  using _style = installStyles();
  const container = document.createElement("div");
  const preferences = dockPreferences.getState();
  using _restore = {
    [Symbol.dispose]: () => preferences.setDrawerOpen(preferences.drawerOpen),
  };
  preferences.setDrawerOpen(false);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/"] }));
  await using screen = await render(<CustomDockHost router={router} />, { container });

  await screen.getByRole("button", { name: "Open Custom Dock" }).click();
  const drawer = screen.getByRole("complementary", { name: "Custom Dock" });
  const close = drawer.getByRole("button", { name: "Close Custom Dock" });
  await expect.element(close).toBeVisible();
  expect(drawer.element().getBoundingClientRect().top).toBe(0);

  container.classList.add("wco");
  container.style.setProperty("--workspace-topbar-height", "52px");
  expect(drawer.element().getBoundingClientRect().top).toBe(52);
  expect(close.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(52);
  await close.click();
  await expect.element(drawer).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Open Custom Dock" })).toBeVisible();
});

it("removes task coordination after a turn ends without removing the chat", async () => {
  using _style = installStyles();
  await page.viewport(1600, 960);
  const thread = threadWithHistory("task-lifecycle", 1);
  const completed = thread.runs[0]!;
  const active = { ...completed, status: "running" as const, completedAt: null };
  using _environment = installFakeEnvironment([{ ...thread, runs: [active] }]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  // AppRoot brings its own router.
  await using screen = await render(<AppRoot router={router} />, { router: false });
  const answer = screen.getByText("Answer 0 for task-lifecycle.", { exact: false });
  await expect.element(answer).toBeVisible();

  const plan: OrchestrationV2PlanArtifact = {
    id: PlanId.make("task-lifecycle-plan"),
    threadId: thread.id,
    runId: active.id,
    nodeId: NodeId.make("task-lifecycle-node"),
    kind: "todo_list",
    status: "active",
    steps: [{ id: "old", text: "Previous turn step", status: "running" }],
  };
  const details = page.getByRole("button", { name: "Toggle thread details panel", exact: true });
  await expect.element(details).toHaveAttribute("aria-pressed", "true");
  await details.click();
  await act(() => emitThreadEvent(thread.id, { type: "plan.updated", payload: plan }));
  const taskTrigger = page.getByRole("button", { name: "Open task coordination" });
  await expect.element(taskTrigger, { timeout: 3000 }).toBeVisible();
  await taskTrigger.click();
  const oldStep = page.getByText(/Previous turn step/);
  await expect.element(oldStep, { timeout: 3000 }).toBeVisible();
  await page.getByRole("button", { name: "Collapse task coordination" }).click();

  await details.click();
  const rightTask = page.getByRole("button", { name: "Collapse task coordination" });
  await expect.element(rightTask, { timeout: 3000 }).toBeVisible();
  await act(() => emitThreadEvent(thread.id, { type: "run.updated", payload: completed }));
  await expect.element(rightTask, { timeout: 3000 }).not.toBeInTheDocument();
  await expect.element(oldStep).not.toBeInTheDocument();
  await expect.element(answer).toBeVisible();

  await details.click();
  const next = runningRun(thread.id, "task-lifecycle-next", 2, "next-user");
  await act(() => emitThreadEvent(thread.id, { type: "run.updated", payload: next }));
  await expect.element(screen.getByText("Run 2", { exact: true })).toBeVisible();
  await expect.element(taskTrigger).not.toBeInTheDocument();
  await act(() =>
    emitThreadEvent(thread.id, {
      type: "plan.updated",
      payload: {
        ...plan,
        id: PlanId.make("next-plan"),
        runId: next.id,
        nodeId: NodeId.make("next-task-node"),
        steps: [{ id: "new", text: "Current turn step", status: "running" }],
      },
    }),
  );
  await taskTrigger.click();
  await expect.element(page.getByText(/Current turn step/)).toBeVisible();
  await expect.element(oldStep).not.toBeInTheDocument();
});
