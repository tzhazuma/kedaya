import type { WildlifeAnimal, WildlifePage, WildlifePhoto, WildlifeSighting } from '@kedaya/contracts/wildlife';
const key = 'kedaya:wildlife:session';
type Auth = { accessToken: string; refreshToken: string; expiresIn: number; user: { id: string; displayName: string } };
let session: Auth | null = null;
export function currentWildlifeUser() {
  if (!session && typeof window !== 'undefined') { try { session = JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { session = null; } }
  return session;
}
export async function wildlifeRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const auth = currentWildlifeUser(), headers = new Headers(init.headers);
  if (auth) headers.set('Authorization', `Bearer ${auth.accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/wildlife/${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.json();
  if (response.status === 401 && retry && auth && !path.startsWith('auth/')) {
    const updated = await wildlifeRequest<{ accessToken: string }>('auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: auth.refreshToken }) }, false);
    session = { ...auth, accessToken: updated.accessToken }; sessionStorage.setItem(key, JSON.stringify(session));
    return wildlifeRequest(path, init, false);
  }
  if (!response.ok || !body.ok) throw new Error(body.error?.message ?? '共享服务请求失败');
  return body.data as T;
}
export async function wildlifeLogin(studentNo: string) {
  if (!/^\d{8}$/.test(studentNo)) throw new Error('请输入 8 位测试学号');
  session = await wildlifeRequest<Auth>('auth/login', { method: 'POST', body: JSON.stringify({ ticket: `mock-${studentNo}` }) });
  sessionStorage.setItem(key, JSON.stringify(session)); return session;
}
export function wildlifeSignOut() { session = null; sessionStorage.removeItem(key); }
export const photoUrl = (p: WildlifePhoto) => `/api/wildlife/photos/${encodeURIComponent(p.id)}`;
export function wildlifeQuery(values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams(); for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') search.set(k, String(v)); return search.toString();
}
export const fetchAnimals = (query = '') => wildlifeRequest<WildlifePage<WildlifeAnimal>>(`animals?${query}`);
export const fetchSightings = (query = '') => wildlifeRequest<WildlifePage<WildlifeSighting>>(`sightings?${query}`);
