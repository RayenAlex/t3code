import { createContext, createElement, use, type ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type {
  AnnotationKind,
  AnnotationMark,
  PrototypeAnnotation,
  PrototypeViewport,
} from "../core/prototypes";

export type PrototypeMode = "annotate" | "browse";

export interface AnnotationDraft extends AnnotationMark {
  readonly groupId: string;
  readonly variantId: string;
  readonly viewport: PrototypeViewport;
  readonly kind: AnnotationKind;
  readonly text: string;
}

export interface PrototypeView {
  readonly mode: PrototypeMode;
  readonly viewport: PrototypeViewport;
}

export interface PrototypeStudioState {
  readonly groupId: string;
  readonly compare: boolean;
}

const DEFAULT_VIEW: PrototypeView = { mode: "browse", viewport: "desktop" };

interface PrototypeState {
  readonly annotations: readonly PrototypeAnnotation[];
  /** One at a time: a draft holds the focus in its rail until saved or cancelled. */
  readonly draft: AnnotationDraft | null;
  readonly selectedAnnotationId: number | null;
  readonly views: Readonly<Record<string, PrototypeView>>;
  readonly selectedVariants: Readonly<Record<string, string>>;
  readonly studio: PrototypeStudioState | null;
  readonly studioViewport: PrototypeViewport;
  /** The variant beside the selected one in the studio's compare view. */
  readonly studioRightId: string | null;
  readonly startDraft: (mark: Omit<AnnotationDraft, "kind" | "text">) => void;
  readonly setDraftKind: (kind: AnnotationKind) => void;
  readonly setDraftText: (text: string) => void;
  readonly cancelDraft: () => void;
  readonly commitDraft: (fallbackText: string) => void;
  readonly removeAnnotation: (id: number) => void;
  readonly clearAnnotations: (
    groupId: string,
    variantId: string,
    viewport: PrototypeViewport,
  ) => void;
  readonly selectAnnotation: (id: number | null) => void;
  readonly setView: (groupId: string, view: Partial<PrototypeView>) => void;
  readonly selectVariant: (groupId: string, variantId: string) => void;
  readonly openStudio: (groupId: string) => void;
  readonly closeStudio: () => void;
  readonly setStudioCompare: (compare: boolean) => void;
  readonly setStudioViewport: (viewport: PrototypeViewport) => void;
  readonly setStudioRightId: (variantId: string | null) => void;
}

export type PrototypeStore = ReturnType<typeof createPrototypeStore>;

/** How a group is being looked at: previewing by default, at desktop width. */
export function readPrototypeView(
  views: Readonly<Record<string, PrototypeView>>,
  groupId: string,
): PrototypeView {
  return views[groupId] ?? DEFAULT_VIEW;
}

export function createPrototypeStore() {
  let nextAnnotationId = 1;
  return createStore<PrototypeState>()((set) => ({
    annotations: [],
    draft: null,
    selectedAnnotationId: null,
    views: {},
    selectedVariants: {},
    studio: null,
    studioViewport: "desktop",
    studioRightId: null,
    startDraft: (mark) =>
      set({
        draft: { ...mark, kind: "inaccurate", text: "" },
        selectedAnnotationId: null,
      }),
    setDraftKind: (kind) =>
      set((state) => (state.draft === null ? state : { draft: { ...state.draft, kind } })),
    setDraftText: (text) =>
      set((state) => (state.draft === null ? state : { draft: { ...state.draft, text } })),
    cancelDraft: () => set({ draft: null }),
    commitDraft: (fallbackText) =>
      set((state) => {
        if (state.draft === null) return state;
        const annotation: PrototypeAnnotation = {
          ...state.draft,
          id: nextAnnotationId++,
          text: state.draft.text.trim() || fallbackText,
        };
        return {
          annotations: [...state.annotations, annotation],
          draft: null,
          selectedAnnotationId: annotation.id,
        };
      }),
    removeAnnotation: (id) =>
      set((state) => ({
        annotations: state.annotations.filter((annotation) => annotation.id !== id),
        selectedAnnotationId: state.selectedAnnotationId === id ? null : state.selectedAnnotationId,
      })),
    clearAnnotations: (groupId, variantId, viewport) =>
      set((state) => ({
        annotations: state.annotations.filter(
          (annotation) =>
            annotation.groupId !== groupId ||
            annotation.variantId !== variantId ||
            annotation.viewport !== viewport,
        ),
        draft:
          state.draft !== null &&
          state.draft.groupId === groupId &&
          state.draft.variantId === variantId
            ? null
            : state.draft,
      })),
    selectAnnotation: (selectedAnnotationId) => set({ selectedAnnotationId }),
    // A draft marks one variant in one viewport, so any other view leaves it behind.
    setView: (groupId, view) =>
      set((state) => ({
        draft: null,
        views: {
          ...state.views,
          [groupId]: { ...(state.views[groupId] ?? DEFAULT_VIEW), ...view },
        },
      })),
    selectVariant: (groupId, variantId) =>
      set((state) => ({
        draft: null,
        selectedVariants: { ...state.selectedVariants, [groupId]: variantId },
      })),
    openStudio: (groupId) => set({ studio: { groupId, compare: false }, studioRightId: null }),
    closeStudio: () => set({ studio: null }),
    setStudioCompare: (compare) =>
      set((state) =>
        state.studio === null
          ? state
          : { studio: { ...state.studio, compare }, studioRightId: null },
      ),
    setStudioViewport: (studioViewport) => set({ studioViewport }),
    setStudioRightId: (studioRightId) => set({ studioRightId }),
  }));
}

const PrototypeStoreContext = createContext<PrototypeStore>(createPrototypeStore());

/** Mounts a feature on its own review state, as tests do to keep them independent. */
export function PrototypeStoreProvider(props: {
  readonly store: PrototypeStore;
  readonly children: ReactNode;
}) {
  return createElement(PrototypeStoreContext, { value: props.store }, props.children);
}

/** Selectors may build arrays: shallow comparison keeps them stable between store changes. */
export function usePrototypeStore<T>(selector: (state: PrototypeState) => T): T {
  return useStore(use(PrototypeStoreContext), useShallow(selector));
}
