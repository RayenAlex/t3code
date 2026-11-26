import type { ScopedThreadRef } from "@t3tools/contracts";
import { PencilRulerIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../../components/ui/popover";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useDockCopy } from "../host/panelContext";
import {
  readPrototypeDirective,
  stagePrototypeDirective,
  type PrototypeDirective,
} from "./prototypeMessages";

type Policy = PrototypeDirective | "auto";

const POLICIES: readonly Policy[] = ["auto", "first", "skip"];

/**
 * A switch beside the composer for the next message: let the model decide, ask it for a
 * prototype first, or go straight to code. It only edits the draft's leading line, so the
 * user sees and can change what is sent, and it lapses once that message goes out.
 */
export function PrototypePolicyCapsule({ scope }: { readonly scope: ScopedThreadRef }) {
  const copy = useDockCopy();
  const directive = useComposerDraftStore((store) =>
    readPrototypeDirective(store.getComposerDraft(scope)?.prompt ?? ""),
  );
  const policy: Policy = directive ?? "auto";
  const labels = {
    auto: copy.protoPolicyAuto,
    first: copy.protoPolicyFirst,
    skip: copy.protoPolicySkip,
  };
  const shortLabels = {
    auto: copy.protoPolicyShortAuto,
    first: copy.protoPolicyShortFirst,
    skip: copy.protoPolicyShortSkip,
  };
  const choose = (next: Policy) =>
    stagePrototypeDirective(
      scope,
      next === "auto" ? null : next,
      next === "first" ? copy.protoDirectiveFirst : next === "skip" ? copy.protoDirectiveSkip : "",
    );
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="xs" variant="ghost-muted" data-prototype-policy={policy} />}
        aria-label={copy.protoPolicyLabel}
      >
        <PencilRulerIcon className="size-3" />
        {shortLabels[policy]}
      </PopoverTrigger>
      <PopoverPopup side="top" width="sm" padding="compact" aria-label={copy.protoPolicyLabel}>
        <p className="px-2 pt-1 pb-2 text-2xs text-muted-foreground">{copy.protoPolicyHint}</p>
        <div className="flex flex-col gap-0.5">
          {POLICIES.map((candidate) => (
            <PopoverClose
              key={candidate}
              render={
                <Button
                  size="sm"
                  variant={candidate === policy ? "secondary" : "ghost"}
                  aria-pressed={candidate === policy}
                  className="w-full justify-start"
                />
              }
              onClick={() => choose(candidate)}
            >
              {labels[candidate]}
            </PopoverClose>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
