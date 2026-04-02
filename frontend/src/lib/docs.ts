import { promises as fs } from "node:fs";
import path from "node:path";
import { serialize } from "next-mdx-remote/serialize";
import { docsManifest } from "@/lib/docs-manifest";

export async function getDocBySlug(slug: string) {
  const entry = docsManifest.find((doc) => doc.slug === slug);

  if (!entry) {
    return null;
  }

  // Dynamic imports for ESM-only packages
  const remarkGfm = (await import("remark-gfm")).default;
  const rehypePrismPlus = (await import("rehype-prism-plus")).default;

  // Try the filename as-is first, then with .mdx extension
  const candidates = [
    entry.filename,
    entry.filename.endsWith(".mdx") ? entry.filename : entry.filename.replace(/\.md$/, ".mdx"),
    entry.filename.replace(/\.mdx$/, ".md"),
  ];

  for (const filename of candidates) {
    const filePath = path.join(process.cwd(), "content", "docs", filename);
    try {
      const mdxContent = await fs.readFile(filePath, "utf8");
      const serialized = await serialize(mdxContent, {
        mdxOptions: {
          remarkPlugins: [remarkGfm],
          rehypePlugins: [
            [rehypePrismPlus, { defaultLanguage: "bash", showLineNumbers: false }],
          ],
        },
      });
      return { ...entry, serialized, filename };
    } catch (err) {
      console.error(`[docs] Failed to serialize ${filename}:`, err);
      // try next candidate
    }
  }

  console.error(`Could not find doc file for slug: ${slug}. Tried: ${candidates.join(", ")}`);
  return null;
}
