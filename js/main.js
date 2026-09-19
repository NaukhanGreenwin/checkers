/**
 * main.js — UI controller. Owns the DOM, the interaction model and the
 * game loop. All rules live in rules.js; all search lives in ai.js.
 */

import {
  BLACK, RED, EMPTY, BM, BK, RM, RK,
  RC, colorOf, isKing, opponent,
  initialState, generateMoves, applyMove, gameStatus,
  countMaterial, notation, KING_MOVE_DRAW_LIMIT,
} from './rules.js';
import { chooseMove, DIFFICULTIES } from './ai.js';
import { sfx, setEnabled as setSound, isEnabled as soundOn } from './sound.js';

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const boardEl = $('#board');
const piecesEl = $('#pieces');
const turnbarEl = $('#turnbar');
const turnTextEl = $('#turnText');
const turnHintEl = $('#turnHint');
const historyEl = $('#historyList');
const historyWrapEl = $('#historyWrap');
const undoBtn = $('#undoBtn');
const hintBtn = $('#hintBtn');
const newBtn = $('#newBtn');
const menuBtn = $('#menuBtn');
const themeBtn = $('#themeBtn');
const soundSwitch = $('#soundSwitch');
const coordSwitch = $('#coordSwitch');
const modal = $('#modal');
const modalBody = $('#modalBody');
const confettiEl = $('#confetti');
const statusLive = $('#statusLive');

const LABEL = { [BLACK]: 'Black', [RED]: 'Red' };
const STORE = 'checkers.prefs.v1';

/* ------------------------------------------------------------------ */
/* App state                                                           */
/* ------------------------------------------------------------------ */

const app = {
  state: initialState(),
  history: [],          // { state, move, turn } snapshots BEFORE each move
  moveLog: [],          // notation strings
  mode: 'ai',           // 'ai' | 'local'
  difficulty: 'medium',
  humanSide: BLACK,
  selected: null,       // square index
  legal: [],            // moves for the side to act
  targets: new Map(),   // landing square -> move
  busy: false,
  over: false,
  cursor: 11,           // keyboard cursor square
  lastMove: null,
  showHints: true,
};

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* ignore */ }
  const theme = p.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.coords = p.coords === 'off' ? 'off' : 'on';
  setSound(!!p.sound);
  app.showHints = p.showHints !== false;
  if (p.mode === 'local' || p.mode === 'ai') app.mode = p.mode;
  if (DIFFICULTIES[p.difficulty]) app.difficulty = p.difficulty;
  syncToggles();
}

function savePrefs() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      theme: document.documentElement.dataset.theme,
      coords: document.documentElement.dataset.coords,
      sound: soundOn(),
      showHints: app.showHints,
      mode: app.mode,
      difficulty: app.difficulty,
    }));
  } catch { /* private mode — ignore */ }
}

function syncToggles() {
  soundSwitch.setAttribute('aria-checked', String(soundOn()));
  coordSwitch.setAttribute('aria-checked', String(document.documentElement.dataset.coords !== 'off'));
  hintBtn.setAttribute('aria-pressed', String(app.showHints));
  const dark = document.documentElement.dataset.theme !== 'light';
  themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  themeBtn.querySelector('.themeIcon').innerHTML = dark ? SUN : MOON;
}

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

/* ------------------------------------------------------------------ */
/* Board construction                                                  */
/* ------------------------------------------------------------------ */

const cellEls = new Array(32);
const squareEls = new Array(32);

function buildBoard() {
  boardEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const dark = (row + col) % 2 === 1;
      const sq = document.createElement('div');
      sq.className = 'sq ' + (dark ? 'sq--dark' : 'sq--light');
      if (dark) {
        const idx = RC.findIndex(([r, c]) => r === row && c === col);
        sq.dataset.sq = String(idx);
        const num = document.createElement('span');
        num.className = 'sq__num';
        num.textContent = String(idx + 1);
        sq.appendChild(num);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell';
        btn.dataset.sq = String(idx);
        btn.tabIndex = -1;
        btn.addEventListener('click', () => onSquare(idx));
        sq.appendChild(btn);

        const hint = document.createElement('span');
        hint.className = 'hint';
        sq.appendChild(hint);

        cellEls[idx] = btn;
        squareEls[idx] = sq;
      }
      frag.appendChild(sq);
    }
  }
  boardEl.appendChild(frag);
  boardEl.appendChild(piecesEl);
}

