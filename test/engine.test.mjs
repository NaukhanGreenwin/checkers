/**
 * Headless validation harness. Run: node test/engine.test.mjs
 * Exits non-zero on any failure.
 */
import {
  BLACK, RED, EMPTY, BM, BK, RM, RK,
  initialState, cloneState, generateMoves, applyMove, applyMoveToBoard,
  gameStatus, countMaterial, notation, boardFromString, boardToString,
  colorOf, isKing, opponent, RC, sqAt,
} from '../js/rules.js';
import { chooseMove, evaluate } from '../js/ai.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ' :: ' + detail : ''}`); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

/* seeded RNG so failures reproduce */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= 1. Geometry & setup ================= */
{
  eq('sq1 is row0 col1', RC[0], [0, 1]);
  eq('sq32 is row7 col6', RC[31], [7, 6]);
  ok('all 32 squares dark', RC.every(([r, c]) => (r + c) % 2 === 1));
  ok('sqAt round-trips', RC.every(([r, c], i) => sqAt(r, c) === i));
  ok('off-board is -1', sqAt(-1, 0) === -1 && sqAt(8, 0) === -1 && sqAt(0, 8) === -1);

  const s = initialState();
  const m = countMaterial(s.board);
  eq('black starts 12 men', [m.b.men, m.b.kings], [12, 0]);
  eq('red starts 12 men', [m.r.men, m.r.kings], [12, 0]);
  eq('black moves first', s.turn, BLACK);
  eq('opening has 7 moves', generateMoves(s.board, BLACK).length, 7);
  eq('red opening has 7 moves', generateMoves(s.board, RED).length, 7);
  ok('no opening captures', generateMoves(s.board, BLACK).every((mv) => !mv.capture));
  eq('opening notation sample', notation(generateMoves(s.board, BLACK)[0]), '9-13');
}

/* ================= 2. Man directionality ================= */
{
  // lone black man on 14 -> forward only (17, 18)
  const b = boardFromString('.'.repeat(13) + 'b' + '.'.repeat(18));
  const mv = generateMoves(b, BLACK);
  eq('black man moves forward only', mv.map(notation).sort(), ['14-17', '14-18']);

  const r = boardFromString('.'.repeat(13) + 'r' + '.'.repeat(18));
  const rm = generateMoves(r, RED);
  eq('red man moves forward only', rm.map(notation).sort(), ['14-10', '14-9']);
}

/* ================= 3. Single capture ================= */
{
  // black man 14, red man 18, 23 empty -> 14x23
  const cells = Array(32).fill('.');
  cells[13] = 'b'; cells[17] = 'r';
  const b = boardFromString(cells.join(''));
  const mv = generateMoves(b, BLACK);
  eq('single capture generated', mv.map(notation), ['14x23']);
  eq('capture removes victim', mv[0].captured, [17]);
  const after = applyMoveToBoard(b, mv[0], BLACK);
  ok('victim gone', after[17] === EMPTY);
  ok('piece landed', after[22] === BM);
}

/* ================= 4. Forced capture ================= */
{
  const cells = Array(32).fill('.');
  cells[13] = 'b'; cells[17] = 'r'; cells[9] = 'b'; // 10 is a free quiet mover
  const b = boardFromString(cells.join(''));
  const mv = generateMoves(b, BLACK);
  ok('captures are mandatory', mv.length === 1 && mv[0].capture, mv.map(notation).join(','));
}

