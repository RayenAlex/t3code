import type { ThreadStructure, ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2Run, OrchestrationV2RuntimeRequest } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function timestampMs(
  value: DateTime.Utc | string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const ms =
    typeof value === "string"
      ? Date.parse(value)
      : typeof value === "number"
        ? value
        : DateTime.toEpochMillis(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isTerminalRun(run: OrchestrationV2Run): boolean {
  return (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "interrupted" ||
    run.status === "cancelled" ||
    run.status === "rolled_back"
  );
}

export function latestDockRun(projection: ThreadStructure): OrchestrationV2Run | null {
  let latest: OrchestrationV2Run | null = null;
  let active: OrchestrationV2Run | null = null;
  for (const run of projection.runs) {
    if (run.status === "rolled_back") continue;
    if (!latest || run.ordinal >= latest.ordinal) latest = run;
    if (
      !isTerminalRun(run) &&
      (run.status !== "queued" || run.startedAt !== null) &&
      (!active || run.ordinal >= active.ordinal)
    )
      active = run;
  }
  return active ?? latest;
}

export function isHumanRequest(request: OrchestrationV2RuntimeRequest): boolean {
  return request.kind !== "dynamic_tool_call" && request.kind !== "auth_refresh";
}

export function isToolItem(item: ThreadStructureTurnItem): boolean {
  return (
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "file_search" ||
    item.type === "web_search" ||
    item.type === "dynamic_tool"
  );
}
