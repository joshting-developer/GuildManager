// Animation planning only: the winner is already decided and saved by the backend.
export const RACE_MS = 20000;
export const AFTER_MS = 3000;

export const RACE_ICONS = [
  { key: 'horse', label: '🏇 騎士', set: ['🏇'] },
  { key: 'pony', label: '🐎 馬', set: ['🐎'] },
  {
    key: 'zoo',
    label: '🎲 動物大亂鬥',
    set: ['🐎', '🐖', '🐕', '🐈', '🐢', '🐌', '🦆', '🐓', '🐇', '🦖', '🐄', '🐐'],
  },
  { key: 'turtle', label: '🐢 烏龜', set: ['🐢'] },
  { key: 'pig', label: '🐖 小豬', set: ['🐖'] },
  { key: 'dog', label: '🐕 狗狗', set: ['🐕'] },
  { key: 'duck', label: '🦆 鴨子', set: ['🦆'] },
  { key: 'snail', label: '🐌 蝸牛', set: ['🐌'] },
  { key: 'dino', label: '🦖 恐龍', set: ['🦖'] },
  { key: 'car', label: '🏎️ 賽車', set: ['🏎️'] },
];

// rate is how fast the runner's own clock moves during the mishap (0 = stopped).
export const MISHAPS = {
  fall: {
    rate: 0,
    min: 1500,
    max: 2300,
    fx: '💥',
    weight: 3,
    say: ['{n} 馬失前蹄，摔個狗吃屎！', '{n} 跌倒了！快爬起來啊！', '{n} 的馬腳滑了一下…'],
  },
  sleep: {
    rate: 0,
    min: 1600,
    max: 2600,
    fx: '💤',
    weight: 2,
    say: ['{n} 跑到一半睡著了…', '{n}：讓我躺一下就好'],
  },
  eat: {
    rate: 0,
    min: 1300,
    max: 2100,
    fx: '🌿',
    weight: 2,
    say: ['{n} 停下來吃草', '{n}：這邊的草好香'],
  },
  back: {
    rate: 0,
    min: 2200,
    max: 3200,
    fx: '❓',
    weight: 6,
    say: ['{n} 跑錯方向了！', '{n} 好像忘了東西要回去拿'],
  },
  boost: {
    rate: 2.4,
    min: 1000,
    max: 1600,
    fx: '🔥',
    weight: 3,
    say: ['{n} 突然暴衝！', '{n} 是吃了什麼這麼猛？！', '{n} 開始認真了！'],
  },
};

export function raceIcon(name, key) {
  const set = (RACE_ICONS.find((icon) => icon.key === key) || RACE_ICONS[0]).set;
  if (set.length === 1) return set[0];
  // Mixed animals: the same person always gets the same animal.
  let value = 0;
  for (const char of name) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return set[value % set.length];
}

export function shuffle(items, random = Math.random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Progress x(t) = t/T + Σ a_j·sin(jπt/T) is exactly 0 and 1 at both ends;
 * Σ|a_j|·jπ < 1 keeps speed positive while still allowing overtakes.
 */
export function makeProfile(total, comeback, random = Math.random) {
  const amplitudes = [];
  let budget = 0.85;
  for (let j = 1; j <= 3; j++) {
    const max = (budget / (j * Math.PI)) * (j === 3 ? 1 : 0.6 + random() * 0.4);
    const amplitude = (random() * 2 - 1) * max;
    amplitudes.push(amplitude);
    budget -= Math.abs(amplitude) * j * Math.PI;
  }
  if (comeback) amplitudes[0] = -Math.abs(amplitudes[0]);
  return (t) => {
    if (t >= total) return 1;
    const u = t / total;
    let x = u;
    amplitudes.forEach((a, i) => {
      x += a * Math.sin((i + 1) * Math.PI * u);
    });
    return Math.max(0, Math.min(1, x));
  };
}

function pickMishap(random) {
  const keys = Object.keys(MISHAPS);
  let roll = random() * keys.reduce((sum, key) => sum + MISHAPS[key].weight, 0);
  for (const key of keys) {
    roll -= MISHAPS[key].weight;
    if (roll < 0) return key;
  }
  return keys[0];
}

// Real-time, non-overlapping mishaps that always end before the runner's finish time.
export function planMishaps(finish, isWinner, random = Math.random) {
  const events = [];
  const latest = finish - 1500;
  const fits = (start, duration) =>
    start + duration <= latest &&
    events.every(
      (event) => start + duration + 300 < event.start || start > event.start + event.duration + 300,
    );
  const add = (type, start, duration) => {
    if (fits(start, duration)) events.push({ type, start, duration, said: false });
  };
  if (random() < 0.08) add('sleep', 0, 1300 + random() * 900);
  if (isWinner && random() < 0.45) add('fall', finish * (0.35 + random() * 0.25), 1700);
  const roll = random();
  const count = roll < 0.3 ? 0 : roll < 0.75 ? 1 : 2;
  for (let k = 0; k < count; k++) {
    for (let tries = 0; tries < 6; tries++) {
      const type = pickMishap(random),
        mishap = MISHAPS[type];
      const before = events.length;
      add(
        type,
        finish * (0.08 + random() * 0.8),
        mishap.min + random() * (mishap.max - mishap.min),
      );
      if (events.length > before) break;
    }
  }
  return events.sort((a, b) => a.start - b.start);
}

export function horseClock(t, events) {
  let clock = t;
  for (const event of events) {
    const overlap = Math.max(0, Math.min(t - event.start, event.duration));
    clock += (MISHAPS[event.type].rate - 1) * overlap;
  }
  return clock;
}

// The winner reaches the line at RACE_MS; runner-up stays close, others spread out.
export function planRace(names, winner, random = Math.random) {
  const finishAt = { [winner]: RACE_MS };
  shuffle(
    names.filter((name) => name !== winner),
    random,
  ).forEach((name, index) => {
    finishAt[name] = RACE_MS * (index === 0 ? 1.01 + random() * 0.025 : 1.04 + random() * 0.3);
  });
  const plans = names.map((name) => {
    const finish = finishAt[name];
    let events = planMishaps(finish, name === winner, random);
    let total = horseClock(finish, events);
    if (total < finish * 0.5) {
      events = [];
      total = finish;
    }
    return {
      events,
      profile: makeProfile(total, name === winner && random() < 0.5, random),
      state: '',
    };
  });
  const rank = {};
  names
    .slice()
    .sort((a, b) => finishAt[a] - finishAt[b])
    .forEach((name, index) => {
      rank[name] = index + 1;
    });
  return { finishAt, plans, rank };
}
