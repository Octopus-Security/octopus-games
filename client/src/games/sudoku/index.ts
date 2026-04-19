import type { User } from '../../auth';

type Board = (number | null)[][];

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array(9).fill(null));
}

function isValid(board: Board, r: number, c: number, n: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (board[r][i] === n || board[i][c] === n) return false;
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++)
      if (board[br + dr][bc + dc] === n) return false;
  return true;
}

function solve(board: Board): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== null) continue;
      const nums = shuffle([1,2,3,4,5,6,7,8,9]);
      for (const n of nums) {
        if (isValid(board, r, c, n)) {
          board[r][c] = n;
          if (solve(board)) return true;
          board[r][c] = null;
        }
      }
      return false;
    }
  }
  return true;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const REMOVE_COUNT: Record<string, number> = { easy: 36, medium: 46, hard: 55 };

function generatePuzzle(difficulty: string): { puzzle: Board; solution: Board } {
  const solution = emptyBoard();
  solve(solution);
  const puzzle = solution.map(row => [...row]) as Board;
  let removed = 0;
  const target = REMOVE_COUNT[difficulty] ?? 36;
  const cells = shuffle(Array.from({ length: 81 }, (_, i) => i));
  for (const idx of cells) {
    if (removed >= target) break;
    const r = Math.floor(idx / 9), c = idx % 9;
    puzzle[r][c] = null;
    removed++;
  }
  return { puzzle, solution };
}