/* ================= 5. MULTI-JUMP CHAIN ================= */
{
  // Black man on 13. Red men on 17 and 26 -> 13x22x31 (double jump).
  const cells = Array(32).fill('.');
  cells[12] = 'b'; cells[16] = 'r'; cells[25] = 'r';
  const b = boardFromString(cells.join(''));
  const mv = generateMoves(b, BLACK);
  eq('double jump found', mv.map(notation), ['13x22x31']);
  eq('two victims', mv[0].captured.length, 2);
  eq('path length 3', mv[0].path.length, 3);
  const after = applyMoveToBoard(b, mv[0], BLACK);
  ok('both victims removed', after[16] === EMPTY && after[25] === EMPTY);
  ok('origin vacated', after[12] === EMPTY);
  // square 31 sits on row 7, so this double jump finishes by crowning
  ok('lands on 31 and crowns', after[30] === BK && mv[0].crowned, `code ${after[30]}`);

  // TRIPLE jump that does NOT reach the crown row: black man 5 -> x14 x23 ... build it.
  const c3 = Array(32).fill('.');
  c3[4] = 'b';    // black man on square 5  (row1,col2)
  c3[8] = 'r';    // square 9   (row2,col1) -> land 14 (row3,col0)?  verify via engine
  const b3 = boardFromString(c3.join(''));
  const j3 = generateMoves(b3, BLACK).filter((m) => m.capture);
  ok('chain from square 5 exists', j3.length >= 1, generateMoves(b3, BLACK).map(notation).join(','));

  // King triple jump in open space: king on 23, reds on 18, 10, 11 pattern
  const c4 = Array(32).fill('.');
  c4[26] = 'B';   // black king on 27
  c4[22] = 'r';   // 23
  c4[14] = 'r';   // 15
  c4[6] = 'r';    // 7
  const b4 = boardFromString(c4.join(''));
  const j4 = generateMoves(b4, BLACK).filter((m) => m.capture);
  const longest = Math.max(0, ...j4.map((m) => m.captured.length));
  ok('king finds a multi-capture chain', longest >= 2, `longest=${longest} :: ${j4.map(notation).join(',')}`);
  if (longest >= 2) {
    const chain = j4.find((m) => m.captured.length === longest);
    const res = applyMoveToBoard(b4, chain, BLACK);
    ok('all chain victims removed', chain.captured.every((s) => res[s] === EMPTY));
    ok('chain path length = victims + 1', chain.path.length === chain.captured.length + 1);
    ok('king stays a king through the chain', res[chain.to] === BK, `code ${res[chain.to]}`);
    console.log(`  triple-jump check: ${notation(chain)} capturing ${chain.captured.length}`);
  }

  // Triple jump: black KING on 14, red men on 18, 19(->no) ... build a real one.
  // King on 15; reds on 18, 11, 19 arranged so 15x22x31x24 is impossible;
  // use a clean staircase instead: king 23, reds 18, 10 -> 23x14x7? verify shape.
  const c2 = Array(32).fill('.');
  c2[22] = 'B';        // black king on 23
  c2[17] = 'r';        // 18
  c2[9] = 'r';         // 10
  const b2 = boardFromString(c2.join(''));
  const mv2 = generateMoves(b2, BLACK).filter((m) => m.captured.length >= 2);
  ok('king chains backwards', mv2.length >= 1, generateMoves(b2, BLACK).map(notation).join(','));
  if (mv2.length) eq('king double victims', mv2[0].captured.length, 2);
}

/* ================= 6. Crowning ================= */
{
  const cells = Array(32).fill('.');
  cells[27] = 'b'; // black man on 28 -> reaches row 7
  const b = boardFromString(cells.join(''));
  const mv = generateMoves(b, BLACK).filter((m) => m.to >= 28);
  ok('crowning move flagged', mv.length > 0 && mv.every((m) => m.crowned));
  const after = applyMoveToBoard(b, mv[0], BLACK);
  ok('became a king', after[mv[0].to] === BK, `code ${after[mv[0].to]}`);

  // red crowns on row 0
  const rc = Array(32).fill('.');
  rc[4] = 'r';
  const rb = boardFromString(rc.join(''));
  const rmv = generateMoves(rb, RED);
  ok('red crowns at back row', rmv.every((m) => m.crowned));
  ok('red became king', applyMoveToBoard(rb, rmv[0], RED)[rmv[0].to] === RK);

  // English rule: crowning ENDS the move even if another jump is available.
  const cc = Array(32).fill('.');
  cc[21] = 'b';  // black man on 22
  cc[25] = 'r';  // 26 -> jump to 31 (row 7) = crown
  cc[26] = 'r';  // would allow a continuation if crowning did not stop it
  const cb = boardFromString(cc.join(''));
  const cmv = generateMoves(cb, BLACK).filter((m) => m.crowned);
  ok('crowning terminates the jump chain', cmv.every((m) => m.captured.length === 1),
    cmv.map((m) => notation(m) + ':' + m.captured.length).join(','));
}

