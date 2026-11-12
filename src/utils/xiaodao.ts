import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { XIAODAO } from "../config";

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export function parseXiaodaoItems(body: string): string[] {
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
  if (listItems.length) return listItems;

  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !isHeading(line) && !isFence(line))
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
}

export async function getXiaodaoItems(): Promise<string[]> {
  try {
    const raw = await readFile(resolve(process.cwd(), XIAODAO.source), "utf8");
    return parseXiaodaoItems(stripFrontmatter(raw));
  } catch {
    return [];
  }
}
