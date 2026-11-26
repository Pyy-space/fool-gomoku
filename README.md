# 傻子五子棋 AI（fool-gomoku）

一个会自我进化的五子棋 AI，做成分离式 Web 应用：前端是纯静态页面（挂 GitHub Pages），
后端是纯 Python 引擎 API（挂 Render）。

本仓库是 **web 版**，只保留纯引擎能提供的能力：

- **人机对弈**：网页棋盘直接和 AI 下，可选手执黑/白、难度、棋盘尺寸、禁手规则
- **在线负反馈学习**：AI 下输后把这局胜负喂回来，微调防守权重，下一局更强
- **实验室**（隐藏入口）：让 AI 自己和自己下很多局，搜索引擎超参数
- **网友对局采集**：每局棋谱自动落盘，实验室里一键导出，拿回本地喂调参器

> 本仓库**不含「识别下棋」**（从游戏窗口截图识别棋盘 + 自动点鼠标落子）。那部分依赖
> Windows 专属 API，云端 Linux 没有屏幕也没有鼠标，物理上无法实现。识别下棋的完整能力
> 在**本地完整版 `GomokuAI/`** 目录里，与本仓库共享同一套引擎。

---

## 架构

```
GitHub Pages（前端，纯静态）          Render（后端，纯 API）
   web/*.html + web/static/app.js  ──HTTP/JSON──▶  Flask + SocketIO（engine/ core/ adapters/local）
```

前端通过 `web/config.js` 里的 `window.API_BASE` 指向后端地址；后端已开 CORS，跨域可用。

---

## 快速开始

```bat
pip install -r requirements.txt
python run.py
```

浏览器打开 `http://127.0.0.1:5000/`。或用 `start.bat` 一键启动（会自动装依赖）。

---

## 部署

### 后端到 Render

仓库根已有 `render.yaml`（Blueprint）。在 Render 控制台用 **New → Blueprint** 连接本仓库，
一键创建 Web Service；或手动建 Web Service：

- Build Command：`pip install -r requirements-web.txt`
- Start Command：`python run.py --host 0.0.0.0 --no-browser`
- Health Check Path：`/healthz`
- 环境变量 `GOMOKU_LAB_TOKEN` 改成自己的口令（别用默认 `gomoku-lab`）

部署完成后拿到后端地址，形如 `https://fool-gomoku.onrender.com`。

### 前端到 GitHub Pages

`web/` 目录已通过 `.github/workflows/pages.yml` 自动发布到 GitHub Pages：

- 站点地址：`https://pyy-space.github.io/fool-gomoku/`

然后把 `web/config.js` 的 `window.API_BASE` 改成后端地址（末尾不带斜杠）再推一次：

```js
window.API_BASE = "https://fool-gomoku.onrender.com";
```

留空 `""` 表示同源（本地 `python run.py` 时用这个）。

> GitHub Pages 挂在子路径下，前端已用相对 `xxx.html` 跳转，能正常工作。**不要**把首页链接写成 `/hub` 这种绝对路径。

---

## 界面导航（三层）

```
/           落地页
/hub        模式选择（人机对弈）
  /local    人机对弈（含「自我进化」开关）
  /lab      实验室（训练=机器对弈调参，隐藏入口）
```

### 隐藏入口：实验室

1. 在任意页面的**页脚版本号 `v1.0` 上连点 5 次**（1.6 秒内），跳转 `/lab`；
2. 进入后还需输入**访问口令**（默认 `gomoku-lab`，可用环境变量 `GOMOKU_LAB_TOKEN` 覆盖）。

两层防护：彩蛋负责隐蔽，口令负责真锁（后端 API 加 token 鉴权，防挂网后被陌生人打满 CPU）。

---

## 在线学习 vs 实验室调参

本项目**没有神经网络权重**。实验室调的是防守权重、搜索宽度等无解析最优值的超参数旋钮，
用自我对弈黑箱优化；在线学习只微调 `defense_weight` 一个浮点。