export function launchSudoku(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  let difficulty = 'easy';
  let puzzle: Board = emptyBoard();
  let solution: Board = emptyBoard();
  let userBoard: Board = emptyBoard();
  let notesBoard: Set<number>[][] = [];
  let selected: [number, number] | null = null;
  let mistakes = 0;
  let seconds = 0;
  let timerInterval = 0;
  let complete = false;
  let notesMode = false;
  const given = new Set<string>();

  const wrapper = document.createElement('div');
  wrapper.className = 'min-h-screen bg-gray-950 text-white flex flex-col';
  wrapper.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4">
      <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors">← Hub</button>
      <span class="font-bold text-lg">🔢 Sudoku</span>
      <div class="flex gap-1 ml-4">
        ${['easy','medium','hard'].map(d => `
          <button data-diff="${d}" class="diff-btn px-3 py-1 rounded text-sm font-medium capitalize transition-colors ${d === 'easy' ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-800 hover:text-gray-200'}">${d}</button>
        `).join('')}
      </div>
      <div class="ml-auto flex items-center gap-6 font-mono text-sm">
        <span>❌ <span id="mistakes">0</span>/3</span>
        <span>⏱ <span id="timer">0</span>s</span>
        <button id="resetBtn" class="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm">New Game</button>
      </div>
    </nav>
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="flex flex-col items-center gap-6">
        <div id="board" class="select-none"></div>
        <div id="numpad" class="flex gap-2 items-center">
          ${[1,2,3,4,5,6,7,8,9].map(n => `
            <button data-n="${n}" class="num-btn w-10 h-10 rounded-lg bg-gray-800 hover:bg-blue-600 border border-gray-700 text-white font-bold text-lg transition-colors">${n}</button>
          `).join('')}
          <button id="eraseBtn" class="w-10 h-10 rounded-lg bg-gray-800 hover:bg-red-700 border border-gray-700 text-gray-400 font-bold text-sm transition-colors">✕</button>
          <div class="w-px h-8 bg-gray-700 mx-1"></div>
          <button id="notesBtn" class="w-10 h-10 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 font-bold text-sm transition-colors" title="Notes mode">✏️</button>
        </div>
      </div>
    </div>
    <div id="banner" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-10">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
        <div id="bannerEmoji" class="text-6xl mb-4"></div>
        <div id="bannerText" class="text-2xl font-bold mb-6"></div>
        <button id="playAgain" class="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-colors">New Game</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  function startGame() {
    clearInterval(timerInterval);
    const gen = generatePuzzle(difficulty);
    puzzle = gen.puzzle;
    solution = gen.solution;
    userBoard = puzzle.map(row => [...row]) as Board;
    notesBoard = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set<number>()));
    selected = null;
    mistakes = 0;
    seconds = 0;
    complete = false;
    notesMode = false;
    given.clear();
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (puzzle[r][c] !== null) given.add(`${r},${c}`);
    wrapper.querySelector<HTMLElement>('#mistakes')!.textContent = '0';
    wrapper.querySelector<HTMLElement>('#timer')!.textContent = '0';
    const banner = wrapper.querySelector<HTMLElement>('#banner')!;
    banner.classList.add('hidden');
    banner.style.display = '';
    updateNotesBtn();
    timerInterval = window.setInterval(() => {
      if (!complete) { seconds++; wrapper.querySelector<HTMLElement>('#timer')!.textContent = String(seconds); }
    }, 1000);
    renderBoard();
  }

  function updateNotesBtn() {
    const btn = wrapper.querySelector<HTMLElement>('#notesBtn')!;
    btn.className = notesMode
      ? 'w-10 h-10 rounded-lg bg-yellow-600 border border-yellow-500 text-white font-bold text-sm transition-colors'
      : 'w-10 h-10 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 font-bold text-sm transition-colors';
  }

  function renderBoard() {
    const board = wrapper.querySelector<HTMLElement>('#board')!;
    board.innerHTML = '';
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    for (let r = 0; r < 9; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < 9; c++) {
        const td = document.createElement('td');
        const val = userBoard[r][c];
        const isGiven = given.has(`${r},${c}`);
        const isSel = selected?.[0] === r && selected?.[1] === c;
        const isRelated = selected && (selected[0] === r || selected[1] === c ||
          (Math.floor(selected[0]/3) === Math.floor(r/3) && Math.floor(selected[1]/3) === Math.floor(c/3)));
        const isConflict = val !== null && !isGiven && val !== solution[r][c];

        const borderT = r % 3 === 0 ? '2px solid #6b7280' : '1px solid #374151';
        const borderL = c % 3 === 0 ? '2px solid #6b7280' : '1px solid #374151';
        const borderB = r === 8 ? '2px solid #6b7280' : '';
        const borderR = c === 8 ? '2px solid #6b7280' : '';

        let bg = '#111827';
        if (isSel) bg = '#1d4ed8';
        else if (isRelated) bg = '#1e2d4a';
        if (isConflict) bg = '#450a0a';

        const notes = notesBoard[r][c];
        const showNotes = val === null && notes.size > 0;
        td.style.cssText = `width:48px;height:48px;text-align:center;vertical-align:middle;cursor:pointer;
          border-top:${borderT};border-left:${borderL};${borderB ? `border-bottom:${borderB};` : ''}${borderR ? `border-right:${borderR};` : ''}
          background:${bg};font-size:${showNotes ? '9px' : '22px'};font-weight:${isGiven ? 'bold' : 'normal'};
          color:${isConflict ? '#ef4444' : isGiven ? '#ffffff' : '#60a5fa'};padding:${showNotes ? '2px' : '0'};`;
        if (showNotes) {
          const grid = document.createElement('div');
          grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);width:100%;height:100%;gap:0';
          for (let n = 1; n <= 9; n++) {
            const span = document.createElement('span');
            span.style.cssText = 'font-size:9px;text-align:center;line-height:1;color:#9ca3af;display:flex;align-items:center;justify-content:center';
            span.textContent = notes.has(n) ? String(n) : '';
            grid.appendChild(span);
          }
          td.appendChild(grid);
        } else {
          td.textContent = val !== null ? String(val) : '';
        }
        td.addEventListener('click', () => {
          if (!isGiven) { selected = [r, c]; renderBoard(); }
          else { selected = [r, c]; renderBoard(); }
        });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    board.appendChild(table);
  }

  function inputNumber(n: number | null) {
    if (!selected || complete) return;
    const [r, c] = selected;
    if (given.has(`${r},${c}`)) return;
    if (n === null) {
      userBoard[r][c] = null;
      notesBoard[r][c].clear();
      renderBoard();
      return;
    }
    if (notesMode) {
      if (userBoard[r][c] !== null) return;
      if (notesBoard[r][c].has(n)) notesBoard[r][c].delete(n);
      else notesBoard[r][c].add(n);
      renderBoard();
      return;
    }
    userBoard[r][c] = n;
    notesBoard[r][c].clear();
    if (n !== solution[r][c]) {
      mistakes++;
      wrapper.querySelector<HTMLElement>('#mistakes')!.textContent = String(mistakes);
      if (mistakes >= 3) { endGame(false); return; }
    }
    renderBoard();
    checkWin();
  }

  function checkWin() {
    const done = userBoard.every((row, r) => row.every((v, c) => v === solution[r][c]));
    if (done) endGame(true);
  }

  function endGame(win: boolean) {
    clearInterval(timerInterval);
    complete = true;
    const banner = wrapper.querySelector<HTMLElement>('#banner')!;
    wrapper.querySelector<HTMLElement>('#bannerEmoji')!.textContent = win ? '🏆' : '💔';
    wrapper.querySelector<HTMLElement>('#bannerText')!.textContent = win ? `Solved in ${seconds}s!` : 'Too many mistakes!';
    banner.classList.remove('hidden');
  }

  wrapper.querySelector('#backBtn')!.addEventListener('click', () => {
    clearInterval(timerInterval);
    wrapper.remove();
    hubEl.style.display = '';
  });
  wrapper.querySelector('#resetBtn')!.addEventListener('click', startGame);
  wrapper.querySelector('#playAgain')!.addEventListener('click', startGame);
  wrapper.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => inputNumber(parseInt((btn as HTMLElement).dataset.n!)));
  });
  wrapper.querySelector('#eraseBtn')!.addEventListener('click', () => inputNumber(null));
  wrapper.querySelector('#notesBtn')!.addEventListener('click', () => {
    notesMode = !notesMode;
    updateNotesBtn();
  });
  wrapper.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      difficulty = (btn as HTMLElement).dataset.diff!;
      wrapper.querySelectorAll('.diff-btn').forEach(b => {
        b.className = b === btn
          ? 'diff-btn px-3 py-1 rounded text-sm font-medium capitalize transition-colors bg-blue-600 text-white'
          : 'diff-btn px-3 py-1 rounded text-sm font-medium capitalize transition-colors text-gray-400 bg-gray-800 hover:text-gray-200';
      });
      startGame();
    });
  });

  document.addEventListener('keydown', onKey);
  function onKey(e: KeyboardEvent) {
    if (!wrapper.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key >= '1' && e.key <= '9') inputNumber(parseInt(e.key));
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') inputNumber(null);
    if (e.key === 'n' || e.key === 'N') { notesMode = !notesMode; updateNotesBtn(); }
    if (!selected) return;
    const [r, c] = selected;
    if (e.key === 'ArrowUp' && r > 0) { selected = [r-1, c]; renderBoard(); }
    if (e.key === 'ArrowDown' && r < 8) { selected = [r+1, c]; renderBoard(); }
    if (e.key === 'ArrowLeft' && c > 0) { selected = [r, c-1]; renderBoard(); }
    if (e.key === 'ArrowRight' && c < 8) { selected = [r, c+1]; renderBoard(); }
  }

  startGame();
}
