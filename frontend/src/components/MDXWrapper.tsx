"use client";

import { MDXRemote, type MDXRemoteSerializeResult } from "next-mdx-remote";

export default function MDXWrapper({ serialized }: { serialized: MDXRemoteSerializeResult }) {
  return <MDXRemote {...serialized} />;
}
