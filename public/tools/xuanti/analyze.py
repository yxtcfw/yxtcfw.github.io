# -*- coding: utf-8 -*-
"""
关键词 / 长尾词 / 痛点 / 段子 提取
无外部依赖（jieba 可选，装了效果更好）
"""
import re
from collections import Counter
from config import load_items, save_items

# ---------- 词典 ----------

# 痛点信号词
PAIN_PAT = re.compile(
    r"卡|慢|崩|闪退|报错|失败|无法|不能|不了|怎么|为什么|咋|坑|坑爹|"
    r"垃圾|太差|退款|投诉|骗|虚假|不推荐|后悔|无语|服了|醉了"
)

# 疑问句（长尾词主要来源）
QUESTION_PAT = re.compile(r"[^。！？\n]{4,40}[？?]")

# 反差/段子信号：提问 + 转折回答
GAG_PAT = re.compile(r"但是|其实|只能|就是|不过|可惜|没办法|结果|没想到")

# 停用词（简化版）
STOP = set("的 了 是 在 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 自己 这 那 什么 怎么 为什么 可以 这个 那个 现在 已经 还是 但是 因为 所以 如果".split())


def _tokenize(text):
    """分词，jieba 可用则用，否则退化为正则"""
    try:
        import jieba
        return [w for w in jieba.cut(text) if len(w) >= 2]
    except ImportError:
        return re.findall(r"[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z0-9+#.\-]{2,}", text)


def extract_keywords(text, top_k=10):
    """高频关键词"""
    words = [w for w in _tokenize(text) if w not in STOP]
    return [w for w, _ in Counter(words).most_common(top_k)]


def extract_long_tail(text):
    """长尾词：疑问句 + 长短语，SEO/搜索流量来源"""
    results = []
    for m in QUESTION_PAT.finditer(text):
        q = m.group().strip()
        if 6 <= len(q) <= 40:
            results.append(q)
    # 补充：含技术名词的长短语
    for m in re.finditer(r"[\u4e00-\u9fa5]{2,}(?:[\u4e00-\u9fa5]{2,}){1,6}", text):
        p = m.group()
        if len(p) >= 6 and p not in results:
            results.append(p)
    return results[:15]


def extract_pain_points(text):
    """痛点句提取"""
    sents = re.split(r"[。！？\n]", text)
    return [s.strip() for s in sents if PAIN_PAT.search(s) and 6 <= len(s) <= 80]


def extract_gags(items):
    """
    段子提取：从"提问-回答"对里找反差
    items: 同一来源的 dict 列表（load_items 返回的是 dict，不是 TopicItem）
    """
    gags = []
    questions = [it for it in items if "?" in it.get("content", "") or "？" in it.get("content", "")]
    answers   = [it for it in items if GAG_PAT.search(it.get("content", ""))]
    for q in questions[:20]:
        for a in answers[:20]:
            if q.get("author") != a.get("author") and len(a.get("content", "")) < 200:
                gags.append({
                    "ask":    q["content"][:80],
                    "answer": a["content"][:80],
                    "source": q.get("source", ""),
                })
    return gags[:10]



def run():
    """主流程：读取 → 分析 → 回写"""
    items = load_items()
    if not items:
        print("无数据，先运行 main.py collect")
        return

    # 按来源分组，便于段子提取
    from collections import defaultdict
    by_source = defaultdict(list)
    for it in items:
        by_source[it["source"]].append(it)

    for it in items:
        text = f"{it['title']} {it['content']}"
        it["keywords"] = extract_keywords(text)
        it["long_tail"] = extract_long_tail(text)
        it["pain_points"] = extract_pain_points(text)

    # 段子按来源批量提取
    for src, group in by_source.items():
        gags = extract_gags(group)
        if gags:
            group[0]["gags"] = gags

    # 输出报告
    print_report(items)
    save_items(items, "output/topics_analyzed.jsonl")


def print_report(items):
    all_kw = Counter()
    all_lt = Counter()
    pain_cnt = 0
    for it in items:
        all_kw.update(it.get("keywords", []))
        all_lt.update(it.get("long_tail", []))
        pain_cnt += len(it.get("pain_points", []))

    print("\n===== 分析结果 =====")
    print(f"总条目: {len(items)}")
    print(f"\n【TOP 20 关键词】")
    for w, c in all_kw.most_common(20):
        print(f"  {w}: {c}")
    print(f"\n【TOP 15 长尾词】")
    for w, c in all_lt.most_common(15):
        print(f"  {w}: {c}")
    print(f"\n【痛点句总数】{pain_cnt}")
    print(f"【段子素材】{sum(len(i.get('gags',[])) for i in items)} 组")


if __name__ == "__main__":
    run()