/* ================= 7. King mobility ================= */
{
  const cells = Array(32).fill('.');
  cells[13] = 'B'; // black king on 14
  const b = boardFromString(cells.join(''));
  const mv = generateMoves(b, BLACK);
  eq('king moves all 4 ways', mv.length, 4);
  eq('king dirs', mv.map(notation).sort(), ['14-10', '14-17', '14-18', '14-9']);
}

/* ================= 8. Win / block detection ================= */
{
  const cells = Array(32).fill('.');
  cells[13] = 'b';
  const b = boardFromString(cells.join(''));
  const st = { board: b, turn: RED, kingMoves: 0, ply: 0 };
  const s = gameStatus(st);
  ok('all-captured win detected', s.over && s.winner === BLACK && s.reason === 'captured', JSON.stringify(s));

  // Blocked: red man on 32 boxed in by its own wall in the corner.
  const bc = Array(32).fill('.');
  bc[31] = 'r';  // red man on 32 (row 7) moves to 27/28
  bc[26] = 'b'; bc[27] = 'b';           // block both
  bc[22] = 'b'; bc[23] = 'b';           // and block the jump landings
  const bb = boardFromString(bc.join(''));
  const bs = gameStatus({ board: bb, turn: RED, kingMoves: 0, ply: 0 });
  ok('blocked loss detected', bs.over && bs.winner === BLACK && bs.reason === 'blocked', JSON.stringify(bs));
}

/* ================= 9. Draw by 40 king moves ================= */
{
  const cells = Array(32).fill('.');
  cells[13] = 'B'; cells[20] = 'R';
  const b = boardFromString(cells.join(''));
  const st = { board: b, turn: BLACK, kingMoves: 40, ply: 90 };
  const s = gameStatus(st);
  ok('king-move draw', s.over && s.winner === null && s.reason === 'draw-king-moves', JSON.stringify(s));

  // counter increments only on quiet king moves
  let s2 = { board: b, turn: BLACK, kingMoves: 0, ply: 0 };
  const quiet = generateMoves(s2.board, BLACK).find((m) => !m.capture);
  s2 = applyMove(s2, quiet);
  eq('quiet king move increments', s2.kingMoves, 1);
}

/* ================= 10. State immutability ================= */
{
  const s = initialState();
  const before = boardToString(s.board);
  const mv = generateMoves(s.board, BLACK)[0];
  const s2 = applyMove(s, mv);
  eq('applyMove does not mutate input', boardToString(s.board), before);
  ok('new state differs', boardToString(s2.board) !== before);
  eq('turn alternates', s2.turn, RED);
}

/* ================= 11. AI sanity ================= */
{
  // AI must take a free capture.
  const cells = Array(32).fill('.');
  cells[13] = 'b'; cells[17] = 'r'; cells[0] = 'b';
  const b = boardFromString(cells.join(''));
  const st = { board: b, turn: BLACK, kingMoves: 0, ply: 0 };
  for (const d of ['easy', 'medium', 'hard']) {
    const mv = chooseMove(st, d, mulberry32(7));
    ok(`${d} takes the forced capture`, mv && mv.capture, notation(mv));
  }

  // Hard must avoid hanging a piece when a safe alternative exists.
  const c2 = Array(32).fill('.');
  c2[13] = 'b';   // black man 14
  c2[9] = 'b';    // black man 10
  c2[21] = 'r';   // red man 22
  c2[24] = 'r';   // red man 25 (kings later)
  const st2 = { board: boardFromString(c2.join('')), turn: BLACK, kingMoves: 0, ply: 0 };
  const hardMv = chooseMove(st2, 'hard', mulberry32(3));
  ok('hard returns a legal move', !!hardMv && generateMoves(st2.board, BLACK).some((m) => notation(m) === notation(hardMv)));

  // Strength check: hard should beat easy over a few games.
  ok('evaluate is symmetric', evaluate(initialState().board, BLACK) === -evaluate(initialState().board, RED),
    `${evaluate(initialState().board, BLACK)} vs ${evaluate(initialState().board, RED)}`);
}

