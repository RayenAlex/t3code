import {
  buildTraitsTriggerDisplay,
  isReasoningSelect,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { useMessages } from "gt-react";
import { WorkflowIcon, ZapIcon } from "lucide-react";
import type { CSSProperties } from "react";

import type { ComposerControlSize } from "../../components/chat/ComposerControl";
import { EffortGlyph, FastBolt, resolveEffortGlyph } from "../../components/chat/EffortGlyph";
import {
  type TraitsSelectionInput,
  ULTRATHINK_IN_BODY_NOTE,
  useTraitsSelection,
} from "../../components/chat/TraitsPicker";
import { useModelPickerCopy } from "./copy";
import styles from "./modelPicker.module.css";
import { detentKeyIndex, detentPosition, useDetentDrag } from "./detentDrag";

type Traits = ReturnType<typeof useTraitsSelection>;
type Reasoning = Extract<ProviderOptionDescriptor, { type: "select" }>;

export function ModelTraitSummary(props: {
  input: TraitsSelectionInput;
  display: EffortDisplay;
  size: ComposerControlSize;
}) {
  const traits = useTraitsSelection(props.input);
  const messages = useMessages();
  const copy = useModelPickerCopy();
  const reasoning = traits.selectDescriptors.find(isReasoningSelect);
  const value = reasoning ? traits.selectValue(reasoning) : "";
  const glyph = reasoning ? resolveEffortGlyph(reasoning, value) : null;
  const label = reasoning
    ? copy.level(value, (glyph?.label ?? traits.currentLabel(reasoning)) || value)
    : traits.thinkingDescriptor
      ? traits.currentLabel(traits.thinkingDescriptor)
      : null;
  const display = buildTraitsTriggerDisplay(
    {
      descriptors: traits.descriptors,
      primarySelectDescriptorId: traits.primarySelectDescriptor?.id ?? null,
      ultrathinkPromptControlled: traits.ultrathinkPromptControlled,
      modelSelection:
        props.input.instanceId && props.input.model
          ? {
              instanceId: props.input.instanceId,
              model: props.input.model,
              options: props.input.modelOptions ?? [],
            }
          : null,
      reportedModelSelection: props.input.reportedModelSelection,
    },
    messages,
  );
  const fast = display.speedLabel === "Fast" || display.speedLabel === "Ultrafast";
  const context =
    traits.contextWindowDescriptor && traits.currentLabel(traits.contextWindowDescriptor);
  if (!label && !fast && !display.ultracode && !context) return null;
  return (
    <span className={styles.modelTriggerTraits}>
      {label && glyph && !glyph.special && props.display === "bars" ? (
        <EffortGlyph count={glyph.count} filled={glyph.filled} size={props.size} />
      ) : label ? (
        <span data-composer-control-label className="max-w-24 truncate">
          {label}
        </span>
      ) : null}
      {fast && <FastBolt ultra={display.speedLabel === "Ultrafast"} />}
      {display.ultracode && (
        <WorkflowIcon aria-hidden="true" data-composer-control-icon className="size-3" />
      )}
      {context && (
        <span
          data-composer-control-label
          data-composer-secondary-trait
          className="max-w-24 truncate text-xs"
        >
          {context}
        </span>
      )}
    </span>
  );
}

function TraitToggle({
  label,
  icon: Icon,
  pressed,
  disabled,
  onToggle,
}: {
  label: string;
  icon: typeof ZapIcon | null;
  pressed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.traitChip}
      data-dock-trait-focus
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onToggle}
    >
      {Icon && <Icon aria-hidden="true" />}
      {label}
    </button>
  );
}

