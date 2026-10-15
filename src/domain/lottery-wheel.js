// Wheel animation planning only: the winner is already decided and saved by the backend.
// Angles are degrees clockwise from the pointer at 12 o'clock.

// Endings are presentation only; every one of them finishes on the saved winner.
export const WHEEL_ENDINGS = [
  { key: 'normal', weight: 2 },
  { key: 'extend', weight: 1 },
  { key: 'bend', weight: 1 },
];
export const WHEEL_SPIN_MS = 8000;
// Share of the spin spent speeding up from standstill, so it never starts at full speed.
const SPIN_UP = 0.18;

const mod = (value, base) => ((value % base) + base) % base;

function pickEnding(count, random) {
  // A twist needs someone else on the wheel to stop on first.
  const options = WHEEL_ENDINGS.filter((ending) => count > 1 || ending.key === 'normal');
  let roll = random() * options.reduce((sum, ending) => sum + ending.weight, 0);
  for (const ending of options) {
    roll -= ending.weight;
    if (roll < 0) return ending.key;
  }
  return 'normal';
}

/**
 * Plans where the wheel stops and how the pointer then moves.
 * - normal: the winner's slice stops under the pointer.
 * - extend: the winner sits opposite; the pointer stretches through the centre.
 * - bend: the winner sits a few slices aside (25–60°); the pointer bends to it.
 * `decoy` is whoever the pointer first appears to land on.
 */
export function planWheel(count, winnerIndex, random = Math.random, { turns } = {}) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('轉盤至少需要一位參加者');
  const slice = 360 / count;
  const center = (index) => index * slice + slice / 2;
  const ending = pickEnding(count, random);
  let target, pointerAngle;
  if (ending === 'extend') {
    target = 180;
    pointerAngle = 180;
  } else if (ending === 'bend') {
    const steps = Math.max(
      1,
      Math.min(Math.floor(count / 2), Math.round((25 + random() * 35) / slice)),
    );
    pointerAngle = (random() < 0.5 ? -1 : 1) * steps * slice;
    target = pointerAngle;
  } else {
    // A small offset inside the slice so normal stops don't look machine-perfect.
    target = (random() - 0.5) * slice * 0.6;
    pointerAngle = 0;
  }
  // Wheel rotation R puts the winner's centre at `target`: center(w) + R ≡ target.
  const rest = mod(target - center(winnerIndex), 360);
  const fullTurns = turns ?? 4 + Math.floor(random() * 2);
  const rotation = fullTurns * 360 + rest;
  const decoy = sliceAt(count, rotation, 0);
  return { ending, rotation, pointerAngle, decoy, winner: winnerIndex, slice };
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
