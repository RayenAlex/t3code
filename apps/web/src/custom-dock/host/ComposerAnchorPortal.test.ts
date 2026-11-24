import { expect, test } from "vite-plus/test";

import { resolveComposerPlacement } from "./ComposerAnchorPortal";
import type { ComposerPlacement } from "./uiContract";

function placement(anchorPresent: boolean, maximizedAway: boolean): ComposerPlacement {
  return resolveComposerPlacement(true, anchorPresent, maximizedAway);
}

test.each([
  {
    name: "usable composer anchors the bar",
    states: [[true, false]],
    expected: ["anchored"],
  },
  {
    name: "missing composer leaves a floating pill",
    states: [[false, false]],
    expected: ["floating"],
  },
  {
    name: "maximized-away composer leaves a floating pill",
    states: [[true, true]],
    expected: ["floating"],
  },
  {
    name: "removing and restoring the composer detaches and reattaches the bar",
    states: [
      [true, false],
      [false, false],
      [true, false],
    ],
    expected: ["anchored", "floating", "anchored"],
  },
] satisfies {
  name: string;
  states: [boolean, boolean][];
  expected: ComposerPlacement[];
}[])("$name", ({ states, expected }) => {
  expect(states.map(([present, away]) => placement(present, away))).toEqual(expected);
});
