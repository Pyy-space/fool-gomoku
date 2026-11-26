# fool-gomoku

五子棋 AI 助手 —— 与一位会自我进化的五子棋 AI 对弈。

- **人机对弈**：标准五子棋（支持 13/15/19 路、无禁手 / 连珠禁手、五档难度、悔棋 / 提示 / 复盘）。
- **在线自我进化**：下完一局后，把胜负喂回去微调评估参数（防守权重），越下越贴合你的棋风。
- **实验室**（隐藏入口）：机器对机器自我对弈调参（页脚版本号连点 5 次进入，需口令解锁）。

## 快速开始

### 本地运行（Windows）

```bat
双击 start.bat
```

或

```bat
pip install -r requirements.txt
python run.py
```

浏览器打开后：`/` 落地页 → `/hub` 选模式。

### 前后端分离部署

见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 文档

- [docs/STARTUP.md](docs/STARTUP.md) —— 怎么跑起来（操作手册）
- [docs/DEPLOY.md](docs/DEPLOY.md) —— 怎么部署到 GitHub Pages + Render
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 架构决策与设计
- [README.md](README.md) —— 项目总览

## 目录结构

```
fool-gomoku/
├── web/            # 纯静态前端（GitHub Pages 用）
├── app/            # Flask 应用（页面 + API + SocketIO）
├── engine/         # 棋盘 / 棋型 / 搜索 / 评估 / 在线学习 / 调参
├── core/           # 对局状态机 / Profile
├── adapters/       # 本地人机适配器
├── profiles/       # 配置文件（JSON）
├── tests/          # 单元测试（unittest）
├── run.py          # 启动入口
├── render.yaml     # Render 部署蓝图
├── Procfile        # Render 启动命令
└── requirements*.txt
```

> 说明：识别下棋（窗口截图 + 自动落子）依赖 Windows 专属 API，只在本地完整版
> （GomokuAI 目录）提供；本仓库是前后端分离的 web 版，聚焦「人机对弈 + 在线学习 + 实验室」。