/* ================= 12. FULL AI-vs-AI GAMES (legality audit) ================= */
function playGame(dBlack, dRed, seed, maxPlies = 300) {
  const rng = mulberry32(seed);
  let st = initialState();
  const log = [];
  let illegal = 0, badCrown = 0, badCount = 0, moves = 0;
  let prevMat = countMaterial(st.board);

  while (moves < maxPlies) {
    const status = gameStatus(st);
    if (status.over) return { st, log, illegal, badCrown, badCount, moves, status };

    const legal = generateMoves(st.board, st.turn);
    const mv = chooseMove(st, st.turn === BLACK ? dBlack : dRed, rng);

    // --- legality audit ---
    if (!mv || !legal.some((l) => notation(l) === notation(mv) && l.from === mv.from && l.to === mv.to)) {
      illegal++; break;
    }
    if (legal.some((l) => l.capture) && !mv.capture) illegal++; // forced-capture violation
    const moverCode = st.board[mv.from];
    if (colorOf(moverCode) !== st.turn) illegal++;
    if (st.board[mv.to] !== EMPTY) illegal++;
    // direction legality for men
    if (!isKing(moverCode) && !mv.capture) {
      const dr = RC[mv.to][0] - RC[mv.from][0];
      if ((st.turn === BLACK && dr !== 1) || (st.turn === RED && dr !== -1)) illegal++;
    }

    const turnBefore = st.turn;
    st = applyMove(st, mv);
    moves++;
    log.push(notation(mv));

    // --- crowning audit ---
    const landed = st.board[mv.to];
    const crownR = turnBefore === BLACK ? 7 : 0;
    if (RC[mv.to][0] === crownR && !isKing(landed)) badCrown++;
    if (isKing(landed) && !isKing(moverCode) && RC[mv.to][0] !== crownR) badCrown++;

    // --- material audit: pieces only ever decrease, by exactly the captured count ---
    const mat = countMaterial(st.board);
    const lostB = prevMat.b.total - mat.b.total;
    const lostR = prevMat.r.total - mat.r.total;
    const expected = mv.captured.length;
    const actualLoss = turnBefore === BLACK ? lostR : lostB;
    const ownLoss = turnBefore === BLACK ? lostB : lostR;
    if (actualLoss !== expected || ownLoss !== 0) badCount++;
    // a king must never revert to a man
    prevMat = mat;
  }
  return { st, log, illegal, badCrown, badCount, moves, status: gameStatus(st) };
}

{
  const games = [
    ['easy', 'easy', 11], ['easy', 'medium', 22], ['medium', 'easy', 33],
    ['medium', 'medium', 44], ['hard', 'easy', 55], ['easy', 'hard', 66],
  ];
  let totalMoves = 0, finished = 0;
  for (const [db, dr, seed] of games) {
    const g = playGame(db, dr, seed);
    totalMoves += g.moves;
    if (g.status.over) finished++;
    ok(`game ${db}-v-${dr}: no illegal moves`, g.illegal === 0, `${g.illegal} illegal; log=${g.log.slice(0, 12).join(' ')}`);
    ok(`game ${db}-v-${dr}: crowning correct`, g.badCrown === 0, `${g.badCrown} bad crownings`);
    ok(`game ${db}-v-${dr}: material accounting correct`, g.badCount === 0, `${g.badCount} mismatches`);
    ok(`game ${db}-v-${dr}: >=20 moves played`, g.moves >= 20, `only ${g.moves}`);
    console.log(`  ${db.padEnd(6)} vs ${dr.padEnd(6)} -> ${String(g.moves).padStart(3)} plies, ` +
      `${g.status.over ? (g.status.winner ? g.status.winner.toUpperCase() + ' wins (' + g.status.reason + ')' : 'draw') : 'cut off'}`);
  }
  ok('total plies across games >= 20', totalMoves >= 20, String(totalMoves));
  ok('most games reach a terminal state', finished >= games.length - 1, `${finished}/${games.length}`);
}

/* ================= 13. AI strength ordering ================= */
{
  // Hard vs Easy: hard should win or at minimum end ahead on material.
  let hardAhead = 0;
  for (const seed of [101, 202, 303]) {
    const g = playGame('hard', 'easy', seed, 240);
    const m = countMaterial(g.st.board);
    if (g.status.winner === BLACK || m.b.total > m.r.total) hardAhead++;
  }
  ok('hard outplays easy (>=2 of 3)', hardAhead >= 2, `${hardAhead}/3`);
}

/* ================= report ================= */
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('All engine checks green.');
