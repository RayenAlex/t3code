import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { useAtomValue } from "@effect/atom-react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { rankModelPickerSearch } from "@t3tools/client-runtime/model-search";
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  formatProviderUpdateRequiredNotice,
  providerUpdateChannelLags,
} from "@t3tools/client-runtime/providerUpdateRequiredModels";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT, useLocale, useMessages } from "gt-react";
import { CheckIcon, SearchIcon, StarIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import type { ComposerModelPicker } from "../../components/chat/ComposerFooterControls";
import { resolveModelPickerSelectedModel } from "../../components/chat/ModelPickerContent";
import { ProviderInstanceIcon } from "../../components/chat/ProviderInstanceIcon";
import {
  getProviderStatusMessage,
  hasProviderSetup,
} from "../../components/chat/ProviderStatusBanner";
import { getDisplayModelName, type ModelEsque } from "../../components/chat/providerIconUtils";
import { useProviderWorkspaceSnapshotRefresh } from "../../components/chat/useProviderWorkspaceSnapshotRefresh";
import { InlineButton } from "../../components/ui/button";
import { SharedTooltipTrigger } from "../../components/ui/shared-tooltip";
import {
  useEnvironmentModelPreferences,
  useToggleEnvironmentModelFavorite,
} from "../../hooks/useSettings";
import {
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import { announce } from "../../lib/announce";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import { registerModelPickerContent } from "../../modelPickerVisibility";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { hasRuntimeModelCatalog } from "../../providerModels";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useModelPickerCopy } from "./copy";
import { ProviderPillRail } from "./ProviderPillRail";
import styles from "./modelPicker.module.css";

type PickerProps = ComponentProps<typeof ComposerModelPicker>;
type Tab =
  | { kind: "favorites" }
  | { kind: "all" }
  | { kind: "provider"; entry: ProviderInstanceEntry };
type ModelRow = {
  key: string;
  option: ModelEsque;
  instanceId: ProviderInstanceId;
  slug: string;
  entry: ProviderInstanceEntry;
};

function tabKey(tab: Tab) {
  return tab.kind === "provider" ? `provider:${tab.entry.instanceId}` : tab.kind;
}

function modelKey(picker: PickerProps, instanceId: ProviderInstanceId, model: string) {
  const entry = picker.instanceEntries.find((candidate) => candidate.instanceId === instanceId);
  const option = resolveModelPickerSelectedModel({
    driverKind: entry?.driverKind,
    model,
    options: picker.modelOptionsByInstance.get(instanceId) ?? [],
  });
  return providerModelKey(instanceId, option?.slug ?? model);
}

function needsSetup(entry: ProviderInstanceEntry, options: readonly ModelEsque[]) {
  return (
    hasProviderSetup(entry.snapshot) &&
    entry.status !== "disabled" &&
    (!isProviderInstancePickerReady(entry) ||
      !entry.installed ||
      entry.snapshot.auth.status === "unauthenticated" ||
      !options.some((option) => !option.isUnavailable))
  );
}

function ProviderNotice({
  entry,
  query,
  setup,
  onSetup,
  onClose,
}: {
  entry: ProviderInstanceEntry;
  query: string;
  setup: boolean;
  onSetup: () => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const navigate = useNavigate();
  const update = formatProviderUpdateRequiredNotice(entry.snapshot, query, messages, locale);
  if (!setup && !update) return null;
  return (
    <div className={styles.providerNotice}>
      {setup && (
        <>
          <p>{getProviderStatusMessage(entry.snapshot, messages)}</p>
          <InlineButton onClick={onSetup}>{gt("Open provider setup")}</InlineButton>
        </>
      )}
      {update && (
        <p>
          {update}{" "}
          {!providerUpdateChannelLags(entry.snapshot, query) && (
            <InlineButton
              onClick={() => {
                onClose();
                void navigate({ to: "/settings/providers" });
              }}
            >
              {gt("Provider settings")}
            </InlineButton>
          )}
        </p>
      )}
    </div>
  );
}

export function ModelCatalog(props: {
  picker: PickerProps;
  disabled: boolean;
  open: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onSelect: (instance: ProviderInstanceId, model: string, additive: boolean) => void;
  onClose: () => void;
  onFocusEffort: () => void;
}) {
  const { picker, disabled, open, searchRef } = props;
  const gt = useGT();
  const copy = useModelPickerCopy();
  const { favorites } = useEnvironmentModelPreferences(picker.environmentId);
  const toggleFavorite = useToggleEnvironmentModelFavorite(picker.environmentId);
  const defaultKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = picker.keybindings ?? defaultKeybindings;
  const [query, setQuery] = useState("");
  const listRef = useRef<LegendListRef>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef<string | null>(null);
  const activeKey = modelKey(picker, picker.activeInstanceId, picker.model);
  const selectedKeys = new Set(
    picker.multipleModelsEnabled && picker.multipleModelSelections !== null
      ? picker.multipleModelSelections.map((model) =>
          modelKey(picker, model.instanceId, model.model),
        )
      : [activeKey],
  );
  const favoriteKeys = new Set(
    favorites.map((favorite) => providerModelKey(favorite.provider, favorite.model)),
  );
  const visibleEntries = picker.instanceEntries.filter(isProviderInstancePickerVisible);
  const canBrowse = (entry: ProviderInstanceEntry) =>
    picker.lockedProvider === null ||
    (entry.driverKind === picker.lockedProvider &&
      (!picker.lockedContinuationGroupKey ||
        entry.continuationGroupKey === picker.lockedContinuationGroupKey));
  const availableEntries = visibleEntries.filter(canBrowse);
  const setupEntries =
    picker.onOpenProviderSetup === undefined
      ? []
      : availableEntries.filter((entry) =>
          needsSetup(entry, picker.modelOptionsByInstance.get(entry.instanceId) ?? []),
        );
  const rows = availableEntries.flatMap((entry) => {
    const ready = isProviderInstancePickerReady(entry);
    const options = picker.modelOptionsByInstance.get(entry.instanceId) ?? [];
    const seen = new Set<string>();
    return options.flatMap((option): ModelRow[] => {
      if (
        seen.has(option.slug) ||
        (entry.driverKind === "antigravity" && option.slug === ANTIGRAVITY_DEFAULT_MODEL)
      )
        return [];
      seen.add(option.slug);
      const key = providerModelKey(entry.instanceId, option.slug);
      if (
        !ready &&
        !(key === activeKey && option.isUnavailable && hasRuntimeModelCatalog(entry.driverKind))
      )
        return [];
      return [{ key, option, slug: option.slug, instanceId: entry.instanceId, entry }];
    });
  });
  const tabs: Tab[] = [
    { kind: "favorites" },
    { kind: "all" },
    ...visibleEntries.map((entry) => ({ kind: "provider" as const, entry })),
  ];
  const [selectedTab, setSelectedTab] = useState(() => {
    const active = tabs.find(
      (tab) => tab.kind === "provider" && tab.entry.instanceId === picker.activeInstanceId,
    );
    if (
      active &&
      (picker.lockedProvider !== null ||
        setupEntries.some((entry) => entry.instanceId === picker.activeInstanceId) ||
        rows.some((row) => row.key === activeKey && row.option.isUnavailable))
    )
      return tabKey(active);
    return rows.some((row) => favoriteKeys.has(row.key)) ? "favorites" : "all";
  });
  const tab = tabs.find((tab) => tabKey(tab) === selectedTab) ?? { kind: "all" as const };
  const { scanning } = useProviderWorkspaceSnapshotRefresh({
    environmentId: picker.environmentId,
    gitCwd: picker.workspaceCwd ?? null,
    instanceId: tab.kind === "provider" ? tab.entry.instanceId : picker.activeInstanceId,
  });
  const searching = query.trim().length > 0;
  const filtered = searching
    ? rankModelPickerSearch(rows, query, ({ option, entry, key }) => ({
        name: option.name,
        slug: option.slug,
        ...(option.shortName ? { shortName: option.shortName } : {}),
        ...(option.subProvider ? { subProvider: option.subProvider } : {}),
        driverKind: entry.driverKind,
        providerDisplayName: entry.displayName,
        isFavorite: favoriteKeys.has(key),
      }))
    : sortProviderModelItems(
        rows.filter(
          (row) =>
            tab.kind === "all" ||
            (tab.kind === "favorites"
              ? favoriteKeys.has(row.key)
              : row.instanceId === tab.entry.instanceId),
        ),
        {
          favoriteModelKeys: favoriteKeys,
          groupFavorites: tab.kind !== "favorites",
          instanceOrder: visibleEntries.map((entry) => entry.instanceId),
        },
      );
  const rowByKey = new Map(filtered.map((row) => [row.key, row]));
  const rowKeys = filtered.map((row) => row.key);
  const reason = (row: ModelRow) =>
    disabled
      ? gt("Model picker is disabled")
      : (picker.getModelDisabledReason?.(row.instanceId, row.slug) ??
        row.entry.snapshot.subProviders?.find(
          (provider) => provider.name === row.option.subProvider,
        )?.unavailableReason ??
        (row.option.isUnavailable && !selectedKeys.has(row.key)
          ? gt("Unavailable", { $context: "badge on a model that cannot be selected" })
          : null));
  const pick = (key: string, additive: boolean) => {
    const row = rowByKey.get(key);
    if (!row || reason(row)) return false;
    props.onSelect(row.instanceId, row.slug, additive);
    return true;
  };
  const resetList = () => {
    highlightedRef.current = null;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const chooseTab = (next: Tab) => {
    resetList();
    setSelectedTab(tabKey(next));
    setQuery("");
  };
  const tabTitle = (target: Tab) =>
    target.kind === "provider"
      ? target.entry.displayName
      : target.kind === "all"
        ? copy.all
        : copy.favorites;
  const onWindowKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    )
      return;
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: {
        terminalFocus: false,
        terminalOpen: picker.terminalOpen ?? false,
        modelPickerOpen: true,
      },
    });
    if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
      const choices = tabs.filter(
        (candidate) => candidate.kind !== "provider" || canBrowse(candidate.entry),
      );
      const index = choices.findIndex((choice) => tabKey(choice) === tabKey(tab));
      const direction = command === "modelPicker.nextProvider" ? 1 : -1;
      const next = choices[(index + direction + choices.length) % choices.length];
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      chooseTab(next);
      const button = railRef.current?.querySelectorAll("button")[tabs.indexOf(next)];
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      announce(tabTitle(next), "model-picker");
      return;
    }
    const jump = modelPickerJumpIndexFromCommand(command ?? "");
    if (jump === null || jump >= MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.length) return;
    event.preventDefault();
    event.stopPropagation();
    const row = filtered.filter((candidate) => !reason(candidate))[jump];
    if (row && pick(row.key, false))
      announce(gt("Model: {name}", { name: row.option.name }), "model-picker");
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the global shortcut resolver reads picker visibility during capture
  useLayoutEffect(() => (open ? registerModelPickerContent() : undefined), [open]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- picker shortcuts must take priority over the global composer handler
  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onWindowKey, true);
    return () => window.removeEventListener("keydown", onWindowKey, true);
  }, [open]);
  const shortcut = shortcutLabelForCommand(keybindings, "modelPicker.toggle");
  const searchLabel = gt("Search models...");
  const focusedEntry = tab.kind === "provider" && canBrowse(tab.entry) ? tab.entry : undefined;
  const notices = searching
    ? availableEntries.filter((entry) => entry.snapshot.updateRequiredModels?.length)
    : focusedEntry
      ? [focusedEntry]
      : filtered.length === 0
        ? setupEntries
        : [];

  return (
    <BaseCombobox.Root<string, boolean>
      inline
      open
      virtualized
      autoHighlight
      items={rowKeys}
      filter={null}
      multiple={picker.multipleModelsEnabled}
      value={picker.multipleModelsEnabled ? [...selectedKeys] : activeKey}
      onItemHighlighted={(key, details) => {
        highlightedRef.current = typeof key === "string" ? key : null;
        if (details.reason === "keyboard" && details.index >= 0) {
          void listRef.current?.scrollIndexIntoView({ index: details.index, animated: false });
        }
      }}
      onValueChange={(value, details) => {
        const key = Array.isArray(value)
          ? (value.find((item) => !selectedKeys.has(item)) ??
            [...selectedKeys].find((item) => !value.includes(item)))
          : value;
        if (typeof key === "string")
          pick(key, "shiftKey" in details.event && details.event.shiftKey === true);
      }}
    >
      <label className={styles.modelSearch}>
        <SearchIcon aria-hidden="true" />
        <BaseCombobox.Input
          ref={searchRef}
          value={query}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onChange={(event) => {
            resetList();
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              event.preventBaseUIHandler();
              event.stopPropagation();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              props.onClose();
            }
            const key = highlightedRef.current;
            if (event.key === "Enter" && key && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventBaseUIHandler();
              event.preventDefault();
              event.stopPropagation();
              pick(key, event.shiftKey);
            }
            if (
              event.key === "ArrowRight" &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              event.currentTarget.selectionStart === query.length
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (!key || selectedKeys.has(key) || !pick(key, false)) props.onFocusEffort();
            }
          }}
        />
        {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
      </label>
      <ProviderPillRail railRef={railRef}>
        {tabs.map((candidate) => (
          <button
            key={tabKey(candidate)}
            type="button"
            aria-pressed={!searching && tabKey(candidate) === tabKey(tab)}
            disabled={candidate.kind === "provider" && !canBrowse(candidate.entry)}
            onClick={() => chooseTab(candidate)}
          >
            {candidate.kind === "provider" && (
              <ProviderInstanceIcon
                driverKind={candidate.entry.driverKind}
                displayName={candidate.entry.displayName}
                accentColor={candidate.entry.accentColor}
                acpRegistryAgentId={candidate.entry.acpRegistryAgentId}
                acpRegistryIconUrl={candidate.entry.acpRegistryIconUrl}
                className="size-3.5"
                iconClassName="size-3.5"
              />
            )}
            <span className="min-w-0 truncate">{tabTitle(candidate)}</span>
            {candidate.kind === "provider" &&
              shouldShowInstanceBadge(candidate.entry, picker.instanceEntries) && (
                <span className={styles.modelInstanceTag} aria-hidden="true">
                  {providerInstanceInitials(candidate.entry.displayName)}
                </span>
              )}
          </button>
        ))}
      </ProviderPillRail>
      <div className={styles.modelListWrap}>
        {filtered.length === 0 ? (
          <p role="status" className={styles.modelEmpty}>
            {tab.kind === "favorites" && !searching
              ? gt("No favorites yet")
              : scanning
                ? gt("Searching project models...")
                : gt("No models found")}
          </p>
        ) : (
          <BaseCombobox.List className={styles.modelList}>
            <LegendList
              ref={listRef}
              data={filtered}
              extraData={{ favorites, selectedKeys, disabled }}
              keyExtractor={(row) => row.key}
              estimatedItemSize={42}
              drawDistance={168}
              recycleItems={false}
              className="h-full overflow-x-hidden overscroll-y-contain"
              renderItem={({ item: row, index }) => {
                const unavailable = reason(row);
                const selected = selectedKeys.has(row.key);
                const favorite = favoriteKeys.has(row.key);
                return (
                  <BaseCombobox.Item
                    index={index}
                    value={row.key}
                    className={styles.modelRow}
                    disabled={Boolean(unavailable)}
                    aria-disabled={Boolean(unavailable) || undefined}
                    data-picked={selected || undefined}
                    aria-label={`${getDisplayModelName(row.option)}, ${row.entry.displayName}`}
                    aria-description={unavailable ?? undefined}
                  >
                    <ProviderInstanceIcon
                      driverKind={row.entry.driverKind}
                      displayName={row.entry.displayName}
                      accentColor={row.entry.accentColor}
                      acpRegistryAgentId={row.entry.acpRegistryAgentId}
                      acpRegistryIconUrl={row.entry.acpRegistryIconUrl}
                      showBadge={shouldShowInstanceBadge(row.entry, picker.instanceEntries)}
                      className={styles.modelProviderTile ?? ""}
                      iconClassName="size-3.5"
                      badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-2.75 min-w-3 px-0.5 text-5xs"
                      indicatorBackground="var(--popover)"
                    />
                    {unavailable ? (
                      <SharedTooltipTrigger
                        label={unavailable}
                        render={<span className={styles.modelName} />}
                      >
                        {getDisplayModelName(row.option)}
                      </SharedTooltipTrigger>
                    ) : (
                      <span className={styles.modelName}>{getDisplayModelName(row.option)}</span>
                    )}
                    <button
                      type="button"
                      className={styles.modelStar}
                      data-favorite={favorite || undefined}
                      disabled={Boolean(unavailable)}
                      aria-label={favorite ? gt("Remove from favorites") : gt("Add to favorites")}
                      onKeyDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleFavorite(row.instanceId, row.slug);
                      }}
                    >
                      <StarIcon aria-hidden="true" />
                    </button>
                    <span className={styles.modelCheck} aria-hidden="true">
                      {selected && <CheckIcon />}
                    </span>
                  </BaseCombobox.Item>
                );
              }}
            />
          </BaseCombobox.List>
        )}
      </div>
      {notices.map((entry) => (
        <ProviderNotice
          key={entry.instanceId}
          entry={entry}
          query={query}
          setup={!searching && setupEntries.includes(entry)}
          onClose={props.onClose}
          onSetup={() => {
            props.onClose();
            picker.onOpenProviderSetup?.(entry.instanceId);
          }}
        />
      ))}
    </BaseCombobox.Root>
  );
}
