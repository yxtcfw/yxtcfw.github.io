import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { XIAODAO } from "../config";

export interface XiaodaoSegment {
  text: string;
  href?: string;
}

export interface XiaodaoItem {
  segments: XiaodaoSegment[];
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function sanitizeHref(href: string): string | undefined {
  const value = href.trim();
  if (!value) return undefined;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("#")) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    return undefined;
  }
  return undefined;
}

export function parseXiaodaoSegments(raw: string): XiaodaoSegment[] {
  const segments: XiaodaoSegment[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw))) {
    if (match.index > last) {
      segments.push({ text: raw.slice(last, match.index) });
    }

    const href = sanitizeHref(match[2]);
    segments.push(href ? { text: match[1], href } : { text: match[1] });
    last = match.index + match[0].length;
  }

  if (last < raw.length) {
    segments.push({ text: raw.slice(last) });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

export function parseXiaodaoItems(body: string): XiaodaoItem[] {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const isList = (line: string) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
  const isHeading = (line: string) => /^\s*#+\s+/.test(line);
  const isFence = (line: string) => /^\s*```/.test(line);

  const listItems: string[] = [];
  let current: string | null = null;
  let inFence = false;

  for (const line of text.split("\n")) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || isHeading(line)) continue;

    if (isList(line)) {
      if (current) listItems.push(current.trim());
      current = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
    } else if (current !== null && line.trim()) {
      current += ` ${line.trim()}`;
    } else if (current !== null) {
      listItems.push(current.trim());
      current = null;
    }
  }

  if (current) listItems.push(current.trim());

  const source = listItems.length
    ? listItems
    : text
        .split(/\n{2,}/)
        .map((block) =>
          block
            .split("\n")
            .filter((line) => !isHeading(line) && !isFence(line))
            .join(" ")
            .trim(),
        )
        .filter(Boolean);

  return source.map((item) => ({ segments: parseXiaodaoSegments(item) }));
}

export async function getXiaodaoItems(): Promise<XiaodaoItem[]> {
  try {
    const raw = await readFile(resolve(process.cwd(), XIAODAO.source), "utf8");
    return parseXiaodaoItems(stripFrontmatter(raw));
  } catch {
    return [];
  }
}
