# -*- coding: utf-8 -*-
import time, requests
from config import TopicItem

API = "https://www.v2ex.com/api"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.v2ex.com/",
}


def _get(url, params=None, retries=3):
    """带重试的 GET"""
    for i in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(1.5 * (i + 1))   # 退避重试


def collect_hot():
    data = _get(f"{API}/topics/hot.json")
    items = []
    for d in data:
        items.append(TopicItem(
            source="v2ex",
            title=d.get("title", ""),
            content=d.get("content", "")[:500],
            url=d.get("url"),
            author=d.get("member", {}).get("username"),
            heat=d.get("replies", 0),
            raw={"node": d.get("node", {}).get("title")},
        ))
    return items


def collect_replies(topic_id):
    data = _get(f"{API}/replies/show.json", params={"topic_id": topic_id})
    items = []
    for d in data:
        items.append(TopicItem(
            source="v2ex_reply",
            title=d.get("member", {}).get("username", ""),
            content=d.get("content", ""),
            author=d.get("member", {}).get("username"),
            raw={"topic_id": topic_id},
        ))
    return items



def collect_replies(topic_id):
    """抓主题回复 —— 吐槽素材"""
    r = requests.get(f"{API}/replies/show.json?topic_id={topic_id}",
                     headers=HEADERS, timeout=15)
    items = []
    for d in r.json():
        items.append(TopicItem(
            source="v2ex_reply",
            title=d.get("member", {}).get("username", ""),
            content=d.get("content", ""),
            author=d.get("member", {}).get("username"),
            raw={"topic_id": topic_id},
        ))
    return items
