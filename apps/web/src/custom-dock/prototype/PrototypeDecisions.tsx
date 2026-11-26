import { Button } from "../../components/ui/button";
import type { PrototypeAnnotation, PrototypeGroup, PrototypeVariant } from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import {
  prototypeAdoptMessage,
  prototypeAdjustMessage,
  prototypeFeedbackMessage,
} from "./prototypeMessages";

/** What to do with the prototype on screen: send its notes back, or adopt or revise it. */
export function PrototypeDecisions(props: {
  readonly group: PrototypeGroup;
  readonly variant: PrototypeVariant;
  /** Every note on the group; each line names its own variant and viewport. */
  readonly notes: readonly PrototypeAnnotation[];
  readonly onDecide: (message: string) => void;
}) {
  const copy = useDockCopy();
  const { group, variant } = props;
  const lettered = group.variants.length > 1 && variant.key !== null;
  const label = (template: string) =>
    template.replace("{key}", variant.key ?? "").replace("{count}", String(props.notes.length));
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {props.notes.length > 0 ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onDecide(prototypeAdoptMessage(copy, group, variant.id))}
          >
            {lettered ? label(copy.protoIgnoreAndAdopt) : copy.protoAdoptSingle}
          </Button>
          <Button
            size="sm"
            onClick={() => props.onDecide(prototypeFeedbackMessage(copy, group, props.notes))}
          >
            {label(copy.protoSendAnnotations)}
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onDecide(prototypeAdjustMessage(copy, group, variant.id))}
          >
            {lettered ? label(copy.protoAdjustVariant) : copy.protoAdjustSingle}
          </Button>
          <Button
            size="sm"
            onClick={() => props.onDecide(prototypeAdoptMessage(copy, group, variant.id))}
          >
            {lettered ? label(copy.protoAdoptVariant) : copy.protoAdoptSingle}
          </Button>
        </>
      )}
    </div>
  );
}
