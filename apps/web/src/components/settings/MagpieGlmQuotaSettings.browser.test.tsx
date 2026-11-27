import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import stylesheet from "~/index.css?inline";
import { render } from "../../../test/render";
import { MagpieGlmQuotaSettings } from "./MagpieGlmQuotaSettings";

const update = vi.hoisted(() => vi.fn());
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useUpdateEnvironmentSettings: () => update,
}));

it("saves one gateway for both providers without putting a key in the instance environment", async () => {
  const style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.append(style);
  using _style = { [Symbol.dispose]: () => style.remove() };
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
  await screen.getByRole("switch", { name: "Show GPT quota" }).click();
  const route = screen.getByLabelText("GPT proxy origin (optional)");
  await userEvent.fill(route, "http://127.0.0.1:15722/v1");
  await expect.element(save).toBeDisabled();
  await userEvent.fill(route, "http://127.0.0.1:15722/");
  await userEvent.fill(screen.getByLabelText("Magpie GPT provider ID (optional)"), " cpa ");
  await userEvent.fill(
    screen.getByLabelText("GPT account name in Magpie (optional)"),
    " work-codex ",
  );
  await userEvent.fill(
    screen.getByLabelText("GPT model aliases (comma-separated)"),
    " daily-gpt, daily-gpt ",
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
        gpt: {
          enabled: true,
          provider: "cpa",
          user: "work-codex",
          modelAliases: ["daily-gpt"],
          routeOrigin: "http://127.0.0.1:15722",
        },
        gatewayKey: "fake-test-key",
        revision: expect.any(String),
      },
    },
    expect.objectContaining({ onSaved: expect.any(Function), onFailed: expect.any(Function) }),
  );
});
