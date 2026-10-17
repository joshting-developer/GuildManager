// 賽馬播報台詞：可愛搞笑＋網路梗。想增減台詞直接改這個檔案即可。
// {n} = 參賽者名稱，{a} = 該參賽者的角色名稱（小豬、狗狗…）。
// 每種突發狀況：fall 摔倒、sleep 睡著／停住、eat 吃東西、back 跑錯方向、boost 暴衝；
// lateStart 起跑沒出發、start 開場、sprint 最後衝刺、win 奪冠。

// Lines every runner can use, so they must not mention grass, horses or engines.
const GENERIC = {
  fall: [
    '{n} 的{a}腳滑了一下，芭比Q了',
    '{n} 原地摔倒，社死現場',
    '{n}：我沒有跌倒，我在找拍照角度',
    '{n} 被自己絆倒，當場破防',
  ],
  sleep: [
    '{n} 跑到一半直接躺平',
    '{n}：我就爛，先睡一下',
    '{n} 的{a}進入省電模式',
    '{n} 睡著了，已讀不回',
  ],
  eat: [
    '{n} 看到點心，腳步自動停下',
    '{n}：先吃再說，比賽什麼的不重要',
    '{n} 停下來買珍奶，還要半糖少冰',
  ],
  back: [
    '{n} 跑錯方向了！是在哈囉？',
    '{n} 好像忘了東西要回去拿',
    '{n} 迷路了，正在問路',
    '{n}：等等，終點在哪？',
  ],
  boost: [
    '{n} 突然暴衝！這不是演習！',
    '{n} 開始認真了，YYDS',
    '{n} 是吃了什麼這麼猛？！',
    '{n} 燃起來了，誰都擋不住',
  ],
  lateStart: ['{n} 起跑還在睡……', '{n} 還在賴床，根本還沒出發'],
  start: ['比賽開始！衝啊！', '槍聲響起，大家出發啦！'],
  sprint: ['最後衝刺！{n} 暫時領先！', '剩最後一段！{n} 跑在最前面！'],
  win: ['🏁 {n} 衝線奪冠！', '🏁 冠軍是 {n}！太神啦！'],
};
const DEFAULT_FX = { fall: '💥', sleep: '💤', eat: '🍪', back: '❓', boost: '🔥' };

