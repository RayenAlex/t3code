import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { ComposerPlacement } from "./uiContract";

const COMPOSER = '[data-chat-composer-stack="true"]';
const HIDDEN = '[data-chat-column-maximized-away="true"], [hidden], [inert]';
const ATTRIBUTES = [
  "data-chat-composer-stack",
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
  const anchors = document.querySelectorAll<HTMLElement>(COMPOSER);
  for (const anchor of anchors) {
    if (!anchor.closest(HIDDEN)) return anchor;
  }
  return null;
}

function subscribeAnchor(notify: () => void): () => void {
  let previous: HTMLElement | null = null;
  const observer = new MutationObserver(update);
  function update() {
    const anchor = readAnchor();
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

export function ComposerAnchorPortal(props: {
  readonly threadActive: boolean;
  readonly children: ReactNode;
  readonly fallback: ReactNode;
}) {
  const anchor = useSyncExternalStore(
    props.threadActive ? subscribeAnchor : noSubscription,
    props.threadActive ? readAnchor : noAnchor,
    noAnchor,
  );
  if (resolveComposerPlacement(props.threadActive, anchor !== null, false) === "hidden")
    return null;
  return anchor
    ? createPortal(
        <div
          data-dock-placement="anchored"
          className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-1.5 flex justify-center px-1"
        >
          {props.children}
        </div>,
        anchor,
      )
    : createPortal(
        <div data-dock-placement="floating" className="fixed right-4 bottom-4 z-40">
          {props.fallback}
        </div>,
        document.body,
      );
}
