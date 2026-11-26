"""tests/ 目录：把 tools/ 下分散的开发自检脚本收拢成标准 unittest 用例。

为什么用 unittest 而不是 pytest：本机 conda 环境没装 pytest，而 unittest 是
标准库，零额外依赖 —— 保证换一台机器 clone 下来就能跑。

用法：
    python -m unittest discover -s tests -v
或
    python tests/run_all.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# 让 tests/ 里的用例能 import 到项目根目录下的包
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
