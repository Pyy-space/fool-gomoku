# 傻子五子棋 AI（fool-gomoku）

一个会自我进化的五子棋 AI，做成**前后端分离**的 Web 应用：前端是纯静态页面（可挂 GitHub Pages），
后端是纯 Python 引擎 API（可挂 Render）。本仓库是 **web 版**，只保留纯引擎能提供的能力：

- **人机对弈**：网页棋盘上直接和 AI 下，可选手执黑/白、难度、棋盘尺寸、禁手规则
- **在线负反馈学习**：AI 下输了会把这一局胜负喂回来，微调防守权重，下一局更强
- **实验室（隐藏入口）**：让 AI 自己跟自己下很多局，搜索引擎超参数（机器对弈调参）
- **网友对局数据采集**：每局棋谱自动落盘，可在实验室里一键导出，拿回本地喂调参器

> ⚠️ 本仓库**不含「识别下棋」**（从游戏窗口截图识别棋盘 + 自动点鼠标落子）。那部分依赖
> Windows 专属 API（窗口截图 / 鼠标注入 / 窗口枚举），云端 Linux 上没有屏幕也没有鼠标，物理上
> 无法实现。识别下棋的完整能力在**本地完整版** `GomokuAI/` 目录里，和本仓库共享同一套引擎。

---

## 架构

```
GitHub Pages（前端，纯静态）          Render（后端，纯 API）
   web/*.html + web/static/app.js  ──HTTP/JSON──▶  Flask + SocketIO（engine/ core/ adapters/local）
```

前端通过 `web/config.js` 里的 `window.API_BASE` 指向后端地址；后端开了 CORS，跨域可用。

---

## 快速开始（本地跑起来）

### 1. 装依赖

```bat
pip install -r requirements.txt
```

（`requirements.txt` 是本仓库后端的最小依赖：Flask + Flask-SocketIO + 引擎运行所需。
`requirements-web.txt` 是给 Render 用的精简版，两者内容基本一致。）

### 2. 启动

```bat
python run.py
```

浏览器打开 `http://127.0.0.1:5000/`。或用 `start.bat` 一键启动（会自动装依赖）。

### 3. 部署到 Render

看 [docs/DEPLOY.md](docs/DEPLOY.md) —— 从创建 Render Web Service 到配置 GitHub Pages 的完整步骤。

---

## 界面导航（三层结构）

打开后是落地页，点「进入」到模式选择：

```
/           落地页（hero + 进入）
/hub        模式选择（人机对弈）
  /local    人机对弈（含「自我进化」开关）
  /lab      实验室（训练=机器对弈调参，隐藏入口）
```

### 隐藏入口：实验室

「训练 = 机器与机器对弈」藏在**实验室**里：

1. 在任意页面的**页脚版本号 `v1.0` 上连点 5 次**（1.6 秒内），跳转到 `/lab`；
2. 进入后还需输入**访问口令**（默认 `gomoku-lab`，可用环境变量 `GOMOKU_LAB_TOKEN` 覆盖）。

两层防护：彩蛋负责隐蔽，口令负责真锁（后端 API 加 token 鉴权，防止挂网后被陌生人打满 CPU）。

### `/local` 人机对弈

- 选执色（黑/白）、难度（1~5）、棋盘尺寸（13/15/19）、规则（休闲/连珠禁手）
- 点棋盘落子，AI 后台思考后应手（SocketIO 实时推送）
- 悔棋、提示、认输
- 「自我进化」开关：下完一局，AI 输了就把防守权重 +0.03（上限 1.80）持久化，下一局自动生效

### `/lab` 实验室（训练=自我对弈调参）

> 先澄清：本项目**没有神经网络，没有需要训练的权重**。这里做的是**用自我对弈搜索引擎超参数**
> （防守权重、候选宽度等旋钮），属于黑箱优化，几十~几百局即可；和深度学习的百万局 + 梯度反传是两回事。

两种策略：坐标搜索（稳慢）/ SPSA（快噪）。结果落盘 `output/tuning/`。

实验室里还有「**网友对局数据**」区块：网页版每局结束，棋谱会追加到 `output/games.jsonl`，
点「导出」下载后拿回本地，喂给调参器，让 AI 从网友的棋里变强（这就是「别人的对局帮模型优化」的闭环）。

---

## 在线负反馈学习 vs 实验室调参

| | 在线学习（/local 的开关） | 实验室调参（/lab） |
|---|---|---|
| 触发 | 每局结束自动 | 手动跑 N 局 |
| 改什么 | 防守权重（±0.03） | 全部可调旋钮 |
| 数据 | 单局（噪声大） | 几十局（噪声被压下去） |
| 持久化 | `profiles/learned.json` | `output/tuning/*.json` |

两者共享同一套 `EngineConfig` 与 `TUNING_SPACE` 合法区间，不冲突。

---

## 目录结构

