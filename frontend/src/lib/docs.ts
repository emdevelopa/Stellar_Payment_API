import { promises as fs } from "node:fs";
import path from "node:path";
import { serialize } from "next-mdx-remote/serialize";
import { docsManifest } from "@/lib/docs-manifest";

export async function getDocBySlug(slug: string) {
  const entry = docsManifest.find((doc) => doc.slug === slug);
  if (!entry) return null;

  const remarkGfm = (await import("remark-gfm")).default;
  const rehypePrismPlus = (await import("rehype-prism-plus")).default;

  const candidates = [
    entry.filename,
    entry.filename.replace(/\.md$/, ".mdx"),
    entry.filename.replace(/\.mdx$/, ".md"),
  ];

  const docsBaseCandidates = [
    path.join(process.cwd(), "content", "docs"),
    path.join(process.cwd(), "frontend", "content", "docs"),
  ];

  for (const docsBase of docsBaseCandidates) {
    for (const filename of candidates) {
      const filePath = path.join(docsBase, filename);
      try {
        const raw = await fs.readFile(filePath, "utf8");

        // Escape lone curly braces outside code blocks so MDX doesn't treat them as JSX.
        // We replace { and } that are NOT inside backtick fences with their HTML entities.
        const escaped = escapeNonCodeBraces(raw);

        const serialized = await serialize(escaped, {
          mdxOptions: {
            remarkPlugins: [remarkGfm],
            rehypePlugins: [
              [rehypePrismPlus, { defaultLanguage: "bash", showLineNumbers: false }],
            ],
          },
        });
        return { ...entry, serialized, filename };
      } catch {
        // try next candidate path
      }
    }
  }

  console.error(`[docs] Could not load slug: ${slug}`);
  return null;
}

/**
 * Escape { and } that appear outside fenced code blocks.
 * MDX treats bare braces as JSX expressions and throws on them.
 */
function escapeNonCodeBraces(content: string): string {
  const lines = content.split("\n");
  let inFence = false;
  return lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    // Outside code blocks: escape bare { and } so MDX doesn't parse them as JSX
    return line.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
  }).join("\n");
}
