# 工作留痕：代码精简 + 文档合并 + 部署准备

> 执行时间：2026-11-27（用户睡觉期间，独立执行）
> 工作区：`E:\Code_VS2022_Project\shit_Nogo_UI\fool-gomoku\`

---

## 一、任务来源

用户委托三项收尾任务（工作纪律：独立执行、工作留痕、完成后保存并关机）：

1. **代码精简**：所有代码文件的注释只说明"这部分做什么"，删除思考过程。
2. **文档合并**：把所有 MD 文档合并并精简。
3. **后端部署到 Render**：尽量用命令行完成。

---

## 二、代码注释精简（已完成）

**原则**：模块 docstring 压缩成 3~5 行"做什么"；行内注释只保留语义说明，删除"为什么/设计取舍/历史/对比/性能论证"类内容。

已精简的文件：

| 文件 | 改动要点 |
|---|---|
| `engine/learn.py` | 模块 docstring、LEARNED_PATH/LEARNABLE/_DEFAULT_ANCHOR 注释、apply_outcome 内 win/lose 注释、Learner 类 docstring 删用法示例 |
| `engine/config.py` | 模块 docstring、EvalConfig 字段注释、ROOT 注释、EngineConfig 段注释 |
| `engine/search.py` | Searcher 类 docstring、_negamax 终局注释、_ordered_moves docstring 删 FIVE 推导、必胜/必败注释 |
| `engine/patterns.py` | 模块 docstring、DP 拆表注释 |
| `engine/board.py` | 模块 docstring、_build_geom 第 3/4 步注释、Board 类 docstring 删 numpydoc 段 |
| `engine/eval.py` | 模块 docstring、_POINT_CAP 注释 |
| `engine/__init__.py` | AI 类 docstring、LEVELS 注释、choose 内开局注释 |
| `engine/tactics.py` | 模块 docstring、winning_moves docstring 删性能论证 |
| `engine/tuner.py` | 模块 docstring、基线注释、SPSA docstring |
| `engine/rules.py` | forbidden_reason docstring、四/活三注释 |
| `core/game.py` | 模块 docstring、sync 方法三处注释 |
| `core/collector.py` | 模块 docstring |
| `adapters/local.py` | 模块 docstring |
| `app/state.py` | 模块 docstring |
| `app/__init__.py` | LAB_TOKEN/_lab_ok 注释 |

**未改动**：`tests/`、`tools/` 下的开发/自检脚本（属于开发工具，非交付代码）。

---

## 三、MD 文档合并（已完成）

**合并前**：5 个 MD 文件（README.md、web/README.md、docs/DEPLOY.md、docs/ARCHITECTURE.md、docs/STARTUP.md）。

**合并后**：只保留 **`README.md`** 一个文件，作为唯一完整文档。

删除的文件：
- `docs/ARCHITECTURE.md`（描述的是完整版 GomokuAI 架构，与 web 版无关，已删除）
- `docs/STARTUP.md`（描述完整版启动流程，含识别下棋，与 web 版无关，已删除）
- `docs/DEPLOY.md`（部署步骤已合并进 README.md）
- `web/README.md`（与 README.md 重复，已删除）
- 空的 `docs/` 目录已删除

`README.md` 现包含：项目介绍、架构、快速开始、部署（Render + GitHub Pages）、界面导航、在线学习 vs 实验室对比、目录结构、棋力设计、开发自检、已知坑、与原 C++ 项目关系。

---

## 四、Render 部署（**未能全自动完成**）

### 结论

**命令行部署缺少 API key，无法全自动完成。** 需要用户醒后在 render.com 控制台手动创建 API key，或授权 Render CLI 登录。

### 已探测到的环境事实

| 项 | 状态 |
|---|---|
| Render CLI | 未安装（`render` / `rndr` 命令均不存在） |
| `~/.render` / `~/.config/render` 凭证 | 无 |
| RENDER / RNDR 环境变量 | 无 |
| Node / npm | v22.19.0 / 10.9.3（可 `npx` 装 Render CLI） |
| Render 官方 API key | 只能在 render.com 控制台手动创建，我无法代取 |

### 用户醒后需要做的（照 README「部署」章节操作即可）

1. 打开 https://render.com/，用 GitHub 账号登录。
2. **New → Blueprint**，连接仓库 `Pyy-space/fool-gomoku`（仓库根已有 `render.yaml`，会自动创建 Web Service）。
3. 或在 **Account Settings → API Keys** 创建一个 API key，交给我用命令行部署。
4. 部署完成后拿到后端地址（形如 `https://fool-gomoku.onrender.com`）。
5. 把 `web/config.js` 的 `window.API_BASE` 改成该地址，再推一次 GitHub。

### 部署文件已就绪（无需再写）

- `render.yaml`：Blueprint 定义（Web Service + 依赖 + 环境变量 GOMOKU_LAB_TOKEN）
- `Procfile`：`web: python run.py --host 0.0.0.0 --no-browser`
- `requirements-web.txt`：纯引擎最小依赖（Flask + Flask-SocketIO）
- `run.py`：已支持 `PORT` 环境变量、`RENDER` 环境变量、`/healthz` 健康检查
- `.github/workflows/pages.yml`：GitHub Pages 自动发布（web/ 目录）

---

## 五、验证结果（精简后全部通过）

| 检查项 | 结果 |
|---|---|
| `python -m unittest discover -s tests -t .` | **Ran 54 tests OK** |
| `node --check app/static/app.js` | rc=0 |
| `node --check web/static/app.js` | rc=0 |
| `tools/_check_front.py` | RESULT: PASS |
| `tools/_smoke_deploy.py` | RESULT: PASS（healthz/capabilities/4 页/静态文件/API_BASE） |
| `python -c "import engine, core, adapters, app"` | import OK |

---

## 六、Git 提交

改动已提交并推送（见 git log）。提交内容：代码注释精简 + MD 文档合并。

---

## 七、当前项目状态总结

- **代码**：web 版纯引擎（人机对弈 + 在线学习 + 实验室调参 + 网友对局采集），注释精简完毕。
- **文档**：README.md 唯一完整文档。
- **前端**：GitHub Pages 已上线 https://pyy-space.github.io/fool-gomoku/
- **后端**：等待用户创建 Render API key 后部署（部署文件已全部就绪）。
