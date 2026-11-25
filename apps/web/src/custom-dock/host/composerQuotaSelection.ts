import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { MagpieGlmQuotaInput, ScopedThreadRef } from "@t3tools/contracts";
import { createStore } from "zustand/vanilla";

const selections = createStore<ReadonlyMap<string, MagpieGlmQuotaInput>>(() => new Map());

export function publishComposerQuotaSelection(
  scope: ScopedThreadRef,
  input: MagpieGlmQuotaInput,
): () => void {
  const key = threadKey(scope);
  selections.setState((current) => new Map(current).set(key, input), true);
  return () => {
    selections.setState(
      (current) =>
        current.get(key) === input
          ? new Map([...current].filter(([entry]) => entry !== key))
          : current,
      true,
    );
  };
}

export const composerQuotaSelections = {
  getState: selections.getState,
  getInitialState: selections.getInitialState,
  subscribe: selections.subscribe,
};
