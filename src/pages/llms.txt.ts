import type { APIRoute } from "astro";

import { AUTHOR, SITE } from "../config";
import { formatDate } from "../utils/date";
import { collectTags, getPublishedPosts } from "../utils/posts";

/**
 * https://llmstxt.org — a plain-text index of the site for language models,
 * built from the same collection that drives the pages.
 */
export const GET: APIRoute = async ({ site }) => {
  const posts = await getPublishedPosts();
  const tags = collectTags(posts);
  const absolute = (path: string) => new URL(path, site).href;

  const lines = [
    `# ${SITE.title}`,
    "",
    `> ${SITE.description}`,
    "",
    `作者：${AUTHOR.name}（${AUTHOR.url}）。`,
    "",
    "## 文章",
    "",
    ...posts.map(
      (post) =>
        `- [${post.data.title}](${absolute(`/blog/${post.id}/`)}): ${
          post.data.description
        } 发布于 ${formatDate(post.data.pubDate)}。`,
    ),
    "",
    "## 页面",
    "",
    `- [文章](${absolute("/blog/")}): 全部文章，最新在前。`,
    `- [标签](${absolute("/tags/")}): ${tags.map((t) => t.name).join("、")}。`,
    `- [关于](${absolute("/about/")}): 关于作者与本站。`,
    "",
    "## 订阅",
    "",
    `- [RSS](${absolute("/rss.xml")})`,
    `- [Sitemap](${absolute("/sitemap-index.xml")})`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
