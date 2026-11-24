import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { observeResize } from "../../lib/observeResize";

const DETAILS_PANEL = '[data-thread-details-panel="inline"]';
const HIDDEN = '[data-chat-column-maximized-away="true"], [hidden], [inert]';
const ATTRIBUTES = [
  "data-thread-details-panel",
  "data-chat-column-maximized-away",
  "hidden",
  "inert",
  "style",
];
const GAP_PX = 12;
const BOTTOM_MARGIN_PX = 16;
const MIN_INLINE_HEIGHT_PX = 140;

type RightRailGeometry = {
  readonly container: HTMLElement;
  readonly right: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
};

export function computeRightRailGeometry(
  anchor: HTMLElement,
  container: HTMLElement,
): RightRailGeometry | null {
  const width = Math.round(anchor.offsetWidth);
  if (width < 180) return null;
  const top = Math.round(anchor.offsetTop + anchor.offsetHeight + GAP_PX);
  const maxHeight = Math.floor(container.clientHeight - top - BOTTOM_MARGIN_PX);
  if (maxHeight < MIN_INLINE_HEIGHT_PX) return null;
  const parsedRight = Number.parseFloat(anchor.style.right);
  const right = Number.isFinite(parsedRight)
    ? parsedRight
    : Math.max(0, Math.round(container.clientWidth - (anchor.offsetLeft + anchor.offsetWidth)));
  return { container, right, top, width, maxHeight };
}

function readDetailsPanel(): HTMLElement | null {
  for (const panel of document.querySelectorAll<HTMLElement>(DETAILS_PANEL)) {
    if (panel.closest(HIDDEN) || panel.closest("[data-right-panel-surface-content]")) continue;
    if (panel.parentElement) return panel;
  }
  return null;
}

function sameGeometry(a: RightRailGeometry | null, b: RightRailGeometry | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.container === b.container &&
    a.right === b.right &&
    a.top === b.top &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}

let cachedGeometry: RightRailGeometry | null = null;

function readGeometry(): RightRailGeometry | null {
  const panel = readDetailsPanel();
  const next =
    panel && panel.parentElement ? computeRightRailGeometry(panel, panel.parentElement) : null;
  if (!sameGeometry(cachedGeometry, next)) cachedGeometry = next;
  return cachedGeometry;
}

function subscribeGeometry(notify: () => void): () => void {
  let activePanel: HTMLElement | null = null;
  let stopResize: (() => void) | null = null;
  const observer = new MutationObserver(() => sync());

  function rebind(panel: HTMLElement | null) {
    if (panel === activePanel) return;
    activePanel = panel;
    stopResize?.();
    stopResize = null;
    observer.disconnect();
    const options = { childList: true, attributes: true, attributeFilter: ATTRIBUTES };
    if (!panel || !panel.parentElement) {
      observer.observe(document.body, { ...options, subtree: true });
      return;
    }
    for (let node: HTMLElement | null = panel; node; node = node.parentElement) {
      observer.observe(node, options);
    }
    stopResize = observeResize([panel, panel.parentElement], sync);
  }

  function sync() {
    const panel = readDetailsPanel();
    rebind(panel);
    const previous = cachedGeometry;
    const next = readGeometry();
    if (previous !== next) notify();
  }

  window.addEventListener("resize", sync);
  sync();
  return () => {
    window.removeEventListener("resize", sync);
    stopResize?.();
    observer.disconnect();
  };
}

const noGeometry = () => null;
const noSubscription = () => () => undefined;

export function useRightRailGeometry(active: boolean): RightRailGeometry | null {
  return useSyncExternalStore(
    active ? subscribeGeometry : noSubscription,
    active ? readGeometry : noGeometry,
    noGeometry,
  );
}

export function RightRailTaskPortal({
  geometry,
  children,
}: {
  readonly geometry: RightRailGeometry;
  readonly children: ReactNode;
}) {
  const [mount] = useState(() => {
    const node = document.createElement("div");
    node.dataset.customDockRightRailSlot = "true";
    return node;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- appends and removes the isolated right-rail portal slot beside ThreadDetailsCard
  useLayoutEffect(() => {
    geometry.container.append(mount);
    return () => mount.remove();
  }, [geometry.container, mount]);

  return createPortal(
    <aside
      data-custom-dock-right-tasks="inline"
      className="dropdown-glass isolate absolute z-20 flex flex-col overflow-hidden rounded-2xl border border-border/75 bg-card/95 text-card-foreground shadow-sm"
      style={{
        right: geometry.right,
        top: geometry.top,
        width: geometry.width,
        maxHeight: geometry.maxHeight,
      }}
    >
      {children}
    </aside>,
    mount,
  );
}
