import { Badge } from "../../components/ui/badge";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import type { PrototypeVariant } from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";

/** The variants of one prototype set; a count is the notes waiting on that variant. */
export function PrototypeVariantPills(props: {
  readonly variants: readonly PrototypeVariant[];
  readonly selectedId: string;
  /** A set of several shows each variant's letter. */
  readonly lettered: boolean;
  readonly counts?: ReadonlyMap<string, number>;
  readonly onSelect: (variantId: string) => void;
}) {
  const copy = useDockCopy();
  return (
    <ToggleGroup
      variant="pill"
      aria-label={copy.protoVariantsLabel}
      value={[props.selectedId]}
      onValueChange={(next) => {
        const variantId = next[0];
        if (typeof variantId === "string") props.onSelect(variantId);
      }}
    >
      {props.variants.map((variant) => {
        const count = props.counts?.get(variant.id) ?? 0;
        return (
          <Toggle key={variant.id} value={variant.id} data-prototype-variant={variant.id}>
            {props.lettered && variant.key !== null ? (
              <span className="rounded bg-muted px-1 font-mono text-3xs leading-4">
                {variant.key}
              </span>
            ) : null}
            {variant.name}
            {count > 0 ? (
              <Badge data-prototype-variant-count={variant.id} size="sm" variant="warning">
                {count}
              </Badge>
            ) : null}
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}
