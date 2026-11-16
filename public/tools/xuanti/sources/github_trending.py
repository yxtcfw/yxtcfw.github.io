# -*- coding: utf-8 -*-
import re, requests
from bs4 import BeautifulSoup
from config import TopicItem

URL = "https://github.com/trending"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def collect(language=None, since="daily"):
    """抓取 GitHub Trending"""
    params = {"since": since}
    if language:
        params["language"] = language
    r = requests.get(URL, params=params, headers=HEADERS, timeout=15)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    items = []
    for art in soup.select("article.Box-row"):
        a = art.select_one("h2 a")
        if not a:
            continue
        name = a.get("href", "").strip("/")
        desc_el = art.select_one("p")
        desc = desc_el.get_text(strip=True) if desc_el else ""
        # star 数
        star_el = art.select_one("a[href$='/stargazers']")
        star = int(re.sub(r"\D", "", star_el.get_text())) if star_el else 0
        # 语言
        lang_el = art.select_one("[itemprop='programmingLanguage']")
        lang = lang_el.get_text(strip=True) if lang_el else ""

        items.append(TopicItem(
            source="github",
            title=name,
            content=desc,
            url=f"https://github.com/{name}",
            heat=star,
            raw={"language": lang, "since": since},
        ))
    return items


if __name__ == "__main__":
    for it in collect():
        print(it.title, it.heat)
