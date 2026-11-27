import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";
import { Fragment, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { readComposerDraftPrompt, useComposerDraftStore } from "../../composerDraftStore";
import type { TimelineRowSharedState } from "../../components/chat/timelineRowContext";
import { act, render } from "../../../test/render";
import { renderCustomDockPrototypeRow } from "./PrototypeCard";
import { PrototypeStudio } from "./PrototypeStudio";
import { createPrototypeStore, PrototypeStoreProvider } from "./prototypeStore";

const mocks = vi.hoisted(() => ({ items: [] as OrchestrationV2ProjectedTurnItem[] }));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useThreadVisibleTurnItems: () => mocks.items,
}));

vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: "about:blank",
    expiresAt: Date.now() + 60 * 60_000,
  }),
}));

const SCOPE = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
const CTX: Pick<TimelineRowSharedState, "activeThreadEnvironmentId" | "threadRef"> = {
  activeThreadEnvironmentId: SCOPE.environmentId,
  threadRef: SCOPE,
};

type Render = readonly [id: string, title: string];

/** What a thread holds after a model rendered these pages, as the timeline reads them. */
function renders(
  runId: string,
  entries: ReadonlyArray<Render>,
): OrchestrationV2ProjectedTurnItem[] {
  return entries.map(
    ([id, title], position) =>
      // Only the fields this feature reads are filled in.
      ({
        position,
        visibility: "local",
        sourceThreadId: SCOPE.threadId,
        sourceItemId: TurnItemId.make(id),
        item: {
          type: "dynamic_tool",
          status: "completed",
          id: TurnItemId.make(id),
          threadId: SCOPE.threadId,
          runId: RunId.make(runId),
          toolName: "mcp__t3-code__html_render",
          output: { htmlRender: { attachmentId: `${id}-html`, title, height: 600 }, message: "" },
        },
      }) as unknown as OrchestrationV2ProjectedTurnItem,
  );
}

function row(item: OrchestrationV2ProjectedTurnItem) {
  if (item.item.type !== "dynamic_tool") throw new Error("the fixture item is not a tool call");
  const htmlRender = htmlRenderFromToolItem(item.item);
  if (htmlRender === undefined) throw new Error("the fixture item is not a render");
  return { kind: "html-render" as const, id: item.item.id, createdAt: "", htmlRender };
}

/** The timeline rows for every render, each through the seam the timeline uses. */
function timeline(items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>) {
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.item.id}>{renderCustomDockPrototypeRow(row(item), CTX)}</Fragment>
      ))}
    </>
  );
}

function pointer(target: Element, type: string, at: { clientX: number; clientY: number }) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, ...at }));
}

const VARIANTS: ReadonlyArray<Render> = [
  ["a", "[Prototype:A] Settings nav: Sidebar nav"],
  ["b", "[Prototype:B] Settings nav: Top tabs"],
];

