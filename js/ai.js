/**
 * ai.js — checkers engine. Random / 3-ply / 5-ply minimax with alpha-beta.
 * Pure and DOM-free so the test harness can drive it under Node.
 */

import {
  BLACK, RED, EMPTY, BM, BK, RM, RK,
  RC, colorOf, isKing, opponent,
  generateMoves, applyMoveToBoard, countMaterial,
} from './rules.js';

export const DIFFICULTIES = {
  easy: { label: 'Easy', depth: 0 },
  medium: { label: 'Medium', depth: 3 },
  hard: { label: 'Hard', depth: 5 },
};

const MAN_VALUE = 100;
const KING_VALUE = 175;
const WIN = 1e6;

/**
 * Piece-square table from BLACK's point of view, indexed by dark square 0..31.
 * Rewards advancement, holding the back rank (anti-crowning defence) and the
 * centre; penalises the vulnerable edge files slightly less than the centre pays.
 */
const MAN_PST = buildManPst();
const KING_PST = buildKingPst();

function buildManPst() {
  const t = new Int16Array(32);
  for (let i = 0; i < 32; i++) {
    const [r, c] = RC[i];
    let v = r * 6;                      // advancement toward the crown row
    if (r === 0) v += 10;               // guard the back rank
    if (r === 6) v += 12;               // one step from promotion
    const centre = 3.5 - Math.abs(c - 3.5);
    v += centre * 2;
    if (c === 0 || c === 7) v -= 4;     // edge men have half the mobility
    t[i] = Math.round(v);
  }
  return t;
}

function buildKingPst() {
  const t = new Int16Array(32);
  for (let i = 0; i < 32; i++) {
    const [r, c] = RC[i];
    const cr = 3.5 - Math.abs(r - 3.5);
    const cc = 3.5 - Math.abs(c - 3.5);
    t[i] = Math.round((cr + cc) * 4); // kings want the middle
  }
  return t;
}

/** Mirror a square index vertically (BLACK table -> RED table). */
const MIRROR = new Int8Array(32);
for (let i = 0; i < 32; i++) {
  const [r, c] = RC[i];
  const mr = 7 - r;
  const mc = 7 - c;
  for (let j = 0; j < 32; j++) {
    if (RC[j][0] === mr && RC[j][1] === mc) { MIRROR[i] = j; break; }
  }
}

/**
 * Static evaluation from `me`'s point of view. Positive is good for `me`.
 * Material dominates; PST, king count and mobility are tie-breakers.
 */
export function evaluate(board, me, usePst = true) {
  let score = 0;
  for (let i = 0; i < 32; i++) {
    const code = board[i];
    if (code === EMPTY) continue;
    const black = code === BM || code === BK;
    const king = isKing(code);
    let v = king ? KING_VALUE : MAN_VALUE;
    if (usePst) {
      const idx = black ? i : MIRROR[i];
      v += king ? KING_PST[idx] : MAN_PST[idx];
    }
    score += black ? v : -v;
  }
  return me === BLACK ? score : -score;
}

function terminalScore(board, turn, me, depthLeft) {
  // `turn` has no moves -> `turn` loses. Prefer faster wins / slower losses.
  const loser = turn;
  const base = WIN + depthLeft;
  return loser === me ? -base : base;
}

function orderMoves(moves) {
  // Captures first, longest chains first — cheap but very effective pruning.
  return moves.slice().sort((a, b) => b.captured.length - a.captured.length);
}

function negamax(board, turn, me, depth, alpha, beta, usePst, budget) {
  budget.nodes++;
  const moves = generateMoves(board, turn);
  if (moves.length === 0) return terminalScore(board, turn, me, depth);

  // Quiescence: never stop the search in the middle of an exchange.
  if (depth <= 0) {
    const forced = moves.length === 1 || moves[0].capture;
    if (!forced || budget.nodes > budget.maxNodes || depth <= -6) {
      return evaluate(board, me, usePst);
    }
  }

  let best = -Infinity;
  for (const mv of orderMoves(moves)) {
    const nb = applyMoveToBoard(board, mv, turn);
    const score = -negamax(nb, opponent(turn), opponent(me), depth - 1, -beta, -alpha, usePst, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

function pickRandom(moves, rng) {
  return moves[Math.floor(rng() * moves.length)];
}

/**
 * Choose a move for `state.turn`.
 * @param {object} state  {board, turn, ...}
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {() => number} rng  injectable RNG for deterministic tests
 * @returns {object|null} the chosen move, or null if there are none
 */
export function chooseMove(state, difficulty = 'medium', rng = Math.random) {
  const { board, turn } = state;
  const moves = generateMoves(board, turn);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  if (cfg.depth === 0) return pickRandom(moves, rng);

  const usePst = difficulty === 'hard';
  const budget = { nodes: 0, maxNodes: difficulty === 'hard' ? 400000 : 120000 };

  let alpha = -Infinity;
  const scored = [];
  for (const mv of orderMoves(moves)) {
    const nb = applyMoveToBoard(board, mv, turn);
    const score = -negamax(nb, opponent(turn), opponent(turn), cfg.depth - 1, -Infinity, -alpha, usePst, budget);
    scored.push({ mv, score });
    if (score > alpha) alpha = score;
  }

  const best = Math.max(...scored.map((s) => s.score));
  // Medium plays a shade loosely among equal-value moves so games vary.
  const ties = scored.filter((s) => s.score === best).map((s) => s.mv);
  return ties.length === 1 ? ties[0] : pickRandom(ties, rng);
}

export { countMaterial };
