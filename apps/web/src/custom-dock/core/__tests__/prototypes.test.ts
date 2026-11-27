import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  annotationGeometry,
  clampStudioZoom,
  collectPrototypeGroups,
  fitPrototypePage,
  fitStudioPage,
  formatAnnotationArea,
  parsePrototypeTitle,
  prototypeGroupForRow,
  STUDIO_ZOOM_FIT_MAX,
} from "../prototypes";

function renderItem(input: {
  readonly id: string;
  readonly runId: string;
  readonly title: string;
  readonly toolName?: string;
}) {
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: "thread-1",
    sourceItemId: input.id,
    item: {
      type: "dynamic_tool",
      status: "completed",
      id: input.id,
      runId: input.runId,
      toolName: input.toolName ?? "mcp__t3-code__html_render",
      output: {
        htmlRender: { attachmentId: `${input.id}-html`, title: input.title, height: 600 },
        message: "Rendered.",
      },
    },
  } as unknown as OrchestrationV2ProjectedTurnItem;
}

const bare = { attachmentId: "bare-html", title: "[Prototype] Settings nav", height: 600 };
const variantTitles = [
  renderItem({ id: "a", runId: "run-1", title: "[Prototype:A] 设置页导航重构: 左侧分组导航" }),
  renderItem({ id: "chart", runId: "run-1", title: "Token usage chart" }),
  renderItem({ id: "b", runId: "run-1", title: "[prototype:b] 设置页导航重构 - 顶部水平标签" }),
  renderItem({ id: "c", runId: "run-1", title: "[Prototype:C] 设置页导航重构｜搜索卡片总览" }),
];

describe("parsePrototypeTitle", () => {
  it("separates the topic from the variant name and keeps a single prototype whole", () => {
    expect(parsePrototypeTitle("[Prototype] 设置页导航重构")).toEqual({
      key: null,
      topic: "设置页导航重构",
      name: "设置页导航重构",
    });
    expect(parsePrototypeTitle(" [Prototype:A] 设置页导航重构：左侧分组导航 ")).toEqual({
      key: "A",
      topic: "设置页导航重构",
      name: "左侧分组导航",
    });
    expect(parsePrototypeTitle("[Prototype:A] Sidebar nav")).toEqual({
      key: "A",
      topic: "",
      name: "Sidebar nav",
    });
  });

  it("leaves ordinary renders alone", () => {
    expect(parsePrototypeTitle("Token usage chart")).toBeNull();
    expect(parsePrototypeTitle("Prototype draft")).toBeNull();
  });
});

describe("collectPrototypeGroups", () => {
  it("groups one run's variants under their topic and lets only the first row render them", () => {
    const groups = collectPrototypeGroups(variantTitles);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group?.topic).toBe("设置页导航重构");
    expect(group?.variants.map((variant) => [variant.key, variant.name])).toEqual([
      ["A", "左侧分组导航"],
      ["B", "顶部水平标签"],
      ["C", "搜索卡片总览"],
    ]);
    expect(group?.variants.map((variant) => variant.id)).toEqual(["a", "b", "c"]);

    expect(prototypeGroupForRow(groups, { id: "a", htmlRender: bare })).toBe(group);
    expect(prototypeGroupForRow(groups, { id: "b", htmlRender: bare })).toBeNull();
    expect(prototypeGroupForRow(groups, { id: "c", htmlRender: bare })).toBeNull();
  });

  it("stands on its own when the thread's other items are not at hand", () => {
    const htmlRender = {
      attachmentId: "x-html",
      title: "[Prototype:A] Sidebar nav",
      height: 600,
    };
    const lone = prototypeGroupForRow([], { id: "x", htmlRender });
    expect(lone).toEqual({
      id: "x",
      topic: "Sidebar nav",
      variants: [{ id: "x", key: "A", name: "Sidebar nav", htmlRender }],
    });
  });

  it("keeps each round apart, so an earlier design stays reviewable", () => {
    const secondRound = renderItem({
      id: "v2-a",
      runId: "run-2",
      title: "[Prototype:A] 设置页导航重构: 顶部搜索 + 分组导航",
    });
    const groups = collectPrototypeGroups([...variantTitles, secondRound]);
    expect(groups.map((group) => [group.topic, group.variants.length])).toEqual([
      ["设置页导航重构", 3],
      ["设置页导航重构", 1],
    ]);
    expect(prototypeGroupForRow(groups, { id: "v2-a", htmlRender: bare })).toBe(groups[1]);
  });

  it("leaves a variant group without a topic untitled and a lone prototype single", () => {
    const groups = collectPrototypeGroups([
      renderItem({ id: "x", runId: "run-3", title: "[Prototype:A] Sidebar nav" }),
      renderItem({ id: "y", runId: "run-3", title: "[Prototype:B] Top tabs" }),
      renderItem({ id: "s", runId: "run-4", title: "[Prototype] Billing page" }),
    ]);
    expect(groups.map((group) => [group.topic, group.variants.length])).toEqual([
      ["", 2],
      ["Billing page", 1],
    ]);
  });
});

