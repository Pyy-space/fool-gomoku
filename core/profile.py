"""配置档（Profile）：把"如何识别某个程序"做成可替换的 JSON，而不是写死在代码里。

一个 profile 描述一个目标程序：
  * 怎么找到它的窗口
  * 棋盘在窗口里的位置（四种定位方式，从最宽松到最精确）
  * 主题色（可选，不给就自动聚类）
  * 怎么落子

新增一个目标程序 = 新建一个 profiles/*.json，不改任何代码。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

PROFILES_DIR = Path(__file__).resolve().parent.parent / "profiles"


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------
@dataclass
class WindowRule:
    """窗口匹配规则。所有字段都是"给了就必须匹配"。"""

    title_regex: str = ""
    class_regex: str = ""
    process_name: str = ""          # 可执行文件名，如 "yysls.exe"
    match_mode: str = "search"      # search | fullmatch


@dataclass
class BoardLayout:
    """棋盘在截图里的几何。定位优先级：quad > origin+spacing > auto。

    * quad: 四个角点（左上、右上、右下、左下），像素坐标，支持透视/仿射校正。
    * origin + spacing: 左上交点坐标 与 相邻交点间距。
    * axis: "xy" 表示第一个角是左上；"flipped_x"/"flipped_y"/"flipped_xy"
      表示棋盘图像被镜像（有些程序会把黑方视角翻转）。
    * auto: 什么都不给，靠网格线检测自动找（最通用，但可能被背景干扰）。
    """

    size: int = 15
    quad: list = field(default_factory=list)   # [[x,y], [x,y], [x,y], [x,y]]
    origin: Optional[list] = None              # [x, y]
    spacing: Optional[float] = None            # 像素
    axis: str = "xy"
    auto: bool = True
    # 自动检测时，只在这个相对区域内找棋盘（比例 0~1），None = 全图
    roi: Optional[list] = None                 # [x0, y0, x1, y1]


@dataclass
class Theme:
    """颜色阈值。给了就按阈值分类，不给就自动聚类。"""

    board_bg: Optional[list] = None     # [B, G, R]
    black_stone: Optional[list] = None
    white_stone: Optional[list] = None
    tolerance: int = 60                 # 欧氏距离阈值
    sample_radius: int = 0              # 0 = 按格距自动算


@dataclass
class InputConfig:
    method: str = "mouse"               # mouse
    click_delay: float = 0.06           # 鼠标按下/抬起间隔
    move_duration: float = 0.0          # 0 = 瞬移
    offset: list = field(default_factory=lambda: [0, 0])   # 落点微调


@dataclass
class CaptureConfig:
    method: str = "auto"                # auto | printwindow | screen
    settle_ms: int = 120                # 截图前等待画面稳定
    bring_to_front: bool = False


@dataclass
class Profile:
    name: str = "default"
    description: str = ""
    window: WindowRule = field(default_factory=WindowRule)
    board: BoardLayout = field(default_factory=BoardLayout)
    theme: Theme = field(default_factory=Theme)
    input: InputConfig = field(default_factory=InputConfig)
    capture: CaptureConfig = field(default_factory=CaptureConfig)

    # -- 序列化 -------------------------------------------------------------
    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict) -> "Profile":
        return cls(
            name=raw.get("name", "default"),
            description=raw.get("description", ""),
            window=WindowRule(**raw.get("window", {})),
            board=BoardLayout(**raw.get("board", {})),
            theme=Theme(**raw.get("theme", {})),
            input=InputConfig(**raw.get("input", {})),
            capture=CaptureConfig(**raw.get("capture", {})),
        )

    # -- 磁盘 ---------------------------------------------------------------
    def save(self, path: Optional[Path] = None) -> Path:
        path = Path(path) if path else PROFILES_DIR / f"{self.name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return path

    @classmethod
    def load(cls, path: Path) -> "Profile":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        p = cls.from_dict(raw)
        if not p.name or p.name == "default":
            p.name = Path(path).stem
        return p


# ---------------------------------------------------------------------------
# 便捷函数
# ---------------------------------------------------------------------------
def list_profiles() -> list[dict]:
    """列出所有可用 profile（按文件名排序）。"""
    if not PROFILES_DIR.exists():
        return []
    out = []
    for f in sorted(PROFILES_DIR.glob("*.json")):
        try:
            p = Profile.load(f)
            out.append({"file": f.name, "name": p.name,
                        "description": p.description,
                        "size": p.board.size})
        except Exception as exc:                      # 坏文件不该拖垮整个 UI
            out.append({"file": f.name, "name": f.stem,
                        "description": f"(读取失败: {exc})", "size": 15})
    return out


def get_profile(name: str) -> Profile:
    """按名字或文件名取 profile；找不到就返回内置默认。"""
    if name:
        for cand in (PROFILES_DIR / f"{name}.json", PROFILES_DIR / name):
            if cand.exists():
                return Profile.load(cand)
    return default_profile()


def default_profile() -> Profile:
    return Profile(
        name="default",
        description="通用默认配置：自动检测棋盘，自动聚类判色，鼠标点击落子",
        window=WindowRule(),
        board=BoardLayout(size=15, auto=True),
        theme=Theme(),
        input=InputConfig(),
        capture=CaptureConfig(),
    )