/* ------------------------------------------------------------------ */
/* Piece rendering — keyed DOM nodes so CSS transforms animate         */
/* ------------------------------------------------------------------ */

const CROWN_SVG =
  '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.2 3.1L12 4.4l4.8 6.7L21 8l-1.7 10H4.7L3 8z"/></svg>';

let pieceNodes = new Map(); // id -> { el, sq, code }
let nextPieceId = 1;
let idBySquare = new Map();

function posTransform(sq) {
  const [r, c] = RC[sq];
  return `translate3d(${c * 100}%, ${r * 100}%, 0)`;
}

function makePiece(code, sq) {
  const el = document.createElement('div');
  el.className = `piece piece--${colorOf(code)}${isKing(code) ? ' piece--king' : ''}`;
  el.style.transform = posTransform(sq);
  el.innerHTML = `<span class="piece__disc">${CROWN_SVG}</span>`;
  el.setAttribute('aria-hidden', 'true');
  piecesEl.appendChild(el);
  return el;
}

/** Full rebuild — used on new game / undo / mode change. */
function renderPiecesFresh() {
  piecesEl.innerHTML = '';
  pieceNodes = new Map();
  idBySquare = new Map();
  for (let sq = 0; sq < 32; sq++) {
    const code = app.state.board[sq];
    if (code === EMPTY) continue;
    const id = nextPieceId++;
    pieceNodes.set(id, { el: makePiece(code, sq), sq, code });
    idBySquare.set(sq, id);
  }
}

/**
 * Animate one move: slide the mover along its path, fade the victims,
 * then apply the crown. Resolves when the motion has settled.
 */
function animateMove(move, turn) {
  return new Promise((resolve) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = idBySquare.get(move.from);
    const node = id != null ? pieceNodes.get(id) : null;
    if (!node) { renderPiecesFresh(); resolve(); return; }

    idBySquare.delete(move.from);
    node.el.classList.add('piece--capturing');
    node.el.classList.remove('piece--sel');

    const hops = move.path.slice(1);
    const hopMs = reduce ? 0 : (move.capture ? 230 : 250);

    const step = (i) => {
      if (i >= hops.length) {
        node.sq = hops[hops.length - 1];
        idBySquare.set(node.sq, id);
        node.el.classList.remove('piece--capturing');
        if (move.crowned) {
          node.code = turn === BLACK ? BK : RK;
          node.el.classList.add('piece--king', 'piece--crowning');
          setTimeout(() => node.el.classList.remove('piece--crowning'), 460);
          sfx.king();
        }
        setTimeout(resolve, reduce ? 0 : 40);
        return;
      }
      const target = hops[i];
      node.el.style.transform = posTransform(target);

      // remove the victim consumed by this hop, mid-slide
      const victim = move.captured[i];
      if (victim != null) {
        const vid = idBySquare.get(victim);
        const vnode = vid != null ? pieceNodes.get(vid) : null;
        if (vnode) {
          idBySquare.delete(victim);
          setTimeout(() => {
            vnode.el.style.setProperty('--pos', posTransform(victim));
            vnode.el.classList.add('piece--dying');
            setTimeout(() => { vnode.el.remove(); pieceNodes.delete(vid); }, reduce ? 0 : 240);
          }, hopMs * 0.55);
        }
      }
      setTimeout(() => step(i + 1), hopMs);
    };

    if (reduce) { step(0); } else { requestAnimationFrame(() => step(0)); }
  });
}

/* ------------------------------------------------------------------ */
/* Highlight layer                                                     */
/* ------------------------------------------------------------------ */

