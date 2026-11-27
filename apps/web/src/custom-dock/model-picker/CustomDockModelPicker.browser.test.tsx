import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { createModelCapabilities, createModelSelection } from "@t3tools/shared/model";
import { useId, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../../test/render";
import { ComposerControlsBar } from "../../components/chat/ComposerControlsBar";
import { markOpenToEffort, markOpenToPermissions } from "../../components/chat/composerEventScope";
import { resolveRuntimeModeOption } from "../../components/chat/runtimeModeConfig";
import { DraftId, useComposerThreadDraft } from "../../composerDraftStore";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { dockPreferences } from "../host/panelContext";
import { ModelPickerPreference } from "./ModelPickerPreference";

const environmentId = EnvironmentId.make("dock-picker-test");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");
const codexDriver = ProviderDriverKind.make("codex");
const claudeDriver = ProviderDriverKind.make("claudeAgent");

function provider(
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  models: ServerProvider["models"],
): ServerProvider {
  return {
    instanceId,
    driver,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models,
    slashCommands: [],
    skills: [],
  };
}

const entries = deriveProviderInstanceEntries([
  provider(codex, codexDriver, [
    {
      slug: "test-astra",
      name: "Test Astra",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          {
            id: "effort",
            type: "select",
            role: "reasoning",
            label: "Reasoning effort",
            options: [
              { id: "high", label: "High" },
              { id: "max", label: "Max" },
              { id: "xhigh", label: "Extra High" },
              { id: "ultra", label: "Ultra" },
            ],
            currentValue: "high",
          },
          { id: "fastMode", type: "boolean", label: "Fast", currentValue: false },
        ],
      }),
    },
    { slug: "test-restricted", name: "Test Restricted", isCustom: false, capabilities: null },
    {
      slug: "test-speed-tiers",
      name: "Test speed tiers",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          {
            id: "serviceTier",
            type: "select",
            label: "Service Tier",
            currentValue: "default",
            options: [
              { id: "default", label: "Standard", isDefault: true },
              { id: "priority", label: "Fast" },
            ],
          },
        ],
      }),
    },
  ]),
  provider(claude, claudeDriver, [
    { slug: "test-haiku", name: "Test Haiku", isCustom: false, capabilities: null },
  ]),
]);
const overflowingEntries = [
  ...entries,
  ...deriveProviderInstanceEntries(
    Array.from({ length: 5 }, (_, index) => ({
      ...provider(ProviderInstanceId.make(`connected-${index + 1}`), codexDriver, []),
      displayName: `Connected provider ${index + 1}`,
    })),
  ),
];
const modelOptionsByInstance = new Map(
  entries.map((entry) => [
    entry.instanceId,
    entry.models.map(({ slug, name, isCustom }) => ({ slug, name, isCustom })),
  ]),
);
const permissionOptions = [
  resolveRuntimeModeOption("full-access"),
  { ...resolveRuntimeModeOption("auto"), disabledReason: "Blocked in this folder" },
  resolveRuntimeModeOption("approval-required"),
];
const chinesePermissions = (
  [
    ["full-access", "完全访问"],
    ["auto", "自动"],
    ["auto-accept-edits", "自动接受编辑"],
    ["approval-required", "需审批"],
  ] as const
).map(([mode, label]) => ({ ...resolveRuntimeModeOption(mode), label }));
const keybindings = compileResolvedKeybindingsConfig([
  { key: "ctrl+1", command: "modelPicker.jump.1", when: "modelPickerOpen" },
]);

