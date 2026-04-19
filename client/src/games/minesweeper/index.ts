import type { User } from '../../auth';

type CellState = 'hidden' | 'revealed' | 'flagged';

interface Cell {
  mine: boolean;
  adjacent: number;
  state: CellState;
}

interface DifficultyPreset { label: string; rows: number; cols: number; mines: number }

const PRESETS: Record<string, DifficultyPreset> = {
  easy:   { label: 'Easy',   rows: 9,  cols: 9,  mines: 10 },
  medium: { label: 'Medium', rows: 16, cols: 16, mines: 40 },
  hard:   { label: 'Hard',   rows: 16, cols: 30, mines: 99 },
  custom: { label: 'Custom', rows: 12, cols: 12, mines: 20 },
};

interface Symbols {
  mine: string;
  flag: string;
  winEmoji: string;
  loseEmoji: string;
}

const DEFAULT_SYMBOLS: Symbols = { mine: '💣', flag: '🚩', winEmoji: '🎉', loseEmoji: '💥' };

function createGrid(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, adjacent: 0, state: 'hidden' as CellState }))
  );
}

function placeMines(grid: Cell[][], mines: number, safeR: number, safeC: number): void {
  const rows = grid.length, cols = grid[0].length;
  let placed = 0;
  while (placed < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!grid[r][c].mine && (Math.abs(r - safeR) > 1 || Math.abs(c - safeC) > 1)) {
      grid[r][c].mine = true;
      placed++;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc].mine) count++;
        }
      grid[r][c].adjacent = count;
    }
  }
}

function flood(grid: Cell[][], r: number, c: number): void {
  const rows = grid.length, cols = grid[0].length;
  if (r < 0 || r >= rows || c < 0 || c >= cols) return;
  const cell = grid[r][c];
  if (cell.state !== 'hidden' || cell.mine) return;
  cell.state = 'revealed';
  if (cell.adjacent === 0) {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr !== 0 || dc !== 0) flood(grid, r + dr, c + dc);
  }
}

const ADJ_COLORS = ['', '#3b82f6', '#22c55e', '#ef4444', '#7c3aed', '#dc2626', '#06b6d4', '#374151', '#6b7280'];

function inputCls() {
  return 'w-16 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded px-2 py-1 text-white text-sm outline-none text-center';
}

