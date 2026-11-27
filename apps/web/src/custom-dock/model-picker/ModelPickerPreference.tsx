import { useStore } from "zustand";

import { Checkbox } from "../../components/ui/checkbox";
import { dockPreferences } from "../host/panelContext";
import { useModelPickerCopy } from "./copy";

export function ModelPickerPreference() {
  const enabled = useStore(dockPreferences, (state) => state.composerModelPickerEnabled);
  const copy = useModelPickerCopy();
  return (
    <label className="flex items-center gap-2">
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) =>
          dockPreferences.getState().setComposerModelPickerEnabled(checked)
        }
      />
      {copy.preference}
    </label>
  );
}
