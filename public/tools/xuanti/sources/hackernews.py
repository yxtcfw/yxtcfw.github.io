# -*- coding: utf-8 -*-
import requests
from config import TopicItem

API = "https://hacker-news.firebaseio.com/v0"


def _get(id_):
    return requests.get(f"{API}/item/{id_}.json", timeout=10).json()


def collect(top_n=30):
    ids = requests.get(f"{API}/topstories.json", timeout=10).json()[:top_n]
    items = []
    for i in ids:
        d = _get(i)
        if not d or d.get("type") != "story":
            continue
        items.append(TopicItem(
            source="hackernews",
            title=d.get("title", ""),
            content=d.get("url", ""),
            url=d.get("url"),
            author=d.get("by"),
            heat=d.get("score", 0),
            raw={"descendants": d.get("descendants", 0)},
        ))
    return items


def collect_comments(story_id, limit=50):
    """抓某条新闻的评论 —— 痛点/段子密集区"""
    d = _get(story_id)
    items = []
    for cid in (d.get("kids") or [])[:limit]:
        c = _get(cid)
        if not c or c.get("deleted") or not c.get("text"):
            continue
        items.append(TopicItem(
            source="hackernews_comment",
            title=c.get("by", ""),
            content=re.sub(r"<[^>]+>", " ", c["text"]).strip(),
            author=c.get("by"),
            raw={"parent": story_id},
        ))
    return items
