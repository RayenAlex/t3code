import { expect, it } from "vite-plus/test";

import { computeRightRailGeometry } from "./RightRailTaskSlot";

function element(metrics: {
  readonly offsetTop?: number;
  readonly offsetHeight?: number;
  readonly offsetLeft?: number;
  readonly offsetWidth?: number;
  readonly clientWidth?: number;
  readonly clientHeight?: number;
  readonly right?: string;
}): HTMLElement {
  return {
    offsetTop: metrics.offsetTop ?? 0,
    offsetHeight: metrics.offsetHeight ?? 0,
    offsetLeft: metrics.offsetLeft ?? 0,
    offsetWidth: metrics.offsetWidth ?? 0,
    clientWidth: metrics.clientWidth ?? 0,
    clientHeight: metrics.clientHeight ?? 0,
    style: { right: metrics.right ?? "" },
  } as unknown as HTMLElement;
}

it("places the task card directly below ThreadDetailsCard using matching width and right inset", () => {
  const container = element({ clientWidth: 1200, clientHeight: 820 });
  const detailsCard = element({
    offsetTop: 16,
    offsetHeight: 280,
    offsetWidth: 280,
    offsetLeft: 904,
    right: "16px",
  });
  expect(computeRightRailGeometry(detailsCard, container)).toEqual({
    container,
    right: 16,
    top: 308,
    width: 280,
    maxHeight: 496,
  });
});

it("falls back to null when vertical room or card width is too small", () => {
  const shortContainer = element({ clientWidth: 1200, clientHeight: 400 });
  const detailsCard = element({
    offsetTop: 16,
    offsetHeight: 280,
    offsetWidth: 280,
    right: "16px",
  });
  expect(computeRightRailGeometry(detailsCard, shortContainer)).toBeNull();

  const narrowCard = element({ offsetTop: 16, offsetHeight: 200, offsetWidth: 120, right: "16px" });
  expect(
    computeRightRailGeometry(narrowCard, element({ clientWidth: 1200, clientHeight: 900 })),
  ).toBeNull();
});
