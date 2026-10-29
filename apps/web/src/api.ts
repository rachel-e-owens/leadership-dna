const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export async function request(path: string, token?: string, options: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  if (!r.headers.get('content-type')?.includes('application/json')) {
    throw new Error(r.status >= 500
      ? 'The server is temporarily unavailable. Please try again in a moment.'
      : 'The server returned an unexpected response. Please refresh and try again.');
  }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
