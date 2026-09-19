/**
 * rules.js — English draughts (American checkers) rules engine.
 * Pure, DOM-free, dependency-free. Safe to import in a Worker or in Node.
 *
 * Board representation: Int8Array(32) over the 32 dark squares only,
 * numbered 1..32 in standard draughts order (index = number - 1).
 *
 *   Square 1  is row 0, col 1 (top-left dark square)
 *   Square 32 is row 7, col 6 (bottom-right dark square)
 *
 * Black occupies squares 1..12 and advances toward row 7.
 * Red   occupies squares 21..32 and advances toward row 0.
 * Black moves first (official English draughts).
 */

export const EMPTY = 0;
export const BM = 1; // black man
export const BK = 2; // black king
export const RM = 3; // red man
export const RK = 4; // red king

export const BLACK = 'b';
export const RED = 'r';

/** Number of consecutive quiet king moves (plies) that force a draw. */
export const KING_MOVE_DRAW_LIMIT = 40;

export function colorOf(code) {
  if (code === EMPTY) return null;
  return code <= BK ? BLACK : RED;
}

export function isKing(code) {
  return code === BK || code === RK;
}

export function opponent(color) {
  return color === BLACK ? RED : BLACK;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** RC[sq] -> [row, col] */
export const RC = [];
for (let i = 0; i < 32; i++) {
  const row = (i / 4) | 0;
  const col = row % 2 === 0 ? (i % 4) * 2 + 1 : (i % 4) * 2;
  RC.push([row, col]);
}

const SQMAP = new Int8Array(64).fill(-1);
RC.forEach(([r, c], i) => {
  SQMAP[r * 8 + c] = i;
});

/** Dark-square index at (row, col), or -1 if off-board / light square. */
export function sqAt(row, col) {
  if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
  return SQMAP[row * 8 + col];
}

const MAN_DIRS = {
  [BM]: [[1, -1], [1, 1]],
  [RM]: [[-1, -1], [-1, 1]],
};
const KING_DIRS = [[1, -1], [1, 1], [-1, -1], [-1, 1]];

function dirsFor(code) {
  return isKing(code) ? KING_DIRS : MAN_DIRS[code];
}

/** Row on which `color` promotes. */
function crownRow(color) {
  return color === BLACK ? 7 : 0;
}

function willCrown(code, sq) {
  if (isKing(code)) return false;
  return RC[sq][0] === crownRow(colorOf(code));
}

function kingCode(color) {
  return color === BLACK ? BK : RK;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export function initialBoard() {
  const b = new Int8Array(32);
  for (let i = 0; i <= 11; i++) b[i] = BM;
  for (let i = 20; i <= 31; i++) b[i] = RM;
  return b;
}

export function initialState() {
  return { board: initialBoard(), turn: BLACK, kingMoves: 0, ply: 0 };
}

export function cloneState(s) {
  return { board: s.board.slice(), turn: s.turn, kingMoves: s.kingMoves, ply: s.ply };
}

/* ------------------------------------------------------------------ */
/* Move generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * A Move:
 *   { from, to, path: [sq...], captured: [sq...], crowned: bool, capture: bool }
 * `path[0]` is the origin; each subsequent entry is a landing square.
 */

function collectJumps(board, sq, code, turn, path, captured, out) {
  const [r, c] = RC[sq];
  for (const [dr, dc] of dirsFor(code)) {
    const mid = sqAt(r + dr, c + dc);
    if (mid < 0) continue;
    const victim = board[mid];
    if (victim === EMPTY || colorOf(victim) === turn) continue;
    const land = sqAt(r + 2 * dr, c + 2 * dc);
    if (land < 0 || board[land] !== EMPTY) continue;

    const nb = board.slice();
    nb[sq] = EMPTY;
    nb[mid] = EMPTY;

    const crowns = willCrown(code, land);
    nb[land] = crowns ? kingCode(turn) : code;

    const npath = path.concat(land);
    const ncap = captured.concat(mid);

    if (crowns) {
      // English draughts: crowning terminates the move, even mid-jump.
      out.push({ from: path[0], to: land, path: npath, captured: ncap, crowned: true, capture: true });
    } else {
      const before = out.length;
      collectJumps(nb, land, code, turn, npath, ncap, out);
      if (out.length === before) {
        out.push({ from: path[0], to: land, path: npath, captured: ncap, crowned: false, capture: true });
      }
    }
  }
}

/**
 * All legal moves for `turn`. Captures are mandatory: if any capture exists,
 * only captures are returned.
 */
export function generateMoves(board, turn) {
  const jumps = [];
  for (let i = 0; i < 32; i++) {
    const code = board[i];
    if (code === EMPTY || colorOf(code) !== turn) continue;
    collectJumps(board, i, code, turn, [i], [], jumps);
  }
  if (jumps.length) return jumps;

  const moves = [];
  for (let i = 0; i < 32; i++) {
    const code = board[i];
    if (code === EMPTY || colorOf(code) !== turn) continue;
    const [r, c] = RC[i];
    for (const [dr, dc] of dirsFor(code)) {
      const t = sqAt(r + dr, c + dc);
      if (t < 0 || board[t] !== EMPTY) continue;
      moves.push({
        from: i,
        to: t,
        path: [i, t],
        captured: [],
        crowned: willCrown(code, t),
        capture: false,
      });
    }
  }
  return moves;
}

/** Apply a move to a board in place-free fashion; returns the new board. */
export function applyMoveToBoard(board, move, turn) {
  const b = board.slice();
  const code = b[move.from];
  b[move.from] = EMPTY;
  for (const cs of move.captured) b[cs] = EMPTY;
  b[move.to] = move.crowned ? kingCode(turn) : code;
  return b;
}

/** Apply a move to a full state; returns a new state (input untouched). */
export function applyMove(state, move) {
  const code = state.board[move.from];
  const quiet = !move.capture && !move.crowned && isKing(code);
  return {
    board: applyMoveToBoard(state.board, move, state.turn),
    turn: opponent(state.turn),
    kingMoves: quiet ? state.kingMoves + 1 : 0,
    ply: state.ply + 1,
  };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export function countMaterial(board) {
  const t = { b: { men: 0, kings: 0 }, r: { men: 0, kings: 0 } };
  for (let i = 0; i < 32; i++) {
    const code = board[i];
    if (code === EMPTY) continue;
    const side = colorOf(code) === BLACK ? t.b : t.r;
    if (isKing(code)) side.kings++;
    else side.men++;
  }
  t.b.total = t.b.men + t.b.kings;
  t.r.total = t.r.men + t.r.kings;
  return t;
}

/**
 * Returns { over, winner, reason, moves }.
 * winner is BLACK | RED | null (null with over=true means a draw).
 */
export function gameStatus(state) {
  const moves = generateMoves(state.board, state.turn);
  if (moves.length === 0) {
    const mat = countMaterial(state.board);
    const mine = state.turn === BLACK ? mat.b.total : mat.r.total;
    return {
      over: true,
      winner: opponent(state.turn),
      reason: mine === 0 ? 'captured' : 'blocked',
      moves,
    };
  }
  if (state.kingMoves >= KING_MOVE_DRAW_LIMIT) {
    return { over: true, winner: null, reason: 'draw-king-moves', moves };
  }
  return { over: false, winner: null, reason: null, moves };
}

/* ------------------------------------------------------------------ */
/* Notation                                                            */
/* ------------------------------------------------------------------ */

/** Standard draughts notation: "11-15" for a move, "22x18" / "22x15x6" for jumps. */
export function notation(move) {
  const sep = move.capture ? 'x' : '-';
  return move.path.map((s) => s + 1).join(sep);
}

/** Parse a board from a compact debug string (for tests). '.'=empty b/B/r/R */
export function boardFromString(str) {
  const cleaned = str.replace(/[^.bBrR]/g, '');
  if (cleaned.length !== 32) throw new Error(`expected 32 cells, got ${cleaned.length}`);
  const b = new Int8Array(32);
  for (let i = 0; i < 32; i++) {
    b[i] = { '.': EMPTY, b: BM, B: BK, r: RM, R: RK }[cleaned[i]];
  }
  return b;
}

export function boardToString(board) {
  const ch = ['.', 'b', 'B', 'r', 'R'];
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += ch[board[i]];
    if (i % 4 === 3) out += i === 31 ? '' : '/';
  }
  return out;
}
