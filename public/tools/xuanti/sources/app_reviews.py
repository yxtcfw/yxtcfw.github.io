# -*- coding: utf-8 -*-
import re, requests
from config import TopicItem

HEADERS = {"User-Agent": "Mozilla/5.0 (Linux; Android 10)"}
# 应用宝评论接口（公开，需按实际 appid 调整）
API = "https://android.myapp.com/myapp/comment.htm"

# 默认监控的应用列表（应用宝/应用商店的 appid 或包名）
DEFAULT_APPS = [
    "com.tencent.mm",        # 微信
    "com.eg.android.AlipayGphone",  # 支付宝
    "com.ss.android.ugc.aweme",     # 抖音
]

def collect_default():
    """main.py 调用的无参入口：遍历默认应用，汇总评论"""
    items = []
    for appid in DEFAULT_APPS:
        try:
            items.extend(collect(appid))
        except Exception as e:
            print(f"  [app] {appid} 失败: {e}")
    return items


def collect(appid, page=1, size=20):
    """抓取应用评论 —— 1-2 星是痛点金矿"""
    r = requests.get(API, params={"appid": appid, "page": page, "pageSize": size},
                     headers=HEADERS, timeout=15)
    # 应用宝返回 HTML 片段，用正则提取（结构变动时改这里）
    items = []
    for m in re.finditer(
        r'<div class="comment-item".*?score="(\d)".*?content">(.*?)</div>',
        r.text, re.S
    ):
        score = int(m.group(1))
        text = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if len(text) < 5:
            continue
        items.append(TopicItem(
            source="appstore",
            title=f"评分{score}星",
            content=text,
            heat=score,
            raw={"appid": appid, "score": score},
        ))
    return items