| | 在线学习（/local） | 实验室调参（/lab） |
|---|---|---|
| 触发 | 每局结束自动 | 手动跑 N 局 |
| 改什么 | 防守权重（±0.03） | 全部可调旋钮 |
| 数据 | 单局（噪声大） | 几十局（噪声被压平） |
| 持久化 | `profiles/learned.json` | `output/tuning/*.json` |

两者共享同一套 `EngineConfig` 与 `TUNING_SPACE` 合法区间，不冲突。

---

## 目录结构

```
fool-gomoku/
├── run.py               启动入口
├── start.bat            Windows 一键启动
├── Procfile / render.yaml   Render 部署
├── requirements*.txt    依赖（两文件内容一致）
├── engine/              棋力核心（与 UI 完全解耦）
│   ├── board.py         棋盘：2-bit 行打包 + 增量候选点
│   ├── patterns.py      棋型表：262144 项预计算
│   ├── eval.py          评估：空点势能
│   ├── tactics.py       战术：成五点、双威胁、VCF
│   ├── search.py        迭代加深 αβ + 置换表 + 杀手走法
│   ├── rules.py         连珠禁手
│   ├── config.py        超参数对象（可 JSON 覆盖）
│   ├── tuner.py         自我对弈调参
│   ├── learn.py         在线负反馈学习
│   └── __init__.py      统一入口 AI(level, rules, config)
├── core/
│   ├── game.py          GameSession 对局状态机
│   ├── profile.py       Profile 数据层
│   └── collector.py     对局棋谱采集（output/games.jsonl）
├── adapters/local.py    本地人机对弈适配器
├── app/                 Flask 路由 + SocketIO + 页面模板 + 静态资源
├── web/                 静态前端（GitHub Pages 发布目录）
├── profiles/            配置（只留 generic.json）
├── tests/               单元测试（unittest）
├── assets/              棋型表缓存（首次运行自动生成）
└── output/              运行产物（调参结果、对局棋谱）
```

---

## 棋力设计

搜索顺序：终局/空盘 → 一步成五 → 双威胁 → VCF 必胜 → 迭代加深 αβ（只采纳跑完整轮）。

难度档位：1（0.15s/深2/无VCF）、2（0.40s/深4）、3（1.00s/深6）、4（2.50s/深8）、5（5.00s/深10）。

---

## 开发自检

```bat
python -m unittest discover -s tests -t .     :: 单元测试
node --check app/static/app.js                :: 前端 JS 语法
python tools\_check_front.py                  :: 前后端 id 契约
python tools\_smoke_deploy.py                 :: healthz / capabilities / 页面 / 静态文件
```

---

## 已知坑

1. **Flask 没开 reload**：改后端代码必须重启 `run.py`。
2. **`board.winner` 是方法**，`board.stone_count` / `board.is_full` 才是属性。
3. **`winning_moves()` / `immediate_move()` 返回一维索引**，要 `(i % size, i // size)` 换算。
4. **`AI.choose()` 返回 tuple**；`AI.analyse()` 才返回 `{"move": {"x", "y"}, ...}`。
5. **`start.bat` 必须纯 ASCII**：cmd 按本地 OEM 代码页解析批处理，UTF-8 中文会崩。
6. **Render 免费版 15 分钟休眠**：首次请求冷启动几十秒；对局数据落本地盘，重启会丢（故实验室有「导出」按钮手动拿走）。
7. **`GOMOKU_LAB_TOKEN` 别用默认值**：挂网前在 Render 环境变量里改成自己的口令。

---

## 和原 C++ 项目的关系

原项目是不围棋（Nogo），用 MCTS + EasyX。本 Python 版把规则换成五子棋（连五 + 可选禁手）、
AI 换成 αβ + VCF + 棋型表，界面换成 Web 服务。原有 C++ 文件全部保留在原位置，Python 版是独立目录，
代码无任何绝对路径，可整体搬走。
