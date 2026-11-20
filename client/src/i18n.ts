import { de } from './i18n-de.ts';

export type Lang = 'de' | 'en';

function stored(): Lang {
  try {
    const l = localStorage.getItem('lang');
    if (l === 'de' || l === 'en') return l;
  } catch { /* private mode */ }
  return 'de';
}

/** Current interface language. German is the default. */
export let lang: Lang = stored();
document.documentElement.lang = lang;

export const locale = () => (lang === 'de' ? 'de-DE' : 'en-GB');

/** Translate an English source string; {name} placeholders are filled from vars. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === 'de' ? de[s] ?? s : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Singular/plural: tn(n, '{n} card', '{n} cards'). */
export const tn = (n: number, one: string, other: string, vars: Record<string, string | number> = {}) =>
  t(n === 1 ? one : other, { n, ...vars });

/**
 * Switch the interface language in place (no page reload, so blocked storage cannot cause a
 * reload loop). Remembered on this device; the caller saves it to the account.
 */
export function setLang(l: Lang) {
  try { localStorage.setItem('lang', l); } catch { /* private mode: keep it for this page only */ }
  if (l === lang) return;
  lang = l;
  document.documentElement.lang = l;
  window.dispatchEvent(new Event('langchange'));
}

/** Server messages are English; translate the known ones. */
const SERVER_PATTERNS: [RegExp, string][] = [
  [/^Need at least (\d+) reviews to optimise \(you have (\d+)\)\.$/, 'Need at least {0} reviews to optimise (you have {1}).'],
  [/^Password must be at least (\d+) characters$/, 'Password must be at least {0} characters'],
  [/^Import failed: (.*)$/, 'Import failed: {0}'],
  [/^Request failed \((\d+)\)$/, 'Request failed ({0})'],
];
export function tServer(msg: string): string {
  if (lang === 'en' || !msg) return msg;
  if (de[msg]) return de[msg];
  for (const [re, key] of SERVER_PATTERNS) {
    const m = msg.match(re);
    if (m) return (de[key] ?? key).replace(/\{(\d)\}/g, (_x, i) => m[Number(i) + 1]);
  }
  return msg;
}