function clearMarks() {
  for (let i = 0; i < 32; i++) {
    const sq = squareEls[i];
    if (!sq) continue;
    delete sq.dataset.hint;
    delete sq.dataset.doomed;
  }
  piecesEl.querySelectorAll('.piece--sel').forEach((p) => p.classList.remove('piece--sel'));
}

function paintLastMove() {
  for (let i = 0; i < 32; i++) if (squareEls[i]) delete squareEls[i].dataset.last;
  if (!app.lastMove) return;
  for (const s of app.lastMove.path) if (squareEls[s]) squareEls[s].dataset.last = '1';
}

function paintSelection() {
  clearMarks();
  app.targets = new Map();
  if (app.selected == null) return;

  const id = idBySquare.get(app.selected);
  if (id != null) pieceNodes.get(id)?.el.classList.add('piece--sel');

  for (const mv of app.legal) {
    if (mv.from !== app.selected) continue;
    app.targets.set(mv.to, mv);
    const sq = squareEls[mv.to];
    if (sq) sq.dataset.hint = mv.capture ? 'jump' : 'move';
    for (const v of mv.captured) if (squareEls[v]) squareEls[v].dataset.doomed = '1';
  }
}

function markMovablePieces() {
  piecesEl.querySelectorAll('.piece--movable').forEach((p) => p.classList.remove('piece--movable'));
  if (app.over || app.busy || !humanToMove()) return;
  const froms = new Set(app.legal.map((m) => m.from));
  for (const sq of froms) {
    const id = idBySquare.get(sq);
    if (id != null) pieceNodes.get(id)?.el.classList.add('piece--movable');
  }
}

function syncCellAffordance() {
  const active = !app.over && !app.busy && humanToMove();
  const froms = new Set(app.legal.map((m) => m.from));
  for (let i = 0; i < 32; i++) {
    const c = cellEls[i];
    if (!c) continue;
    const playable = active && (froms.has(i) || app.targets.has(i));
    if (playable) c.dataset.playable = '1'; else delete c.dataset.playable;
    c.setAttribute('aria-label', describeSquare(i));
  }
}

