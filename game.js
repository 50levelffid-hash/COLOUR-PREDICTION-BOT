// ── RTF Gaming — Game Engine ──
const { User, Bet } = require('./models');

// ── Predefined 54-round sequence ──
const RESULT_SEQUENCE = [
  'big','small','big','small','small','big','small','small','small','small',
  'big','big','big','big','big','big','big','big','big','big',
  'small','small','small','big','small','big','small','big','small','big',
  'small','big','small','big','small','small','small','big','small','small',
  'small','big','small','small','big','small','small','big','small','big',
  'small','big','small','big'
];

const ROUND_TIME   = 60;   // 1 minute betting window
const BREAK_TIME   = 10;   // seconds between rounds
const WIN_MULT     = 1.92;

// ── Shared mutable state (single process) ──
const state = {
  gameActive: false,
  currentRound: 0,
  roundEndTime: 0,
  activePlayers: new Set(),
  optedOut: new Set(),
  timerMsgIds: new Map(),
  pendingBets: new Map(),
  gameTimer: null,
  forceResultMode: false   // NEW: jab ON ho to kam bet wali side jeetegi
};

function getNextResult() {
  return RESULT_SEQUENCE[state.currentRound % RESULT_SEQUENCE.length];
}

function timerBar(remaining, total = ROUND_TIME) {
  const filled = total - remaining;
  const pct = filled / total;
  const barLen = 10;
  const green = Math.floor(pct * barLen);
  const red = barLen - green;
  return '🟩'.repeat(green) + '🟥'.repeat(red);
}

function getRemainingSeconds() {
  return Math.max(0, Math.round((state.roundEndTime - Date.now()) / 1000));
}

module.exports = {
  state,
  RESULT_SEQUENCE,
  ROUND_TIME,
  BREAK_TIME,
  WIN_MULT,
  getNextResult,
  timerBar,
  getRemainingSeconds
};
