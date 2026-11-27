import { RegistryContext } from "@effect/atom-react";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type RuntimeMode,
} from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { useGT } from "gt-react";
import { memo, use, useEffect, useEffectEvent, useRef, type ComponentProps } from "react";
import { useStore } from "zustand";

import { ChatGptSharingControl } from "../../components/chat/ChatGptSharingControl";
import { ComposerControl } from "../../components/chat/ComposerControl";
import {
  ComposerModelPicker,
  type RuntimeModeOption,
} from "../../components/chat/ComposerFooterControls";
import { takeOpenTarget, useComposerMenuProps } from "../../components/chat/composerEventScope";
import { resolveModelPickerSelectedModel } from "../../components/chat/ModelPickerContent";
import { ProviderInstanceIcon } from "../../components/chat/ProviderInstanceIcon";
import { retainedModelWhileProviderLocked } from "../../components/chat/ProviderModelPicker.logic";
import {
  getDisplayModelName,
  getTriggerDisplayModelName,
} from "../../components/chat/providerIconUtils";
import type { TraitsSelectionInput } from "../../components/chat/TraitsPicker";
import { Popover, PopoverPopup, PopoverTrigger } from "../../components/ui/popover";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { dockPreferences } from "../host/panelContext";
import { useModelPickerCopy } from "./copy";
import { ModelCatalog } from "./ModelCatalog";
import { ModelOptions, ModelTraitSummary } from "./ModelOptions";
import { ModelPermissions } from "./ModelPermissions";

import styles from "./modelPicker.module.css";

type Props = ComponentProps<typeof ComposerModelPicker> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dock: {
    traits: TraitsSelectionInput | null;
    effortDisplay: EffortDisplay;
    runtimeMode: RuntimeMode;
    runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
    onRuntimeModeChange: (mode: RuntimeMode) => void;
  };
};

export function CustomDockComposerModelPicker({ dock, ...picker }: Props) {
  const enabled = useStore(dockPreferences, (state) => state.composerModelPickerEnabled);
  return enabled ? (
    <CustomDockModelPicker {...picker} dock={dock} />
  ) : (
    <ComposerModelPicker {...picker} />
  );
}

function InstanceGlyph({
  entry,
  picker,
  stacked,
}: {
  entry: ProviderInstanceEntry;
  picker: Props;
  stacked?: boolean;
}) {
  return (
    <ProviderInstanceIcon
      driverKind={entry.driverKind}
      displayName={entry.displayName}
      accentColor={entry.accentColor}
      acpRegistryAgentId={entry.acpRegistryAgentId}
      acpRegistryIconUrl={entry.acpRegistryIconUrl}
      showBadge={!stacked && shouldShowInstanceBadge(entry, picker.instanceEntries)}
      className="size-4"
      iconClassName={cn("size-4", picker.activeProviderIconClassName)}
      indicatorBackground={picker.instanceIndicatorBackground ?? "var(--contrast-input)"}
      badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
    />
  );
}