function describeSquare(sq) {
  const code = app.state.board[sq];
  const n = sq + 1;
  if (code === EMPTY) {
    if (app.targets.has(sq)) {
      const mv = app.targets.get(sq);
      return `Square ${n}, ${mv.capture ? 'capture landing' : 'legal move'}`;
    }
    return `Square ${n}, empty`;
  }
  const who = LABEL[colorOf(code)];
  const kind = isKing(code) ? 'king' : 'man';
  const sel = app.selected === sq ? ', selected' : '';
  return `Square ${n}, ${who} ${kind}${sel}`;
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

function renderScore() {
  const m = countMaterial(app.state.board);
  for (const side of [BLACK, RED]) {
    const s = side === BLACK ? m.b : m.r;
    const el = $(`#side-${side}`);
    el.dataset.active = !app.over && app.state.turn === side ? '1' : '0';
    el.querySelector('.side__count').textContent = String(s.total);
    el.querySelector('.side__meta').textContent =
      `${s.men} ${s.men === 1 ? 'man' : 'men'} · ${s.kings} ${s.kings === 1 ? 'king' : 'kings'}`;
    el.querySelector('.side__name').textContent = playerName(side);
  }
}

function playerName(side) {
  if (app.mode === 'local') return LABEL[side];
  return side === app.humanSide ? `${LABEL[side]} (You)` : `${LABEL[side]} (${DIFFICULTIES[app.difficulty].label} AI)`;
}

function renderHistory() {
  if (!app.moveLog.length) {
    historyEl.innerHTML = '';
    historyEl.hidden = true;
    $('#historyEmpty').hidden = false;
    return;
  }
  historyEl.hidden = false;
  $('#historyEmpty').hidden = true;

  let html = '';
  for (let i = 0; i < app.moveLog.length; i += 2) {
    const n = i / 2 + 1;
    html += `<li class="history__row"><span class="history__n">${n}</span>`;
    html += cellHtml(app.moveLog[i], 'b', i === app.moveLog.length - 1);
    html += app.moveLog[i + 1] !== undefined
      ? cellHtml(app.moveLog[i + 1], 'r', i + 1 === app.moveLog.length - 1)
      : '<span class="history__mv"></span>';
    html += '</li>';
  }
  historyEl.innerHTML = html;
  historyWrapEl.scrollTop = historyWrapEl.scrollHeight;
}

function cellHtml(txt, side, latest) {
  const cap = txt.includes('x') ? ' history__mv--cap' : '';
  const s = side === 'b' ? ' history__mv--b' : '';
  const l = latest ? ' history__mv--latest' : '';
  return `<span class="history__mv${s}${cap}${l}">${txt}</span>`;
}

function renderTurnbar() {
  turnbarEl.dataset.turn = app.state.turn;
  if (app.over) {
    turnbarEl.dataset.thinking = '0';
    return;
  }
  const mine = humanToMove();
  turnTextEl.textContent = app.mode === 'local'
    ? `${LABEL[app.state.turn]} to move`
    : (mine ? 'Your move' : `${DIFFICULTIES[app.difficulty].label} AI to move`);

  const caps = app.legal.some((m) => m.capture);
  let hint = `${app.legal.length} legal ${app.legal.length === 1 ? 'move' : 'moves'}`;
  if (caps) hint = 'Capture is mandatory';
  if (app.state.kingMoves >= KING_MOVE_DRAW_LIMIT - 8) {
    hint = `Draw in ${KING_MOVE_DRAW_LIMIT - app.state.kingMoves} king moves`;
  }
  turnHintEl.textContent = hint;
}

function announce(msg) {
  statusLive.textContent = msg;
}

function renderAll() {
  app.legal = app.over ? [] : generateMoves(app.state.board, app.state.turn);
  paintLastMove();
  paintSelection();
  markMovablePieces();
  syncCellAffordance();
  renderScore();
  renderHistory();
  renderTurnbar();
  undoBtn.disabled = app.busy || !app.history.length || (app.mode === 'ai' && !humanToMove() && !app.over);
}

/* ------------------------------------------------------------------ */
/* Game flow                                                           */
/* ------------------------------------------------------------------ */

function humanToMove() {
  return app.mode === 'local' || app.state.turn === app.humanSide;
}

async function commitMove(move) {
  const turn = app.state.turn;
  app.history.push({ state: app.state, move, lastMove: app.lastMove });
  app.selected = null;
  app.busy = true;
  clearMarks();
  syncCellAffordance();
  undoBtn.disabled = true;

  if (move.capture) sfx.capture(); else sfx.move();

  const anim = animateMove(move, turn);
  app.state = applyMove(app.state, move);
  app.moveLog.push(notation(move));
  app.lastMove = move;
  await anim;

  const st = gameStatus(app.state);
  app.busy = false;

  if (st.over) {
    app.over = true;
    renderAll();
    finish(st);
    return;
  }

  renderAll();
  announce(`${LABEL[turn]} played ${notation(move)}. ${LABEL[app.state.turn]} to move.`);

  if (app.mode === 'ai' && !humanToMove()) queueAI();
}

function queueAI() {
  turnbarEl.dataset.thinking = '1';
  app.busy = true;
  syncCellAffordance();
  undoBtn.disabled = true;

  // Yield twice so the "thinking" state paints before the (blocking) search.
  requestAnimationFrame(() => setTimeout(async () => {
    let mv = null;
    try {
      mv = chooseMove(app.state, app.difficulty);
    } catch (err) {
      console.error('AI search failed, falling back to a legal move', err);
    }
    if (!mv) {
      const legal = generateMoves(app.state.board, app.state.turn);
      mv = legal[0] || null;
    }
    turnbarEl.dataset.thinking = '0';
    app.busy = false;
    if (mv) await commitMove(mv);
    else { app.over = true; renderAll(); finish(gameStatus(app.state)); }
  }, 230));
}

function finish(status) {
  const humanWon = app.mode === 'ai' && status.winner === app.humanSide;
  if (status.winner === null) sfx.lose();
  else if (app.mode === 'local' || humanWon) sfx.win();
  else sfx.lose();

  let title, detail;
  if (status.winner === null) {
    title = 'Draw';
    detail = `Neither side made progress for ${KING_MOVE_DRAW_LIMIT} king moves.`;
  } else {
    const w = LABEL[status.winner];
    title = app.mode === 'local'
      ? `${w} wins`
      : (humanWon ? 'You win' : `${DIFFICULTIES[app.difficulty].label} AI wins`);
    detail = status.reason === 'captured'
      ? `${w} captured every opposing piece in ${app.moveLog.length} moves.`
      : `${LABEL[opponent(status.winner)]} has no legal move left.`;
  }
  announce(`Game over. ${title}. ${detail}`);
  if (status.winner !== null && (app.mode === 'local' || humanWon)) burstConfetti();
  showResult(title, detail);
}

function burstConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['var(--accent)', 'var(--red-piece)', 'var(--ok)', 'var(--ink-muted)'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 70; i++) {
    const b = document.createElement('i');
    b.style.left = Math.random() * 100 + 'vw';
    b.style.background = colors[i % colors.length];
    b.style.setProperty('--x', (Math.random() * 220 - 110) + 'px');
    b.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
    b.style.setProperty('--t', (1.7 + Math.random() * 1.5) + 's');
    b.style.setProperty('--d', (Math.random() * 0.5) + 's');
    if (i % 3 === 0) b.style.borderRadius = '50%';
    frag.appendChild(b);
  }
  confettiEl.innerHTML = '';
  confettiEl.appendChild(frag);
  setTimeout(() => { confettiEl.innerHTML = ''; }, 3600);
}

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

