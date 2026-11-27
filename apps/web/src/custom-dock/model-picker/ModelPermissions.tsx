import type { RuntimeMode } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { use, useId, useRef, useState, type CSSProperties } from "react";

import { SharedTooltipTrigger } from "../../components/ui/shared-tooltip";
import type { RuntimeModeOption } from "../../components/chat/ComposerFooterControls";
import {
  RuntimeModeLimitsTargetContext,
  useProviderRuntimeModeLimits,
} from "../../state/runtimeModeLimits";
import { useModelPickerCopy } from "./copy";
import styles from "./modelPicker.module.css";
import { detentKeyIndex, detentPosition, useDetentDrag } from "./detentDrag";

const order: readonly RuntimeMode[] = [
  "full-access",
  "auto",
  "auto-accept-edits",
  "approval-required",
];

export function ModelPermissions(props: {
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  disabled: boolean;
}) {
  const copy = useModelPickerCopy();
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  useProviderRuntimeModeLimits(use(RuntimeModeLimitsTargetContext), "picker");
  const options = [...props.runtimeModeOptions].sort(
    (a, b) => order.indexOf(a.mode) - order.indexOf(b.mode),
  );
  const selectedIndex = options.findIndex((option) => option.mode === props.runtimeMode);
  const current = options[selectedIndex];
  const enabled = (index: number) =>
    !props.disabled && options[index]?.disabledReason === undefined;
  const select = (index: number) => {
    const option = options[index];
    if (!option || !enabled(index)) return;
    if (option.mode !== props.runtimeMode) props.onRuntimeModeChange(option.mode);
    trackRef.current
      ?.querySelector<HTMLElement>(`[data-mode-index="${index}"]`)
      ?.focus({ preventScroll: true });
  };
  const { handlers } = useDetentDrag({
    count: options.length,
    inset: 0.5 / Math.max(2, options.length),
    enabled,
    onCommit: select,
  });
  const tabIndex =
    selectedIndex >= 0 ? selectedIndex : options.findIndex((_, index) => enabled(index));
  if (!current) return null;
  return (
    <div className={styles.modelPermissions}>
      <button
        type="button"
        data-composer-permissions-trigger
        className={styles.permissionDisclosure}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDownIcon aria-hidden="true" />
        {copy.permissions}
      </button>
      <div
        id={id}
        ref={trackRef}
        role="radiogroup"
        aria-label={copy.permissions}
        data-composer-permissions
        className={`${styles.permissionSegments} ${styles.detentTrack}`}
        hidden={!expanded}
        dir="ltr"
        style={
          {
            "--dock-permission-width": `${(options.length === 4 ? 5.125 : 4.35) * options.length}rem`,
            "--dock-detent-width": `${100 / options.length}%`,
            "--dock-detent-stop": `${detentPosition(selectedIndex, options.length, 0.5 / options.length) * 100}%`,
          } as CSSProperties
        }
        {...handlers}
        onKeyDown={(event) => {
          const target = event.target;
          const index =
            target instanceof HTMLElement ? Number(target.dataset.modeIndex) : selectedIndex;
          const next = detentKeyIndex(
            event,
            Number.isNaN(index) ? selectedIndex : index,
            options.length,
            enabled,
          );
          if (next !== null) select(next);
        }}
      >
        <span className={`${styles.permissionThumb} ${styles.detentThumb}`} aria-hidden="true" />
        {options.map((option, index) => (
          <SharedTooltipTrigger
            key={option.mode}
            label={option.disabledReason ?? option.description}
            render={
              <button
                type="button"
                role="radio"
                aria-label={option.label}
                aria-checked={option.mode === props.runtimeMode}
                aria-disabled={!enabled(index) || undefined}
                aria-description={option.disabledReason ?? option.description}
                tabIndex={index === tabIndex ? 0 : -1}
                data-mode-index={index}
                data-dock-permission-choice
                onClick={(event) => {
                  if (event.detail === 0 || options.length === 1) select(index);
                }}
              />
            }
          >
            <span className={styles.permissionLabel}>{option.label}</span>
          </SharedTooltipTrigger>
        ))}
      </div>
      {!expanded && (
        <button
          type="button"
          className={styles.permissionCurrent}
          aria-description={current.disabledReason ?? current.description}
          onClick={() => setExpanded(true)}
        >
          <current.icon aria-hidden="true" />
          {current.label}
        </button>
      )}
    </div>
  );
}
