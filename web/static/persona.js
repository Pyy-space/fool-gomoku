/* 惜江悅的小助手 —— 台词与人设。
 *
 * 人设：借了《燕云十六声》两个角色的气质——江无浪的冷面寡言、
 * 喜怒不形于色，加上陈叔那种温润底下的嘴贱逗弄。棋艺高强的冷面棋士，
 * 毒舌却句句带江湖气；玩家输了要被嘲，赢了也只配一句「有一点资格」。
 * 把「惜江悅」挂在嘴边当标杆，仿佛自己就是她手把手教出来的。
 */
window.Persona = (function () {
  const NAME = "惜江悅的小助手";
  const OWNER = "惜江悅";

  // 玩家输（助手赢）—— 冷面嘲讽，带江湖味
  const WIN_LINES = [
    `就这点斤两，也敢在我面前落子？`,
    `你连我都下不过，还想跟${OWNER}过招？回去再练三年。`,
    `这盘棋，我闭着眼都能赢你。`,
    `输就输吧，别砸了棋盘。${OWNER}可没你这么沉不住气。`,
    `你这一步一子，都写着一个「急」字。`,
    `先把胜负忘了，再回来跟我下。`,
  ];

  // 玩家赢（助手输）—— 冷傲，只给一句资格
  const LOSE_LINES = [
    `算你有几分资格。`,
    `这一局，权当让${OWNER}看看你还有点意思。`,
    `运气也讲究时机。下次，我不会再让你。`,
    `有点意思。不过，离${OWNER}还差得远。`,
    `赢一局而已，别急着抖。`,
  ];

  // 和棋
  const DRAW_LINES = [
    `平局？我竟跟你打平了，回去得跟${OWNER}请罪。`,
    `和棋，算你捡了半条命。`,
  ];

  // 助手思考时的碎嘴
  const THINK_LINES = [
    "让我掂量掂量你这一手…",
    "呵，这一步，藏了点心思。",
    "我在看你的破绽，别急。",
    "这棋路有点熟悉…谁教你的？",
    "等等，容我想想。",
    "落子无悔，你想清楚了？",
  ];

  // 玩家落子后的即时吐槽（偶尔出现）
  const TAUNTS = [
    "就这？",
    "你这一步，是把刀递到我手上。",
    "我早料到了。",
    "胆子不小。",
    "你在让我？可别。",
    "这一步…很勇敢，也很蠢。",
  ];

  // 提示（棋盘上发光点）
  const HINT_LINES = [
    "那个发光的点，就是你的活路。",
    "落这儿，能续你几口气。",
    "看那个光点，照着下。",
  ];

  // 悔棋
  const UNDO_LINES = [
    "反悔了？落子无悔，这道理还得我教你。",
    "悔一步，改不了你的坏棋。",
    "行，给你一次机会。",
  ];

  function pick(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function line(outcome) {
    if (outcome === "lose") return pick(WIN_LINES);   // 玩家输
    if (outcome === "win") return pick(LOSE_LINES);   // 玩家赢
    return pick(DRAW_LINES);
  }
  function think() { return pick(THINK_LINES); }
  function taunt() { return pick(TAUNTS); }
  function hint() { return pick(HINT_LINES); }
  function undo() { return pick(UNDO_LINES); }

  return { NAME, OWNER, line, think, taunt, hint, undo };
})();
