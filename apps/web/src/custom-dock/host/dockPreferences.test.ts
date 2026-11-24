import { expect, it } from "vite-plus/test";

import { createDockStore } from "./dockStore";
import { resolveDockPanels } from "./registry";
import type { CustomDockPanelDefinition } from "./types";

it("clamps saved width and restores composer, drawer, and external panel preferences", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
  };
  const dock = createDockStore(storage);
  dock.getState().setDrawerWidth(900);
  dock.getState().setDrawerOpen(true);
  dock.getState().setThreadCollapsed("local:thread", true);
  dock.getState().upsertExternalPanel({
    id: "external",
    title: "Tools",
    url: "http://127.0.0.1:4321/",
    sendReadonlySnapshot: false,
  });
  const restored = createDockStore(storage);
  expect(restored.getState()).toMatchObject({
    drawerOpen: true,
    drawerWidth: 560,
    collapsedByThreadKey: { "local:thread": true },
    externalPanels: [{ id: "external" }],
  });
  restored.getState().setThreadCollapsed("local:thread", false);
  restored.getState().removeExternalPanel("external");
  restored.getState().setDrawerOpen(false);
  expect(createDockStore(storage).getState()).toMatchObject({
    drawerOpen: false,
    collapsedByThreadKey: {},
    externalPanels: [],
  });
});

it("sorts registered panels and rejects names that could shadow a built-in", () => {
  const definitions: CustomDockPanelDefinition[] = [
    { id: "telemetry", title: "Telemetry", icon: "activity", order: 2, renderPanel: () => null },
    { id: "plan", title: "Plan", icon: "list-todo", order: 1, renderPanel: () => null },
  ];
  const config = { title: "Outside", url: "https://example.test/", sendReadonlySnapshot: false };
  expect(
    resolveDockPanels(
      [
        { ...config, id: "plan" },
        { ...config, id: "addon" },
        { ...config, id: "bad", url: "http://example.test/" },
      ],
      () => null,
      definitions,
    ).map(({ id }) => id),
  ).toEqual(["plan", "telemetry", "addon"]);
});