```
fool-gomoku/
├── run.py                 启动入口（含 RENDER 环境自动 0.0.0.0 + no-browser）
├── start.bat              Windows 一键启动
├── Procfile               Render 启动命令
├── render.yaml            Render Blueprint（Web Service + 健康检查 + 环境变量）
├── requirements.txt       后端最小依赖（Flask + Flask-SocketIO）
├── requirements-web.txt   Render 用（内容一致）
├── engine/                棋力核心（与 UI 完全解耦）
│   ├── board.py           棋盘：2-bit 行打包 + 增量候选点
│   ├── patterns.py        棋型表：262144 项预计算
│   ├── eval.py            评估：空点势能（可插 NNUE）
│   ├── tactics.py         战术：成五点、双威胁、VCF
│   ├── search.py          搜索：迭代加深 αβ + 置换表 + 杀手走法
│   ├── rules.py           连珠禁手
│   ├── config.py          超参数对象（可 JSON 覆盖）
│   ├── tuner.py           自我对弈调参（离线）
│   ├── learn.py           在线负反馈学习
│   └── __init__.py        统一入口 AI(level, rules, config)
├── core/
│   ├── game.py            GameSession 对局状态机
│   ├── profile.py         Profile 数据层
│   └── collector.py       对局棋谱采集（output/games.jsonl）
├── adapters/
│   └── local.py           本地人机对弈适配器
├── app/                   Web 应用
│   ├── __init__.py        Flask 路由 + SocketIO（含实验室 token 鉴权 + 导出 API）
│   ├── state.py           AppState（线程安全）
│   ├── templates/         landing/hub/local/lab 4 个页面模板
│   └── static/            样式、前端 JS、Socket.IO 本地副本
├── web/                   静态前端（GitHub Pages 发布目录）
│   ├── index.html / hub.html / local.html / lab.html
│   ├── config.js          window.API_BASE（指到后端地址）
│   └── static/            style.css / app.js / socket.io.min.js
├── profiles/              配置（本仓库只留 generic.json）
├── tests/                 单元测试（unittest，54 项）
├── assets/                棋型表缓存（首次运行自动生成）
└── output/                运行产物（调参结果、对局棋谱）
```

---

## 棋力设计

搜索顺序（`engine/search.py`）：

1. 终局 / 空盘 → 直接返回
2. 一步成五 → 立刻走
3. 双威胁（双四 / 四+活三）→ 立刻走
4. VCF 必胜搜索 → 按杀棋线走
5. 迭代加深 αβ（步长 2），只采纳跑完整轮的深度

关键优化：棋型表（预计算 262144 项，运行期一次移位查表）、棋盘 2-bit 行打包、候选点剪枝（切比雪夫 ≤2，`bytearray` 增量维护）、放弃国际象棋式 quiescence（改由 VCF 层处理地平线效应）。

难度档位：

| 档位 | 思考时间 | 最大深度 | VCF |
|---|---|---|---|
| 1 | 0.15s | 2 | ✗ |
| 2 | 0.40s | 4 | ✓ |
| 3 | 1.00s | 6 | ✓ |
| 4 | 2.50s | 8 | ✓ |
| 5 | 5.00s | 10 | ✓ |

---

## 开发自检

```bat
python -m unittest discover -s tests -t .     :: 单元测试（54 项）
node --check app/static/app.js                :: 前端 JS 语法
python tools\_check_front.py                  :: 前后端 id 契约
python tools\_smoke_deploy.py                 :: healthz / capabilities / 页面 / 静态文件
```

---

## 已知的「坑」清单

1. **Flask 没开 reload**：改后端代码必须重启 `run.py`。
2. **`board.winner` 是方法**，`board.stone_count` / `board.is_full` 才是属性。
3. **`winning_moves()` / `immediate_move()` 返回一维索引**，要 `(i % size, i // size)` 换算。
4. **`AI.choose()` 返回 tuple**；`AI.analyse()` 才返回 `{"move": {"x", "y"}, ...}`。
5. **`start.bat` 必须纯 ASCII**：cmd 按本地 OEM 代码页解析批处理，UTF-8 中文会崩，中文提示交给 `run.py`。
6. **Render 免费版 15 分钟休眠**：首次请求会冷启动几十秒；对局数据落本地盘，重启会丢（所以才有「导出」按钮手动拿走）。
7. **`GOMOKU_LAB_TOKEN` 别用默认值**：挂网前在 Render 环境变量里改成你自己的口令。

---

## 和原 C++ 项目的关系

原项目是不围棋（Nogo），用 MCTS + EasyX。这个 Python 版把规则换成五子棋（连五 + 可选禁手）、
AI 换成 αβ + VCF + 棋型表（五子棋分支因子小、战术密度高，αβ 比 MCTS 合适）、界面换成 Web 服务。

原有 C++ 文件全部保留在原位置，Python 版是独立子目录，代码里没有任何绝对路径，可整体搬走。
