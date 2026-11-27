import { useLocale } from "gt-react";

const effortLabels = new Map([
  ["none", "无"],
  ["minimal", "最低"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["xhigh", "极高"],
]);

export function useModelPickerCopy() {
  const zh = useLocale().split("-")[0] === "zh";
  return {
    all: zh ? "全部" : "All",
    favorites: zh ? "常用" : "Favorites",
    scrollProvidersLeft: zh ? "向左滚动提供商" : "Scroll providers left",
    scrollProvidersRight: zh ? "向右滚动提供商" : "Scroll providers right",
    permissions: zh ? "访问权限" : "Access permissions",
    preference: zh ? "使用新版模型选择器" : "Use the Custom Dock model picker",
    effort: zh ? "推理强度" : "Reasoning effort",
    levels: (count: number) => (zh ? `${count} 档` : `${count} levels`),
    level: (id: string, label: string) =>
      id === "max" ? (zh ? "最高" : "Maximum") : zh ? (effortLabels.get(id) ?? label) : label,
  };
}
