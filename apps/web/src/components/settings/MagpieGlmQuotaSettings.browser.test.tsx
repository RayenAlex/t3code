import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { MagpieGlmQuotaSettings } from "./MagpieGlmQuotaSettings";

const update = vi.hoisted(() => vi.fn());
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useUpdateEnvironmentSettings: () => update,
}));

it("saves one gateway for both providers without putting a key in the instance environment", async () => {
  await using screen = await render(
    <MagpieGlmQuotaSettings
      environmentId={EnvironmentId.make("local")}
      config={null}
      readOnly={false}
    />,
  );
  const url = screen.getByLabelText("Magpie gateway URL");
  const save = screen.getByRole("button", { name: "Save Magpie settings" });
  await userEvent.fill(url, "https://magpie.example.test/v1");
  await expect.element(save).toBeDisabled();
  await userEvent.fill(url, "https://magpie.example.test");
  await userEvent.fill(
    screen.getByLabelText("GLM model aliases (comma-separated)"),
    " daily , daily, weekly ",
  );
  await userEvent.fill(screen.getByLabelText("Magpie gateway key (if required)"), "fake-test-key");
  await save.click();
  expect(update).toHaveBeenCalledExactlyOnceWith(
    {
      magpieGlmQuota: {
        enabled: true,
        url: "https://magpie.example.test",
        provider: "zhipu",
        user: "",
        kind: "plan",
        modelAliases: ["daily", "weekly"],
        gatewayKey: "fake-test-key",
        revision: expect.any(String),
      },
    },
    expect.objectContaining({ onSaved: expect.any(Function), onFailed: expect.any(Function) }),
  );
});
