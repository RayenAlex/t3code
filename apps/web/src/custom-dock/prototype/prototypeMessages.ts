import type { ScopedThreadRef } from "@t3tools/contracts";

import { readComposerDraftPrompt, useComposerDraftStore } from "../../composerDraftStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import en from "../copy/en.json";
import zh from "../copy/zh.json";
import type {
  AnnotationKind,
  PrototypeAnnotation,
  PrototypeGroup,
  PrototypeViewport,
} from "../core/prototypes";
import { formatAnnotationArea } from "../core/prototypes";

export type PrototypeCopy = typeof en;

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

const KIND_COPY = {
  inaccurate: "protoKindInaccurate",
  replace: "protoKindReplace",
  layout: "protoKindLayout",
} as const satisfies Record<AnnotationKind, keyof PrototypeCopy>;

const VIEWPORT_COPY = {
  desktop: "protoViewportDesktop",
  tablet: "protoViewportTablet",
  mobile: "protoViewportMobile",
} as const satisfies Record<PrototypeViewport, keyof PrototypeCopy>;

export function annotationKindLabel(copy: PrototypeCopy, kind: AnnotationKind): string {
  return copy[KIND_COPY[kind]];
}

export function prototypeViewportLabel(copy: PrototypeCopy, viewport: PrototypeViewport): string {
  return copy[VIEWPORT_COPY[viewport]];
}

/** The letter a decision names the variant by; a lone prototype needs none. */
function variantKey(group: PrototypeGroup, key: string | null): string | null {
  return key !== null && group.variants.length > 1 ? key : null;
}

function topicLabel(copy: PrototypeCopy, group: PrototypeGroup): string {
  return group.topic || copy.protoUntitled;
}

function decision(
  copy: PrototypeCopy,
  group: PrototypeGroup,
  variantId: string,
  templates: readonly [single: string, variant: string],
): string {
  const variant = group.variants.find((candidate) => candidate.id === variantId);
  if (variant === undefined) return "";
  const topic = topicLabel(copy, group);
  const key = variantKey(group, variant.key);
  return key === null
    ? fill(templates[0], { topic })
    : fill(templates[1], { topic, key, name: variant.name });
}

export function prototypeAdoptMessage(
  copy: PrototypeCopy,
  group: PrototypeGroup,
  variantId: string,
): string {
  return decision(copy, group, variantId, [copy.protoMsgAdoptSingle, copy.protoMsgAdoptVariant]);
}

export function prototypeAdjustMessage(
  copy: PrototypeCopy,
  group: PrototypeGroup,
  variantId: string,
): string {
  return decision(copy, group, variantId, [copy.protoMsgAdjustSingle, copy.protoMsgAdjustVariant]);
}

export function prototypeFeedbackMessage(
  copy: PrototypeCopy,
  group: PrototypeGroup,
  annotations: readonly PrototypeAnnotation[],
): string {
  const lines = annotations.map((annotation, index) => {
    const values = {
      index: index + 1,
      kind: annotationKindLabel(copy, annotation.kind),
      viewport: prototypeViewportLabel(copy, annotation.viewport),
      area: formatAnnotationArea(annotation),
      text: annotation.text,
    };
    const marked = group.variants.find((variant) => variant.id === annotation.variantId);
    const key = variantKey(group, marked?.key ?? null);
    return key === null
      ? fill(copy.protoMsgLineSingle, values)
      : fill(copy.protoMsgLineVariant, { ...values, key });
  });
  return fill(copy.protoMsgFeedback, {
    topic: topicLabel(copy, group),
    lines: lines.join("\n"),
  });
}

/** A leading composer line that asks for a prototype first, or for none, this turn. */
export type PrototypeDirective = "first" | "skip";

const DIRECTIVES: ReadonlyArray<{ readonly id: PrototypeDirective; readonly text: string }> = [
  { id: "first", text: zh.protoDirectiveFirst },
  { id: "first", text: en.protoDirectiveFirst },
  { id: "skip", text: zh.protoDirectiveSkip },
  { id: "skip", text: en.protoDirectiveSkip },
];

export function readPrototypeDirective(prompt: string): PrototypeDirective | null {
  const firstLine = prompt.split("\n", 1)[0]?.trim() ?? "";
  return DIRECTIVES.find((directive) => directive.text === firstLine)?.id ?? null;
}

/** Rewrites the draft's leading directive line; `null` removes it so the model's default applies. */
export function withPrototypeDirective(
  prompt: string,
  directive: PrototypeDirective | null,
  text: string,
): string {
  const [firstLine = "", ...rest] = prompt.split("\n");
  const body = DIRECTIVES.some((entry) => entry.text === firstLine.trim())
    ? rest.join("\n")
    : prompt;
  return directive === null ? body : `${text}\n${body}`;
}

/**
 * Puts a decision in the composer for the user to send. Text already being written stays above
 * it; a pending turn directive goes, since the decision says what this turn should do.
 */
export function stagePrototypeMessage(scope: ScopedThreadRef, message: string): void {
  const current = withPrototypeDirective(readComposerDraftPrompt(scope) ?? "", null, "").trim();
  useComposerDraftStore.getState().setPrompt(scope, current ? `${current}\n\n${message}` : message);
  dispatchSnapShotComposerFocus();
}

/** Sets the draft's leading turn directive, then brings the composer forward. */
export function stagePrototypeDirective(
  scope: ScopedThreadRef,
  directive: PrototypeDirective | null,
  text: string,
): void {
  useComposerDraftStore
    .getState()
    .setPrompt(
      scope,
      withPrototypeDirective(readComposerDraftPrompt(scope) ?? "", directive, text),
    );
  dispatchSnapShotComposerFocus();
}
