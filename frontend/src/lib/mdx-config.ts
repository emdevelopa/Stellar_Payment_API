import remarkGfm from "remark-gfm";
import rehypePrismPlus from "rehype-prism-plus";

export const mdxOptions = {
  mdxOptions: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypePrismPlus, { defaultLanguage: "bash" }]],
  },
};
