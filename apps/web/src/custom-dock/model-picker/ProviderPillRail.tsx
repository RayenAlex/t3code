import { useGT } from "gt-react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";
import { useModelPickerCopy } from "./copy";
import styles from "./modelPicker.module.css";

export function ProviderPillRail({
  railRef,
  children,
}: {
  railRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const gt = useGT();
  const copy = useModelPickerCopy();
  const rowRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const refresh = useStableCallback(() => {
    const row = rowRef.current;
    const rail = railRef.current;
    const pills = pillsRef.current;
    if (!row || !rail || !pills) return;
    // Reserve arrow space only if the pills cannot fit even without the arrows.
    const overflow = pills.offsetWidth > row.clientWidth;
    const left = rail.scrollLeft > 1;
    const right = rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 1;
    setEdges((current) =>
      current.overflow === overflow && current.left === left && current.right === right
        ? current
        : { overflow, left, right },
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes DOM widths after popup resize, text changes or provider updates
  useLayoutEffect(() => {
    const row = rowRef.current;
    const rail = railRef.current;
    const pills = pillsRef.current;
    if (!row || !rail || !pills) return;
    refresh();
    return observeResize([row, pills], refresh);
  }, [railRef, refresh]);

  const scroll = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail || !(direction === -1 ? edges.left : edges.right)) return;
    rail.scrollBy({ left: direction * Math.max(1, rail.clientWidth - 24) });
  };
  return (
    <div ref={rowRef} className={styles.providerRail} dir="ltr">
      <div
        ref={railRef}
        role="group"
        aria-label={gt("Providers")}
        className={styles.providerViewport}
        onScroll={refresh}
      >
        <div ref={pillsRef} className={styles.modelPills}>
          {children}
        </div>
      </div>
      {edges.overflow && (
        <div className={styles.providerScrollControls}>
          <button
            type="button"
            aria-label={copy.scrollProvidersLeft}
            aria-disabled={!edges.left}
            onClick={() => scroll(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={copy.scrollProvidersRight}
            aria-disabled={!edges.right}
            onClick={() => scroll(1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
