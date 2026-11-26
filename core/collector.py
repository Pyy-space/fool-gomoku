"""对局数据采集器。

每局结束把「棋谱 + 胜负 + 当时参数快照」追加成一行 JSONL 存 output/games.jsonl。
网友玩→棋谱落盘→实验室导出下载→拿回本地喂调参器。线程安全，一局只记一次。
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
