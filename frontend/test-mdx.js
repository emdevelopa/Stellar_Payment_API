const { serialize } = require("next-mdx-remote/serialize");
const fs = require("fs");

async function check() {
  const remarkGfm = (await import("remark-gfm")).default;
  const rehypePrismPlus = (await import("rehype-prism-plus")).default;

  const raw = fs.readFileSync("./content/docs/api-guide.mdx", "utf8");
  
  function escapeNonCodeBraces(content) {
    const lines = content.split("\n");
    let inFence = false;
    return lines.map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
    }).join("\n");
  }

  const escaped = escapeNonCodeBraces(raw);
  
  try {
    await serialize(escaped, {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          [rehypePrismPlus, { defaultLanguage: "bash", showLineNumbers: false }],
        ],
      },
    });
    console.log("SUCCESS");
  } catch(e) {
    console.error("MDX ERROR:", e);
  }
}

check();
