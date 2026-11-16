# -*- coding: utf-8 -*-
"""统一数据结构：所有采集器必须输出这个格式"""
from dataclasses import dataclass, field, asdict
from typing import Optional
import json, time


@dataclass
class TopicItem:
    """选题条目 —— 所有平台的统一输出单元"""
    source: str                 # 来源标识: github/hn/v2ex/appstore/local
    title: str                  # 标题 / 评论原文
    content: str                # 正文 / 评论详情
    url: Optional[str] = None
    author: Optional[str] = None
    heat: int = 0               # 热度: star/评论数/点赞数
    created_at: Optional[str] = None
    # 分析字段（由 analyze.py 填充）
    keywords: list = field(default_factory=list)
    long_tail: list = field(default_factory=list)
    pain_points: list = field(default_factory=list)
    gags: list = field(default_factory=list)
    # 原始数据，便于回溯
    raw: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)


def save_items(items, path="output/topics.jsonl"):
    """JSONL 追加写入。兼容 TopicItem 对象 和 load_items 读回的 dict"""
    import os
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        for it in items:
            if isinstance(it, dict):          # 从 jsonl 读回来的就是 dict
                d = it
            else:                              # 采集阶段产出的 TopicItem 对象
                d = it.to_dict()
            f.write(json.dumps(d, ensure_ascii=False) + "\n")



def load_items(path="output/topics.jsonl"):
    import os
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]
