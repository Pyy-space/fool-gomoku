"""启动入口：``python run.py``。

自动挑选空闲端口（默认 5000），打印局域网地址，然后启动 Flask-SocketIO 服务。
所有路径都基于本文件所在目录，整个文件夹可以整体搬走。
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def _free_port(start: int = 5000, tries: int = 40) -> int:
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


def _lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def main() -> None:
    ap = argparse.ArgumentParser(description="五子棋 AI 助手")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址，0.0.0.0 = 允许局域网访问")
    ap.add_argument("--port", type=int, default=0, help="端口，0 = 自动挑空闲端口")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--debug", action="store_true", help="打开调试日志")
    args = ap.parse_args()

    try:
        from app import create_app
    except ImportError as exc:
        print("[错误] 依赖缺失：", exc, sep="\n  ")
        print("\n请先安装依赖：\n  pip install -r requirements.txt")
        raise SystemExit(1)

    port = args.port or int(os.environ.get("PORT", "0")) or _free_port()
    # Render / 容器环境不自动弹浏览器（也没浏览器可弹）。
    if os.environ.get("RENDER"):
        args.no_browser = True
        if args.host == "127.0.0.1":
            args.host = "0.0.0.0"
    app, socketio = create_app()

    url = f"http://{'127.0.0.1' if args.host == '0.0.0.0' else args.host}:{port}/"
    print("=" * 58)
    print("  五子棋 AI 助手")
    print(f"  本地访问: {url}")
    if args.host == "0.0.0.0":
        print(f"  局域网:   http://{_lan_ip()}:{port}/")
    print("  按 Ctrl+C 停止")
    print("=" * 58)

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    socketio.run(app, host=args.host, port=port,
                 debug=args.debug, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
