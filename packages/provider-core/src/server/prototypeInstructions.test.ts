import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_ORCHESTRATION_SECTIONS,
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";
import { T3_PROTOTYPE_INSTRUCTIONS } from "./prototypeInstructions.ts";

describe("UI prototype instructions", () => {
  it("ride every path that delivers the orchestration sections", () => {
    // The prompt paths trim the joined text, and Codex sends the sections one entry each.
    const text = T3_PROTOTYPE_INSTRUCTIONS.trim();
    assert.include(T3_CODE_ORCHESTRATION_SECTIONS, T3_PROTOTYPE_INSTRUCTIONS);
    assert.include(t3OrchestrationSystemPrompt(true, false), text);
    assert.include(
      t3OrchestrationPrompt({
        prompt: "Redo the settings page.",
        hasT3Mcp: true,
        hasDeviceTools: false,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      }),
      text,
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt: "Redo the settings page.",
        state: { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false },
      }),
      text,
    );
  });
});
