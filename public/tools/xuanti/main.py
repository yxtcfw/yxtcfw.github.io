# -*- coding: utf-8 -*-
import sys
from config import save_items
from sources import github_trending, hackernews, v2ex, app_reviews
import analyze

SOURCES = {
    "github": github_trending.collect,
    "hn":     hackernews.collect,
    "v2ex":   v2ex.collect_hot,
    "app":    app_reviews.collect_default,   # ← 无参入口
}




def collect(names=None):
    names = names or SOURCES.keys()
    total = []
    for n in names:
        try:
            items = SOURCES[n]()
            print(f"[{n}] 采集 {len(items)} 条")
            total.extend(items)
        except Exception as e:
            print(f"[{n}] 失败: {e}")
    save_items(total)
    print(f"\n合计 {len(total)} 条 → output/topics.jsonl")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "analyze":
        analyze.run()
    else:
        collect(sys.argv[1:] or None)
