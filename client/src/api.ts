import { locale, t, tn, tServer } from './i18n.ts';

export class ApiError extends Error {
  constructor(message: string, public data: any = {}) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.location.href = '/login';
    return new Promise(() => {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(tServer(data.error || `Request failed (${res.status})`), data);
  return data as T;
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  return (await api<{ url: string }>('/api/media', { form })).url;
}

export function timeAgo(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return tn(Math.floor(s / 3600), '{n} hour ago', '{n} hours ago');
  const d = Math.floor(s / 86400);
  return d === 1 ? t('yesterday') : t('{n} days ago', { n: d });
}

export function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}

export const fmtDate = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString(locale(), opts);
