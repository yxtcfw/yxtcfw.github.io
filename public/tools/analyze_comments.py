# analyze_comments.py
# 用法：python analyze_comments.py --in comments.csv --out topics.csv
# 输出：控制台摘要 + 选题清单CSV

import argparse, csv, re
from collections import Counter, defaultdict

# 中文分词（无依赖版）：按标点/空白切，再抽2-4字片段
STOPWORDS = set("""的 了 是 我 你 他 她 它 吗 吧 啊 呢 有 在 就 都 也 和 与 或 不 没 这 那 一个 什么 怎么 可以 现在 已经 还是 但是 因为 所以 如果 这个 那个 一下 有点 应该 可能 感觉 觉得 知道 时候 东西 问题 回复 谢谢 哈哈 666 楼上 楼主 视频 视频里 主播 up up主 博主 老师 客服 店铺 公众号 gz gz号""".split())

def tokenize(text: str) -> list[str]:
    text = re.sub(r"https?://\S+|@\S+", " ", text)
    parts = re.split(r"[^\u4e00-\u9fa5a-zA-Z0-9]+", text)
    words = []
    for p in parts:
        if not p:
            continue
        if re.match(r"^[a-zA-Z0-9]+$", p):
            if len(p) >= 2:
                words.append(p.lower())
            continue
        # 中文：抽 2-4 字滑窗片段（无分词依赖的近似做法）
        for n in (4, 3, 2):
            for i in range(len(p) - n + 1):
                frag = p[i:i+n]
                if frag not in STOPWORDS:
                    words.append(frag)
    return words

def main():
    ap = argparse.ArgumentParser(description="B站评论 → 选题素材分析")
    ap.add_argument("--in", dest="infile", default="comments.csv")
    ap.add_argument("--out", dest="outfile", default="topics.csv")
    ap.add_argument("--min-likes", type=int, default=0, help="只看点赞≥N的评论")
    ap.add_argument("--top", type=int, default=20, help="高频词显示条数")
    args = ap.parse_args()

    rows = []
    with open(args.infile, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if int(r.get("like") or 0) < args.min_likes:
                continue
            rows.append(r)

    if not rows:
        print("没有符合条件的评论。")
        return

    firsts = [r for r in rows if r.get("level") == "1"]
    print(f"总评论 {len(rows)} 条，一级评论 {len(firsts)} 条\n")

    # ---------- 1. 标签分布 ----------
    tag_cnt = Counter(r["tag"] for r in firsts if r.get("tag"))
    print("【标签分布】")
    for t, c in tag_cnt.most_common():
        print(f"  {t}: {c} 条")

    # ---------- 2. 高频词 ----------
    wc = Counter()
    for r in firsts:
        wc.update(set(tokenize(r.get("message", ""))))  # 每条评论只计一次词频
    print(f"\n【高频词 TOP {args.top}】")
    for w, c in wc.most_common(args.top):
        print(f"  {w}: {c}")

    # ---------- 3. 高赞疑问（直接可当选题）----------
    q_rows = sorted(
        [r for r in firsts if r.get("tag") in ("问题", "痛点", "需求", "疑虑")],
        key=lambda r: int(r.get("like") or 0), reverse=True)

    # ---------- 4. 按关键词聚类成选题 ----------
    TOPICS = {
        "资费与返费": re.compile(r"返|充|到账|多少钱|月租|首充|优惠|价格|贵|便宜"),
        "信号与网速": re.compile(r"信号|网速|卡不卡|限速|延迟|测速|5g|4g"),
        "地区与库存": re.compile(r"地区|发货|打烊|满额|没有|缺货|物流|发不了"),
        "使用体验": re.compile(r"用了|到手|体验|感受|真实|实测|掉线|断网"),
        "办理与售后": re.compile(r"怎么办|办理|实名|激活|注销|客服|退款|售后"),
    }
    topic_rows = defaultdict(list)
    for r in q_rows:
        msg = r.get("message", "")
        for name, pat in TOPICS.items():
            if pat.search(msg):
                topic_rows[name].append(r)
                break

    print("\n【选题清单】")
    out = []
    for name, items in sorted(topic_rows.items(), key=lambda kv: -len(kv[1])):
        print(f"\n  ▶ {name}（{len(items)} 条相关疑问）")
        for r in items[:3]:
            print(f"     · {r['message'][:50]}  (赞{r['like']})")
        out.append({
            "选题方向": name,
            "疑问数量": len(items),
            "代表评论": " | ".join(r["message"][:40] for r in items[:3]),
            "总点赞": sum(int(r.get("like") or 0) for r in items),
            "建议标题": f"《{name}：{items[0]['message'][:20]}…》",
        })

    with open(args.outfile, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["选题方向", "疑问数量", "代表评论", "总点赞", "建议标题"])
        w.writeheader()
        w.writerows(out)
    print(f"\n选题清单已导出 → {args.outfile}")

if __name__ == "__main__":
    main()
