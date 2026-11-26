import type { ScopedThreadRef } from "@t3tools/contracts";
import { Maximize2Icon, MessageSquarePlusIcon, PencilRulerIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useThreadVisibleTurnItems } from "../../state/entities";
import en from "../copy/en.json";
import { collectPrototypeGroups, type PrototypeGroup } from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import type { CustomDockPanelDefinition } from "../host/types";
import { stagePrototypeDirective } from "../prototype/prototypeMessages";
import { usePrototypeStore } from "../prototype/prototypeStore";

function PrototypeSetRow({
  group,
  onOpen,
}: {
  readonly group: PrototypeGroup;
  readonly onOpen: (groupId: string) => void;
}) {
  const copy = useDockCopy();
  const lettered = group.variants.length > 1;
  return (
    <button
      type="button"
      data-prototype-set={group.id}
      onClick={() => onOpen(group.id)}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3 text-left outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-foreground">
        <PencilRulerIcon className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{group.topic || copy.protoUntitled}</span>
        <span className="flex flex-wrap gap-1">
          {group.variants.map((variant) => (
            <span
              key={variant.id}
              className="rounded bg-muted px-1.5 py-0 text-2xs text-muted-foreground"
            >
              {lettered && variant.key !== null ? `${variant.key} ${variant.name}` : variant.name}
            </span>
          ))}
        </span>
      </span>
      <Maximize2Icon className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Every prototype set this thread produced, newest first, each one a way into the studio. */
function PrototypePanel({ scope }: { readonly scope: ScopedThreadRef }) {
  const copy = useDockCopy();
  const items = useThreadVisibleTurnItems(scope);
  const openStudio = usePrototypeStore((state) => state.openStudio);
  const groups = collectPrototypeGroups(items).toReversed();
  return (
    <div className="flex flex-col gap-2 p-3">
      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-3">
          <p className="text-sm">{copy.protoPanelEmpty}</p>
          <p className="text-xs text-muted-foreground">{copy.protoPanelHint}</p>
          <Button
            size="sm"
            variant="outline"
            data-prototype-request-first
            onClick={() => stagePrototypeDirective(scope, "first", copy.protoDirectiveFirst)}
          >
            <MessageSquarePlusIcon className="size-3.5" />
            {copy.protoPolicyFirst}
          </Button>
        </div>
      ) : (
        groups.map((group) => <PrototypeSetRow key={group.id} group={group} onOpen={openStudio} />)
      )}
    </div>
  );
}

export const panelDefinition: CustomDockPanelDefinition = {
  id: "prototype-studio",
  title: en.prototypes,
  icon: "prototype",
  order: 15,
  renderPanel: (snapshot) => <PrototypePanel scope={snapshot.threadMeta} />,
};
