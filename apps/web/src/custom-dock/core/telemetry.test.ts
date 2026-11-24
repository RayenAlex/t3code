import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2Run } from "@t3tools/contracts";
import { expect, test } from "vite-plus/test";

import { deriveRunTelemetry } from "./telemetry";

const at = (ms: number) => new Date(ms).toISOString();

const measure = (fields: Record<string, unknown>, now: number) => {
  const run = {
    id: "run-public",
    ordinal: 1,
    requestedAt: at(1000),
    startedAt: at(1500),
    status: "running",
    ...fields,
  } as unknown as OrchestrationV2Run;
  const projection = {
    runs: [run],
    attempts: [],
    turns: [],
  } as unknown as ThreadStructure;
  return deriveRunTelemetry(projection, run, now);
};

test.each([
  {
    name: "started work without a separate work timestamp",
    fields: {},
    now: 4000,
    elapsedMs: 2500,
    status: "pending",
  },
  {
    name: "separate work timestamp leaves queue unchanged",
    fields: { workStartedAt: at(2000) },
    now: 4000,
    elapsedMs: 2000,
    status: "pending",
  },
  {
    name: "terminal run freezes and has no usage report",
    fields: { status: "completed", workStartedAt: at(2000), completedAt: at(12000) },
    now: 45000,
    elapsedMs: 10000,
    status: "unavailable",
  },
  {
    name: "terminal run without a completion timestamp does not tick",
    fields: { status: "failed" },
    now: 45000,
    elapsedMs: null,
    status: "unavailable",
  },
])("$name", ({ fields, now, elapsedMs, status }) => {
  const telemetry = measure(fields, now);
  expect(telemetry).toMatchObject({
    queueMs: 500,
    status,
    cacheHitRate: null,
    turnAvgOutputTps: null,
    activeOutputTps: null,
  });
  if (elapsedMs === null) {
    expect(telemetry.elapsedMs).toBe(measure(fields, now + 60000).elapsedMs);
  } else {
    expect(telemetry.elapsedMs).toBe(elapsedMs);
  }
});
