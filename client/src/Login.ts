import { login } from './auth';

export function renderLogin(onSuccess: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'min-h-screen flex items-center justify-center bg-gray-950';
  el.innerHTML = `
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm">
      <div class="text-center mb-6">
        <div class="text-5xl mb-3">🐙</div>
        <h1 class="text-2xl font-bold text-white">Octopus Games</h1>
        <p class="text-gray-500 text-sm mt-1">Sign in to play</p>
      </div>
      <div id="err" class="hidden mb-4 px-4 py-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm"></div>
      <form id="loginForm" class="space-y-4">
        <input id="username" type="text" placeholder="Username" autocomplete="username"
          class="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-4 py-3 text-white outline-none placeholder:text-gray-600 text-sm" />
        <input id="password" type="password" placeholder="Password" autocomplete="current-password"
          class="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-4 py-3 text-white outline-none placeholder:text-gray-600 text-sm" />
        <button type="submit"
          class="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-semibold transition-colors">
          Sign in
        </button>
      </form>
    </div>
  `;

  const form = el.querySelector('#loginForm') as HTMLFormElement;
  const errEl = el.querySelector('#err') as HTMLElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (el.querySelector('#username') as HTMLInputElement).value;
    const password = (el.querySelector('#password') as HTMLInputElement).value;
    const btn = form.querySelector('button')!;
    btn.textContent = 'Signing in…';
    btn.setAttribute('disabled', '');
    const err = await login(username, password);
    if (err) {
      errEl.textContent = err;
      errEl.classList.remove('hidden');
      btn.textContent = 'Sign in';
      btn.removeAttribute('disabled');
    } else {
      onSuccess();
    }
  });

  return el;
}