function TraitControl({
  descriptor,
  traits,
  disabled,
}: {
  descriptor: ProviderOptionDescriptor;
  traits: Traits;
  disabled: boolean;
}) {
  if (descriptor.type === "boolean") {
    return (
      <TraitToggle
        label={descriptor.label}
        icon={
          descriptor.id === "fastMode"
            ? ZapIcon
            : descriptor.id === "ultracode"
              ? WorkflowIcon
              : null
        }
        pressed={descriptor.currentValue === true}
        disabled={disabled}
        onToggle={() => traits.changeBoolean(descriptor.id, descriptor.currentValue !== true)}
      />
    );
  }
  const choices = selectableProviderOptionChoices(descriptor);
  if (choices.length < 2) return null;
  const value = traits.selectValue(descriptor);
  if (descriptor.id === "serviceTier" && choices.length === 2) {
    const standard = choices.find(
      ({ id, label }) => id === "default" || id === "standard" || label === "Standard",
    );
    const fast = choices.find(({ id, label }) => id === "fast" || label === "Fast");
    if (standard && fast && standard.id !== fast.id) {
      const pressed = value === fast.id;
      return (
        <TraitToggle
          label={fast.label}
          icon={ZapIcon}
          pressed={pressed}
          disabled={disabled}
          onToggle={() => traits.changeSelect(descriptor, pressed ? standard.id : fast.id)}
        />
      );
    }
  }
  return (
    <label className={styles.traitSelect}>
      {descriptor.id === "serviceTier" ? (
        <ZapIcon aria-hidden="true" />
      ) : (
        <span>{descriptor.label}</span>
      )}
      <select
        data-dock-trait-focus
        aria-label={descriptor.label}
        disabled={disabled}
        value={value}
        onChange={(event) => traits.changeSelect(descriptor, event.target.value)}
      >
        {!choices.some((choice) => choice.id === value) && (
          <option value={value} disabled>
            {traits.currentLabel(descriptor) ?? value}
          </option>
        )}
        {choices.map((choice) => (
          <option value={choice.id} key={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const particleSeeds = Array.from({ length: 22 }, (_, i) => ({
  x: ((i * 43 + 11) % 101) / 100,
  y: ((i * 31 + 7) % 83) / 82,
  delay: (i * 71) % 540,
  side: i % 4,
  size: 1.5 + (i % 4) * 0.55,
}));

function Particles({ edge }: { edge?: boolean }) {
  return (
    <span
      className={edge ? `${styles.effortParticles} ${styles.effortEdge}` : styles.effortParticles}
      aria-hidden="true"
      data-testid="dock-effort-particles"
    >
      {edge && <span className={styles.effortComet} />}
      {particleSeeds.map(({ x, y, delay, size, side }) => {
        return (
          <span
            key={delay}
            style={
              {
                left: `${100 * (!edge || side < 2 ? x : side === 2 ? 0.015 : 0.985)}%`,
                top: `${100 * (!edge ? y : side === 0 ? 0.06 : side === 1 ? 0.94 : y)}%`,
                "--particle-delay": `${delay}ms`,
                "--particle-size": `${size}px`,
                "--particle-travel": edge ? `${(x - 0.5) * 56}px` : `${-(18 + x * 52)}px`,
                "--particle-drift": `${(y - 0.5) * (edge ? 38 : 18)}px`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

const ORBIT_INSET = 0.08;
const effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

function orbitChoices(descriptor: Reasoning) {
  const choices = selectableProviderOptionChoices(descriptor);
  const rank = (id: string) => effortOrder.indexOf(id);
  const ordered = choices
    .filter(({ id }) => rank(id) !== -1)
    .sort((a, b) => rank(a.id) - rank(b.id));
  // Agent-specific choices keep their original slots; only known levels share a scale.
  let index = 0;
  return choices.map((choice) => (rank(choice.id) === -1 ? choice : (ordered[index++] ?? choice)));
}

function ReasoningOrbit({
  descriptor,
  traits,
  speed,
  open,
  disabled,
}: {
  descriptor: Reasoning;
  traits: Traits;
  speed?: ProviderOptionDescriptor;
  open: boolean;
  disabled: boolean;
}) {
  const copy = useModelPickerCopy();
  const messages = useMessages();
  const choices = orbitChoices(descriptor);
  const value = traits.selectValue(descriptor);
  const index = choices.findIndex((choice) => choice.id === value);
  const locked =
    traits.ultrathinkInBodyText && descriptor.id === traits.primarySelectDescriptor?.id;
  const enabled = () => !locked && !disabled;
  const select = (next: number) => {
    const choice = choices[next];
    if (choice && value !== choice.id && enabled()) traits.changeSelect(descriptor, choice.id);
  };
  const { preview, handlers } = useDetentDrag({
    count: choices.length,
    inset: ORBIT_INSET,
    enabled,
    onCommit: select,
  });
  const shownChoice = choices[preview ?? index];
  const shownId = shownChoice?.id ?? value;
  const label = copy.level(shownId, shownChoice?.label ?? traits.currentLabel(descriptor) ?? value);
  const energy = shownId === "max" || shownId === "ultra" ? shownId : undefined;
  const position = (step: number) => `${detentPosition(step, choices.length, ORBIT_INSET) * 100}%`;
  return (
    <div className={styles.effortCard} data-energy={energy}>
      {open && energy && <Particles key={`edge-${energy}`} edge />}
      <div className={styles.effortHeading}>
        <span className={styles.effortTitle}>
          <span aria-hidden="true" className={styles.effortDot} />
          {copy.effort}
          <span aria-hidden="true" className={styles.effortSeparator}>
            ·
          </span>
          <span className={styles.effortLabel}>{label}</span>
        </span>
        <span className={styles.effortMeta}>
          {speed && <TraitControl descriptor={speed} traits={traits} disabled={disabled} />}
          <span>{copy.levels(choices.length)}</span>
        </span>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={copy.effort}
        aria-valuemin={0}
        aria-valuemax={choices.length - 1}
        aria-valuenow={Math.max(0, index)}
        aria-valuetext={copy.level(
          value,
          choices[index]?.label ?? traits.currentLabel(descriptor) ?? value,
        )}
        aria-disabled={locked || disabled || undefined}
        aria-description={choices[index]?.description}
        data-dock-trait-focus
        dir="ltr"
        className={`${styles.effortOrbit} ${styles.detentTrack}`}
        style={{ "--dock-detent-stop": position(Math.max(0, index)) } as CSSProperties}
        {...handlers}
        onPointerDown={(event) => {
          if (!enabled()) return;
          event.currentTarget.focus({ preventScroll: true });
          handlers.onPointerDown(event);
        }}
        onKeyDown={(event) => {
          if (!enabled()) return;
          const next = detentKeyIndex(
            event,
            index < 0 && (event.key === "ArrowLeft" || event.key === "ArrowDown")
              ? choices.length
              : index,
            choices.length,
            enabled,
          );
          if (next !== null) select(next);
        }}
      >
        {open && energy && <Particles key={`track-${energy}`} />}
        {choices.map((choice, step) => (
          <span
            key={choice.id}
            className={styles.effortTick}
            data-testid={`dock-effort-tick-${step}`}
            data-current={step === (preview ?? index) || undefined}
            aria-hidden="true"
            style={{ left: position(step) }}
          />
        ))}
        <span className={`${styles.orbitThumb} ${styles.detentThumb}`} aria-hidden="true">
          <span className={styles.orbitStar} />
        </span>
      </div>
      {locked && (
        <p className="mt-1 text-xs text-muted-foreground">{messages(ULTRATHINK_IN_BODY_NOTE)}</p>
      )}
    </div>
  );
}

export function ModelOptions({
  input,
  open,
  disabled,
}: {
  input: TraitsSelectionInput;
  open: boolean;
  disabled: boolean;
}) {
  const traits = useTraitsSelection(input);
  if (traits.modelIsUnavailable || traits.descriptors.length === 0) return null;
  const reasoning = traits.selectDescriptors.find(isReasoningSelect);
  const orbit =
    reasoning && selectableProviderOptionChoices(reasoning).length > 1 ? reasoning : null;
  const speed =
    traits.selectDescriptors.find(({ id }) => id === "serviceTier") ?? traits.fastModeDescriptor;
  const others = traits.descriptors.filter(
    (descriptor) => descriptor !== orbit && (!orbit || descriptor !== speed),
  );
  if (
    !orbit &&
    !others.some(
      (descriptor) =>
        descriptor.type === "boolean" || selectableProviderOptionChoices(descriptor).length > 1,
    )
  )
    return null;
  return (
    <div data-model-picker-effort>
      {orbit && (
        <ReasoningOrbit
          key={orbit.id}
          descriptor={orbit}
          traits={traits}
          {...(speed ? { speed } : {})}
          open={open}
          disabled={disabled}
        />
      )}
      {others.length > 0 && (
        <div className={styles.otherTraits}>
          {others.map((descriptor) => (
            <TraitControl
              key={descriptor.id}
              descriptor={descriptor}
              traits={traits}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
