import type { User } from '../../auth';

type Suit = '♠' | '♥' | '♦' | '♣';
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
interface Card { rank: Rank; suit: Suit; hidden?: boolean }

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const RED_SUITS = new Set<Suit>(['♥', '♦']);

function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (['J','Q','K'].includes(rank)) return 10;
  return parseInt(rank);
}

function handTotal(hand: Card[]): number {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    total += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function cardEl(card: Card): HTMLElement {
  const el = document.createElement('div');
  const isRed = RED_SUITS.has(card.suit);
  if (card.hidden) {
    el.style.cssText = `width:60px;height:84px;border-radius:8px;background:linear-gradient(135deg,#1e40af,#1d4ed8);border:2px solid #3b82f6;display:flex;align-items:center;justify-content:center;font-size:24px;`;
    el.textContent = '🂠';
    return el;
  }
  el.style.cssText = `width:60px;height:84px;border-radius:8px;background:white;border:2px solid #d1d5db;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);`;
  const color = isRed ? '#dc2626' : '#111827';
  el.innerHTML = `
    <span style="font-size:13px;font-weight:bold;color:${color};align-self:flex-start;">${card.rank}</span>
    <span style="font-size:22px;color:${color};">${card.suit}</span>
    <span style="font-size:13px;font-weight:bold;color:${color};align-self:flex-end;transform:rotate(180deg);">${card.rank}</span>
  `;
  return el;
}

function handEl(hand: Card[], label: string, total: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'color:#9ca3af;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;';
  lbl.textContent = `${label} — ${total}`;
  const cards = document.createElement('div');
  cards.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;';
  for (const c of hand) cards.appendChild(cardEl(c));
  wrap.appendChild(lbl);
  wrap.appendChild(cards);
  return wrap;
}

export function launchBlackjack(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  let deck: Card[] = [];
  let playerHand: Card[] = [];
  let dealerHand: Card[] = [];
  let balance = 1000;
  let bet = 50;
  type Phase = 'betting' | 'playing' | 'result';
  let phase: Phase = 'betting';
  let message = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'min-h-screen bg-gray-950 text-white flex flex-col';
  wrapper.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4">
      <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors">← Hub</button>
      <span class="font-bold text-lg">🃏 Blackjack</span>
      <div class="ml-auto flex items-center gap-4 font-mono text-sm">
        <span>💰 $<span id="balance">1000</span></span>
      </div>
    </nav>
    <div class="flex-1 flex flex-col items-center justify-center gap-8 p-6" id="gameArea">
    </div>
  `;
  document.body.appendChild(wrapper);

  wrapper.querySelector('#backBtn')!.addEventListener('click', () => {
    wrapper.remove();
    hubEl.style.display = '';
  });

  function draw(): Card { return deck.pop()!; }

  function startRound() {
    if (deck.length < 15) deck = newDeck();
    playerHand = [draw(), draw()];
    dealerHand = [draw(), { ...draw(), hidden: true }];
    phase = 'playing';
    // Check immediate blackjack
    if (handTotal(playerHand) === 21) { stand(); return; }
    render();
  }

  function stand() {
    dealerHand.forEach(c => c.hidden = false);
    while (handTotal(dealerHand) < 17) dealerHand.push(draw());
    const p = handTotal(playerHand);
    const d = handTotal(dealerHand);
    let winAmount = 0;
    if (p > 21) { message = 'Bust! You lose.'; winAmount = -bet; }
    else if (d > 21 || p > d) {
      if (p === 21 && playerHand.length === 2) { message = '🃏 Blackjack! 3:2 payout!'; winAmount = Math.floor(bet * 1.5); }
      else { message = 'You win!'; winAmount = bet; }
    }
    else if (p === d) { message = 'Push — bet returned.'; winAmount = 0; }
    else { message = 'Dealer wins.'; winAmount = -bet; }
    balance += winAmount;
    phase = 'result';
    render();
  }

  function hit() {
    playerHand.push(draw());
    if (handTotal(playerHand) > 21) { dealerHand.forEach(c => c.hidden = false); message = 'Bust!'; balance -= bet; phase = 'result'; }
    render();
    if (phase !== 'result' && handTotal(playerHand) === 21) stand();
  }

  function double() {
    if (balance < bet * 2) return;
    bet *= 2;
    playerHand.push(draw());
    stand();
  }

  function render() {
    wrapper.querySelector<HTMLElement>('#balance')!.textContent = String(balance);
    const area = wrapper.querySelector<HTMLElement>('#gameArea')!;
    area.innerHTML = '';

    if (phase === 'betting') {
      area.innerHTML = `
        <div class="text-4xl">🃏</div>
        <h2 class="text-2xl font-bold">Place Your Bet</h2>
        <div class="flex gap-3 items-center">
          ${[10,25,50,100,250].map(v => `<button data-bet="${v}" class="bet-chip px-4 py-2 rounded-lg font-bold border transition-colors ${bet===v?'bg-blue-600 border-blue-400':'bg-gray-800 border-gray-600 hover:border-blue-500'} text-white">$${v}</button>`).join('')}
        </div>
        <div class="text-gray-400 text-sm">Current bet: <span class="text-white font-bold">$${bet}</span></div>
        <button id="dealBtn" class="px-8 py-3 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-lg transition-colors ${balance < bet ? 'opacity-50 cursor-not-allowed':''}" ${balance < bet ? 'disabled':''}>Deal</button>
      `;
      area.querySelectorAll('.bet-chip').forEach(btn => {
        btn.addEventListener('click', () => { bet = parseInt((btn as HTMLElement).dataset.bet!); render(); });
      });
      area.querySelector('#dealBtn')?.addEventListener('click', startRound);
      return;
    }

    const dealerTotal = phase === 'result' ? handTotal(dealerHand) : handTotal(dealerHand.filter(c => !c.hidden));
    area.appendChild(handEl(dealerHand, 'Dealer', dealerTotal));

    if (message) {
      const msg = document.createElement('div');
      const win = message.includes('win') || message.includes('Blackjack');
      const push = message.includes('Push');
      msg.style.cssText = `font-size:20px;font-weight:bold;padding:12px 24px;border-radius:12px;background:${win?'#14532d':push?'#1e3a5f':'#7f1d1d'};color:${win?'#4ade80':push?'#93c5fd':'#fca5a5'}`;
      msg.textContent = message;
      area.appendChild(msg);
    }

    area.appendChild(handEl(playerHand, 'You', handTotal(playerHand)));

    if (phase === 'playing') {
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:12px;margin-top:8px;';
      const canDouble = playerHand.length === 2 && balance >= bet * 2;
      btns.innerHTML = `
        <button id="hitBtn" class="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-colors">Hit</button>
        <button id="standBtn" class="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors">Stand</button>
        <button id="doubleBtn" class="px-6 py-2 bg-yellow-700 hover:bg-yellow-600 rounded-lg font-semibold transition-colors ${!canDouble?'opacity-40 cursor-not-allowed':''}" ${!canDouble?'disabled':''}>Double</button>
      `;
      btns.querySelector('#hitBtn')!.addEventListener('click', hit);
      btns.querySelector('#standBtn')!.addEventListener('click', stand);
      btns.querySelector('#doubleBtn')!.addEventListener('click', double);
      area.appendChild(btns);
    } else {
      const nextBtn = document.createElement('button');
      nextBtn.style.cssText = 'margin-top:8px;padding:10px 28px;background:#2563eb;hover:background:#1d4ed8;border-radius:10px;font-weight:600;font-size:16px;cursor:pointer;color:white;border:none;';
      nextBtn.textContent = balance > 0 ? 'Next Round' : 'Game Over';
      nextBtn.addEventListener('click', () => {
        message = '';
        if (balance <= 0) { balance = 1000; }
        phase = 'betting';
        render();
      });
      area.appendChild(nextBtn);
    }
  }

  deck = newDeck();
  render();
}
