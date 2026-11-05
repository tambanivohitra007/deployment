import { state } from './state.js';

// The session cookie is HttpOnly: JavaScript only holds the CSRF token.
let csrfToken = '';

function updateSession(data) {
  csrfToken = data.csrfToken;
  state.admin = data.admin;
  state.authReady = true;
  if (!state.admin) state.orders = [];
  window.dispatchEvent(new Event('sessionchange'));
}

export async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  let response;
  try {
    response = await fetch(url, { ...options, headers, credentials: 'same-origin', signal: options.signal || AbortSignal.timeout(20000) });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/auth/login') {
      state.admin = null;
      state.orders = [];
      window.dispatchEvent(new Event('sessionchange'));
    }
    // Refresh expired cookies for the next attempt. Never silently replay a write.
    if (response.status === 403 && data.error?.includes('session expired')) {
      await loadSession().catch(() => {});
    }
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function loadSession() {
  updateSession(await request('/api/session'));
}

export async function signIn(email, password) {
  await loadSession();
  updateSession(await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
}

export async function signOut() {
  updateSession(await request('/api/auth/logout', { method: 'POST', body: '{}' }));
}