function onSquare(sq) {
  if (app.over || app.busy || !humanToMove()) return;

  const mv = app.targets.get(sq);
  if (mv) { commitMove(mv); return; }

  const code = app.state.board[sq];
  if (code !== EMPTY && colorOf(code) === app.state.turn) {
    if (app.selected === sq) { app.selected = null; renderAll(); return; }
    if (!app.legal.some((m) => m.from === sq)) {
      sfx.invalid();
      const caps = app.legal.some((m) => m.capture);
      announce(caps ? 'That piece cannot move: a capture is mandatory elsewhere.' : 'That piece has no legal move.');
      const id = idBySquare.get(sq);
      const el = id != null ? pieceNodes.get(id)?.el : null;
      if (el) { el.animate?.([{ transform: el.style.transform + ' translateX(-3px)' }, { transform: el.style.transform + ' translateX(3px)' }, { transform: el.style.transform }], { duration: 170 }); }
      return;
    }
    app.selected = sq;
    sfx.select();
    renderAll();
    announce(`Selected square ${sq + 1}. ${app.legal.filter((m) => m.from === sq).length} destination(s).`);
    return;
  }

  if (app.selected != null) { app.selected = null; renderAll(); }
}

/* --- keyboard navigation over the dark squares --- */
function moveCursor(dr, dc) {
  const [r, c] = RC[app.cursor];
  for (let step = 1; step <= 8; step++) {
    const nr = r + dr * step;
    const nc = c + dc * step;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) break;
    const idx = RC.findIndex(([rr, cc]) => rr === nr && cc === nc);
    if (idx >= 0) { focusSquare(idx); return; }
  }
}

function focusSquare(idx) {
  app.cursor = idx;
  cellEls[idx]?.focus();
}