export function launchMinesweeper(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  let difficulty = 'easy';
  let customRows = 12, customCols = 12, customMines = 20;
  let grid: Cell[][] = [];
  let started = false;
  let gameOver = false;
  let flagCount = 0;
  let seconds = 0;
  let timerInterval = 0;
  let symbols: Symbols = { ...DEFAULT_SYMBOLS };

  const wrapper = document.createElement('div');
  wrapper.className = 'min-h-screen bg-gray-950 text-white flex flex-col';
  document.body.appendChild(wrapper);

  function getDiff(): DifficultyPreset {
    if (difficulty === 'custom') return { label: 'Custom', rows: customRows, cols: customCols, mines: customMines };
    return PRESETS[difficulty];
  }

  function buildShell() {
    wrapper.innerHTML = `
      <nav class="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-3 flex-wrap">
        <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors">← Hub</button>
        <span class="font-bold text-lg">💣 Minesweeper</span>

        <div class="flex gap-1">
          ${Object.entries(PRESETS).map(([k, d]) => `
            <button data-diff="${k}" class="diff-btn px-3 py-1 rounded text-sm font-medium transition-colors ${k === difficulty ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-800 hover:text-gray-200'}">${d.label}</button>
          `).join('')}
        </div>

        <div id="customControls" class="${difficulty === 'custom' ? 'flex' : 'hidden'} items-center gap-2 text-sm">
          <label class="text-gray-500">Rows</label>
          <input id="customRows" type="number" min="4" max="30" value="${customRows}" class="${inputCls()}" />
          <label class="text-gray-500">Cols</label>
          <input id="customCols" type="number" min="4" max="50" value="${customCols}" class="${inputCls()}" />
          <label class="text-gray-500">Mines</label>
          <input id="customMines" type="number" min="1" value="${customMines}" class="${inputCls()}" />
          <button id="applyCustom" class="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium transition-colors">Apply</button>
        </div>

        <button id="symbolsBtn" class="text-sm px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded transition-colors ml-1">🎨 Symbols</button>

        <div class="ml-auto flex items-center gap-4 font-mono text-sm">
          <span>${symbols.flag} <span id="mineCount">0</span></span>
          <span>⏱ <span id="timer">0</span>s</span>
          <button id="resetBtn" class="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm transition-colors">New Game</button>
        </div>
      </nav>

      <div id="symbolsPanel" class="hidden bg-gray-900 border-b border-gray-800 px-6 py-3 flex flex-wrap gap-6 items-center">
        <span class="text-sm font-semibold text-gray-400">Customize symbols:</span>
        ${(['mine','flag','winEmoji','loseEmoji'] as (keyof Symbols)[]).map(key => `
          <label class="flex items-center gap-2 text-sm text-gray-400">
            ${key === 'mine' ? 'Mine' : key === 'flag' ? 'Flag' : key === 'winEmoji' ? 'Win' : 'Lose'}
            <input data-sym="${key}" type="text" value="${symbols[key]}" maxlength="4"
              class="w-14 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded px-2 py-1 text-white text-center text-lg outline-none" />
          </label>
        `).join('')}
        <button id="resetSymbols" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">Reset defaults</button>
      </div>

      <div class="flex-1 flex items-center justify-center p-4 overflow-auto">
        <div id="gridWrap"></div>
      </div>

      <div id="banner" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-10">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
          <div id="bannerEmoji" class="text-6xl mb-4"></div>
          <div id="bannerText" class="text-2xl font-bold mb-6"></div>
          <button id="playAgain" class="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-colors">Play Again</button>
        </div>
      </div>
    `;

    wrapper.querySelector('#backBtn')!.addEventListener('click', () => {
      clearInterval(timerInterval);
      wrapper.remove();
      hubEl.style.display = '';
    });
    wrapper.querySelector('#resetBtn')!.addEventListener('click', startGame);
    wrapper.querySelector('#playAgain')!.addEventListener('click', startGame);

    wrapper.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        difficulty = (btn as HTMLElement).dataset.diff!;
        wrapper.querySelectorAll('.diff-btn').forEach(b => {
          const active = b === btn;
          b.className = `diff-btn px-3 py-1 rounded text-sm font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-800 hover:text-gray-200'}`;
        });
        wrapper.querySelector<HTMLElement>('#customControls')!.className =
          difficulty === 'custom' ? 'flex items-center gap-2 text-sm' : 'hidden items-center gap-2 text-sm';
        if (difficulty !== 'custom') startGame();
      });
    });

    wrapper.querySelector('#applyCustom')!.addEventListener('click', () => {
      const r = parseInt((wrapper.querySelector('#customRows') as HTMLInputElement).value) || 12;
      const c = parseInt((wrapper.querySelector('#customCols') as HTMLInputElement).value) || 12;
      const m = parseInt((wrapper.querySelector('#customMines') as HTMLInputElement).value) || 20;
      customRows = Math.min(30, Math.max(4, r));
      customCols = Math.min(50, Math.max(4, c));
      customMines = Math.min(customRows * customCols - 9, Math.max(1, m));
      startGame();
    });

    wrapper.querySelector('#symbolsBtn')!.addEventListener('click', () => {
      const panel = wrapper.querySelector<HTMLElement>('#symbolsPanel')!;
      panel.classList.toggle('hidden');
    });

    wrapper.querySelectorAll<HTMLInputElement>('[data-sym]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.sym as keyof Symbols;
        symbols[key] = input.value || DEFAULT_SYMBOLS[key];
        // Update mine count icon live
        const mineCountEl = wrapper.querySelector<HTMLElement>('#mineCount')!;
        if (mineCountEl.previousSibling) {
          (mineCountEl.parentElement as HTMLElement).childNodes[0].textContent = symbols.flag + ' ';
        }
        renderGrid();
      });
    });

    wrapper.querySelector('#resetSymbols')!.addEventListener('click', () => {
      symbols = { ...DEFAULT_SYMBOLS };
      wrapper.querySelectorAll<HTMLInputElement>('[data-sym]').forEach(input => {
        input.value = symbols[input.dataset.sym as keyof Symbols];
      });
      renderGrid();
    });
  }

  function startGame() {
    clearInterval(timerInterval);
    const d = getDiff();
    grid = createGrid(d.rows, d.cols);
    started = false;
    gameOver = false;
    flagCount = 0;
    seconds = 0;
    wrapper.querySelector<HTMLElement>('#mineCount')!.textContent = String(d.mines);
    wrapper.querySelector<HTMLElement>('#timer')!.textContent = '0';
    const banner = wrapper.querySelector<HTMLElement>('#banner')!;
    banner.classList.add('hidden');
    banner.style.display = 'none';
    renderGrid();
  }

  function renderGrid() {
    const d = getDiff();
    const wrap = wrapper.querySelector<HTMLElement>('#gridWrap')!;
    wrap.innerHTML = '';
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    for (let r = 0; r < d.rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < d.cols; c++) {
        const td = document.createElement('td');
        const cell = grid[r][c];
        td.style.cssText = 'width:28px;height:28px;text-align:center;vertical-align:middle;font-size:14px;cursor:pointer;user-select:none;border:1px solid #374151;';
        if (cell.state === 'hidden') {
          td.style.background = '#1f2937';
        } else if (cell.state === 'flagged') {
          td.style.background = '#1f2937';
          td.textContent = symbols.flag;
        } else if (cell.mine) {
          td.textContent = symbols.mine;
          td.style.background = '#7f1d1d';
        } else {
          td.style.background = '#111827';
          if (cell.adjacent > 0) {
            td.textContent = String(cell.adjacent);
            td.style.color = ADJ_COLORS[cell.adjacent];
            td.style.fontWeight = 'bold';
          }
        }
        td.addEventListener('click', () => onReveal(r, c));
        td.addEventListener('contextmenu', e => { e.preventDefault(); onFlag(r, c); });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    wrap.appendChild(table);
  }

  function onReveal(r: number, c: number) {
    if (gameOver) return;
    const cell = grid[r][c];
    if (cell.state !== 'hidden') return;
    if (!started) {
      placeMines(grid, getDiff().mines, r, c);
      started = true;
      timerInterval = window.setInterval(() => {
        seconds++;
        wrapper.querySelector<HTMLElement>('#timer')!.textContent = String(seconds);
      }, 1000);
    }
    if (cell.mine) {
      cell.state = 'revealed';
      for (const row of grid) for (const cc of row) if (cc.mine) cc.state = 'revealed';
      endGame(false);
    } else {
      flood(grid, r, c);
      checkWin();
    }
    renderGrid();
  }

  function onFlag(r: number, c: number) {
    if (gameOver || grid[r][c].state === 'revealed') return;
    if (grid[r][c].state === 'flagged') {
      grid[r][c].state = 'hidden'; flagCount--;
    } else {
      grid[r][c].state = 'flagged'; flagCount++;
    }
    wrapper.querySelector<HTMLElement>('#mineCount')!.textContent = String(getDiff().mines - flagCount);
    renderGrid();
  }

  function checkWin() {
    if (grid.every(row => row.every(c => c.mine || c.state === 'revealed'))) endGame(true);
  }

  function endGame(win: boolean) {
    clearInterval(timerInterval);
    gameOver = true;
    const banner = wrapper.querySelector<HTMLElement>('#banner')!;
    wrapper.querySelector<HTMLElement>('#bannerEmoji')!.textContent = win ? symbols.winEmoji : symbols.loseEmoji;
    wrapper.querySelector<HTMLElement>('#bannerText')!.textContent = win ? `You won in ${seconds}s!` : 'Boom! Try again.';
    banner.classList.remove('hidden');
    banner.style.display = 'flex';
  }

  buildShell();
  startGame();
}
