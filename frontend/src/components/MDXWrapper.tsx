"use client";

import { MDXRemote, type MDXRemoteSerializeResult } from "next-mdx-remote";
import { FrameworkTab, FrameworkTabs } from "@/components/FrameworkTabs";

export default function MDXWrapper({ serialized }: { serialized: MDXRemoteSerializeResult }) {
  return (
    <MDXRemote
      {...serialized}
      components={{
        FrameworkTabs,
        FrameworkTab,
      }}
    />
  );
}
