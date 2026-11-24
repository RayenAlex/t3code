import { Tabs } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";

export function DockTabList(props: ComponentProps<typeof Tabs.List>) {
  return (
    <Tabs.List {...props} className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-muted p-1" />
  );
}

export function DockTab(props: ComponentProps<typeof Tabs.Tab>) {
  return (
    <Tabs.Tab
      {...props}
      className="flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-card data-[active]:text-foreground data-[active]:shadow-xs"
    />
  );
}
