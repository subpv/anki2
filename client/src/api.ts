export class ApiError extends Error {}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    window.location.href = '/auth/login';
    return new Promise(() => {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`);
  return data as T;
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  return (await api<{ url: string }>('/api/media', { form })).url;
}

export function timeAgo(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`.replace(/^1 hours/, '1 hour');
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function dueLabel(ms: number | null | undefined): string {
  if (ms == null) return 'new';
  const d = Math.ceil((ms - Date.now()) / 86_400_000);
  if (d <= 0) return 'due now';
  if (d === 1) return 'due tomorrow';
  if (d < 60) return `due in ${d} days`;
  if (d < 365) return `due in ${Math.round(d / 30.44)} months`;
  return `due in ${(d / 365.25).toFixed(1)} years`;
}

export function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}