function Composer({
  locked = false,
  manyProviders = false,
  runtimeModeOptions = permissionOptions,
}: {
  locked?: boolean;
  manyProviders?: boolean;
  runtimeModeOptions?: typeof permissionOptions;
}) {
  const draftId = DraftId.make(useId());
  const draft = useComposerThreadDraft(draftId);
  const [selection, setSelection] = useState(() => createModelSelection(codex, "test-astra"));
  const [multiple, setMultiple] = useState<ReadonlyArray<ModelSelection> | null>(null);
  const [mode, setMode] = useState<RuntimeMode>("full-access");
  const [open, setOpen] = useState(false);
  const entry = entries[selection.instanceId === codex ? 0 : 1]!;
  const savedOptions = draft.modelSelectionByProvider[entry.instanceId]?.options;
  return (
    <div className="fixed inset-x-4 bottom-4 flex justify-end">
      <output
        data-testid="composer-selection"
        data-model={selection.model}
        data-multiple={multiple?.map(({ model }) => model).join(",") ?? ""}
        data-options={JSON.stringify(savedOptions)}
        className="sr-only"
      />
      <ComposerControlsBar
        environmentId={environmentId}
        workspaceCwd={null}
        routeKind="draft"
        routeThreadRef={{ environmentId, threadId: ThreadId.make("dock-picker-test") }}
        draftId={draftId}
        selectedProvider={entry.driverKind}
        selectedInstanceId={entry.instanceId}
        selectedModel={selection.model}
        selectedProviderModels={entry.models}
        composerModelOptions={savedOptions ? { [entry.instanceId]: savedOptions } : null}
        reportedModelSelection={null}
        promptUltrathink="none"
        onPromptEdit={() => {}}
        effortDisplay="label"
        permissionsShownInStrip={false}
        compatibleRuntimeMode={mode}
        defaultRuntimeMode={mode}
        compatibleRuntimeModeOptions={runtimeModeOptions}
        handleRuntimeModeChange={setMode}
        composerControlsCollapsed={false}
        composerControlsHidden={false}
        restingHiddenBlockCount={0}
        iconOnlyBlockCount={0}
        showProviderUnavailable={false}
        providerSetupInstanceId={undefined}
        onOpenProviderSetup={() => {}}
        providerCatalogPending={false}
        isSendBusy={false}
        multipleModelsEnabled={!locked}
        multipleModelSelections={multiple}
        onMultipleModelSelectionsChange={setMultiple}
        selectedModelSelection={selection}
        onProviderModelSelect={(instanceId, model) =>
          setSelection(createModelSelection(instanceId, model))
        }
        activeThreadModelSelection={null}
        selectedModelForPickerWithCustomFallback={selection.model}
        lockedProvider={locked ? codexDriver : null}
        lockedContinuationGroupKey={null}
        providerInstanceEntries={manyProviders ? overflowingEntries : entries}
        keybindings={keybindings}
        modelOptionsByInstance={modelOptionsByInstance}
        terminalOpen={false}
        modelPickerOpen={open}
        onModelPickerOpenChange={setOpen}
        modelPickerIconClassName={undefined}
        getModelDisabledReason={(_, model) =>
          model === "test-restricted" ? "Cannot switch to this model" : null
        }
      />
    </div>
  );
}

