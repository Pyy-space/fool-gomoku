"""对战适配器。

* `local` —— 本地人机对弈（人是鼠标点棋盘、AI 应手）。

共用 `core.game.GameSession` 作为状态机。
"""

from .local import LocalAdapter

__all__ = ["LocalAdapter"]
