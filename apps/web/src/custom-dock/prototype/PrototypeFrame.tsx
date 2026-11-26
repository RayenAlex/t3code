import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { htmlRenderFileName, type HtmlRenderReference } from "@t3tools/shared/htmlRender";
import { useState } from "react";

import { useLongLivedAssetUrl } from "../../assets/longLivedAssetUrls";
import { HtmlRenderDocument } from "../../components/files/BrowserDocumentFrame";
import { useDockCopy } from "../host/panelContext";

/** One prototype page in T3's sandboxed HTML frame, at the size its parent gives it. */
export function PrototypeFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly onContentHeight: (height: number) => void;
}) {
  const copy = useDockCopy();
  const { attachmentId, title } = props.htmlRender;
  // The frame keeps the first URL it loads, so a grant that expires never reloads the page.
  const [loaded, setLoaded] = useState<{ readonly src: string } | null>(null);
  const assetUrl = useLongLivedAssetUrl(loaded === null ? props.environmentId : null, {
    _tag: "attachment",
    attachmentId,
    fileName: htmlRenderFileName(title),
    mimeType: "text/html",
    disposition: "inline",
  });
  if (loaded === null && assetUrl._tag === "Success") setLoaded({ src: assetUrl.url });
  if (loaded !== null) {
    return (
      <HtmlRenderDocument
        src={loaded.src}
        title={title}
        threadRef={props.threadRef}
        className="block size-full"
        containScroll
        onContentHeight={props.onContentHeight}
      />
    );
  }
  return assetUrl._tag === "Failure" ? (
    <p className="flex size-full items-center justify-center p-4 text-center text-muted-foreground text-xs">
      {copy.protoLoadFailed}
    </p>
  ) : null;
}
