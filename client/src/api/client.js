// Minimal fetch wrapper. Relative /api URLs work in dev (Vite proxy)
// and in production (Express serves the built client, or same origin).

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const isForm = options.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
    body: options.body ? (isForm ? options.body : JSON.stringify(options.body)) : undefined,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  postForm: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  patchForm: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

/** Direct link usable in <a href> — passes the JWT as a query param. */
export function downloadUrl(slug) {
  const token = getToken();
  return `/api/games/${slug}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