it("shows one review card for a set of variants and leaves other renders to the timeline", async () => {
  mocks.items = renders("run-1", [
    ["chart", "Token usage chart"],
    ...VARIANTS,
    ["c", "[Prototype:C] Settings nav: Search cards"],
  ]);
  const [chart, ...variants] = mocks.items;
  expect(renderCustomDockPrototypeRow(row(chart!), CTX)).toBeUndefined();

  await using screen = await render(timeline(variants), {
    // Nothing here navigates.
    router: false,
  });
  expect(screen.container.querySelectorAll("[data-prototype-card]")).toHaveLength(1);
  await expect
    .element(screen.getByRole("heading", { name: "Settings nav", level: 3 }))
    .toBeVisible();
  for (const name of ["Sidebar nav", "Top tabs", "Search cards"]) {
    await expect.element(screen.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  }
  // Only the selected variant keeps a page loaded.
  expect(screen.container.querySelectorAll("iframe")).toHaveLength(1);
});

it("marks a click and a dragged region, then stages the notes for the model", async () => {
  mocks.items = renders("run-1", VARIANTS);
  await using screen = await render(timeline(mocks.items), {
    // Nothing here navigates.
    router: false,
  });
  await expect.element(screen.getByText(/Preview mode/)).toBeVisible();
  await screen.getByRole("button", { name: "Start annotating" }).click();
  const layer = screen.container.querySelector<HTMLElement>(
    '[data-prototype-annotation-layer="active"]',
  )!;
  // Synthetic pointers have no active browser pointer to capture.
  using _capture = vi.spyOn(layer, "setPointerCapture").mockImplementation(() => {});
  const bounds = layer.getBoundingClientRect();
  const at = (x: number, y: number) => ({
    clientX: bounds.left + bounds.width * x,
    clientY: bounds.top + bounds.height * y,
  });

  // One event per update, as a browser delivers them.
  await act(() => pointer(layer, "pointerdown", at(0.5, 0.5)));
  await act(() => pointer(layer, "pointerup", at(0.5, 0.5)));
  const editor = screen.getByPlaceholder("Describe what is off or what to use instead…");
  await expect.element(editor).toBeVisible();
  await userEvent.type(editor, "Move the search up{Enter}");
  await expect.element(screen.getByText("Move the search up")).toBeVisible();

  await act(() => pointer(layer, "pointerdown", at(0.2, 0.2)));
  await act(() => pointer(layer, "pointermove", at(0.4, 0.45)));
  await act(() => pointer(layer, "pointerup", at(0.4, 0.45)));
  await expect.element(screen.getByText("Note: Selected region")).toBeVisible();
  await screen.getByRole("button", { name: "Replace" }).click();
  await screen.getByRole("button", { name: "Save note" }).click();

  await expect.element(screen.getByText("2 notes to send")).toBeVisible();
  expect(screen.container.querySelectorAll("[data-annotation-pin]")).toHaveLength(2);
  await screen.getByRole("button", { name: "Send 2 notes for a new round" }).click();
  expect(readComposerDraftPrompt(SCOPE)).toBe(
    [
      "[Prototype feedback · Settings nav]",
      "Revise the prototype from these marked regions and publish the next round; do not edit feature code yet:",
      "1. [Variant A · Inaccurate · Desktop] Region x 50%, y 50%: Move the search up",
      "2. [Variant A · Replace · Desktop] Region x 20% to 40%, y 20% to 45%: Adjust this",
    ].join("\n"),
  );
  useComposerDraftStore.getState().setPrompt(SCOPE, "");
});

it("switches variants with 1/2/3 from inside the card, which opens the studio", async () => {
  mocks.items = renders("run-1", VARIANTS);
  const store = createPrototypeStore();
  const ui: ReactNode = (
    <>
      {timeline(mocks.items)}
      <PrototypeStudio scope={SCOPE} />
    </>
  );
  await using screen = await render(
    <PrototypeStoreProvider store={store}>{ui}</PrototypeStoreProvider>,
    {
      // Nothing here navigates.
      router: false,
    },
  );
  const sidebar = screen.getByRole("button", { name: /Sidebar nav/ });
  const tabs = screen.getByRole("button", { name: /Top tabs/ });
  await expect.element(sidebar).toHaveAttribute("aria-pressed", "true");
  await sidebar.click();
  await userEvent.keyboard("2");
  await expect.element(tabs).toHaveAttribute("aria-pressed", "true");
  await expect.element(sidebar).toHaveAttribute("aria-pressed", "false");
  await expect.element(screen.getByText("B · Top tabs")).toBeVisible();

  await screen.getByRole("button", { name: "Open in prototype studio" }).click();
  const studio = screen.getByRole("dialog", { name: "Prototype studio" });
  await expect.element(studio).toBeVisible();
  expect(store.getState().studio?.groupId).toBe("run-1:Settings nav");
  await userEvent.keyboard("1");
  expect(store.getState().selectedVariants["run-1:Settings nav"]).toBe("a");
  await screen.getByRole("button", { name: "Compare" }).click();
  await screen.getByRole("button", { name: "Compare" }).click();
  // The card keeps one page; a comparison holds two more.
  expect(screen.container.querySelectorAll("iframe")).toHaveLength(3);
  await expect.element(screen.getByText("Left")).toBeVisible();
  await expect.element(screen.getByText("Right")).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(studio).not.toBeInTheDocument();
  expect(store.getState().studio).toBeNull();
  expect(screen.container.querySelectorAll("iframe")).toHaveLength(1);
});

it("supports zoom controls, collapsible notes rail, and live annotation inside the studio", async () => {
  mocks.items = renders("run-1", [["single", "[Prototype] Model picker"]]);
  const store = createPrototypeStore();
  await using screen = await render(
    <PrototypeStoreProvider store={store}>
      {timeline(mocks.items)}
      <PrototypeStudio scope={SCOPE} />
    </PrototypeStoreProvider>,
    {
      // Nothing here navigates.
      router: false,
    },
  );

  await screen.getByRole("button", { name: "Open in prototype studio" }).click();
  const studio = screen.getByRole("dialog", { name: "Prototype studio" });
  await expect.element(studio).toBeVisible();
  expect(store.getState().studio?.originRect).not.toBeNull();

  // Manual zoom enlarges above 100% and resets back to 100% / Fit.
  await studio.getByRole("button", { name: "100%" }).click();
  await expect.element(studio.getByText("100%").first()).toBeVisible();
  await studio.getByRole("button", { name: "Zoom in" }).click();
  expect(store.getState().studioZoomMode).toBe("manual");
  expect(store.getState().studioManualZoom).toBeGreaterThan(1);
  expect(studio.element().querySelector('[data-prototype-page="enlarged"]')).not.toBeNull();

  // Toggle the notes sidebar off and back on, then switch into annotate mode.
  const toggleRail = studio.getByRole("button", { name: "Toggle notes sidebar" });
  await toggleRail.click();
  expect(store.getState().studioRailOpen).toBe(false);
  await toggleRail.click();
  expect(store.getState().studioRailOpen).toBe(true);
  await studio.getByRole("button", { name: "Annotate" }).click();
  expect(
    studio.element().querySelector('[data-prototype-annotation-layer="active"]'),
  ).not.toBeNull();

  await studio.getByRole("button", { name: "Close prototype studio" }).click();
  await expect.element(studio).not.toBeInTheDocument();
});
