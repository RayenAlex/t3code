import { XIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import {
  PROTOTYPE_ANNOTATION_KINDS,
  type AnnotationKind,
  type PrototypeAnnotation,
  type PrototypeGroup,
  type PrototypeVariant,
  type PrototypeViewport,
} from "../core/prototypes";
import { useDockCopy } from "../host/panelContext";
import { ANNOTATION_BADGE, ANNOTATION_PIN } from "./annotationStyles";
import { annotationKindLabel } from "./prototypeMessages";
import { type AnnotationDraft, type PrototypeMode, usePrototypeStore } from "./prototypeStore";

function DraftEditor({ draft }: { readonly draft: AnnotationDraft }) {
  const copy = useDockCopy();
  const setDraftKind = usePrototypeStore((state) => state.setDraftKind);
  const setDraftText = usePrototypeStore((state) => state.setDraftText);
  const cancelDraft = usePrototypeStore((state) => state.cancelDraft);
  const commitDraft = usePrototypeStore((state) => state.commitDraft);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const quickNotes = [
    copy.protoQuickNote1,
    copy.protoQuickNote2,
    copy.protoQuickNote3,
    copy.protoQuickNote4,
  ];
  const save = () => commitDraft(copy.protoDefaultAnnotationText);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    save();
  };
  // A click moves focus to the chip, so the note being written takes it back.
  const pickQuickNote = (note: string) => () => {
    setDraftText(note);
    textarea.current?.focus();
  };
  return (
    <div
      data-prototype-annotation-draft
      className="flex shrink-0 flex-col gap-1.5 rounded-md border border-accent bg-accent/15 p-2"
    >
      <div className="flex items-center justify-between gap-1 text-2xs font-semibold">
        <span>
          {copy.protoDraftTarget.replace(
            "{target}",
            draft.shape === "box" ? copy.protoDraftBoxTarget : copy.protoDraftPointTarget,
          )}
        </span>
        <span className="font-mono text-3xs opacity-80">
          {Math.round(draft.pin.x)}%, {Math.round(draft.pin.y)}%
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {PROTOTYPE_ANNOTATION_KINDS.map((kind: AnnotationKind) => (
          <Button
            key={kind}
            size="micro"
            variant={draft.kind === kind ? "secondary" : "ghost-muted"}
            aria-pressed={draft.kind === kind}
            onClick={() => setDraftKind(kind)}
          >
            {annotationKindLabel(copy, kind)}
          </Button>
        ))}
      </div>
      <Textarea
        ref={textarea}
        size="sm"
        rows={2}
        autoFocus
        value={draft.text}
        placeholder={copy.protoDraftPlaceholder}
        onChange={(event) => setDraftText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex flex-wrap gap-1">
        {quickNotes.map((note) => (
          <Button key={note} size="micro" variant="outline" onClick={pickQuickNote(note)}>
            {note}
          </Button>
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost-muted" onClick={cancelDraft}>
          {copy.cancel}
        </Button>
        <Button size="xs" onClick={save}>
          {copy.protoSaveAnnotation}
        </Button>
      </div>
    </div>
  );
}

/** The notes on one variant, with the one being written on top. */
export function AnnotationRail(props: {
  readonly group: PrototypeGroup;
  readonly variant: PrototypeVariant;
  readonly viewport: PrototypeViewport;
  readonly mode: PrototypeMode;
  readonly annotations: readonly PrototypeAnnotation[];
  readonly onStartAnnotate: () => void;
  readonly layout?: "card" | "studio" | "sheet" | undefined;
  readonly onClose?: (() => void) | undefined;
}) {
  const copy = useDockCopy();
  const { group, variant, viewport } = props;
  const layout = props.layout ?? "card";
  const draft = usePrototypeStore((state) =>
    state.draft !== null &&
    state.draft.groupId === group.id &&
    state.draft.variantId === variant.id &&
    state.draft.viewport === viewport
      ? state.draft
      : null,
  );
  const selectedId = usePrototypeStore((state) => state.selectedAnnotationId);
  const clearAnnotations = usePrototypeStore((state) => state.clearAnnotations);
  const selectAnnotation = usePrototypeStore((state) => state.selectAnnotation);
  const removeAnnotation = usePrototypeStore((state) => state.removeAnnotation);
  const namesVariant = group.variants.length > 1 && variant.key !== null;
  const containerClass =
    layout === "studio"
      ? "flex h-full min-h-0 flex-col bg-card"
      : layout === "sheet"
        ? "flex max-h-[60dvh] min-h-48 flex-col bg-card"
        : "sticky top-2 flex max-h-[calc(100dvh-5rem)] min-h-48 flex-col self-start bg-card";
  return (
    <aside data-prototype-annotation-rail className={containerClass}>
      {layout === "sheet" ? (
        <div
          aria-hidden="true"
          className="mx-auto mt-2 mb-0.5 h-1 w-9 shrink-0 rounded-full bg-border"
        />
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 py-2 text-xs font-semibold">
        <span>{copy.protoRailTitle.replace("{count}", String(props.annotations.length))}</span>
        <div className="flex items-center gap-1">
          {props.annotations.length > 0 ? (
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => clearAnnotations(group.id, variant.id, viewport)}
            >
              {namesVariant ? copy.protoClearVariant : copy.protoClearSingle}
            </Button>
          ) : null}
          {props.onClose !== undefined ? (
            <Button size="xs" variant="ghost-muted" onClick={props.onClose}>
              {copy.protoStudioCloseSheet}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2.5">
        {draft !== null ? <DraftEditor draft={draft} /> : null}
        {props.annotations.length === 0 && draft === null ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-5 text-center text-2xs text-muted-foreground">
            <p>{props.mode === "annotate" ? copy.protoEmptyRail : copy.protoEmptyRailBrowse}</p>
            {props.mode === "browse" ? (
              <Button size="xs" variant="outline" onClick={props.onStartAnnotate}>
                {copy.protoStartAnnotating}
              </Button>
            ) : null}
          </div>
        ) : null}
        {props.annotations.map((annotation, index) => {
          const selected = selectedId === annotation.id;
          return (
            <div key={annotation.id} className="relative shrink-0">
              <button
                type="button"
                data-prototype-annotation
                aria-pressed={selected}
                onClick={() => selectAnnotation(selected ? null : annotation.id)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1 rounded-md border bg-background p-2 pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected ? "border-accent bg-accent/20" : "border-border",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-3xs font-bold",
                      ANNOTATION_PIN[annotation.kind],
                    )}
                  >
                    {index + 1}
                  </span>
                  <Badge size="sm" variant={ANNOTATION_BADGE[annotation.kind]}>
                    {annotationKindLabel(copy, annotation.kind)}
                  </Badge>
                  <span className="truncate text-xs font-semibold">
                    {annotation.shape === "box"
                      ? copy.protoDraftBoxTarget
                      : copy.protoDraftPointTarget}
                  </span>
                </span>
                <span className="text-xs wrap-anywhere text-muted-foreground">
                  {annotation.text}
                </span>
              </button>
              <Button
                size="icon-tiny"
                variant="ghost-muted"
                aria-label={copy.protoDeleteAnnotation}
                className="absolute top-1.5 right-1.5"
                onClick={() => removeAnnotation(annotation.id)}
              >
                <XIcon />
              </Button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
