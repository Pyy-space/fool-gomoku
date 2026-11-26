"""对局数据采集器（web 版核心闭环之一）。

网页版每局结束，把「完整棋谱 + 最终胜负 + 当时参数快照」追加成一 JSONL 行，
存在 ``output/games.jsonl``。这些就是网友贡献的优化燃料：

    网友玩 → 每局棋谱落盘 → 你在实验室里点「导出」下载 → 拿回本地喂调参器。

设计要点：
* JSONL（一行一局），追加写，天然适合"对局结束才写一次"的场景；
* 线程安全（多线程 Flask + 后台线程都可能触发写）；
* 一局只记一次（对局结束判定由 GameSession 保证）。
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parent.parent
GAMES_PATH = ROOT / "output" / "games.jsonl"

_LOCK = threading.Lock()


def record_game(size: int, rules: str, human_color: int, winner: int,
                moves: List[dict], config: dict) -> None:
    """追加一局。

    :param moves: MoveRecord.as_dict() 的列表，即每步 ``{x, y, color, by}``。
    :param config: 当时引擎参数的扁平字典（EngineConfig.flat()）。
    """
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "size": size,
        "rules": rules,
        "human_color": human_color,
        "winner": winner,
        "moves": moves,
        "config": config,
    }
    GAMES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        with open(GAMES_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def count_games() -> int:
    """已收集的对局数（不含未写完的半行）。"""
    if not GAMES_PATH.exists():
        return 0
    with _LOCK:
        return sum(1 for line in open(GAMES_PATH, encoding="utf-8")
                   if line.strip())


def read_games() -> str:
    """整份 JSONL 文本（导出用）。"""
    if not GAMES_PATH.exists():
        return ""
    with _LOCK:
        return GAMES_PATH.read_text(encoding="utf-8")
