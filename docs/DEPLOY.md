# 部署指南（前后端分离）

本项目的应用形态是 **Web 应用**：前端是纯静态页面（可挂 GitHub Pages），后端是 Python API（挂 Render）。

## 一、总体架构

```
┌─────────────────────────┐        HTTPS + CORS        ┌─────────────────────────┐
│  前端（纯静态 SPA）        │  ───────────────────────>  │  后端（Flask API）        │
│  GitHub Pages            │   fetch / Socket.IO       │  Render Web Service      │
│  web/ 目录               │                            │  app/ + engine/ + core/  │
└─────────────────────────┘                            └─────────────────────────┘
```

- **前端**：`web/` 目录，纯 HTML + CSS + JS，无构建、无框架，直接放到静态托管即可。
- **后端**：Flask + Flask-SocketIO，跑纯引擎（人机对弈 / 实验室调参 / 在线学习）。
- **识别下棋**（`/auto`、`/vision`）依赖 Windows 专属 API（窗口截图 + 鼠标注入），**只能在本机 Windows 完整版 `GomokuAI/` 里跑**，本仓库（web 版）已把它移除。

## 二、前端怎么配后端地址

编辑 `web/config.js`，把 `window.API_BASE` 改成你的后端地址（末尾不带斜杠）：

```js
window.API_BASE = "https://fool-gomoku.onrender.com";
```

留空 `""` 表示同源（本地 `python run.py` 时用这个）。

> 前端已经做了适配：`app.js` 里的 `pageHref()` 会在静态部署时用 `xxx.html` 相对路径跳转，
> 在 Flask 版用 `/xxx` 绝对路由。两者不需要改代码。

## 三、部署后端到 Render

### 方式 A：Render Dashboard（推荐新手）

1. 登录 [render.com](https://render.com/)，点 **New + → Web Service**。
2. 连接你的 GitHub 仓库（`Pyy-space/fool-gomoku`）。
3. Render 会自动读仓库根的 `render.yaml`，或手动填：
   - **Build Command**: `pip install -r requirements-web.txt`
   - **Start Command**: `python run.py --host 0.0.0.0 --no-browser`
   - **Health Check Path**: `/healthz`
4. 环境变量里把 `GOMOKU_LAB_TOKEN` 改成你自己的口令（别用默认 `gomoku-lab`）。
5. 部署完成后，记下服务地址（形如 `https://fool-gomoku.onrender.com`）。

### 方式 B：Blueprint（render.yaml）

仓库根已有 `render.yaml`，在 Render 里用 **Blueprint** 一键导入即可。它声明了 Web Service + 依赖 + 环境变量。

### 依赖说明

- Render 用的是 `requirements-web.txt`（纯引擎最小集：Flask + Flask-SocketIO，无 numpy/opencv）。
- 本仓库 `requirements.txt` 与 `requirements-web.txt` 内容一致（web 版已精简掉识别下棋，没有 numpy/opencv/mss/pywin32 依赖）。
- 识别下棋的完整依赖（numpy / opencv / mss / pywin32）在本地完整版 `GomokuAI/` 的 `requirements.txt` 里。

## 四、部署前端到 GitHub Pages

1. 把 `web/` 目录里的内容推到仓库（`web/index.html` 就是首页）。
2. 在 GitHub 仓库 → **Settings → Pages**，把 **Source** 选成 `main` 分支的 `/web` 目录。
3. 保存后等几分钟，会得到 `https://Pyy-space.github.io/fool-gomoku/` 这样的地址。

> 注意：GitHub Pages 挂在子路径下（`/fool-gomoku/`），而前端已用相对 `xxx.html` 跳转，
> 所以能正常工作。**不要**把首页里的链接写成 `/hub` 这种绝对路径。

## 五、本地跑（开发）

本地跑 web 版（前端+后端同源）：

```bat
双击 start.bat
:: 或
python run.py
```

> 想要「识别下棋」完整功能，请切到本地完整版 `GomokuAI/` 目录（它额外带 vision/ control/
> core/window.py、adapters/window.py 与 profiles/yanyun.json），跑法相同。

## 六、免费版注意事项

1. **15 分钟休眠**：Render 免费版无流量 15 分钟后会休眠，首次请求要冷启动几十秒。想省事可定时访问 `/healthz` 保活。
2. **WebSocket 不稳定**：免费版长连接容易被断。前端已经做了「Socket.IO 连不上就降级 HTTP 轮询/同步接口」的处理，AI 应手改用同步接口也能用。
3. **CPU 受限**：实验室调参（机器对弈）很吃 CPU，免费版跑大规模会慢，属于预期。

## 七、仓库名

仓库名定为 **`fool-gomoku`**（傻子五子棋），自嘲式直白，符合 GitHub 小写连字符规范。
