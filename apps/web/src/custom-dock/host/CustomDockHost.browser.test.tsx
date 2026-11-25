import { createMemoryHistory } from "@tanstack/react-router";
import { expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { getRouter } from "../../router";
import { CustomDockHost } from "./CustomDockHost";
import { dockPreferences } from "./panelContext";

it("keeps the dock close action below the native window controls", async () => {
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
