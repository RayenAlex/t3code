import type { ReactNode } from "react";

import { parseExternalPanelUrl } from "./externalUrl";
import type {
  CustomDockPanelDefinition,
  CustomDockThreadSnapshot,
  ExternalWebPanelConfig,
} from "./types";

const modules = import.meta.glob<{ panelDefinition?: CustomDockPanelDefinition }>(
  "../panels/*.tsx",
  { eager: true },
);
const builtIns = Object.values(modules).flatMap((module) => module.panelDefinition ?? []);

export function resolveDockPanels(
  external: readonly ExternalWebPanelConfig[],
  renderExternal: (config: ExternalWebPanelConfig, snapshot: CustomDockThreadSnapshot) => ReactNode,
  definitions: readonly CustomDockPanelDefinition[] = builtIns,
): readonly CustomDockPanelDefinition[] {
  const panels = new Map<string, CustomDockPanelDefinition>();
  for (const definition of definitions) {
    if (definition.id && !panels.has(definition.id) && typeof definition.renderPanel === "function")
      panels.set(definition.id, definition);
  }
  for (const config of external) {
    if (!config.id || panels.has(config.id) || !parseExternalPanelUrl(config.url)) continue;
    panels.set(config.id, {
      id: config.id,
      title: config.title,
      icon: "globe",
      order: 100,
      renderPanel: (snapshot) => renderExternal(config, snapshot),
    });
  }
  return [...panels.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
