/*!
 * 五子棋引擎 —— 纯前端零依赖实现（由 Python 版 engine/ 逐模块移植）
 *
 * 坐标系：x 向右、y 向下；棋盘一维存储，idx = y * size + x。
 * 模块用 IIFE 挂到全局（window.GomokuEngine / globalThis.GomokuEngine），
 * 既能在浏览器直接 <script> 引入，也能被 node require。
 *
 * 主要内容：
 *   - 棋型识别：9 格窗口精确推演（活四/冲四/活三/眠三/活二/二）
 *   - 棋盘：线打包、Zobrist 哈希、增量候选点
 *   - 战术：一步成五、必防、双威胁、VCF
 *   - 搜索：迭代加深 αβ + 置换表 + 走法排序 + 杀手走法
 *   - 规则：休闲 / 连珠（黑禁长连、双四、双三）
 *   - 在线学习：Learner（防守权重微调）
 */
(function (root) {
  "use strict";

  /* =======================================================================
   * 常量
   * ===================================================================== */
  var EMPTY = 0, BLACK = 1, WHITE = 2;

  var NONE = "NONE";
  var FIVE = "FIVE";
  var OPEN_FOUR = "OPEN_FOUR";
  var FOUR = "FOUR";
  var OPEN_THREE = "OPEN_THREE";
  var THREE = "THREE";
  var OPEN_TWO = "OPEN_TWO";
  var TWO = "TWO";

  // 形状由弱到强（下标即形状编号）
  var SHAPE_NAMES = [NONE, TWO, OPEN_TWO, THREE, OPEN_THREE, FOUR, OPEN_FOUR, FIVE];
  var SHAPE_INDEX = {
    NONE: 0, TWO: 1, OPEN_TWO: 2, THREE: 3,
    OPEN_THREE: 4, FOUR: 5, OPEN_FOUR: 6, FIVE: 7
  };
  var SHAPE_RANK = [0, 1, 2, 3, 4, 5, 6, 7];

  // 单方向形状分（与 Python DIR_SHAPE_SCORE 完全一致）
  var SHAPE_SCORE = {
    NONE: 0,
    TWO: 15,
    OPEN_TWO: 120,
    THREE: 300,
    OPEN_THREE: 3000,
    FOUR: 9000,
    OPEN_FOUR: 120000,
    FIVE: 10000000
  };
  var SCORE_BY_IDX = [0, 15, 120, 300, 3000, 9000, 120000, 10000000];

  var FIVE_SCORE = 10000000;     // 一步成五阈值
  var WIN_LEN = 5;
  var SPAN = 4;
  var WINDOW_LEN = 2 * SPAN + 1;   // 9
  var MASK18 = (1 << 18) - 1;
  var PACKED_SIZE = 1 << 18;       // 4^9

  // 四方向：横、竖、撇（↘）、捺（↗）
  var DX = [1, 0, 1, 1];
  var DY = [0, 1, 1, -1];

  var CANDIDATE_RADIUS = 2;

  // 2 的幂（线打包用浮点精确表示，最多用到 2^52）
  var POW = new Float64Array(64);
  for (var _pi = 0; _pi < 64; _pi++) POW[_pi] = Math.pow(2, _pi);

  var now = (typeof performance !== "undefined" && performance && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* =======================================================================
   * 几何预计算（按棋盘尺寸缓存）
   *   - base[d][lineId]：该线的初始打包值（两端各 4 格墙）
   *   - flatLI/flatIP/flatPP：每个点每方向的 (线号, 取窗倒数幂, 落子位移)
   *   - ring：每个点的切比雪夫半径 2 邻域
   * ===================================================================== */
  var _GEOM = {};

  function _buildGeom(size) {
    var x, y, d, k, li;
    var lineCells = [[], [], [], []];

    for (y = 0; y < size; y++) {
      var row = [];
      for (x = 0; x < size; x++) row.push(y * size + x);
      lineCells[0].push(row);
    }
    for (x = 0; x < size; x++) {
      var col = [];
      for (y = 0; y < size; y++) col.push(y * size + x);
      lineCells[1].push(col);
    }
    for (d = -(size - 1); d < size; d++) {
      var diag = [];
      var dx0 = Math.max(0, -d), dx1 = Math.min(size - 1, size - 1 - d);
      for (x = dx0; x <= dx1; x++) diag.push((x + d) * size + x);
      lineCells[2].push(diag);
    }
    for (var s = 0; s < 2 * size - 1; s++) {
      var anti = [];
      var ax0 = Math.max(0, s - (size - 1)), ax1 = Math.min(size - 1, s);
      for (x = ax0; x <= ax1; x++) anti.push((s - x) * size + x);
      lineCells[3].push(anti);
    }

    // 打包：低 4 格是前置墙，接着是棋盘格，再后 4 格后置墙。
    var direct = (2 * (size + 8)) > 52;   // 超过 52 位：退回直接读格
    var base = [[], [], [], []];
    for (d = 0; d < 4; d++) {
      var lists = lineCells[d];
      for (li = 0; li < lists.length; li++) {
        var len = lists[li].length;
        var packed = 0;
        for (k = 0; k < SPAN; k++) packed += 3 * POW[2 * k];
        for (k = 0; k < SPAN; k++) packed += 3 * POW[2 * (SPAN + len + k)];
        base[d].push(packed);
      }
    }

    var nn = size * size;
    var flatLI = new Int32Array(nn * 4);
    var flatIP = new Float64Array(nn * 4);
    var flatPP = new Float64Array(nn * 4);
    var px = new Int8Array(nn), py = new Int8Array(nn);
    for (var p = 0; p < nn; p++) {
      px[p] = p % size;
      py[p] = (p / size) | 0;
    }
    for (d = 0; d < 4; d++) {
      var ls = lineCells[d];
      for (li = 0; li < ls.length; li++) {
        var cells = ls[li];
        for (k = 0; k < cells.length; k++) {
          var pos = cells[k], f = pos * 4 + d;
          flatLI[f] = li;
          flatIP[f] = Math.pow(2, -2 * k);
          flatPP[f] = POW[2 * (SPAN + k)];
        }
      }
    }

    // 半径 2 邻域（含自身）
    var ring = new Array(nn);
    var r = CANDIDATE_RADIUS;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        var cellList = [];
        for (var ny = Math.max(0, y - r); ny <= Math.min(size - 1, y + r); ny++) {
          for (var nx = Math.max(0, x - r); nx <= Math.min(size - 1, x + r); nx++) {
            cellList.push(ny * size + nx);
          }
        }
        ring[y * size + x] = Int32Array.from(cellList);
      }
    }

    return {
      size: size,
      direct: direct,
      base: base,
      flatLI: flatLI,
      flatIP: flatIP,
      flatPP: flatPP,
      px: px,
      py: py,
      ring: ring,
      candBuf: new Int32Array(nn),
      evalBuf: new Int32Array(nn)
    };
  }

  function _geomFor(size) {
    var g = _GEOM[size];
    if (!g) { g = _buildGeom(size); _GEOM[size] = g; }
    return g;
  }

  /* =======================================================================
   * 棋型表：18 位窗口码 → 形状编号
   *   窗口码：每 2 bit 一格，0 空 / 1 黑 / 2 白 / 3 墙，中心恒在 bit 8-9。
   *   按颜色懒建 memo（Int8Array(4^9)，-1 未计算），等价于 Python 预计算表。
   * ===================================================================== */
  var _SHAPE_MEMO = [null, null, null];

  // 每色把 2-bit 格值翻译成「己方 / 阻挡」两个位掩码的查表（低 4 格 + 高 5 格）
  var _CONV = [null, null, null];

  function _buildConv(color) {
    var loOwn = new Uint16Array(256), loBlk = new Uint16Array(256);
    var hiOwn = new Uint16Array(1024), hiBlk = new Uint16Array(1024);
    var code, i, v, o, b;
    for (code = 0; code < 256; code++) {
      o = 0; b = 0;
      for (i = 0; i < 4; i++) {
        v = (code >> (2 * i)) & 3;
        if (v === color) o |= 1 << i;
        else if (v !== 0) b |= 1 << i;
      }
      loOwn[code] = o; loBlk[code] = b;
    }
    for (code = 0; code < 1024; code++) {
      o = 0; b = 0;
      for (i = 0; i < 5; i++) {
        v = (code >> (2 * i)) & 3;
        if (v === color) o |= 1 << (4 + i);
        else if (v !== 0) b |= 1 << (4 + i);
      }
      hiOwn[code] = o; hiBlk[code] = b;
    }
    return { loOwn: loOwn, loBlk: loBlk, hiOwn: hiOwn, hiBlk: hiBlk };
  }

  // 9 位内的 popcount
  var _POP = new Uint8Array(512);
  (function () {
    for (var i = 0; i < 512; i++) {
      var c = 0, v = i;
      while (v) { c += v & 1; v >>= 1; }
      _POP[i] = c;
    }
  })();

  // 是否存在五连（own 为 9 位己方位图）
  function _hasFiveMask(own) {
    return ((own & (own >> 1) & (own >> 2) & (own >> 3) & (own >> 4)) & 0x1F) !== 0;
  }

  /**
   * 精确分类：与 Python patterns.classify 等价（两级推演）。
   * own/blocked 均为 9 位掩码，第 i 位对应窗口第 i 格。
   */
  function _classifyMasks(own, blocked) {
    if ((own & 16) === 0) return 0;            // 中心必须是己方
    if (_hasFiveMask(own)) return 7;           // FIVE

    var free = (~(own | blocked)) & 0x1FF;
    var s, W, q, r, bq, br, own1, own2, free1, free2, w, c;

    // 冲四 / 活四：补一子即可成五的点数
    w = 0;
    for (s = 0; s < 5; s++) {
      W = 31 << s;
      if (blocked & W) continue;
      if (_POP[own & W] === 4) w |= (W & free);
    }
    c = _POP[w & 0x1FF];
    if (c >= 2) return 6;                      // OPEN_FOUR
    if (c === 1) return 5;                     // FOUR

    // 眠三 / 活三：补一子后能形成冲四 / 活四
    var fourMaker = false;
    q = free;
    while (q) {
      bq = q & -q; q ^= bq;
      own1 = own | bq;
      free1 = free ^ bq;
      w = 0;
      for (s = 0; s < 5; s++) {
        W = 31 << s;
        if (blocked & W) continue;
        if (_POP[own1 & W] === 4) w |= (W & free1);
      }
      c = _POP[w & 0x1FF];
      if (c >= 2) return 4;                    // OPEN_THREE
      if (c === 1) fourMaker = true;
    }
    if (fourMaker) return 3;                   // THREE

    // 二 / 活二：补两子后能形成冲四 / 活四
    var threeMaker = false;
    q = free;
    while (q) {
      bq = q & -q; q ^= bq;
      own1 = own | bq;
      free1 = free ^ bq;
      r = free1;
      while (r) {
        br = r & -r; r ^= br;
        own2 = own1 | br;
        free2 = free1 ^ br;
        w = 0;
        for (s = 0; s < 5; s++) {
          W = 31 << s;
          if (blocked & W) continue;
          if (_POP[own2 & W] === 4) w |= (W & free2);
        }
        c = _POP[w & 0x1FF];
        if (c >= 2) return 2;                  // OPEN_TWO
        if (c === 1) threeMaker = true;
      }
    }
    if (threeMaker) return 1;                  // TWO
    return 0;                                  // NONE
  }

  function _shapeMemo(color) {
    var m = _SHAPE_MEMO[color];
    if (!m) {
      m = new Int8Array(PACKED_SIZE);
      m.fill(-1);
      _SHAPE_MEMO[color] = m;
    }
    return m;
  }

  function _conv(color) {
    var c = _CONV[color];
    if (!c) { c = _buildConv(color); _CONV[color] = c; }
    return c;
  }

  /** 窗口码（中心视为 color 落子）→ 形状编号；memo 懒计算。 */
  function _shapeIndexOf(color, code) {
    var memo = _shapeMemo(color);
    var v = memo[code];
    if (v >= 0) return v;
    var conv = _conv(color);
    var own = conv.loOwn[code & 255] | conv.hiOwn[code >> 8];
    var blocked = conv.loBlk[code & 255] | conv.hiBlk[code >> 8];
    v = _classifyMasks(own, blocked);
    memo[code] = v;
    return v;
  }

  /** 形状名：等价 Python patterns.shape_name(color, code)（中心强制为己方）。 */
  function shapeNameOf(color, code) {
    return SHAPE_NAMES[_shapeIndexOf(color, code | (color << 8))];
  }

  function _scoreOf(color, code) {
    return SCORE_BY_IDX[_shapeIndexOf(color, code | (color << 8))];
  }

  /* =======================================================================
   * 棋盘
   * ===================================================================== */
  var _W4 = new Int32Array(4);
  var _pairAtk = 0, _pairDef = 0;

  /** 取 (idx 为中心) 四方向 9 格窗口码，结果放在 _W4。 */
  function _fillWin4(bd, idx) {
    if (bd._direct) {
      var size = bd.size, g = bd.grid;
      var x = bd._px[idx], y = bd._py[idx];
      for (var d = 0; d < 4; d++) {
        var dx = DX[d], dy = DY[d], code = 0;
        for (var i = 0; i < 9; i++) {
          var nx = x + dx * (i - 4), ny = y + dy * (i - 4);
          var v = (nx >= 0 && nx < size && ny >= 0 && ny < size) ? g[ny * size + nx] : 3;
          code += v * POW[2 * i];
        }
        _W4[d] = code;
      }
      return;
    }
    var f = idx << 2, LI = bd._flatLI, IP = bd._flatIP, L = bd._lines;
    _W4[0] = Math.floor(L[0][LI[f]] * IP[f]) % PACKED_SIZE;
    _W4[1] = Math.floor(L[1][LI[f + 1]] * IP[f + 1]) % PACKED_SIZE;
    _W4[2] = Math.floor(L[2][LI[f + 2]] * IP[f + 2]) % PACKED_SIZE;
    _W4[3] = Math.floor(L[3][LI[f + 3]] * IP[f + 3]) % PACKED_SIZE;
  }

  function _pointScoreAt(bd, idx, color) {
    if (bd.grid[idx] !== 0) { _pairAtk = 0; return 0; }
    _fillWin4(bd, idx);
    var sh = (color << 8);
    _pairAtk = SCORE_BY_IDX[_shapeIndexOf(color, _W4[0] | sh)]
      + SCORE_BY_IDX[_shapeIndexOf(color, _W4[1] | sh)]
      + SCORE_BY_IDX[_shapeIndexOf(color, _W4[2] | sh)]
      + SCORE_BY_IDX[_shapeIndexOf(color, _W4[3] | sh)];
    return _pairAtk;
  }

  function _pointPairScore(bd, idx, color) {
    if (bd.grid[idx] !== 0) { _pairAtk = 0; _pairDef = 0; return; }
    _fillWin4(bd, idx);
    var me = color << 8, other = 3 - color, op = other << 8;
    _pairAtk = SCORE_BY_IDX[_shapeIndexOf(color, _W4[0] | me)]
      + SCORE_BY_IDX[_shapeIndexOf(color, _W4[1] | me)]
      + SCORE_BY_IDX[_shapeIndexOf(color, _W4[2] | me)]
      + SCORE_BY_IDX[_shapeIndexOf(color, _W4[3] | me)];
    _pairDef = SCORE_BY_IDX[_shapeIndexOf(other, _W4[0] | op)]
      + SCORE_BY_IDX[_shapeIndexOf(other, _W4[1] | op)]
      + SCORE_BY_IDX[_shapeIndexOf(other, _W4[2] | op)]
      + SCORE_BY_IDX[_shapeIndexOf(other, _W4[3] | op)];
  }

  // Zobrist 表（按尺寸缓存；两套 32 位表，合成 53 位置换表键）
  var _ZOB = {};

  function _mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0);
    };
  }

  // 均匀分布在 [0,1) 的随机数。_mulberry32 返回的是 uint32，直接拿去做
  // Math.floor(r * n) % n 会永远得到 0，所以这里单独归一化一份。
  function _rand01(seed) {
    var m = _mulberry32(seed);
    return function () { return m() / 4294967296; };
  }

  function _zobrist(size) {
    var z = _ZOB[size];
    if (z) return z;
    var rng = _mulberry32(0x5EED + size);
    var nn = size * size;
    var a = new Int32Array(nn * 3), b = new Int32Array(nn * 3);
    for (var i = 0; i < nn; i++) {
      a[i * 3] = 0; b[i * 3] = 0;
      a[i * 3 + 1] = rng() | 0; b[i * 3 + 1] = rng() | 0;
      a[i * 3 + 2] = rng() | 0; b[i * 3 + 2] = rng() | 0;
    }
    z = { a: a, b: b, sideA: rng() | 0, sideB: rng() | 0 };
    _ZOB[size] = z;
    return z;
  }

  function _fillNear(bd, buf) {
    var size = bd.size, total = size * size;
    var near = bd._near, grid = bd.grid, cnt = 0;
    if (bd._n === 0) {
      var c = size >> 1;
      buf[0] = c * size + c;
      return 1;
    }
    for (var i = 0; i < total; i++) {
      if (near[i] > 0 && grid[i] === 0) buf[cnt++] = i;
    }
    return cnt;
  }

  function Board(size, rules) {
    if (size && typeof size === "object") {
      var o = size;
      size = o.size;
      rules = o.rules;
    }
    size = (size === undefined || size === null) ? 15 : (size | 0);
    if (size < 5) size = 15;

    var geom = _geomFor(size);
    var zb = _zobrist(size);
    var nn = size * size;

    this.size = size;
    this.rules = (rules === "renju") ? "renju" : "casual";
    this.grid = new Int8Array(nn);
    this.side = BLACK;
    this._n = 0;
    this._mv = new Int32Array(nn);
    this._mc = new Int8Array(nn);
    this._geom = geom;
    this._direct = geom.direct;
    this._flatLI = geom.flatLI;
    this._flatIP = geom.flatIP;
    this._flatPP = geom.flatPP;
    this._px = geom.px;
    this._py = geom.py;
    this._ring = geom.ring;
    this._near = new Int16Array(nn);
    this._lines = this._direct ? null : [
      Float64Array.from(geom.base[0]),
      Float64Array.from(geom.base[1]),
      Float64Array.from(geom.base[2]),
      Float64Array.from(geom.base[3])
    ];
    this._zA = zb.a;
    this._zB = zb.b;
    this._sideA = zb.sideA;
    this._sideB = zb.sideB;
    this._hA = 0;
    this._hB = 0;
  }

  Board.prototype.index = function (x, y) { return y * this.size + x; };

  Board.prototype.inside = function (x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  };

  Board.prototype.get = function (x, y) {
    if (!this.inside(x, y)) return -1;
    return this.grid[y * this.size + x];
  };

  Board.prototype.isEmptyAt = function (x, y) {
    return this.inside(x, y) && this.grid[y * this.size + x] === EMPTY;
  };

  Object.defineProperty(Board.prototype, "stoneCount", {
    get: function () { return this._n; }
  });

  Object.defineProperty(Board.prototype, "isFull", {
    get: function () { return this._n === this.size * this.size; }
  });

  Object.defineProperty(Board.prototype, "hash", {
    get: function () { return this._hA | 0; }
  });

  Object.defineProperty(Board.prototype, "over", {
    get: function () { return this.winner() !== 0 || this._n === this.size * this.size; }
  });

  /** 落子记录：[{x, y, color}]（按落子顺序）。 */
  Object.defineProperty(Board.prototype, "moves", {
    get: function () {
      var out = new Array(this._n), size = this.size;
      for (var i = 0; i < this._n; i++) {
        var idx = this._mv[i];
        out[i] = { x: idx % size, y: (idx / size) | 0, color: this._mc[i] };
      }
      return out;
    }
  });

  /** 包含轮次信息的 53 位键（置换表 / VCF 去重用）。 */
  Board.prototype._zobristKey = function () {
    var a = this._hA, b = this._hB;
    if (this.side === BLACK) { a ^= this._sideA; b ^= this._sideB; }
    return (a >>> 0) + ((b & 0x1FFFFF) * 4294967296);
  };

  Board.prototype._push = function (idx, color) {
    var g = this.grid;
    g[idx] = color;
    this._hA ^= this._zA[idx * 3 + color];
    this._hB ^= this._zB[idx * 3 + color];
    if (!this._direct) {
      var f = idx << 2, LI = this._flatLI, PP = this._flatPP, L = this._lines;
      L[0][LI[f]] += color * PP[f];
      L[1][LI[f + 1]] += color * PP[f + 1];
      L[2][LI[f + 2]] += color * PP[f + 2];
      L[3][LI[f + 3]] += color * PP[f + 3];
    }
    var n = this._n;
    this._mv[n] = idx;
    this._mc[n] = color;
    this._n = n + 1;
    var ring = this._ring[idx], near = this._near, i, len = ring.length;
    for (i = 0; i < len; i++) near[ring[i]]++;
    this.side = 3 - color;
  };

  Board.prototype._pop = function () {
    var n = this._n;
    if (n === 0) return -1;
    n -= 1;
    this._n = n;
    var idx = this._mv[n], color = this._mc[n];
    this.grid[idx] = 0;
    this._hA ^= this._zA[idx * 3 + color];
    this._hB ^= this._zB[idx * 3 + color];
    if (!this._direct) {
      var f = idx << 2, LI = this._flatLI, PP = this._flatPP, L = this._lines;
      L[0][LI[f]] -= color * PP[f];
      L[1][LI[f + 1]] -= color * PP[f + 1];
      L[2][LI[f + 2]] -= color * PP[f + 2];
      L[3][LI[f + 3]] -= color * PP[f + 3];
    }
    var ring = this._ring[idx], near = this._near, i, len = ring.length;
    for (i = 0; i < len; i++) near[ring[i]]--;
    this.side = color;
    return idx;
  };

  Board.prototype.place = function (x, y) {
    return this.placeColor(x, y, this.side);
  };

  Board.prototype.placeColor = function (x, y, color) {
    if (!this.inside(x, y)) return false;
    var idx = y * this.size + x;
    if (this.grid[idx] !== EMPTY) return false;
    this._push(idx, color);
    return true;
  };

  Board.prototype.undo = function () {
    if (this._n === 0) return null;
    var idx = this._pop();
    return { x: idx % this.size, y: (idx / this.size) | 0 };
  };

  Board.prototype.clone = function () {
    var b = Object.create(Board.prototype);
    b.size = this.size;
    b.rules = this.rules;
    b.grid = this.grid.slice();
    b.side = this.side;
    b._n = this._n;
    b._mv = this._mv.slice();
    b._mc = this._mc.slice();
    b._geom = this._geom;
    b._direct = this._direct;
    b._flatLI = this._flatLI;
    b._flatIP = this._flatIP;
    b._flatPP = this._flatPP;
    b._px = this._px;
    b._py = this._py;
    b._ring = this._ring;
    b._near = this._near.slice();
    b._lines = this._direct ? null : [
      this._lines[0].slice(), this._lines[1].slice(),
      this._lines[2].slice(), this._lines[3].slice()
    ];
    b._zA = this._zA;
    b._zB = this._zB;
    b._sideA = this._sideA;
    b._sideB = this._sideB;
    b._hA = this._hA;
    b._hB = this._hB;
    return b;
  };

  Board.prototype.lastMove = function () {
    if (this._n === 0) return null;
    var idx = this._mv[this._n - 1];
    return { x: idx % this.size, y: (idx / this.size) | 0 };
  };

  function _runLength(g, size, x, y, dx, dy, color) {
    var n = 1, nx = x + dx, ny = y + dy;
    while (nx >= 0 && nx < size && ny >= 0 && ny < size && g[ny * size + nx] === color) {
      n++; nx += dx; ny += dy;
    }
    nx = x - dx; ny = y - dy;
    while (nx >= 0 && nx < size && ny >= 0 && ny < size && g[ny * size + nx] === color) {
      n++; nx -= dx; ny -= dy;
    }
    return n;
  }

  function _winAtIdx(bd, idx) {
    var g = bd.grid, color = g[idx];
    if (color === EMPTY) return false;
    var size = bd.size, x = bd._px[idx], y = bd._py[idx];
    var exact = (bd.rules === "renju" && color === BLACK);
    for (var d = 0; d < 4; d++) {
      var run = _runLength(g, size, x, y, DX[d], DY[d], color);
      if (exact) {
        if (run === WIN_LEN) return true;      // 连珠：黑必须恰好五连
      } else if (run >= WIN_LEN) {
        return true;
      }
    }
    return false;
  }

  Board.prototype.isWinAt = function (x, y) {
    if (!this.inside(x, y)) return false;
    return _winAtIdx(this, y * this.size + x);
  };

  Board.prototype.countRun = function (x, y, dx, dy, color) {
    if (color === undefined || color === null) color = this.get(x, y);
    if (color === EMPTY || color === -1) return 0;
    return _runLength(this.grid, this.size, x, y, dx, dy, color);
  };

  Board.prototype.winner = function () {
    if (this._n === 0) return 0;
    var idx = this._mv[this._n - 1];
    return _winAtIdx(this, idx) ? this.grid[idx] : 0;
  };

  /** 以 (x,y) 为中心、四方向 9 格窗口码（与 Python windows4 一致）。 */
  Board.prototype.windows4 = function (x, y) {
    _fillWin4(this, y * this.size + x);
    return [_W4[0], _W4[1], _W4[2], _W4[3]];
  };

  Board.prototype.windowCode = function (x, y, dirIndex) {
    _fillWin4(this, y * this.size + x);
    return _W4[dirIndex];
  };

  Board.prototype.neighbourhood = function (radius) {
    var r = (radius === undefined || radius === null) ? CANDIDATE_RADIUS : radius;
    if (this._n === 0) {
      var c = this.size >> 1;
      return [c * this.size + c];
    }
    if (r === CANDIDATE_RADIUS) {
      var buf = new Int32Array(this.size * this.size);
      var cnt = _fillNear(this, buf);
      var out = new Array(cnt);
      for (var i = 0; i < cnt; i++) out[i] = buf[i];
      return out;
    }
    var size = this.size;
    var marks = new Uint8Array(size * size);
    for (var m = 0; m < this._n; m++) {
      var idx = this._mv[m];
      var mx = idx % size, my = (idx / size) | 0;
      var y0 = Math.max(0, my - r), y1 = Math.min(size - 1, my + r);
      var x0 = Math.max(0, mx - r), x1 = Math.min(size - 1, mx + r);
      for (var ny = y0; ny <= y1; ny++) {
        var base = ny * size;
        for (var nx = x0; nx <= x1; nx++) marks[base + nx] = 1;
      }
    }
    var res = [];
    for (var k = 0; k < marks.length; k++) {
      if (marks[k] && this.grid[k] === EMPTY) res.push(k);
    }
    return res;
  };

  Board.prototype.candidates = function (radius) {
    var idxs = this.neighbourhood(radius), size = this.size;
    var out = new Array(idxs.length);
    for (var i = 0; i < idxs.length; i++) {
      out[i] = { x: idxs[i] % size, y: (idxs[i] / size) | 0 };
    }
    return out;
  };

  Board.prototype.toList = function () {
    var out = new Array(this.grid.length);
    for (var i = 0; i < out.length; i++) out[i] = this.grid[i];
    return out;
  };

  Board.prototype.toRows = function () {
    var size = this.size, rows = new Array(size);
    for (var r = 0; r < size; r++) {
      var row = new Array(size);
      for (var c = 0; c < size; c++) row[c] = this.grid[r * size + c];
      rows[r] = row;
    }
    return rows;
  };

  Board.prototype.fullLine = function (x, y, dx, dy) {
    var size = this.size, g = this.grid;
    var sx = x, sy = y;
    while (sx - dx >= 0 && sx - dx < size && sy - dy >= 0 && sy - dy < size) {
      sx -= dx; sy -= dy;
    }
    var out = [];
    var cx = sx, cy = sy;
    while (cx >= 0 && cx < size && cy >= 0 && cy < size) {
      out.push(g[cy * size + cx]);
      cx += dx; cy += dy;
    }
    return out;
  };

  Board.prototype.toString = function () {
    var sym = [".", "X", "O"];
    var rows = [];
    for (var y = 0; y < this.size; y++) {
      var line = "";
      for (var x = 0; x < this.size; x++) line += sym[this.grid[y * this.size + x]];
      rows.push(line);
    }
    return rows.join("\n");
  };

  /* =======================================================================
   * 棋型统计（对外）
   * ===================================================================== */
  function pointShapes(bd, x, y, color) {
    var idx = y * bd.size + x;
    if (bd.grid[idx] !== EMPTY) return {};
    _fillWin4(bd, idx);
    var sh = color << 8, out = {};
    for (var d = 0; d < 4; d++) {
      var name = SHAPE_NAMES[_shapeIndexOf(color, _W4[d] | sh)];
      if (name !== NONE) out[name] = (out[name] || 0) + 1;
    }
    return out;
  }

  function pointScore(bd, x, y, color) {
    return _pointScoreAt(bd, y * bd.size + x, color);
  }

  function pointPairScore(bd, x, y, color) {
    _pointPairScore(bd, y * bd.size + x, color);
    return [_pairAtk, _pairDef];
  }

  function bestDirectionShape(bd, x, y, color) {
    var shapes = pointShapes(bd, x, y, color);
    var best = NONE;
    for (var k in shapes) {
      if (SHAPE_INDEX[k] > SHAPE_INDEX[best]) best = k;
    }
    return best;
  }

  function _hasShape(shapes, name) {
    return (shapes[name] || 0) > 0;
  }

  function _isDoubleFour(shapes) {
    return (shapes[FOUR] || 0) + (shapes[OPEN_FOUR] || 0) >= 2;
  }

  function _isDoubleThree(shapes) {
    return (shapes[OPEN_THREE] || 0) >= 2;
  }

  /* =======================================================================
   * 战术层：一步成五 / 必防 / 双威胁 / VCF
   * ===================================================================== */
  function winningMoves(bd, color) {
    var buf = bd._geom.candBuf, cnt = _fillNear(bd, buf);
    var out = [];
    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      if (bd.grid[idx] !== EMPTY) continue;
      if (_pointScoreAt(bd, idx, color) >= FIVE_SCORE) out.push(idx);
    }
    return out;
  }

  function immediateMove(bd, color) {
    var wins = winningMoves(bd, color);
    if (wins.length) return wins[0];

    var blocks = winningMoves(bd, 3 - color);
    if (blocks.length) {
      if (blocks.length === 1) return blocks[0];
      var size = bd.size, best = blocks[0], bestV = -1;
      for (var i = 0; i < blocks.length; i++) {
        var v = _pointScoreAt(bd, blocks[i], color);
        if (v > bestV) { bestV = v; best = blocks[i]; }
      }
      return best;
    }
    return -1;
  }

  function threatMoves(bd, color, minShape) {
    var threshold = SHAPE_INDEX[minShape === undefined ? OPEN_THREE : minShape];
    var buf = bd._geom.candBuf, cnt = _fillNear(bd, buf);
    var out = [];
    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      if (bd.grid[idx] !== EMPTY) continue;
      _fillWin4(bd, idx);
      var sh = color << 8, best = 0;
      for (var d = 0; d < 4; d++) {
        var rank = _shapeIndexOf(color, _W4[d] | sh);
        if (rank > best) best = rank;
      }
      if (best >= threshold) out.push(idx);
    }
    return out;
  }

  function doubleThreatMoves(bd, color) {
    var buf = bd._geom.candBuf, cnt = _fillNear(bd, buf);
    var out = [];
    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      if (bd.grid[idx] !== EMPTY) continue;
      _fillWin4(bd, idx);
      var sh = color << 8;
      var fours = 0, threes = 0, five = false;
      for (var d = 0; d < 4; d++) {
        var rank = _shapeIndexOf(color, _W4[d] | sh);
        if (rank === 7) { five = true; break; }
        if (rank === 5 || rank === 6) fours++;
        else if (rank === 4) threes++;
      }
      if (five) continue;
      if (fours >= 2 || (fours >= 1 && threes >= 1)) out.push(idx);
    }
    return out;
  }

  function _fourMoves(bd, color) {
    var buf = bd._geom.candBuf, cnt = _fillNear(bd, buf);
    var out = [];
    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      if (bd.grid[idx] !== EMPTY) continue;
      _fillWin4(bd, idx);
      var sh = color << 8, best = 0;
      for (var d = 0; d < 4; d++) {
        var rank = _shapeIndexOf(color, _W4[d] | sh);
        if (rank > best) best = rank;
      }
      if (best >= 5) out.push(idx);     // FOUR / OPEN_FOUR / FIVE
    }
    return out;
  }

  function VCFSolver(bd, color, maxDepth, nodeLimit) {
    this.root = bd;
    this.color = color;
    this.opp = 3 - color;
    this.maxDepth = maxDepth;
    this.nodeLimit = nodeLimit;
    this.nodes = 0;
    this.seen = new Set();
  }

  VCFSolver.prototype.solve = function () {
    this.nodes = 0;
    this.seen.clear();
    return this._search(this.root, 0);
  };

  VCFSolver.prototype._search = function (b, depth) {
    if (depth > this.maxDepth || this.nodes > this.nodeLimit) return null;
    this.nodes++;

    var wins = winningMoves(b, this.color);
    if (wins.length) return [wins[0]];
    if (depth >= this.maxDepth) return null;

    var key = b._zobristKey();
    if (this.seen.has(key)) return null;
    this.seen.add(key);

    var size = b.size;
    var moves = _fourMoves(b, this.color);
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      b._push(mv, this.color);
      try {
        if (_winAtIdx(b, mv)) return [mv];
        var defenses = winningMoves(b, this.color);
        if (defenses.length >= 2) return [mv];     // 活四：对方挡不住
        if (defenses.length === 0) continue;
        var dfn = defenses[0];
        b._push(dfn, this.opp);
        try {
          if (_winAtIdx(b, dfn)) continue;         // 对方这一步反而赢了
          var sub = this._search(b, depth + 2);
          if (sub !== null) return [mv, dfn].concat(sub);
        } finally {
          b._pop();
        }
      } finally {
        b._pop();
      }
    }
    return null;
  };

  function findVcf(bd, color, maxDepth, nodeLimit) {
    var solver = new VCFSolver(
      bd.clone(), color,
      maxDepth === undefined ? 12 : maxDepth,
      nodeLimit === undefined ? 200000 : nodeLimit
    );
    return solver.solve();
  }

  /* =======================================================================
   * 评估
   * ===================================================================== */
  function _threatPotential(bd, color, buf, cnt) {
    var grid = bd.grid, cap = 200000, total = 0;
    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      if (grid[idx] !== EMPTY) continue;
      var v = _pointScoreAt(bd, idx, color);
      total += (v < cap) ? v : cap;
    }
    return total;
  }

  function _evaluate(bd, side) {
    var buf = bd._geom.evalBuf, cnt = _fillNear(bd, buf);
    var me = _threatPotential(bd, side, buf, cnt);
    var opp = _threatPotential(bd, 3 - side, buf, cnt);
    return me - 1.15 * opp;
  }

  function _terminalScore(bd, side) {
    var w = bd.winner();
    if (w === 0) return bd.isFull ? 0 : null;
    return (w === side) ? 1e9 : -1e9;
  }

  /* =======================================================================
   * 搜索引擎：迭代加深 αβ + 置换表 + 走法排序 + 杀手走法
   * ===================================================================== */
  var INF = 1e9;
  var MATE = 1e8;

  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  var DEFAULT_CFG = {
    defense_weight: 1.15,
    point_cap: 200000,
    time_budget: 1.0,
    max_depth: 6,
    width_deep: 16,
    width_mid: 12,
    width_shallow: 8,
    sort_defense: 1.15,
    use_vcf: true,
    vcf_max_depth: 12,
    vcf_node_limit: 200000,
    tt_bits: 19,
    sort_killer: 10000000,
    sort_mate: 1000000000000,
    root_jitter: 0.08,
    root_pool_tol: 0.02,
    root_pool_max: 6
  };

  // 难度档位。时间预算是上限、不是目标：搜索跑满 max_depth 就提前收工，
  // 所以 max_depth 给得足够深，让时间真正花在加深上而不是空转。
  // 三档：敷衍 / 认真 / 全力。参数由自对弈循环赛实测选出。
  // 实测结论：defense_weight 峰值就在默认 1.15（1.40/1.70 反而更弱）；
  // 时间预算拐点在 0.5~0.6s，再往上收益递减（0.8s vs 0.4s 仅 56%）。
  // 所以「认真」档用 0.8s 榨出拐点后的收益，「全力」档不加时间、靠加深加宽。
  var LEVELS = {
    1: { time_budget: 0.06, max_depth: 2, width_deep: 5, width_mid: 5, width_shallow: 4,
         use_vcf: false, root_jitter: 0.55, root_pool_tol: 0.45, root_pool_max: 6 },
    2: { time_budget: 0.80, max_depth: 14, width_deep: 14, width_mid: 12, width_shallow: 8,
         use_vcf: true, vcf_max_depth: 16, root_jitter: 0.03, root_pool_tol: 0.010, root_pool_max: 4 },
    3: { time_budget: 2.00, max_depth: 20, width_deep: 18, width_mid: 14, width_shallow: 10,
         use_vcf: true, vcf_max_depth: 26, root_jitter: 0.01, root_pool_tol: 0.006, root_pool_max: 3 }
  };

  function _isNumber(v) { return typeof v === "number" && isFinite(v); }

  /** 合并默认值 + 难度档位 + 显式 config（扁平键，也兼容 eval/search 分组）。 */
  function resolveConfig(level, cfg) {
    var out = {}, k;
    for (k in DEFAULT_CFG) out[k] = DEFAULT_CFG[k];
    var lv = LEVELS[level] || LEVELS[3];
    for (k in lv) out[k] = lv[k];

    if (cfg && typeof cfg === "object") {
      for (k in DEFAULT_CFG) {
        if (cfg[k] !== undefined && cfg[k] !== null) out[k] = cfg[k];
      }
      if (cfg.eval && typeof cfg.eval === "object") {
        for (k in cfg.eval) {
          if (cfg.eval[k] !== undefined && cfg.eval[k] !== null) out[k] = cfg.eval[k];
        }
      }
      if (cfg.search && typeof cfg.search === "object") {
        for (k in cfg.search) {
          if (cfg.search[k] !== undefined && cfg.search[k] !== null) out[k] = cfg.search[k];
        }
      }
    }

    out.defense_weight = +out.defense_weight;
    out.sort_defense = +out.sort_defense;
    out.point_cap = out.point_cap | 0;
    out.time_budget = +out.time_budget;
    out.max_depth = out.max_depth | 0;
    out.width_deep = out.width_deep | 0;
    out.width_mid = out.width_mid | 0;
    out.width_shallow = out.width_shallow | 0;
    out.use_vcf = !!out.use_vcf;
    out.vcf_max_depth = out.vcf_max_depth | 0;
    out.vcf_node_limit = out.vcf_node_limit | 0;
    out.root_jitter = +out.root_jitter;
    out.root_pool_tol = +out.root_pool_tol;
    out.root_pool_max = out.root_pool_max | 0;
    out.tt_limit = Math.pow(2, out.tt_bits | 0);
    return out;
  }

  function Searcher(cfg, rng) {
    this.cfg = cfg;
    this.rng = rng || Math.random;
    this.tt = new Map();
    this.ttLimit = cfg.tt_limit;
    this.killers = [];
    this.nodes = 0;
    this.aborted = false;
    this.deadline = 0;
  }

  Searcher.prototype._rememberKiller = function (ply, mv) {
    var lst = this.killers[ply];
    if (!lst) {
      this.killers[ply] = [mv];
    } else if (lst[0] !== mv && lst[1] !== mv) {
      lst.unshift(mv);
      if (lst.length > 2) lst.pop();
    }
  };

  function _cmpScored(a, b, size) {
    if (b[0] !== a[0]) return b[0] - a[0];
    // 同分时靠天元的优先。否则会一路取最大 x/最大 y，全挤在右下角。
    var c = (size - 1) / 2;
    var ax = a[1] % size, ay = (a[1] / size) | 0;
    var bx = b[1] % size, by = (b[1] / size) | 0;
    var da = Math.max(Math.abs(ax - c), Math.abs(ay - c));
    var db = Math.max(Math.abs(bx - c), Math.abs(by - c));
    if (da !== db) return da - db;
    return a[1] - b[1];
  }

  Searcher.prototype._orderedMoves = function (bd, color, depth, ttMove, ply, raw) {
    var cfg = this.cfg, size = bd.size;
    var buf = bd._geom.candBuf, cnt = _fillNear(bd, buf);
    var killers = this.killers[ply];
    var fiveMe = [], fiveOp = [], scored = [];
    var sd = cfg.sort_defense;

    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      _pointPairScore(bd, idx, color);
      var atk = _pairAtk, dfd = _pairDef;
      if (atk >= FIVE_SCORE) { fiveMe.push([atk, idx]); continue; }
      if (dfd >= FIVE_SCORE) { fiveOp.push([dfd, idx]); continue; }
      var v = atk + Math.floor(dfd * sd);
      if (idx === ttMove) v += cfg.sort_mate;
      else if (killers && (killers[0] === idx || killers[1] === idx)) v += cfg.sort_killer;
      scored.push([v, idx]);
    }

    var out, k;
    if (fiveMe.length) {
      fiveMe.sort(function (a, b) { return _cmpScored(a, b, size); });
      return raw ? [[fiveMe[0][0], fiveMe[0][1]]] : [fiveMe[0][1]];
    }
    if (fiveOp.length) {
      fiveOp.sort(function (a, b) { return _cmpScored(a, b, size); });
      if (raw) return fiveOp;
      out = new Array(fiveOp.length);
      for (k = 0; k < fiveOp.length; k++) out[k] = fiveOp[k][1];
      return out;
    }
    scored.sort(function (a, b) { return _cmpScored(a, b, size); });
    var width = depth >= 4 ? cfg.width_deep : (depth >= 2 ? cfg.width_mid : cfg.width_shallow);
    var n = Math.min(width, scored.length);
    if (raw) return scored.slice(0, n);
    out = new Array(n);
    for (k = 0; k < n; k++) out[k] = scored[k][1];
    return out;
  };

  // 根节点降序排列后加一点相对扰动，让价值接近的走法换位。
  // 只在根节点做，保证深层搜索的走法顺序依然稳定。
  Searcher.prototype._jitterRoot = function (pairs) {
    var j = this.cfg.root_jitter;
    if (!j || pairs.length < 2) return pairs;
    var r = this.rng ? this.rng : Math.random;
    var arr = new Array(pairs.length);
    for (var i = 0; i < pairs.length; i++) {
      arr[i] = [pairs[i][0] * (1 + j * r()), pairs[i][1]];
    }
    arr.sort(function (a, b) {
      if (b[0] !== a[0]) return b[0] - a[0];
      return a[1] - b[1];
    });
    return arr;
  };

  Searcher.prototype._fallback = function (bd, color) {
    var buf = bd._geom.candBuf, cnt = _fillNear(bd, buf);
    var size = bd.size, sd = this.cfg.sort_defense;
    var best = -1, bestV = -1;
    for (var i = 0; i < cnt; i++) {
      var idx = buf[i];
      _pointPairScore(bd, idx, color);
      var v = _pairAtk + Math.floor(_pairDef * sd);
      if (v > bestV) { bestV = v; best = idx; }
    }
    if (best < 0) {
      var cands = bd.neighbourhood(CANDIDATE_RADIUS);
      if (cands.length) best = cands[0];
    }
    if (best < 0) return { move: null, score: 0 };
    return { move: { x: best % size, y: (best / size) | 0 }, score: 0 };
  };

  Searcher.prototype._rootSearch = function (bd, depth) {
    var me = bd.side;
    var pairs = this._orderedMoves(bd, me, depth, -1, 0, true);
    if (!pairs.length) return { score: 0, move: null, pool: [], pv: [], complete: true };
    pairs = this._jitterRoot(pairs);

    // 根节点保留 alpha 窗口做剪枝。注意：失败低的走法拿到的是「上界」，不是精确分。
    // 所以只在两种情况下把它收进 pool：它是精确分（首手或曾经超过 alpha），
    // 或者这个档位的容差本来就很松（低难度，故意让它偶尔走次优）。
    var alpha = -INF, bestMv = pairs[0][1], bestScore = -INF;
    var scored = [];
    for (var i = 0; i < pairs.length; i++) {
      if (this.aborted || now() > this.deadline) {
        return { score: bestScore, move: bestMv, pool: [], pv: [bestMv], complete: false };
      }
      var mv = pairs[i][1];
      bd._push(mv, me);
      var score;
      if (_winAtIdx(bd, mv)) {
        score = MATE;
      } else {
        score = -this._negamax(bd, depth - 1, -INF, -alpha, 1);
      }
      bd._pop();
      if (this.aborted) {
        return { score: bestScore, move: bestMv, pool: [], pv: [bestMv], complete: false };
      }
      var exact = (i === 0) || score > alpha;
      scored.push([score, mv, exact]);
      if (score > bestScore) { bestScore = score; bestMv = mv; }
      if (score > alpha) alpha = score;
    }

    // 把和最优分差在容差内的走法收进 pool，交给门外随机挑，这样同样的局面不会次次同一个点。
    var pool = [bestMv];
    var tol = this.cfg.root_pool_tol;
    if (tol > 0 && Math.abs(bestScore) < MATE / 2) {
      var margin = Math.max(1, Math.abs(bestScore) * tol);
      var cap = this.cfg.root_pool_max | 0;
      var loose = tol >= 0.05;
      for (var k = 0; k < scored.length && pool.length < cap; k++) {
        if (scored[k][1] === bestMv) continue;
        if (!loose && !scored[k][2]) continue;
        if (scored[k][0] >= bestScore - margin) pool.push(scored[k][1]);
      }
    }
    return { score: bestScore, move: bestMv, pool: pool, pv: [bestMv], complete: true };
  };

  Searcher.prototype._negamax = function (bd, depth, alpha, beta, ply) {
    this.nodes++;
    if ((this.nodes & 127) === 0 && now() > this.deadline) {
      this.aborted = true;
      return 0;
    }

    if (bd._n > 0) {
      var last = bd._mv[bd._n - 1];
      if (_winAtIdx(bd, last)) return -MATE + ply;
    }

    if (depth <= 0) return _evaluate(bd, bd.side);

    var key = bd._zobristKey();
    var hit = this.tt.get(key);
    var ttMove = -1;
    if (hit !== undefined) {
      ttMove = hit[3];
      if (hit[0] >= depth) {
        if (hit[1] === TT_EXACT) return hit[2];
        if (hit[1] === TT_LOWER) {
          if (hit[2] > alpha) alpha = hit[2];
        } else if (hit[1] === TT_UPPER) {
          if (hit[2] < beta) beta = hit[2];
        }
        if (alpha >= beta) return hit[2];
      }
    }

    var side = bd.side;
    var moves = this._orderedMoves(bd, side, depth, ttMove, ply);
    if (!moves.length) return 0;

    var best = -INF, bestMv = -1, alpha0 = alpha;
    for (var i = 0; i < moves.length; i++) {
      if (this.aborted) return 0;
      var mv = moves[i];
      bd._push(mv, side);
      var score;
      if (_winAtIdx(bd, mv)) {
        score = MATE - (ply + 1);
      } else {
        score = -this._negamax(bd, depth - 1, -beta, -alpha, ply + 1);
      }
      bd._pop();
      if (score > best) { best = score; bestMv = mv; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        this._rememberKiller(ply, mv);
        break;
      }
    }

    if (this.aborted) return 0;
    var flag = (best <= alpha0) ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
    if (best > -INF) this.tt.set(key, [depth, flag, best, bestMv]);
    return best;
  };

  Searcher.prototype.search = function (board) {
    var t0 = now();
    this.nodes = 0;
    this.aborted = false;
    this.deadline = t0 + this.cfg.time_budget * 1000;
    this.killers = [];
    if (this.tt.size > this.ttLimit) this.tt.clear();

    var work = board.clone();
    var me = work.side;
    var size = work.size;

    // 1) 终局 / 空盘
    if (work.isFull || work.winner() !== 0) {
      return { move: null, score: 0, depth: 0, nodes: 0, elapsed: 0, pv: [], reason: "terminal" };
    }
    if (work._n === 0) {
      var c = size >> 1;
      return {
        move: { x: c, y: c }, score: 0, depth: 0, nodes: 0,
        elapsed: now() - t0, pv: [], reason: "opening"
      };
    }

    // 2) 战术速查：一步赢 / 一步防
    var quick = immediateMove(work, me);
    if (quick >= 0) {
      return {
        move: { x: quick % size, y: (quick / size) | 0 }, score: MATE, depth: 1,
        nodes: 0, elapsed: now() - t0, pv: [], reason: "immediate"
      };
    }

    // 3) 双威胁速查
    var dbl = doubleThreatMoves(work, me);
    if (dbl.length) {
      var best = dbl[0], bestV = -1;
      for (var i = 0; i < dbl.length; i++) {
        _pointPairScore(work, dbl[i], me);
        if (_pairAtk > bestV) { bestV = _pairAtk; best = dbl[i]; }
      }
      return {
        move: { x: best % size, y: (best / size) | 0 }, score: MATE - 1, depth: 1,
        nodes: 0, elapsed: now() - t0, pv: [], reason: "double-threat"
      };
    }

    // 4) VCF：连续冲四取胜
    if (this.cfg.use_vcf) {
      var vcf = findVcf(work, me, this.cfg.vcf_max_depth, this.cfg.vcf_node_limit);
      if (vcf) {
        var pv = new Array(vcf.length);
        for (var j = 0; j < vcf.length; j++) {
          pv[j] = { x: vcf[j] % size, y: (vcf[j] / size) | 0 };
        }
        return {
          move: pv[0], score: MATE, depth: vcf.length, nodes: 0,
          elapsed: now() - t0, pv: pv, reason: "vcf"
        };
      }
    }

    // 5) 迭代加深 αβ：只有完整跑完的迭代才更新结果
    var bestMove = null, bestScore = 0, bestPv = [], bestPool = [], reached = 0;
    for (var depth = 2; depth <= this.cfg.max_depth; depth += 2) {
      var r = this._rootSearch(work, depth);
      if (r.complete && r.move !== null) {
        bestMove = r.move; bestScore = r.score; bestPv = r.pv;
        bestPool = r.pool && r.pool.length ? r.pool : [r.move];
        reached = depth;
      }
      if (!r.complete || this.aborted) break;
      if (Math.abs(bestScore) > MATE / 2) break;
      if (now() > this.deadline) break;
    }

    if (bestMove === null) {
      var fb = this._fallback(work, me);
      return {
        move: fb.move, score: fb.score, depth: reached, nodes: this.nodes,
        elapsed: now() - t0, pv: bestPv, pool: [], reason: "fallback"
      };
    }

    return {
      move: { x: bestMove % size, y: (bestMove / size) | 0 },
      score: bestScore, depth: reached, nodes: this.nodes,
      elapsed: now() - t0,
      pv: bestPv.map(function (m) {
        return { x: m % size, y: (m / size) | 0 };
      }),
      // 同分的并列最优走法。AI 门面会在这几个里随机挑一个，
      // 这样同一局面不会每次都走同一步（棋风才不呆板）。
      pool: bestPool,
      reason: "alphabeta"
    };
  };

  /* =======================================================================
   * AI 门面
   * ===================================================================== */
  function AI(opts) {
    opts = opts || {};
    var level = (opts.level === undefined || opts.level === null) ? 3 : (opts.level | 0);
    if (!LEVELS[level]) level = 3;
    this.level = level;
    this.rules = (opts.rules === "renju") ? "renju" : "casual";
    this.config = resolveConfig(level, opts.config);
    this.seed = (opts.seed === undefined || opts.seed === null) ? null : opts.seed;
    this.rng = (this.seed === null) ? Math.random : _rand01(this.seed);
    this.searcher = new Searcher(this.config, this.rng);
    this.lastResult = null;
  }

  // 从并列最优里随机挑一个。搜索只报"同分最优有几个"，
  // 具体走哪个交给这里随机决定，棋风才不会每次都一样。
  AI.prototype._pick = function (res, board) {
    if (!res || !res.move) return res ? res.move : null;
    var pool = res.pool || [];
    if (pool.length < 2) return res.move;
    var size = board.size;
    var mv = pool[Math.floor(this.rng() * pool.length) % pool.length];
    var picked = { x: mv % size, y: (mv / size) | 0 };
    res.move = picked;
    return picked;
  };

  AI.prototype.choose = function (board) {
    if (board.isFull || board.winner() !== 0) return null;

    // 空盘走天元
    if (board._n === 0) {
      var c = board.size >> 1;
      return { x: c, y: c };
    }

    // 第二手在对手首子 ±2 内随机（与 Python 行为一致）
    if (board._n === 1 && this.level >= 2) {
      var first = board.lastMove();
      var cand = [];
      for (var dx = -2; dx <= 2; dx++) {
        for (var dy = -2; dy <= 2; dy++) {
          if (dx === 0 && dy === 0) continue;
          var x = first.x + dx, y = first.y + dy;
          if (board.inside(x, y) && board.grid[y * board.size + x] === EMPTY) {
            cand.push({ x: x, y: y });
          }
        }
      }
      if (cand.length) return cand[Math.floor(this.rng() * cand.length) % cand.length];
    }

    var res = this.searcher.search(board);
    this.lastResult = res;
    return this._pick(res, board);
  };

  AI.prototype.analyse = function (board) {
    var res = this.searcher.search(board);
    this.lastResult = res;
    this._pick(res, board);
    var me = board.side, opp = 3 - me;

    var toXY = function (idxs) {
      var out = new Array(idxs.length);
      for (var i = 0; i < idxs.length; i++) {
        out[i] = { x: idxs[i] % board.size, y: (idxs[i] / board.size) | 0 };
      }
      return out;
    };

    return {
      move: res.move ? { x: res.move.x, y: res.move.y } : null,
      score: res.score,
      depth: res.depth,
      nodes: res.nodes,
      elapsed_ms: Math.round(res.elapsed * 10) / 10,
      reason: res.reason,
      pv: res.pv.map(function (m) { return { x: m.x, y: m.y }; }),
      threats: {
        my_five_points: toXY(winningMoves(board, me)),
        opp_five_points: toXY(winningMoves(board, opp)),
        my_double_threats: toXY(doubleThreatMoves(board, me)),
        opp_double_threats: toXY(doubleThreatMoves(board, opp))
      }
    };
  };

  AI.prototype.brief = function (board) {
    var me = board.side, opp = 3 - me, size = board.size;
    var toXY = function (idxs) {
      var out = new Array(idxs.length);
      for (var i = 0; i < idxs.length; i++) {
        out[i] = { x: idxs[i] % size, y: (idxs[i] / size) | 0 };
      }
      return out;
    };
    return {
      side: me,
      my_immediate_win: toXY(winningMoves(board, me)),
      opp_immediate_win: toXY(winningMoves(board, opp)),
      my_double_threats: toXY(doubleThreatMoves(board, me)),
      opp_double_threats: toXY(doubleThreatMoves(board, opp)),
      my_threats: toXY(threatMoves(board, me)),
      opp_threats: toXY(threatMoves(board, opp))
    };
  };

  /* =======================================================================
   * 规则：禁手 / 合法性（与 Python rules.py 等价）
   * ===================================================================== */
  var FORBIDDEN_OVERLINE = "overline";
  var FORBIDDEN_DOUBLE_FOUR = "double_four";
  var FORBIDDEN_DOUBLE_THREE = "double_three";

  function _countOpenThrees(bd, x, y, color) {
    var count = 0;
    for (var d = 0; d < 4; d++) {
      var dx = DX[d], dy = DY[d];
      var line = bd.fullLine(x, y, dx, dy);
      var sx = x, sy = y, size = bd.size;
      while (sx - dx >= 0 && sx - dx < size && sy - dy >= 0 && sy - dy < size) {
        sx -= dx; sy -= dy;
      }
      var pos = 0, cx = sx, cy = sy;
      while (!(cx === x && cy === y)) { pos++; cx += dx; cy += dy; }

      var n = line.length;
      for (var start = Math.max(0, pos - 4); start <= Math.min(pos, n - 5); start++) {
        var ok = true, cntColor = 0, cntEmpty = 0;
        var first = -1, last = -1;
        for (var k = 0; k < 5; k++) {
          var v = line[start + k];
          if (v === 3 - color) { ok = false; break; }
          if (v === color) {
            cntColor++;
            if (first < 0) first = k;
            last = k;
          } else if (v === EMPTY) {
            cntEmpty++;
          }
        }
        if (!ok) continue;
        if (cntColor !== 3 || cntEmpty !== 2) continue;
        if (last - first !== 2) continue;
        var leftFree = start > 0 && line[start - 1] === EMPTY;
        var rightFree = start + 5 < n && line[start + 5] === EMPTY;
        if (leftFree || rightFree) { count++; break; }
      }
    }
    return count;
  }

  function _countShapesAt(bd, x, y, color) {
    var fours = 0, overline = 0;
    for (var d = 0; d < 4; d++) {
      var dx = DX[d], dy = DY[d];
      var line = bd.fullLine(x, y, dx, dy);
      var sx = x, sy = y, size = bd.size;
      while (sx - dx >= 0 && sx - dx < size && sy - dy >= 0 && sy - dy < size) {
        sx -= dx; sy -= dy;
      }
      var pos = 0, cx = sx, cy = sy;
      while (!(cx === x && cy === y)) { pos++; cx += dx; cy += dy; }

      var n = line.length;
      // 长连
      var run = 1;
      var k = pos - 1;
      while (k >= 0 && line[k] === color) { run++; k--; }
      k = pos + 1;
      while (k < n && line[k] === color) { run++; k++; }
      if (run >= 6) { overline++; continue; }

      // 五连窗口数
      var winWindows = 0;
      for (var start = Math.max(0, pos - 4); start <= Math.min(pos, n - 5); start++) {
        var all = true;
        for (var q = 0; q < 5; q++) {
          if (line[start + q] !== color) { all = false; break; }
        }
        if (all) winWindows++;
      }
      if (winWindows === 0) continue;
      fours += 1;
    }
    var openThrees = _countOpenThrees(bd, x, y, color);
    return { fours: fours, openThrees: openThrees, overline: overline };
  }

  /** 黑方在 (x,y) 落子是否禁手；成五优先。返回 null 表示不违规。 */
  function forbiddenReason(board, x, y) {
    if (board.rules !== "renju") return null;
    if (!board.inside(x, y)) return null;
    if (board.grid[y * board.size + x] !== EMPTY) return null;

    var color = BLACK;
    var idx = y * board.size + x;
    board.grid[idx] = color;
    var overline = 0, fours = 0, openThrees = 0;
    try {
      if (_winAtIdx(board, idx)) return null;      // 成五优先
      var r = _countShapesAt(board, x, y, color);
      fours = r.fours; openThrees = r.openThrees; overline = r.overline;
    } finally {
      board.grid[idx] = EMPTY;
    }

    if (overline) return FORBIDDEN_OVERLINE;
    if (fours >= 2) return FORBIDDEN_DOUBLE_FOUR;
    if (openThrees >= 2) return FORBIDDEN_DOUBLE_THREE;
    return null;
  }

  function isLegal(board, x, y) {
    if (!board.inside(x, y)) return false;
    if (board.grid[y * board.size + x] !== EMPTY) return false;
    if (board.side === BLACK && board.rules === "renju") {
      return forbiddenReason(board, x, y) === null;
    }
    return true;
  }

  function legalMoves(board, points) {
    if (board.rules !== "renju" || board.side !== BLACK) {
      return points ? points.slice() : board.neighbourhood();
    }
    var pts = points ? points : board.neighbourhood();
    var size = board.size, out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (forbiddenReason(board, p % size, (p / size) | 0) === null) out.push(p);
    }
    return out;
  }

  /* =======================================================================
   * 在线学习：Learner
   * ===================================================================== */
  var LEARNED_KEY = "fool-gomoku.learned";
  var LEARNABLE = ["defense_weight", "sort_defense"];
  var ANCHOR = 1.15;
  var CLAMP = { defense_weight: [0.8, 1.8], sort_defense: [0.8, 1.6] };

  function _clampParam(name, val) {
    var r = CLAMP[name];
    var v = Math.max(r[0], Math.min(r[1], Number(val)));
    if (!isFinite(v)) v = ANCHOR;
    return Math.round(v * 1000) / 1000;
  }

  function _storage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (e) { /* 隐私模式等 */ }
    return null;
  }

  function Learner(lr, params) {
    this.lr = (lr === undefined || lr === null) ? 0.03 : Number(lr);
    this.params = { defense_weight: ANCHOR, sort_defense: ANCHOR };
    if (params && typeof params === "object") {
      if (params.defense_weight !== undefined) {
        this.params.defense_weight = _clampParam("defense_weight", params.defense_weight);
      }
      if (params.sort_defense !== undefined) {
        this.params.sort_defense = _clampParam("sort_defense", params.sort_defense);
      }
    }
  }

  /** 从本地存储读取学到的参数；读不到返回默认 Learner。 */
  Learner.load = function (lr) {
    var st = _storage();
    if (!st) return new Learner(lr);
    try {
      var raw = st.getItem(LEARNED_KEY);
      if (!raw) return new Learner(lr);
      var obj = JSON.parse(raw);
      return new Learner(lr, obj);
    } catch (e) {
      return new Learner(lr);
    }
  };

  Learner.prototype.snapshot = function () {
    return {
      "eval.defense_weight": this.params.defense_weight,
      "search.sort_defense": this.params.sort_defense
    };
  };

  /** 返回当前参数的副本（扁平键）。 */
  Learner.prototype.config = function () {
    return {
      defense_weight: this.params.defense_weight,
      sort_defense: this.params.sort_defense
    };
  };

  Learner.prototype.reset = function () {
    this.params.defense_weight = ANCHOR;
    this.params.sort_defense = ANCHOR;
    this.save();
    return this.snapshot();
  };

  Learner.prototype.save = function () {
    var st = _storage();
    if (!st) return false;
    try {
      st.setItem(LEARNED_KEY, JSON.stringify(this.params));
      return true;
    } catch (e) {
      return false;
    }
  };

  /**
   * 喂入一局结果：输了上调防守权重（+lr），赢了向默认锚点回落，平局不动。
   * @param {number} winner 0=平/未分, 1=黑胜, 2=白胜
   * @param {number} myColor 本方颜色（0 表示无）
   * @param {number} moves 手数
   */
  Learner.prototype.applyOutcome = function (winner, myColor, moves) {
    var before = {
      defense_weight: this.params.defense_weight,
      sort_defense: this.params.sort_defense
    };
    var outcome;
    if (!myColor) outcome = "draw";
    else if (winner === myColor) outcome = "win";
    else if (winner !== 0) outcome = "lose";
    else outcome = "draw";

    for (var i = 0; i < LEARNABLE.length; i++) {
      var name = LEARNABLE[i];
      var cur = before[name];
      var nxt = cur;
      if (outcome === "lose") {
        nxt = cur + this.lr;
      } else if (outcome === "win") {
        nxt = cur - this.lr * 0.3;
        if ((cur > ANCHOR && nxt < ANCHOR) || cur <= ANCHOR) nxt = cur;
        else if (cur > ANCHOR) nxt = Math.max(ANCHOR, nxt);
      }
      this.params[name] = _clampParam(name, nxt);
    }

    var after = {
      defense_weight: this.params.defense_weight,
      sort_defense: this.params.sort_defense
    };
    var changed = after.defense_weight !== before.defense_weight ||
      after.sort_defense !== before.sort_defense;
    if (changed) this.save();

    return {
      outcome: outcome,
      myColor: myColor,
      moves: moves,
      before: before,
      after: after,
      changed: changed,
      file: null
    };
  };

  /* =======================================================================
   * 导出
   * ===================================================================== */
  var GomokuEngine = {
    // 常量
    EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE,
    NONE: NONE, TWO: TWO, OPEN_TWO: OPEN_TWO, THREE: THREE,
    OPEN_THREE: OPEN_THREE, FOUR: FOUR, OPEN_FOUR: OPEN_FOUR, FIVE: FIVE,
    SHAPE_ORDER: SHAPE_NAMES.slice(),
    SHAPE_SCORE: {
      NONE: SHAPE_SCORE.NONE, TWO: SHAPE_SCORE.TWO, OPEN_TWO: SHAPE_SCORE.OPEN_TWO,
      THREE: SHAPE_SCORE.THREE, OPEN_THREE: SHAPE_SCORE.OPEN_THREE,
      FOUR: SHAPE_SCORE.FOUR, OPEN_FOUR: SHAPE_SCORE.OPEN_FOUR, FIVE: SHAPE_SCORE.FIVE
    },
    LEVELS: LEVELS,
    // 主要类
    Board: Board,
    AI: AI,
    Learner: Learner,
    // 规则
    forbiddenReason: forbiddenReason,
    isLegal: isLegal,
    legalMoves: legalMoves,
    // 棋型 / 战术工具
    shapeNameOf: shapeNameOf,
    pointShapes: pointShapes,
    pointScore: pointScore,
    pointPairScore: pointPairScore,
    bestDirectionShape: bestDirectionShape,
    winningMoves: winningMoves,
    immediateMove: immediateMove,
    doubleThreatMoves: doubleThreatMoves,
    threatMoves: threatMoves,
    findVcf: findVcf,
    hasFive: function (shapes) { return _hasShape(shapes, FIVE); },
    isDoubleFour: _isDoubleFour,
    isDoubleThree: _isDoubleThree,
    version: "1.0.0"
  };

  if (typeof module === "object" && module && module.exports) module.exports = GomokuEngine;
  root.GomokuEngine = GomokuEngine;
  if (typeof window !== "undefined" && window) window.GomokuEngine = GomokuEngine;
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
