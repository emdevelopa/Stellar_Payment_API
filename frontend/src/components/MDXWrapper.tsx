"use client";

import { MDXRemote, type MDXRemoteSerializeResult } from "next-mdx-remote";
import { FrameworkTab, FrameworkTabs } from "@/components/FrameworkTabs";
import DocsCodeBlock from "@/components/DocsCodeBlock";

export default function MDXWrapper({ serialized }: { serialized: MDXRemoteSerializeResult }) {
  return (
    <MDXRemote
      {...serialized}
      components={{
        pre: DocsCodeBlock,
        FrameworkTabs,
        FrameworkTab,
      }}
    />
  );
}