it("keeps the popup open while selecting and searches across provider pills", async () => {
  await using screen = await render(<Composer />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const search = page.getByRole("combobox", { name: /Search models/ });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect
    .element(page.getByRole("option", { name: /Test Restricted/ }))
    .toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect.element(page.getByRole("option", { name: /Test Haiku/ })).not.toBeInTheDocument();
  await search.fill("haiku");
  await page.getByRole("option", { name: /Test Haiku/ }).click({ modifiers: ["Shift"] });
  const selection = screen.getByTestId("composer-selection");
  await expect.element(selection).toHaveAttribute("data-multiple", "test-astra,test-haiku");
  await userEvent.keyboard("{Control>}1{/Control}");
  await expect.element(selection).toHaveAttribute("data-model", "test-haiku");
  await expect.element(selection).toHaveAttribute("data-multiple", "");
  await expect.element(search).toBeVisible();
  await expect.element(page.getByRole("slider")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(search).not.toBeInTheDocument();
});

it("uses the real per-model effort choices and saves the Max, Ultra and Fast values", async () => {
  await using screen = await render(<Composer />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const slider = page.getByRole("slider", { name: "Reasoning effort" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Extra High");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Maximum");
  await expect
    .element(page.getByRole("dialog").getByText("Maximum", { exact: true }))
    .toHaveLength(1);
  const particles = page.getByTestId("dock-effort-particles");
  await expect.element(particles).toHaveLength(2);
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Ultra");
  await expect.element(particles).toHaveLength(2);
  await page.getByRole("button", { name: "Fast", exact: true }).click();
  const selection = screen.getByTestId("composer-selection");
  await expect.element(selection).toHaveAttribute(
    "data-options",
    JSON.stringify([
      { id: "effort", value: "ultra" },
      { id: "fastMode", value: true },
    ]),
  );
});

it("does not commit a permissions drag before release or choose a disabled segment", async () => {
  await using screen = await render(<Composer />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const group = page.getByRole("radiogroup", { name: "Access permissions" });
  const full = group.getByRole("radio", { name: "Full access" });
  const auto = group.getByRole("radio", { name: "Auto", exact: true });
  const supervised = group.getByRole("radio", { name: "Supervised" });
  await expect.element(auto).toHaveAccessibleDescription("Blocked in this folder");
  await expect.element(auto).toHaveAttribute("aria-disabled", "true");
  await full.hover();
  await commands.pointerDown();
  try {
    await supervised.hover({ force: true });
    await expect.element(full).toHaveAttribute("aria-checked", "true");
  } finally {
    await commands.pointerUp();
  }
  await expect.element(supervised).toHaveAttribute("aria-checked", "true");
  await auto.hover();
  await commands.pointerDown();
  await commands.pointerUp();
  await expect.element(supervised).toHaveAttribute("aria-checked", "true");
  (supervised.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(full).toHaveAttribute("aria-checked", "true");
  const toggle = page.getByRole("button", { name: "Access permissions" });
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Full access", exact: true }).click();
  await expect.element(full).toHaveAttribute("aria-checked", "true");
});

it("does not offer a different provider on a locked thread", async () => {
  await using screen = await render(<Composer locked />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const search = page.getByRole("combobox", { name: /Search models/ });
  await search.fill("haiku");
  await expect.element(page.getByText("No models found")).toBeVisible();
  await expect.element(page.getByRole("option", { name: /Test Haiku/ })).not.toBeInTheDocument();
});

it("returns to the original composer picker when the local preference is turned off", async () => {
  await using screen = await render(
    <>
      <ModelPickerPreference />
      <Composer />
    </>,
  );
  const preferences = dockPreferences.getState();
  const original = preferences.composerModelPickerEnabled;
  try {
    const toggle = screen.getByRole("checkbox", { name: "Use the Custom Dock model picker" });
    await expect.element(toggle).toBeChecked();
    await toggle.click();
    await screen.getByRole("button", { name: /Test Astra/ }).click();
    await expect.element(page.getByRole("radiogroup", { name: "Reasoning effort" })).toBeVisible();
    await expect.element(page.getByRole("slider")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await toggle.click();
    await screen.getByRole("button", { name: /Test Astra/ }).click();
    await expect.element(page.getByRole("slider", { name: "Reasoning effort" })).toBeVisible();
  } finally {
    await act(() => preferences.setComposerModelPickerEnabled(original));
  }
});

it("keeps the orbit and permissions reachable in a narrow, short window", async () => {
  await page.viewport(365, 440);
  await using screen = await render(<Composer />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const dialog = page.getByRole("dialog");
  const slider = dialog.getByRole("slider", { name: "Reasoning effort" });
  await expect.element(slider).toBeVisible();
  const firstTick = page.getByTestId("dock-effort-tick-0");
  const lastTick = page.getByTestId("dock-effort-tick-3");
  await firstTick.hover({ force: true });
  await commands.pointerDown();
  try {
    await lastTick.hover({ force: true });
    await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  } finally {
    await commands.pointerUp();
  }
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Ultra");
  await dialog.getByRole("radio", { name: "Supervised" }).click();
  await expect
    .element(dialog.getByRole("radio", { name: "Supervised" }))
    .toHaveAttribute("aria-checked", "true");
  const { left, right, top } = dialog.element().getBoundingClientRect();
  expect(left).toBeGreaterThanOrEqual(0);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(right).toBeLessThanOrEqual(window.innerWidth);
});

it("routes the composer shortcuts to the orbit and the selected permission", async () => {
  await using screen = await render(<Composer />);
  const trigger = screen.getByRole("button", { name: /Test Astra/ });
  markOpenToEffort(trigger.element() as HTMLElement);
  await trigger.click();
  await expect.element(page.getByRole("slider")).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  markOpenToPermissions(trigger.element() as HTMLElement);
  await trigger.click();
  await expect.element(page.getByRole("radio", { name: "Full access" })).toHaveFocus();
});

it("aligns all four Chinese permission labels and fits the longest one on a single line", async () => {
  await page.viewport(900, 660);
  await using screen = await render(<Composer runtimeModeOptions={chinesePermissions} />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const options = page.getByRole("radiogroup", { name: "Access permissions" });
  const edits = options.getByRole("radio", { name: "自动接受编辑" });
  await expect.element(edits).toBeVisible();
  await vi.waitFor(() => {
    const buttons = [...options.element().querySelectorAll('[role="radio"]')];
    expect(buttons).toHaveLength(4);
    const text = buttons.map((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range;
    });
    const lines = text.map((range) => [...range.getClientRects()].at(-1)!);
    const cell = edits.element().getBoundingClientRect();
    expect(lines[2]!.height).toBeLessThan(cell.height);
    expect(lines[2]!.right).toBeLessThanOrEqual(cell.right);
    expect(lines[2]!.left).toBeGreaterThanOrEqual(cell.left);
    for (const line of lines.slice(1)) expect(Math.abs(line.top - lines[0]!.top)).toBeLessThan(1);
    expect(text[2]!.getBoundingClientRect().height).toBeLessThan(lines[0]!.height + 1);
  });
  await edits.click();
  await expect.element(edits).toHaveAttribute("aria-checked", "true");
});

it("scrolls hidden provider pills using the right-side controls without changing the selection", async () => {
  await page.viewport(900, 660);
  await using screen = await render(<Composer manyProviders />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const rail = page.getByRole("group", { name: "Providers", exact: true });
  const previous = page.getByRole("button", { name: "Scroll providers left" });
  const next = page.getByRole("button", { name: "Scroll providers right" });
  await expect.element(next).toBeVisible();
  expect(getComputedStyle(rail.element()).scrollbarWidth).toBe("none");
  await expect.element(previous).toHaveAttribute("aria-disabled", "true");
  await next.click();
  await vi.waitFor(() => expect(rail.element().scrollLeft).toBeGreaterThan(0));
  await expect.element(previous).not.toHaveAttribute("aria-disabled", "true");
  await expect
    .element(rail.getByRole("button", { name: "All", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await previous.click();
  await vi.waitFor(() => expect(rail.element().scrollLeft).toBe(0));
  await expect.element(previous).toHaveAttribute("aria-disabled", "true");
});

it("toggles a Standard/Fast service tier directly and persists the provider's tier IDs", async () => {
  await using screen = await render(<Composer />);
  await screen.getByRole("button", { name: /Test Astra/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: /Search models/ }).fill("Test speed tiers");
  await dialog.getByRole("option", { name: /Test speed tiers/ }).click();
  const fast = dialog.getByRole("button", { name: "Fast", exact: true });
  await expect.element(fast).toHaveAttribute("aria-pressed", "false");
  await expect
    .element(dialog.getByRole("combobox", { name: "Service Tier" }))
    .not.toBeInTheDocument();
  await fast.click();
  await expect.element(fast).toHaveAttribute("aria-pressed", "true");
  const selection = screen.getByTestId("composer-selection");
  await expect
    .element(selection)
    .toHaveAttribute("data-options", JSON.stringify([{ id: "serviceTier", value: "priority" }]));
  await userEvent.keyboard("{Space}");
  await expect.element(fast).toHaveAttribute("aria-pressed", "false");
  await expect
    .element(selection)
    .toHaveAttribute("data-options", JSON.stringify([{ id: "serviceTier", value: "default" }]));
});