// Keyed by emoji so 動物大亂鬥 picks each runner's own animal. Lines here are added
// to the generic pool; `exclusive` replaces it entirely (cars don't sleep or eat).
const PROFILES = {
  '🏇': {
    noun: '騎士',
    fx: { eat: '🌿' },
    fall: ['{n} 馬失前蹄，騎士飛出去了！', '{n} 的馬腳滑了一下，騎士在空中轉體三圈'],
    eat: ['{n} 的馬停下來吃草，騎士很無奈'],
    boost: ['{n} 揮鞭加速！帥到沒朋友'],
    win: ['🏁 {n} 策馬奪冠，帥到不行！'],
  },
  '🐎': {
    noun: '馬',
    fx: { eat: '🌿' },
    fall: ['{n} 馬失前蹄，摔個狗吃屎！'],
    eat: ['{n} 停下來吃草：這邊的草好香', '{n}：草，好吃'],
    boost: ['{n} 一馬當先，馬力全開！'],
    win: ['🏁 {n} 一馬當先，奪冠！', '🏁 {n} 馬到成功！'],
  },
  '🐖': {
    noun: '小豬',
    fx: { eat: '🍉', fall: '💩' },
    fall: ['{n} 滾進泥巴坑，還滾得很開心', '{n} 跌倒了，但豬皮很厚沒事'],
    sleep: ['{n} 吃太飽，原地午睡', '{n} 打呼聲比觀眾還大聲'],
    eat: ['{n} 聞到西瓜皮，原地開吃', '{n}：吃飽才有力氣跑'],
    boost: ['{n} 聽到「開飯了」，瞬間加速！'],
    win: ['🏁 {n} 豬事順利，奪冠！', '🏁 {n} 是最會跑的小豬！'],
  },
  '🐕': {
    noun: '狗狗',
    fx: { eat: '🦴', back: '🌀', boost: '🥏' },
    eat: ['{n} 停下來聞別人的屁股', '{n} 發現一根骨頭，比賽先不管了'],
    sleep: ['{n} 翻肚討摸，不跑了'],
    back: ['{n} 去追自己的尾巴了', '{n} 聽到門鈴聲，跑回去吠'],
    boost: ['有人丟了飛盤！{n} 全力衝刺！'],
    win: ['🏁 {n} 汪汪奪冠！好狗狗！'],
  },
  '🐈': {
    noun: '貓咪',
    fx: { sleep: '📦', back: '🔴', eat: '🐟' },
    fall: ['{n} 優雅落地……失敗'],
    sleep: ['{n} 找到紙箱，進去就不出來了', '{n} 在陽光下融化了'],
    eat: ['{n} 停下來舔毛', '{n} 聞到罐罐，立刻轉彎'],
    back: ['{n} 被雷射筆的紅點吸走了'],
    boost: ['{n} 半夜暴衝模式啟動！'],
    win: ['🏁 {n} 喵喵奪冠，本喵天下第一'],
  },
  '🐢': {
    noun: '烏龜',
    fx: { sleep: '🐚' },
    fall: ['{n} 翻成四腳朝天，正在努力翻身'],
    sleep: ['{n} 縮回殼裡思考人生'],
    back: ['{n} 忘記終點在哪邊'],
    boost: ['{n} 這速度……是開了外掛嗎？！'],
    win: ['🏁 {n} 龜兔賽跑劇本重現，奪冠！'],
  },
  '🐌': {
    noun: '蝸牛',
    fx: { sleep: '🐚', eat: '🥬' },
    fall: ['{n} 黏在路邊了'],
    sleep: ['{n} 縮回殼裡，今日休息'],
    eat: ['{n} 停下來啃菜葉'],
    boost: ['{n} 以時速 0.03 公里的極速衝刺！'],
    win: ['🏁 {n} 慢慢來比較快，奪冠！'],
  },
  '🦆': {
    noun: '鴨子',
    fx: { eat: '🍞' },
    fall: ['{n} 踩到自己的腳蹼'],
    eat: ['{n} 被麵包屑吸走了'],
    back: ['{n} 跟著別的鴨子走了'],
    boost: ['{n} 呱呱呱呱呱！衝啊！'],
    win: ['🏁 {n} 呱呱奪冠！'],
  },
  '🐓': {
    noun: '雞',
    fx: { eat: '🌾', back: '☀️' },
    eat: ['{n} 低頭啄米'],
    back: ['{n} 停下來咕咕咕，以為天亮了'],
    boost: ['{n} 咯咯咯咯衝刺中！'],
    win: ['🏁 {n} 大吉大利，今晚吃雞！'],
  },
  '🐇': {
    noun: '兔子',
    fx: { eat: '🥕' },
    sleep: ['{n} 覺得自己贏定了，先睡一下（危）'],
    eat: ['{n} 停下來啃紅蘿蔔'],
    boost: ['{n} 蹦蹦跳跳加速中！'],
    win: ['🏁 {n} 這次兔子沒睡著，奪冠！'],
  },
  '🦖': {
    noun: '恐龍',
    fx: { eat: '🍖', sleep: '🧊' },
    fall: ['{n} 手太短，跌倒爬不起來'],
    sleep: ['{n} 冰河期來了，先冬眠'],
    eat: ['{n} 想吃旁邊的參賽者，被裁判制止'],
    boost: ['{n} 一聲咆哮，全場讓路！'],
    win: ['🏁 {n} 侏羅紀霸主奪冠！'],
  },
  '🐄': {
    noun: '牛',
    fx: { eat: '🌿', boost: '🟥' },
    sleep: ['{n} 牛步化了'],
    eat: ['{n} 停下來反芻'],
    boost: ['{n} 看到紅布，衝了！'],
    win: ['🏁 {n} 太牛了，奪冠！'],
  },
  '🐐': {
    noun: '羊',
    fx: { eat: '🪧' },
    fall: ['{n} 嚇到昏倒了，是昏倒羊沒錯'],
    eat: ['{n} 啃了路邊的告示牌'],
    back: ['{n} 咩～跑去找同伴'],
    boost: ['{n} 衝撞模式啟動！'],
    win: ['🏁 {n} 喜氣洋洋，奪冠！'],
  },
  '🏎️': {
    noun: '賽車',
    exclusive: true,
    fx: { fall: '🌀', sleep: '🔧', eat: '⛽', back: '🧭', boost: '💨' },
    fall: ['{n} 甩尾太帥，直接轉了三圈', '{n} 爆胎了，芭比Q了'],
    sleep: ['{n} 引擎熄火，正在重新發動', '{n} 電量不足，請接上充電線'],
    eat: ['{n} 進站換胎加油', '{n} 進站順便買杯咖啡'],
    back: ['{n} 導航說前方右轉……結果錯了', '{n} 開錯匝道了'],
    boost: ['{n} 開了氮氣加速！', '{n} 油門踩到底！'],
    lateStart: ['{n} 起跑還沒發動引擎……'],
    start: ['引擎發動，綠燈！', '各車出發，輪胎冒煙！'],
    sprint: ['最後一圈！{n} 暫時領先！'],
    win: ['🏁 {n} 衝過終點，揮動格子旗！'],
  },
};

