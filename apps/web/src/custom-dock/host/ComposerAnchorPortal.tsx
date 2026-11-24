import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { ComposerPlacement } from "./uiContract";

const COMPOSER = '[data-chat-composer-stack="true"]';
const SURFACE = '[data-chat-composer-main-surface="true"]';
const OVERLAY = '[data-chat-composer-overlay="true"]';
const HIDDEN = '[data-chat-column-maximized-away="true"], [hidden], [inert]';
const ATTRIBUTES = [
  "data-chat-composer-stack",
  "data-chat-composer-main-surface",
  "data-chat-column-maximized-away",
  "hidden",
  "inert",
];

export function resolveComposerPlacement(
  active: boolean,
  anchorPresent: boolean,
  maximizedAway: boolean,
): ComposerPlacement {
  if (!active) return "hidden";
  return anchorPresent && !maximizedAway ? "anchored" : "floating";
}

function readAnchor(): HTMLElement | null {
  for (const stack of document.querySelectorAll<HTMLElement>(COMPOSER)) {
    if (stack.closest(HIDDEN) || stack.closest("[data-right-panel-surface-content]")) continue;
    const surface = stack.querySelector<HTMLElement>(SURFACE);
    if (surface && !surface.closest(HIDDEN)) return surface;
    if (!surface && !stack.closest(OVERLAY)) return stack;
  }
  return null;
}

function subscribeAnchor(notify: () => void): () => void {
  let previous: HTMLElement | null = null;
  const observer = new MutationObserver(update);
  function update(records?: readonly MutationRecord[]) {
    if (
      previous &&
      records?.every((record) => (record.type === "childList" ? record.target === previous : false))
    )
      return;
    const anchor = readAnchor();
    if (previous === anchor && records) return;
    observer.disconnect();
    const options = { childList: true, attributes: true, attributeFilter: ATTRIBUTES };
    if (!anchor) observer.observe(document.body, { ...options, subtree: true });
    else
      for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
        observer.observe(node, options);
      }
    if (previous !== anchor) {
      previous = anchor;
      notify();
    }
  }
  update();
  return () => observer.disconnect();
}

const noAnchor = () => null;
const noSubscription = () => () => undefined;

function ComposerFooter({
  anchor,
  children,
}: {
  readonly anchor: HTMLElement;
  readonly children: ReactNode | ((anchor: HTMLElement) => ReactNode);
}) {
  const [mount] = useState(() => {
    const node = document.createElement("div");
    node.dataset.dockPlacement = "anchored";
    return node;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- appends and removes the isolated portal slot in the native composer's footer
  useLayoutEffect(() => {
    anchor.append(mount);
    return () => mount.remove();
  }, [anchor, mount]);
  return createPortal(typeof children === "function" ? children(anchor) : children, mount);
}

export function ComposerAnchorPortal(props: {
  readonly threadActive: boolean;
  readonly children: ReactNode | ((anchor: HTMLElement) => ReactNode);
  readonly fallback: ReactNode;
}) {
  const anchor = useSyncExternalStore(
    props.threadActive ? subscribeAnchor : noSubscription,
    props.threadActive ? readAnchor : noAnchor,
    noAnchor,
  );
  if (resolveComposerPlacement(props.threadActive, anchor !== null, false) === "hidden")
    return null;
  return anchor ? (
    <ComposerFooter anchor={anchor}>{props.children}</ComposerFooter>
  ) : (
    createPortal(
      <div data-dock-placement="floating" className="fixed right-4 bottom-4 z-40">
        {props.fallback}
      </div>,
      document.body,
    )
  );
}