const CustomDockModelPicker = memo(function CustomDockModelPicker(props: Props) {
  const gt = useGT();
  const copy = useModelPickerCopy();
  const floating = useComposerMenuProps();
  const coarse = useMediaQuery({ pointer: "coarse" });
  const disabled = props.disabled ?? false;
  const open = props.open;
  const size = props.size ?? "sm";
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const registry = use(RegistryContext);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refreshCatalog = useEffectEvent(() => {
    const { environmentId } = props;
    if (
      environmentId &&
      registry.get(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
        .modelCatalogRefresh === true
    ) {
      void refreshProviders({ environmentId, input: { modelCatalogOnly: true } });
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refresh the catalog on open regardless of whether a click or a shortcut opened it
  useEffect(() => {
    if (open) refreshCatalog();
  }, [open]);

  const setOpen = (next: boolean) => props.onOpenChange(next && !disabled);
  const focusEffort = () => {
    const target =
      popupRef.current?.querySelector<HTMLElement>("[role='slider']:not([aria-disabled='true'])") ??
      popupRef.current?.querySelector<HTMLElement>(
        "[data-dock-trait-focus]:not(:disabled):not([aria-disabled='true'])",
      );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  };
  const focusTarget = (target: "effort" | "permissions") => {
    if (target === "effort") {
      focusEffort();
    } else {
      const disclosure = popupRef.current?.querySelector<HTMLButtonElement>(
        "[data-composer-permissions-trigger]",
      );
      if (!disclosure) return;
      const focusMode = () =>
        popupRef.current
          ?.querySelector<HTMLElement>("[data-dock-permission-choice][aria-checked='true']")
          ?.focus();
      if (disclosure.getAttribute("aria-expanded") === "false") {
        disclosure.click();
        window.requestAnimationFrame(focusMode);
      } else {
        focusMode();
      }
    }
  };
  const entryFor = (instanceId: ProviderInstanceId) =>
    props.instanceEntries.find((entry) => entry.instanceId === instanceId);
  const modelFor = (instanceId: ProviderInstanceId, model: string) =>
    resolveModelPickerSelectedModel({
      driverKind: entryFor(instanceId)?.driverKind,
      model,
      options: props.modelOptionsByInstance.get(instanceId) ?? [],
    });
  const activeEntry = entryFor(props.activeInstanceId);
  const selectedModel =
    modelFor(props.activeInstanceId, props.model) ??
    retainedModelWhileProviderLocked(activeEntry ?? null, props.model) ??
    (activeEntry?.driverKind === "opencode" || activeEntry?.driverKind === "antigravity"
      ? undefined
      : props.modelOptionsByInstance.get(props.activeInstanceId)?.[0]);
  const multiple = props.multipleModelsEnabled ? props.multipleModelSelections : null;
  const activeName = selectedModel
    ? getTriggerDisplayModelName(selectedModel, activeEntry?.driverKind)
    : !props.model || props.model === ANTIGRAVITY_DEFAULT_MODEL
      ? gt("Choose model")
      : props.model;
  const unavailableLabel = (model: string, unavailable?: boolean) =>
    unavailable ? gt("{model} (Unavailable)", { model }) : model;
  const selections = multiple?.map(({ instanceId, model }) => {
    const entry = entryFor(instanceId);
    const option = modelFor(instanceId, model);
    return {
      entry,
      key: JSON.stringify([instanceId, model]),
      name: option ? getTriggerDisplayModelName(option, entry?.driverKind) : model,
      fullName: option
        ? unavailableLabel(getDisplayModelName(option), option.isUnavailable)
        : model,
    };
  });
  const multipleNames = selections
    ?.slice(0, 2)
    .map(({ name }) => name)
    .join(", ");
  const triggerText = selections
    ? selections.length === 0
      ? gt("Choose models")
      : selections.length <= 2
        ? multipleNames
        : gt("{count, plural, one {{models}, {count} more} other {{models}, {count} more}}", {
            models: multipleNames ?? "",
            count: selections.length - 2,
          })
    : activeName;
  const accessibleName = selections
    ? selections.map(({ fullName }) => fullName).join(", ") || gt("Choose models")
    : selectedModel
      ? unavailableLabel(getDisplayModelName(selectedModel), selectedModel.isUnavailable)
      : activeName;
  const effortDetail = props.triggerDetail
    ?.split(" · ")
    .map((term) => (term === "Max" ? copy.level("max", term) : term))
    .join(" · ");
  const triggerLabel = [accessibleName, effortDetail].filter(Boolean).join(", ");
  const select = (instanceId: ProviderInstanceId, model: string, additive: boolean) => {
    if (disabled) return;
    if (!additive || !props.multipleModelsEnabled) {
      props.onMultipleModelSelectionsChange(null);
      props.onProviderModelSelect(instanceId, model, { focusComposer: false });
      if (!coarse) window.requestAnimationFrame(focusEffort);
      return;
    }
    const current = multiple ?? [props.selectedModelSelection];
    const index = current.findIndex(
      (selection) =>
        selection.instanceId === instanceId &&
        (modelFor(instanceId, selection.model)?.slug ?? selection.model) === model,
    );
    const next =
      index === -1
        ? [...current, createModelSelection(instanceId, model)]
        : current.filter((_, candidate) => candidate !== index);
    props.onMultipleModelSelectionsChange(next.length > 1 ? next : null);
    const remaining = next[0] ?? props.selectedModelSelection;
    if (next.length <= 1)
      props.onProviderModelSelect(remaining.instanceId, remaining.model, { focusComposer: false });
  };

  return (
    <Popover
      modal
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(shown) => {
        const target = takeOpenTarget(triggerRef.current);
        if (shown && target) focusTarget(target);
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            ref={triggerRef}
            data-chat-provider-model-picker="true"
            data-composer-shortcut={props.triggerShortcuts}
            aria-label={triggerLabel}
            size={size}
            disabled={disabled}
            className={cn("min-w-0 shrink whitespace-nowrap", props.triggerClassName)}
            onClick={(event) => {
              if (!open) return;
              const target = takeOpenTarget(triggerRef.current);
              if (!target) return;
              (
                event as typeof event & { preventBaseUIHandler?: () => void }
              ).preventBaseUIHandler?.();
              focusTarget(target);
            }}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {activeEntry || selections?.length ? (
            <span
              data-chat-provider-model-picker-icon
              className={styles.modelTriggerIcons}
              aria-hidden="true"
            >
              {selections
                ? selections
                    .slice(0, 3)
                    .map(
                      ({ entry, key }) =>
                        entry && <InstanceGlyph key={key} entry={entry} picker={props} stacked />,
                    )
                : activeEntry && <InstanceGlyph entry={activeEntry} picker={props} />}
            </span>
          ) : null}
          <span
            data-chat-provider-model-picker-label="true"
            className="min-w-0 max-w-56 flex-1 truncate"
          >
            {triggerText}
          </span>
          {props.dock.traits && (
            <ModelTraitSummary
              input={props.dock.traits}
              display={props.dock.effortDisplay}
              size={size}
            />
          )}
        </span>
      </PopoverTrigger>
      <PopoverPopup
        {...floating}
        ref={popupRef}
        initialFocus={coarse ? popupRef : searchRef}
        align={props.popupAlign ?? "start"}
        side="top"
        collisionAvoidance={{ side: "shift", align: "shift" }}
        touchBackdrop
        padding="none"
        className="before:hidden"
        style={{ width: "min(26.5rem, calc(100dvw - 1.5rem))" }}
      >
        <div className={styles.modelPicker} data-model-picker-content="true">
          <ModelCatalog
            picker={props}
            disabled={disabled}
            open={open}
            searchRef={searchRef}
            onSelect={select}
            onClose={() => setOpen(false)}
            onFocusEffort={focusEffort}
          />
          {multiple === null && <ChatGptSharingControl provider={activeEntry?.snapshot ?? null} />}
          {props.dock.traits && (
            <ModelOptions
              key={`${props.activeInstanceId}:${props.model}`}
              input={props.dock.traits}
              disabled={disabled}
              open={open}
            />
          )}
          <ModelPermissions {...props.dock} disabled={disabled} />
        </div>
      </PopoverPopup>
    </Popover>
  );
});
