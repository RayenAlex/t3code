import { describe, expect, it } from "vite-plus/test";

import en from "../copy/en.json";
import type { PrototypeGroup } from "../core/prototypes";
import {
  prototypeAdoptMessage,
  prototypeFeedbackMessage,
  readPrototypeDirective,
  withPrototypeDirective,
} from "./prototypeMessages";

const group: PrototypeGroup = {
  id: "run-1:Settings nav",
  topic: "Settings nav",
  variants: [
    {
      id: "a",
      key: "A",
      name: "Sidebar nav",
      htmlRender: {
        attachmentId: "a-html",
        title: "[Prototype:A] Settings nav: Sidebar nav",
        height: 600,
      },
    },
    {
      id: "b",
      key: "B",
      name: "Top tabs",
      htmlRender: {
        attachmentId: "b-html",
        title: "[Prototype:B] Settings nav: Top tabs",
        height: 600,
      },
    },
  ],
};

const annotation = (id: number, variantId: string) => ({
  id,
  groupId: group.id,
  variantId,
  viewport: "desktop" as const,
  kind: "replace" as const,
  shape: "box" as const,
  box: { x: 2.4, y: 4, w: 24.6, h: 86 },
  pin: { x: 27, y: 4 },
  text: "Merge the two groups {here}.",
});

describe("prototype messages", () => {
  it("name the chosen variant and leave a lone prototype unlettered", () => {
    expect(prototypeAdoptMessage(en, group, "b")).toBe(
      "[Prototype decision · Settings nav]\nThe user approved variant B (Top tabs). Build the real feature code with this structure and layout.",
    );
    const single: PrototypeGroup = { ...group, topic: "", variants: [group.variants[1]!] };
    expect(prototypeAdoptMessage(en, single, "b")).toBe(
      "[Prototype decision · Prototype]\nThe user approved this prototype. Build the real feature code with its structure and layout.",
    );
    expect(prototypeAdoptMessage(en, group, "missing")).toBe("");
  });

  it("list each mark with its variant, kind, viewport and page region", () => {
    const message = prototypeFeedbackMessage(en, group, [annotation(1, "b"), annotation(2, "a")]);
    expect(message.split("\n")).toEqual([
      "[Prototype feedback · Settings nav]",
      "Revise the prototype from these marked regions and publish the next round; do not edit feature code yet:",
      "1. [Variant B · Replace · Desktop] Region x 2% to 27%, y 4% to 90%: Merge the two groups {here}.",
      "2. [Variant A · Replace · Desktop] Region x 2% to 27%, y 4% to 90%: Merge the two groups {here}.",
    ]);
  });

  it("keep one leading turn directive in the composer and swap or remove it", () => {
    const first = "(Show a prototype first this turn; don't edit code yet.)";
    const skip = "(Skip the prototype this turn and edit code directly.)";
    const draft = withPrototypeDirective("Redo the nav", "first", first);
    expect(draft).toBe(`${first}\nRedo the nav`);
    expect(readPrototypeDirective(draft)).toBe("first");
    expect(withPrototypeDirective(draft, "skip", skip)).toBe(`${skip}\nRedo the nav`);
    expect(withPrototypeDirective(draft, null, skip)).toBe("Redo the nav");
    expect(readPrototypeDirective("Redo the nav")).toBeNull();
  });
});
