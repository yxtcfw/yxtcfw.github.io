# bili_comments.py  v3  内置debug + 字段兼容取值
# 用法：python bili_comments.py --file bvids.txt --out comments.csv

import argparse, csv, json, os, re, sys, time
from collections import Counter
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UAPI = "https://uapis.cn/api/v1/social/bilibili/replies"
VIEW_API = "https://api.bilibili.com/x/web-interface/view"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
STATE_FILE = "state.json"
DEBUG_FILE = "debug_raw.json"

PATTERNS = {
    "问题": re.compile(r"[？?]|怎么|为什么|能不能|是不是|如何"),
    "疑虑": re.compile(r"收费吗|免费吗|安全吗|靠谱吗|要注册|要会员|会不会"),
    "痛点": re.compile(r"烦|麻烦|每次|总是|又|不行|没用|卡|崩|慢"),
    "需求": re.compile(r"想要|希望|有没有|求推荐|跪求|建议|能不能加"),
}

def tag(text: str) -> str:
    for label, pat in PATTERNS.items():
        if pat.search(text):
            return label
    return "其他"

def get(url: str, params: dict | None = None, retries: int = 3):
    if params:
        url = url + "?" + urlencode(params)
    for i in range(retries):
        try:
            req = Request(url, headers={"User-Agent": UA})
            with urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retries - 1:
                print(f"  ✗ 请求失败 {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 * (i + 1))

def bvid_to_aid(bvid: str) -> int | None:
    data = get(VIEW_API, {"bvid": bvid})
    if data and data.get("code") == 0:
        return data["data"]["aid"]
    return None

# ---------- 字段兼容取值（核心修复）----------
def pick(r: dict, key: str, default=None):
    """在顶层及常见子对象里找 key，兼容扁平/嵌套两种结构"""
    if key in r and r[key] not in (None, ""):
        return r[key]
    for sub in ("member", "content", "user", "reply", "data"):
        v = r.get(sub)
        if isinstance(v, dict) and v.get(key) not in (None, ""):
            return v[key]
    return default

def norm_time(ts):
    """秒级时间戳 → 可读时间"""
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ts)))
    except Exception:
        return str(ts)

# ---------- 状态管理 ----------
def load_state(path: str) -> dict:
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"done_bvids": [], "seen_rpids": [], "rows": []}

def save_state(path: str, state: dict):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)

def parse_reply(r: dict, level: int, parent_id: str) -> dict:
    """统一解析一条评论（一级/二级通用）"""
    return {
        "level": level,
        "parent_id": parent_id,
        "rpid": str(pick(r, "rpid", "") or pick(r, "id", "")),
        "uname": pick(r, "uname", "") or pick(r, "name", ""),
        "uid": str(pick(r, "mid", "") or pick(r, "uid", "")),
        "message": (pick(r, "message", "") or pick(r, "content", "") or "").replace("\n", " ").strip(),
        "like": pick(r, "like", 0) or 0,
        "count": pick(r, "count", 0) or 0,
        "ctime": norm_time(pick(r, "ctime", "") or pick(r, "time", "")),
    }

def get_sub_replies(r: dict) -> list:
    """兼容二级回复的多种键名"""
    for key in ("sub_replies", "sub_reply", "replies", "child_replies"):
        v = r.get(key)
        if isinstance(v, list) and v:
            return v
    return []

def fetch_comments(aid: int, sort: int = 3, max_pages: int = 5, debug: bool = True) -> list[dict]:
    rows = []
    for pn in range(1, max_pages + 1):
        data = get(UAPI, {"oid": aid, "sort": sort, "pn": pn, "ps": 20})

        # ===== DEBUG：第一页原始返回落盘 =====
        if pn == 1 and debug:
            with open(DEBUG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  [debug] 原始返回已存 → {DEBUG_FILE}")
            if data:
                print(f"  [debug] 顶层键: {list(data.keys())}")
                replies = data.get("replies") or data.get("data", {}).get("replies") or []
                if replies:
                    print(f"  [debug] 首条评论键: {list(replies[0].keys())}")

        if not data:
            break
        # 兼容 replies 在顶层或 data 下
        replies = data.get("replies")
        if replies is None:
            replies = (data.get("data") or {}).get("replies")
        if not replies:
            break

        for r in replies:
            rows.append(parse_reply(r, level=1, parent_id="0"))
            for sub in get_sub_replies(r):
                rows.append(parse_reply(sub, level=2, parent_id=str(pick(r, "rpid", ""))))

        print(f"  第{pn}页：本页 {len(replies)} 条，累计 {len(rows)} 条")
        if len(replies) < 20:
            break
        time.sleep(1.5)
    return rows

def main():
    ap = argparse.ArgumentParser(description="B站评论采集器 v3")
    ap.add_argument("--bvids", help="逗号分隔BV号")
    ap.add_argument("--file", help="BV号列表文件（每行一个，支持链接自动提取）")
    ap.add_argument("--out", default="comments.csv")
    ap.add_argument("--state", default=STATE_FILE)
    ap.add_argument("--sort", type=int, default=3, choices=[0, 1, 2, 3])
    ap.add_argument("--pages", type=int, default=5)
    ap.add_argument("--force", action="store_true", help="忽略已完成记录，重新抓取")
    ap.add_argument("--no-debug", action="store_true", help="关闭debug输出")
    args = ap.parse_args()

    bvids = []
    if args.bvids:
        bvids += [b.strip() for b in args.bvids.split(",") if b.strip()]
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            for line in f:
                m = re.search(r"BV[0-9A-Za-z]{10}", line)  # 支持直接粘链接
                if m:
                    bvids.append(m.group())
    if not bvids:
        ap.error("必须指定 --bvids 或 --file")

    bvids = list(dict.fromkeys(bvids))

    state = load_state(args.state)
    if args.force:
        state = {"done_bvids": [], "seen_rpids": [], "rows": []}
    done = set(state["done_bvids"])
    seen = set(state["seen_rpids"])
    rows_all = state["rows"]

    print(f"加载状态：已完成 {len(done)} 个视频，已有评论 {len(rows_all)} 条")
    todo = [b for b in bvids if b not in done]
    if not todo:
        print("所有视频均已抓取过，直接导出。加 --force 可强制重抓。")
    else:
        print(f"待抓取 {len(todo)} 个视频\n")

    for i, bvid in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {bvid}")
        aid = bvid_to_aid(bvid)
        if not aid:
            print("  ✗ 无法获取aid，跳过（不标记完成，下次可重试）")
            continue
        print(f"  aid={aid}")

        rows = fetch_comments(aid, sort=args.sort, max_pages=args.pages, debug=not args.no_debug)

        new_rows = []
        for r in rows:
            if r["rpid"] and r["rpid"] in seen:
                continue
            seen.add(r["rpid"])
            r.update(bvid=bvid, aid=aid, tag=tag(r["message"]))
            new_rows.append(r)
        rows_all += new_rows

        done.add(bvid)
        save_state(args.state, {"done_bvids": list(done), "seen_rpids": list(seen), "rows": rows_all})
        print(f"  ✓ 新增 {len(new_rows)} 条（原 {len(rows)}，去重 {len(rows) - len(new_rows)}）")
        time.sleep(2)

    header = ["bvid", "aid", "level", "parent_id", "rpid", "uname", "uid",
              "message", "like", "count", "ctime", "tag"]
    with open(args.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows_all)

    print(f"\n完成：共 {len(rows_all)} 条评论 → {args.out}")
    print("标签分布：", dict(Counter(r["tag"] for r in rows_all)))

if __name__ == "__main__":
    main()
