import { EnvironmentId, ProviderInstanceId, type MagpieGlmQuota } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { GlmQuotaSelection } from "./RightRailGlmQuotaSlot";

const instanceId = ProviderInstanceId.make("magpie");
const environmentId = EnvironmentId.make("local-glm");
const remoteId = EnvironmentId.make("remote-glm");
const now = Date.parse("2026-11-25T12:00:00Z");
const binding = { instanceId, origin: "http://127.0.0.1:24819", modelAliases: ["daily"] };
const snapshot: MagpieGlmQuota = {
  status: "ready",
  checkedAt: "2026-11-25T11:58:00Z",
  expiresAt: "2026-11-25T12:13:00Z",
  windows: [
    {
      id: "glm-5h",
      kind: "session",
      label: "5 hours",
      usedPercent: 23,
      resetsAt: "2026-11-25T15:00:00Z",
    },
    {
      id: "glm-weekly",
      kind: "weekly",
      label: "7 days",
      usedPercent: 64,
      resetsAt: "2026-11-28T00:00:00Z",
    },
  ],
};
const glmModel = { instanceId, model: "zhipu/glm-5" };
const prefixedGlmModel = { instanceId, model: "claude-glm-5.3-flashx" };
const labeledGlmModel = { instanceId, model: "anthropic/magpie-7099366880" };
const nonGlmModel = { instanceId, model: "claude-sonnet" };

it("queries only for GLM and drops a late read when the model or environment changes", async () => {
  const late = Promise.withResolvers<MagpieGlmQuota>();
  const read = vi
    .fn<Parameters<typeof GlmQuotaSelection>[0]["read"]>()
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce({ status: "noCard" });
  const props = { environmentId, binding, now, read };
  await using screen = await render(<GlmQuotaSelection {...props} model={nonGlmModel} />);
  const card = screen.getByRole("region", { name: "GLM quota" });
  await expect.element(card).not.toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();

  await screen.rerender(<GlmQuotaSelection {...props} model={glmModel} />);
  await expect.element(card).toBeVisible();
  const signal = read.mock.calls[0]?.[1];
  expect(read).toHaveBeenCalledTimes(1);
  await screen.rerender(<GlmQuotaSelection {...props} model={nonGlmModel} />);
  expect(signal?.aborted).toBe(true);
  late.resolve(snapshot);
  await late.promise;
  await expect.element(card).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);

  await screen.rerender(<GlmQuotaSelection {...props} model={glmModel} />);
  await expect
    .element(screen.getByRole("progressbar", { name: "5-hour" }))
    .toHaveAttribute("aria-valuenow", "77");
  await expect
    .element(screen.getByRole("progressbar", { name: "7-day" }))
    .toHaveAttribute("aria-valuenow", "36");

  await screen.rerender(<GlmQuotaSelection {...props} environmentId={remoteId} model={glmModel} />);
  await expect
    .element(
      screen.getByText(
        "No matching quota card in Magpie’s cache. Check the binding and refresh in Magpie.",
      ),
    )
    .toBeVisible();
  await expect.element(screen.getByRole("progressbar", { name: "5-hour" })).not.toBeInTheDocument();
  expect(read.mock.calls.at(-1)?.[0]).toEqual({ environmentId: remoteId, input: glmModel });
});

it("supports an explicit alias but hides expired quota without a new request", async () => {
  const read = vi.fn<Parameters<typeof GlmQuotaSelection>[0]["read"]>().mockResolvedValue(snapshot);
  const props = { environmentId, binding, read, model: { instanceId, model: "daily" } };
  await using screen = await render(
    <div className="w-64">
      <GlmQuotaSelection {...props} now={now} />
    </div>,
  );
  await expect.element(screen.getByText("77% left")).toBeVisible();
  await expect
    .element(screen.getByRole("progressbar", { name: "5-hour" }))
    .toHaveAttribute("aria-valuenow", "77");
  await screen.rerender(
    <div className="w-64">
      <GlmQuotaSelection {...props} now={Date.parse("2026-11-25T12:13:00Z")} />
    </div>,
  );
  await expect
    .element(screen.getByText("Quota cannot be confirmed. Refresh in Magpie first."))
    .toBeVisible();
  await expect.element(screen.getByRole("progressbar", { name: "5-hour" })).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);
  await screen.getByRole("button", { name: "Read Magpie cache again" }).click();
  expect(read).toHaveBeenCalledTimes(2);
  await screen.rerender(
    <div className="w-64">
      <GlmQuotaSelection {...props} model={prefixedGlmModel} now={now} />
    </div>,
  );
  await expect.element(screen.getByText("77% left")).toBeVisible();
  expect(read).toHaveBeenCalledTimes(3);
  expect(read.mock.calls.at(-1)?.[0]).toEqual({ environmentId, input: prefixedGlmModel });
  await screen.rerender(
    <div className="w-64">
      <GlmQuotaSelection
        {...props}
        model={labeledGlmModel}
        modelName="GLM-5.4 · Zhipu GLM"
        now={now}
      />
    </div>,
  );
  await expect.element(screen.getByText("77% left")).toBeVisible();
  expect(read).toHaveBeenCalledTimes(4);
  expect(read.mock.calls.at(-1)?.[0]).toEqual({ environmentId, input: labeledGlmModel });
});