function onKey(e) {
  if (modal.dataset.open === '1') {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    return;
  }
  const k = e.key;
  if (k === 'ArrowUp') { e.preventDefault(); moveCursor(-1, 0); }
  else if (k === 'ArrowDown') { e.preventDefault(); moveCursor(1, 0); }
  else if (k === 'ArrowLeft') { e.preventDefault(); moveCursor(0, -1); }
  else if (k === 'ArrowRight') { e.preventDefault(); moveCursor(0, 1); }
  else if (k === 'Enter' || k === ' ') {
    if (document.activeElement?.classList.contains('cell')) {
      e.preventDefault();
      onSquare(Number(document.activeElement.dataset.sq));
    }
  } else if (k === 'Escape') {
    if (app.selected != null) { e.preventDefault(); app.selected = null; renderAll(); }
  } else if (k.toLowerCase() === 'u') { if (!undoBtn.disabled) undo(); }
  else if (k.toLowerCase() === 'n') { openNewGame(); }
}

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

function undo() {
  if (app.busy || !app.history.length) return;
  // In AI mode, roll back a full round-trip so it is the human's turn again.
  const steps = (app.mode === 'ai' && app.history.length >= 2 && !app.over) ? 2 : 1;
  for (let i = 0; i < steps; i++) {
    const prev = app.history.pop();
    if (!prev) break;
    app.state = prev.state;
    app.lastMove = prev.lastMove;
    app.moveLog.pop();
  }
  // If we landed on the AI's turn (e.g. after undoing a single ply), go back one more.
  if (app.mode === 'ai' && app.history.length && app.state.turn !== app.humanSide) {
    const prev = app.history.pop();
    app.state = prev.state;
    app.lastMove = prev.lastMove;
    app.moveLog.pop();
  }
  app.over = false;
  app.selected = null;
  turnbarEl.dataset.thinking = '0';
  renderPiecesFresh();
  renderAll();
  announce('Move undone.');
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

let lastFocus = null;

function openModal(html) {
  lastFocus = document.activeElement;
  modalBody.innerHTML = html;
  modal.dataset.open = '1';
  modal.removeAttribute('aria-hidden');
  const first = modal.querySelector('button, [tabindex]:not([tabindex="-1"])');
  setTimeout(() => first?.focus(), 60);
}

function closeModal() {
  modal.dataset.open = '0';
  modal.setAttribute('aria-hidden', 'true');
  lastFocus?.focus?.();
}

function openNewGame() {
  openModal(`
    <div>
      <h2 class="modal__title" id="modalTitle">New game</h2>
      <p class="modal__sub">Black always moves first. Captures are mandatory.</p>
    </div>
    <div class="field">
      <span class="field__label" id="lblMode">Mode</span>
      <div class="seg" role="radiogroup" aria-labelledby="lblMode" id="segMode">
        <button type="button" class="seg__btn" role="radio" data-v="ai" aria-checked="${app.mode === 'ai'}">vs Computer</button>
        <button type="button" class="seg__btn" role="radio" data-v="local" aria-checked="${app.mode === 'local'}">Two players</button>
      </div>
    </div>
    <div class="field" id="diffField" ${app.mode === 'local' ? 'hidden' : ''}>
      <span class="field__label" id="lblDiff">Difficulty</span>
      <div class="seg" role="radiogroup" aria-labelledby="lblDiff" id="segDiff">
        ${Object.entries(DIFFICULTIES).map(([k, v]) =>
          `<button type="button" class="seg__btn" role="radio" data-v="${k}" aria-checked="${app.difficulty === k}">${v.label}</button>`).join('')}
      </div>
    </div>
    <div class="field" id="sideField" ${app.mode === 'local' ? 'hidden' : ''}>
      <span class="field__label" id="lblSide">You play</span>
      <div class="seg" role="radiogroup" aria-labelledby="lblSide" id="segSide">
        <button type="button" class="seg__btn" role="radio" data-v="b" aria-checked="${app.humanSide === BLACK}">Black · first</button>
        <button type="button" class="seg__btn" role="radio" data-v="r" aria-checked="${app.humanSide === RED}">Red · second</button>
      </div>
    </div>
    <div class="actions">
      <button type="button" class="btn" id="cancelBtn">Cancel</button>
      <button type="button" class="btn btn--primary" id="startBtn">Start game</button>
    </div>
  `);

  const pick = (wrap, cb) => {
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      wrap.querySelectorAll('.seg__btn').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      cb(b.dataset.v);
    });
  };
  const $m = (s) => modalBody.querySelector(s);
  pick($m('#segMode'), (v) => {
    app.mode = v;
    $m('#diffField').hidden = v === 'local';
    $m('#sideField').hidden = v === 'local';
  });
  pick($m('#segDiff'), (v) => { app.difficulty = v; });
  pick($m('#segSide'), (v) => { app.humanSide = v === 'b' ? BLACK : RED; });
  $m('#cancelBtn').addEventListener('click', closeModal);
  $m('#startBtn').addEventListener('click', () => { closeModal(); startGame(); });
}

