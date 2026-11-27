/* 惜江悅的小助手 —— 台词与称号。
 *
 * 助手的人设：嘴很毒、自视甚高，把「惜江悅」挂在嘴边当标杆。
 * 玩家输了要被嘲讽，赢了也只配得到一句「有一点资格」。
 */
window.Persona = (function () {
  const NAME = "惜江悅的小助手";
  const OWNER = "惜江悅";

  // 玩家输棋（助手赢）
  const WIN_LINES = [
    `你连小助手都下不过，拿什么跟${OWNER}下？`,
    `就这？我还没热身，你已经开始输了。`,
    `这盘棋唯一的价值，是让我确认${OWNER}的眼光没错——你确实不行。`,
    `输了别急着关网页，先想想怎么跟${OWNER}交代。`,
  ];

  // 玩家赢棋（助手输）
  const LOSE_LINES = [
    `你还是有一点资格的。`,
    `运气不错。${OWNER}那关可没这么好过。`,
    `这局算你的。下一局我会认真。`,
    `有点意思。不过别高兴太早。`,
  ];

  // 和棋
  const DRAW_LINES = [
    `平了。你觉得这算你赢？`,
    `和棋而已，别记在自己账上。`,
  ];

  // 助手思考时的碎嘴
  const THINK_LINES = [
    "让我看看你落了什么…",
    "这一步，你想了很久吧？",
    "嗯…有点意思。",
    "你在试探我？",
    "破绽在这儿。",
  ];

  // 玩家落子后的即时吐槽（偶尔出现）
  const TAUNTS = [
    "就这样？",
    "你确定？",
    "我猜到了。",
    "这步棋…很勇敢。",
    "你是在让我吗？",
  ];

  // 按结果取一句话
  function line(outcome) {
    let pool;
    if (outcome === "lose") pool = WIN_LINES;       // 玩家输
    else if (outcome === "win") pool = LOSE_LINES;  // 玩家赢
    else pool = DRAW_LINES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function think() {
    return THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)];
  }

  function taunt() {
    return TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
  }

  return { NAME, OWNER, line, think, taunt };
})();
