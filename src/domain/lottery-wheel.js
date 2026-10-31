// Wheel animation planning only: the winner is already decided and saved by the backend.
// Angles are degrees clockwise from the pointer at 12 o'clock.

// Endings are presentation only; every one of them finishes on the saved winner.
// Twists share the odds equally and vary in direction and distance so viewers can't learn
// where the pointer will end up. Normal stays selectable only for forced previews.
export const WHEEL_ENDINGS = [
  { key: 'normal', weight: 0 },
  { key: 'fake', weight: 1 }, // scare: shakes and trembles, then stays put
  { key: 'extend', weight: 1 }, // pointer stretches through the centre to the far side
  { key: 'bend', weight: 1 }, // pointer bends a short or long way to either side
  { key: 'slip', weight: 1 }, // wheel creeps on or rolls back a few slices
  { key: 'break', weight: 1 }, // pointer snaps; a new one drops in anywhere
  { key: 'swap', weight: 1 }, // the winner's and first stop's names trade places
  { key: 'grow', weight: 1 }, // the winner's slice swells until it reaches the pointer
];
export const WHEEL_SPIN_MS = 8000;
// Share of the spin spent speeding up from standstill, so it never starts at full speed.
const SPIN_UP = 0.18;

const mod = (value, base) => ((value % base) + base) % base;

function pickEnding(count, random, avoid) {
  // A twist needs someone else on the wheel to stop on first.
  const usable = WHEEL_ENDINGS.filter(
    (ending) => ending.weight > 0 && (count > 1 || ['normal', 'fake'].includes(ending.key)),
  );
  // Never the same ending twice running, unless it is the only one left.
  const fresh = usable.filter((ending) => ending.key !== avoid);
  const options = fresh.length ? fresh : usable;
  let roll = random() * options.reduce((sum, ending) => sum + ending.weight, 0);
  for (const ending of options) {
    roll -= ending.weight;
    if (roll < 0) return ending.key;
  }
  return 'normal';
}

/**
 * Plans where the wheel stops and how the reveal then plays.
 * The wheel first stops at `stopRotation` with `decoy` under the pointer; the reveal
 * ends with the wheel at `rotation` and the pointer at screen angle `pointerAngle`,
 * which is always over the saved winner: `winnerSlot` is the slice that shows them there
 * (the first stop's slice after a swap). A grow instead swells the winner's slice to
 * `growHalf` degrees either side of its centre, which then covers the pointer.
 */
export function planWheel(
  count,
  winnerIndex,
  random = Math.random,
  { turns, ending: forced, avoid } = {},
) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('轉盤至少需要一位參加者');
  const slice = 360 / count;
  const center = (index) => index * slice + slice / 2;
  const ending =
    forced && WHEEL_ENDINGS.some((item) => item.key === forced) && (count > 1 || forced === 'fake')
      ? forced
      : pickEnding(count, random, avoid);
  const side = () => (random() < 0.5 ? -1 : 1);
  // A small offset inside the slice so stops don't look machine-perfect.
  const jitter = () => (random() - 0.5) * slice * 0.6;
  let target = jitter(),
    pointerAngle = 0,
    slipSlices = 0,
    growHalf = 0,
    winnerSlot = winnerIndex;
  if (ending === 'extend') {
    target = pointerAngle = 180;
  } else if (ending === 'bend') {
    const steps = Math.max(
      1,
      Math.min(Math.floor(count / 2), Math.round((25 + random() * 125) / slice)),
    );
    target = pointerAngle = side() * steps * slice;
  } else if (ending === 'break') {
    // Any other slice, so the replacement pointer can land anywhere around the wheel.
    target = pointerAngle = (1 + Math.floor(random() * (count - 1))) * slice;
  } else if (ending === 'slip') {
    slipSlices = side() * Math.max(1, Math.min(count - 1, 1 + Math.floor(random() * 3)));
  } else if (ending === 'swap') {
    target += side() * (1 + Math.floor(random() * (count - 1))) * slice;
  } else if (ending === 'grow') {
    // The winner stops a few slices from the pointer, close enough to reach it by growing.
    const steps = Math.max(1, Math.min(Math.floor(count / 4), 1 + Math.floor(random() * 4)));
    target = side() * (steps - 0.25) * slice;
    growHalf = Math.min(170, Math.max(40, Math.abs(target) + slice * 0.25));
  }
  // Wheel rotation R puts the winner's centre at `target`: center(w) + R ≡ target.
  const rest = mod(target - center(winnerIndex), 360);
  const fullTurns = turns ?? 4 + Math.floor(random() * 2);
  const rotation = fullTurns * 360 + rest;
  // Slip stops short (or overshoots) by whole slices, then rolls onto the winner.
  const stopRotation = rotation - slipSlices * slice;
  const decoy = sliceAt(count, stopRotation, 0);
  if (ending === 'swap') winnerSlot = decoy;
  return {
    ending, stopRotation, rotation, pointerAngle, decoy, winner: winnerIndex, winnerSlot,
    slice, target, growHalf,
  };
}

// Which slice is under screen angle `angle` when the wheel is turned by `rotation`.
export function sliceAt(count, rotation, angle = 0) {
  return Math.floor(mod(angle - rotation, 360) / (360 / count)) % count;
}

// Speed ramps up linearly from 0, then decays as (1 - t)^2: a gentle start and a long,
// suspenseful slow-down. Returns the share of the total rotation covered at `progress`.
export function wheelEase(progress) {
  const p = Math.min(1, Math.max(0, progress));
  const rampArea = SPIN_UP / 2,
    tailArea = (1 - SPIN_UP) / 3;
  if (p <= SPIN_UP) return (p * p) / (2 * SPIN_UP) / (rampArea + tailArea);
  const t = (p - SPIN_UP) / (1 - SPIN_UP);
  return (rampArea + tailArea * (1 - Math.pow(1 - t, 3))) / (rampArea + tailArea);
}