function showResult(title, detail) {
  const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6l5 5L19.5 6.5"/></svg>';
  openModal(`
    <div class="result">
      <div class="result__badge">${check}</div>
      <h2 class="modal__title" id="modalTitle">${title}</h2>
      <p class="result__detail">${detail}</p>
    </div>
    <div class="actions">
      <button type="button" class="btn" id="reviewBtn">Review board</button>
      <button type="button" class="btn btn--primary" id="againBtn">New game</button>
    </div>
  `);
  modalBody.querySelector('#reviewBtn').addEventListener('click', closeModal);
  modalBody.querySelector('#againBtn').addEventListener('click', () => { closeModal(); openNewGame(); });
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

function startGame() {
  app.state = initialState();
  app.history = [];
  app.moveLog = [];
  app.selected = null;
  app.lastMove = null;
  app.over = false;
  app.busy = false;
  app.cursor = app.humanSide === BLACK ? 11 : 20;
  turnbarEl.dataset.thinking = '0';
  confettiEl.innerHTML = '';
  renderPiecesFresh();
  renderAll();
  savePrefs();
  announce(app.mode === 'local'
    ? 'New two-player game. Black to move.'
    : `New game against the ${DIFFICULTIES[app.difficulty].label} computer. You are ${LABEL[app.humanSide]}.`);
  if (app.mode === 'ai' && !humanToMove()) queueAI();
}

function wire() {
  newBtn.addEventListener('click', openNewGame);
  menuBtn.addEventListener('click', openNewGame);
  undoBtn.addEventListener('click', undo);

  hintBtn.addEventListener('click', () => {
    app.showHints = !app.showHints;
    document.body.classList.toggle('no-hints', !app.showHints);
    hintBtn.setAttribute('aria-pressed', String(app.showHints));
    savePrefs();
  });

  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    syncToggles();
    savePrefs();
  });

  soundSwitch.addEventListener('click', () => {
    setSound(!soundOn());
    syncToggles();
    savePrefs();
    if (soundOn()) sfx.select();
  });

  coordSwitch.addEventListener('click', () => {
    const on = document.documentElement.dataset.coords !== 'off';
    document.documentElement.dataset.coords = on ? 'off' : 'on';
    syncToggles();
    savePrefs();
  });

  $('#histToggle')?.addEventListener('click', (e) => {
    const p = $('#historyPanel');
    const open = p.dataset.open === '1';
    p.dataset.open = open ? '0' : '1';
    e.currentTarget.setAttribute('aria-expanded', String(!open));
  });

  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', onKey);

  // The board is a single tab stop; arrows move within it.
  boardEl.addEventListener('focusin', (e) => {
    const c = e.target.closest('.cell');
    if (c) {
      cellEls.forEach((x) => { if (x) x.tabIndex = -1; });
      c.tabIndex = 0;
      app.cursor = Number(c.dataset.sq);
    }
  });
}

function init() {
  buildBoard();
  loadPrefs();
  wire();
  cellEls[app.cursor].tabIndex = 0;
  renderPiecesFresh();
  renderAll();
  document.body.classList.toggle('no-hints', !app.showHints);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