const pick = (lines, random) => lines[Math.floor(random() * lines.length)];
function fill(line, name, animal) {
  return line.replace(/\{n\}/g, name ?? '').replace(/\{a\}/g, PROFILES[animal]?.noun || '角色');
}

export function commentaryLines(type, animal) {
  const profile = PROFILES[animal] || {};
  const own = profile[type] || [];
  return profile.exclusive && own.length ? own : [...own, ...(GENERIC[type] || [])];
}

export function commentary(type, { name, animal, random = Math.random } = {}) {
  return fill(pick(commentaryLines(type, animal), random), name, animal);
}

export function mishapFx(type, animal) {
  return PROFILES[animal]?.fx?.[type] || DEFAULT_FX[type] || '';
}

export const COMMENTARY_ANIMALS = Object.keys(PROFILES);

// 轉盤播報：{n} = 得獎者，{d} = 指針一開始停到的人。翻轉時不調侃 {d}。
const WHEEL_LINES = {
  ready: ['準備好了嗎……', '屏住呼吸……', '大家看這邊～'],
  spin: ['命運的轉盤，開轉！', '轉盤轉起來啦！', '轉啊轉～～'],
  slow: ['慢下來了……', '會是誰呢……', '心跳加速中……'],
  stop: ['指針停在 {d}……', '是 {d}嗎？！'],
  normal: ['🏁 恭喜 {n}！就是你了！', '🏁 {n} 中獎！命運選中了你！'],
  extend: ['等等！指針怎麼變長了？！', '指針：我還沒伸展完', '指針開始長高了！'],
  extendWin: ['🏁 指針一路伸到 {n}！', '🏁 長長長長的指針選了 {n}！'],
  bend: ['指針：我覺得 {n} 比較好', '物理學不存在了', '指針突然彎腰了？！'],
  bendWin: ['🏁 指針硬彎給 {n}！', '🏁 {n}：謝謝指針大大'],
  fake: ['等等！指針在抖……', '咦？好像有什麼要發生了……', '屏住呼吸——'],
  fakeWin: ['🏁 虛驚一場！就是 {n}！', '🏁 嚇死人，還是 {n}！'],
  slip: ['喀……轉盤好像還沒停？', '轉盤自己動了一下！'],
  slipWin: ['🏁 滑到 {n}！', '🏁 喀一聲，停在 {n}！'],
  break: ['啪！指針斷掉了！', '指針：我不幹了', '指針罷工了！？'],
  breakWin: ['🏁 新指針指向 {n}！', '🏁 天降新指針，選中 {n}！'],
};

export function wheelLine(type, { winner, decoy, random = Math.random } = {}) {
  return pick(WHEEL_LINES[type], random)
    .replace(/\{n\}/g, winner ?? '')
    .replace(/\{d\}/g, decoy ?? '');
}
