import type { User } from '../../auth';

type CellState = 'hidden' | 'revealed' | 'flagged';

interface Cell {
  mine: boolean;
  adjacent: number;
  state: CellState;
}

interface Difficulty { label: string; rows: number; cols: number; mines: number }

const DIFFICULTIES: Record<string, Difficulty> = {
  easy:   { label: 'Easy',   rows: 9,  cols: 9,  mines: 10 },
  medium: { label: 'Medium', rows: 16, cols: 16, mines: 40 },
  hard:   { label: 'Hard',   rows: 16, cols: 30, mines: 99 },
};

function createGrid(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, adjacent: 0, state: 'hidden' }))
  );
}

function placeMines(grid: Cell[][], mines: number, safeR: number, safeC: number): void {
  const rows = grid.length, cols = grid[0].length;
  let placed = 0;
  while (placed < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!grid[r][c].mine && Math.abs(r - safeR) > 1 || Math.abs(c - safeC) > 1) {
      if (!grid[r][c].mine) { grid[r][c].mine = true; placed++; }
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

const ADJ_COLORS = ['', '#3b82f6', '#22c55e', '#ef4444', '#7c3aed', '#dc2626', '#06b6d4', '#1f2937', '#6b7280'];

export function launchMinesweeper(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  let difficulty = 'easy';
  let grid: Cell[][] = [];
  let started = false;
  let gameOver = false;
  let flagCount = 0;
  let seconds = 0;
  let timerInterval = 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'min-h-screen bg-gray-950 text-white flex flex-col';
  wrapper.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4">
      <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors">← Hub</button>
      <span class="font-bold text-lg">💣 Minesweeper</span>
      <div class="flex gap-1 ml-4">
        ${Object.entries(DIFFICULTIES).map(([k, d]) => `
          <button data-diff="${k}" class="diff-btn px-3 py-1 rounded text-sm font-medium transition-colors ${k === 'easy' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200 bg-gray-800'}">${d.label}</button>
        `).join('')}
      </div>
      <div class="ml-auto flex items-center gap-6 font-mono text-sm">
        <span>🚩 <span id="mineCount">10</span></span>
        <span>⏱ <span id="timer">0</span>s</span>
        <button id="resetBtn" class="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm transition-colors">New Game</button>
      </div>
    </nav>
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
  document.body.appendChild(wrapper);

  function getDiff() { return DIFFICULTIES[difficulty]; }

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
    wrapper.querySelector<HTMLElement>('#banner')!.classList.add('hidden');
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
        td.style.cssText = `width:28px;height:28px;text-align:center;vertical-align:middle;font-size:14px;cursor:pointer;user-select:none;border:1px solid #374151;`;
        if (cell.state === 'hidden' || cell.state === 'flagged') {
          td.style.background = '#1f2937';
          td.textContent = cell.state === 'flagged' ? '🚩' : '';
        } else {
          td.style.background = '#111827';
          if (cell.mine) {
            td.textContent = '💣';
            td.style.background = '#7f1d1d';
          } else if (cell.adjacent > 0) {
            td.textContent = String(cell.adjacent);
            td.style.color = ADJ_COLORS[cell.adjacent];
            td.style.fontWeight = 'bold';
          }
        }
        td.addEventListener('click', () => onReveal(r, c));
        td.addEventListener('contextmenu', (e) => { e.preventDefault(); onFlag(r, c); });
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
      for (const row of grid) for (const c of row) if (c.mine) c.state = 'revealed';
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
    const d = getDiff();
    wrapper.querySelector<HTMLElement>('#mineCount')!.textContent = String(d.mines - flagCount);
    renderGrid();
  }

  function checkWin() {
    const allSafe = grid.every(row => row.every(c => c.mine || c.state === 'revealed'));
    if (allSafe) endGame(true);
  }

  function endGame(win: boolean) {
    clearInterval(timerInterval);
    gameOver = true;
    
    const banner = wrapper.querySelector<HTMLElement>('#banner')!;
    wrapper.querySelector<HTMLElement>('#bannerEmoji')!.textContent = win ? '🎉' : '💥';
    wrapper.querySelector<HTMLElement>('#bannerText')!.textContent = win ? `You _won in ${seconds}s!` : 'Boom! Try again.';
    banner.classList.remove('hidden');
    banner.style.display = 'flex';
  }

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
        b.className = b === btn
          ? 'diff-btn px-3 py-1 rounded text-sm font-medium transition-colors bg-blue-600 text-white'
          : 'diff-btn px-3 py-1 rounded text-sm font-medium transition-colors text-gray-400 hover:text-gray-200 bg-gray-800';
      });
      startGame();
    });
  });

  startGame();
}
