import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { ComposerAnchorPortal } from "./ComposerAnchorPortal";
import { CompactBar } from "./CustomDockHost";

it("leaves input focus intact while moving between the composer and the floating launcher", async () => {
  const column = document.createElement("div");
  const anchor = document.createElement("div");
  const field = document.createElement("textarea");
  anchor.dataset.chatComposerStack = "true";
  anchor.append(field);
  column.append(anchor);
  document.body.append(column);
  using _remove = { [Symbol.dispose]: () => column.remove() };
  field.focus();
  await using _screen = await render(
    <ComposerAnchorPortal threadActive fallback={<span data-dock-test="pill" />}>
      <span data-dock-test="bar" />
    </ComposerAnchorPortal>,
  );
  await vi.waitFor(() => expect(anchor.querySelector('[data-dock-test="bar"]')).not.toBeNull());
  expect(document.activeElement).toBe(field);
  await act(() => {
    column.dataset.chatColumnMaximizedAway = "true";
  });
  await vi.waitFor(() => expect(document.querySelector('[data-dock-test="pill"]')).not.toBeNull());
  expect(anchor.querySelector('[data-dock-test="bar"]')).toBeNull();
  await act(() => {
    delete column.dataset.chatColumnMaximizedAway;
  });
  await vi.waitFor(() => expect(anchor.querySelector('[data-dock-test="bar"]')).not.toBeNull());
  await act(() => anchor.remove());
  await vi.waitFor(() => expect(document.querySelector('[data-dock-test="pill"]')).not.toBeNull());
  await act(() => column.append(anchor));
  await vi.waitFor(() => expect(anchor.querySelector('[data-dock-test="bar"]')).not.toBeNull());
});

it("keeps an accessible collapse action in a narrow composer", async () => {
  const collapse = vi.fn();
  const container = document.createElement("div");
  container.style.width = "280px";
  await using screen = await render(
    <CompactBar open={() => undefined} close={collapse}>
      <span className="truncate">A long current step from the structured Todo list</span>
    </CompactBar>,
    { container },
  );
  const hide = screen.getByRole("button", { name: "Collapse compact bar" });
  await expect.element(hide).toBeVisible();
  await userEvent.click(hide);
  expect(collapse).toHaveBeenCalledTimes(1);
});

it("puts the status footer inside the composer after its normal controls", async () => {
  const stack = document.createElement("section");
  stack.dataset.chatComposerStack = "true";
  const composer = document.createElement("div");
  composer.dataset.chatComposerMainSurface = "true";
  const input = document.createElement("textarea");
  const toolbar = document.createElement("div");
  composer.append(input, toolbar);
  stack.append(composer);
  document.body.append(stack);
  using _remove = { [Symbol.dispose]: () => stack.remove() };
  input.focus();
  await using screen = await render(
    <ComposerAnchorPortal threadActive fallback={null}>
      <span data-dock-test="footer" />
    </ComposerAnchorPortal>,
  );
  const footer = stack.querySelector('[data-dock-test="footer"]');
  expect(composer.lastElementChild?.contains(footer)).toBe(true);
  expect(toolbar.nextElementSibling?.contains(footer)).toBe(true);
  expect(document.activeElement).toBe(input);
  await screen.unmount();
  expect(composer.lastElementChild).toBe(toolbar);
});

it("opens task coordination from the footer without opening the side drawer and can reopen it", async () => {
  const openDetails = vi.fn();
  const container = document.createElement("div");
  const anchor = document.createElement("section");
  anchor.style.cssText = "position: fixed; bottom: 16px; left: 16px; width: 320px; height: 110px";
  container.append(anchor);
  document.body.append(container);
  using _remove = { [Symbol.dispose]: () => container.remove() };
  await using screen = await render(
    <CompactBar anchor={anchor} open={openDetails} panel={<p>Verify composer geometry</p>}>
      <span>Task progress</span>
    </CompactBar>,
    { container: anchor },
  );
  const trigger = screen.getByText("Task progress");
  await trigger.click();
  expect(openDetails).not.toHaveBeenCalled();
  const popup = page.getByRole("dialog", { name: "Task coordination" });
  await expect.element(popup.getByText("Verify composer geometry")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(popup).not.toBeInTheDocument();
  await trigger.click();
  await expect.element(popup).toBeVisible();
  await popup.getByRole("button", { name: "Collapse task coordination" }).click();
  await expect.element(popup).not.toBeInTheDocument();
});
