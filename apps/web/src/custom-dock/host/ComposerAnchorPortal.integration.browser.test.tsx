import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { ComposerAnchorPortal } from "./ComposerAnchorPortal";

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