describe("annotationGeometry", () => {
  const page = { width: 728, height: 1000 };

  it("turns a drag into the page-percent region it covered", () => {
    const mark = annotationGeometry({ x: 100, y: 100 }, { x: 300, y: 400 }, page);
    expect(mark.shape).toBe("box");
    expect(mark.box.x).toBeCloseTo((100 / 728) * 100);
    expect(mark.box.y).toBeCloseTo(10);
    expect(mark.box.w).toBeCloseTo((200 / 728) * 100);
    expect(mark.box.h).toBeCloseTo(30);
    expect(mark.pin).toEqual({ x: mark.box.x + mark.box.w, y: mark.box.y });
  });

  it("turns a click into a point with a small region around it", () => {
    const mark = annotationGeometry({ x: 364, y: 500 }, { x: 370, y: 504 }, page);
    expect(mark.shape).toBe("point");
    expect(mark.pin.x).toBeCloseTo(50);
    expect(mark.pin.y).toBeCloseTo(50);
    expect(mark.box).toEqual({ x: 43, y: 45.5, w: 14, h: 9 });
  });

  it("keeps a drag that ends outside the page inside it", () => {
    const mark = annotationGeometry({ x: 700, y: 980 }, { x: 5000, y: 5000 }, page);
    expect(mark.box.x + mark.box.w).toBeCloseTo(100);
    expect(mark.box.y + mark.box.h).toBeCloseTo(100);
    expect(mark.pin.x).toBe(96);
  });
});

describe("formatAnnotationArea", () => {
  it("describes a region by its edges and a point by its centre", () => {
    expect(
      formatAnnotationArea({
        shape: "box",
        box: { x: 2.4, y: 4, w: 24.6, h: 86 },
        pin: { x: 27, y: 4 },
      }),
    ).toBe("x 2% to 27%, y 4% to 90%");
    expect(
      formatAnnotationArea({
        shape: "point",
        box: { x: 43, y: 45.5, w: 14, h: 9 },
        pin: { x: 50, y: 50 },
      }),
    ).toBe("x 50%, y 50%");
  });
});

describe("fitPrototypePage", () => {
  it("lays a desktop page out at reply width and scales it into a narrow column", () => {
    expect(fitPrototypePage("desktop", 450)).toEqual({ width: 728, scale: 450 / 728 });
    expect(fitPrototypePage("desktop", 1100)).toEqual({ width: 1100, scale: 1 });
    expect(fitPrototypePage("desktop", 1800)).toEqual({ width: 1280, scale: 1 });
  });

  it("keeps tablet and mobile at their device widths", () => {
    expect(fitPrototypePage("mobile", 450)).toEqual({ width: 390, scale: 1 });
    expect(fitPrototypePage("tablet", 450)).toEqual({ width: 768, scale: 450 / 768 });
  });
});

describe("fitStudioPage", () => {
  it("enlarges device-width pages in fit mode to fill large screens up to the fit cap", () => {
    const tablet = fitStudioPage({
      viewport: "tablet",
      availableWidth: 1400,
      availableHeight: 840,
      pageHeight: 560,
      zoomMode: "fit",
      manualZoom: 1,
    });
    expect(tablet.width).toBe(768);
    expect(tablet.scale).toBeCloseTo(1.5);

    const mobile = fitStudioPage({
      viewport: "mobile",
      availableWidth: 1400,
      availableHeight: 1200,
      pageHeight: 500,
      zoomMode: "fit",
      manualZoom: 1,
    });
    expect(mobile.width).toBe(390);
    expect(mobile.scale).toBe(STUDIO_ZOOM_FIT_MAX);
  });

  it("never shrinks a tall page below 100% when the width already fits", () => {
    const tall = fitStudioPage({
      viewport: "desktop",
      availableWidth: 1200,
      availableHeight: 700,
      pageHeight: 1800,
      zoomMode: "fit",
      manualZoom: 1,
    });
    expect(tall.width).toBe(960);
    expect(tall.scale).toBe(1);
  });

  it("scales down on narrow screens and clamps manual zoom", () => {
    const narrow = fitStudioPage({
      viewport: "tablet",
      availableWidth: 384,
      availableHeight: 600,
      pageHeight: 500,
      zoomMode: "fit",
      manualZoom: 1,
    });
    expect(narrow).toEqual({ width: 768, scale: 0.5 });

    const manual = fitStudioPage({
      viewport: "tablet",
      availableWidth: 1200,
      availableHeight: 700,
      pageHeight: 500,
      zoomMode: "manual",
      manualZoom: 3.5,
    });
    expect(manual).toEqual({ width: 768, scale: 2 });
    expect(clampStudioZoom(0.1)).toBe(0.5);
  });
});
