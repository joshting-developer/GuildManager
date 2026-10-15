import RaceStage from './RaceStage.vue';
import WheelStage from './WheelStage.vue';

// 抽獎玩法清單。新增玩法：寫一個元件並加在這裡。
// 玩法元件介面：
// - props：names（本場參加者，依畫面順序）、live（是否全螢幕演出中）
// - emits：say（播報文字）、leader（目前領先者，可不送）
// - expose：play(winnerIndex) → Promise，演出到揭曉得獎者後 resolve
// 得獎者一律由後端決定並保存，玩法只負責演出，不得改變結果。
export const LOTTERY_MODES = [
  {
    key: 'race',
    emoji: '🏇',
    title: '賽馬',
    description: '大家一起賽跑，第一個衝線的人得獎',
    start: '開跑',
    component: RaceStage,
  },
  {
    key: 'wheel',
    emoji: '🎡',
    title: '轉盤',
    description: '轉到最後，指針可能突然變長或彎曲',
    start: '開轉',
    component: WheelStage,
  },
];
