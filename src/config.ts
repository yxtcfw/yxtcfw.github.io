/**
 * Sumi — site configuration
 *
 * This is the only file you need to edit to make the theme yours. Everything
 * else reads from here: metadata, navigation, feeds and OG images.
 */

export interface NavItem {
  label: string;
  href: string;
}

export interface SocialLink {
  /** Shown as the link text, so keep it short. */
  label: string;
  href: string;
}

export const SITE = {
  /** Absolute origin of the deployed site. No trailing slash. */
  url: "https://yxtcfw.github.io",
  title: "宇轩同创",
  /**
   * Short Japanese mark used for the vertical rail and the loading screen.
   * Set to an empty string to drop the Japanese accents entirely.
   */
  titleMark: "宇轩",
  tagline: "小道消息藏机遇，AI 创作更省力。同创共享好工具，财富自由等着你。",
  description:
    "小道消息藏机遇，AI 创作更省力。同创共享好工具，财富自由等着你。",
  /** BCP 47 language tag, written to <html lang>. */
  lang: "zh-CN",
  /** Used for og:locale. */
  locale: "zh_CN",
  /** Fallback OG image, relative to public/. Used for pages without one. */
  defaultOgImage: "/og-default.png",
} as const;

export const AUTHOR = {
  name: "宇轩同创",
  url: "https://github.com/yxtcfw",
  /** One or two sentences. Shown on /about and in structured data. */
  bio: "小道消息藏机遇，AI 创作更省力。同创共享好工具，财富自由等着你。",
} as const;

export const NAV: NavItem[] = [
  { label: "文章", href: "/blog" },
  { label: "标签", href: "/tags" },
  { label: "关于", href: "/about" },
];

export const SOCIAL: SocialLink[] = [
  { label: "GitHub", href: "https://github.com/yxtcfw/yxtcfw.github.io" },
];

export const BLOG = {
  /**
   * Posts per page on /blog and the tag archives. Deliberately low so that the
   * bundled sample posts spill onto a second page; 8–12 suits a real archive.
   */
  postsPerPage: 4,
  /** Latest posts shown on the home page. */
  postsOnHome: 4,
  /** Estimated reading speed used for the "N min read" label. */
  wordsPerMinute: 220,
  showReadingTime: true,
  /** Render the table of contents on article pages. */
  showTableOfContents: true,
  /** Minimum number of headings before the table of contents appears. */
  tocMinHeadings: 3,
} as const;

/**
 * Rumours shown at the top of every article body.
 * Items are parsed from the specified markdown file's body.
 */
export const XIAODAO = {
  /** Path relative to the project root. */
  source: "src/content/xiaodao.md",
  /** How many items to show before the rest is folded. */
  previewCount: 3,
} as const;

/** Generate a per-article OG image at build time with satori. */
export const OG = {
  enabled: true,
  width: 1200,
  height: 630,
} as const;
