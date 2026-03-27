import { promises as fs } from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { docsManifest } from "@/lib/docs-manifest";

marked.setOptions({
  gfm: true,
});

export async function getDocBySlug(slug: string) {
  const entry = docsManifest.find((doc) => doc.slug === slug);

  if (!entry) {
    return null;
  }

  const filePath = path.join(process.cwd(), "content", "docs", entry.filename);
  const markdown = await fs.readFile(filePath, "utf8");
  const html = await marked.parse(markdown);

  return {
    ...entry,
    markdown,
    html,
  };
}
