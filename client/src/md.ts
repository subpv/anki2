import MarkdownIt from 'markdown-it';
import katexPlugin from '@vscode/markdown-it-katex';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import matlab from 'highlight.js/lib/languages/matlab';
import delphi from 'highlight.js/lib/languages/delphi';
import bash from 'highlight.js/lib/languages/bash';
import vhdl from 'highlight.js/lib/languages/vhdl';
import verilog from 'highlight.js/lib/languages/verilog';
import armasm from 'highlight.js/lib/languages/armasm';
import 'katex/dist/katex.min.css';

hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('python', python);
hljs.registerLanguage('matlab', matlab);
// IEC 61131-3 Structured Text is Pascal-like; Pascal highlighting covers its keywords well enough.
hljs.registerLanguage('st', delphi);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('vhdl', vhdl);
hljs.registerLanguage('verilog', verilog);
hljs.registerLanguage('armasm', armasm);

export const LANGUAGES: [string, string][] = [
  ['c', 'C'], ['cpp', 'C++'], ['python', 'Python'], ['matlab', 'MATLAB'], ['st', 'Structured Text (PLC)'],
  ['vhdl', 'VHDL'], ['verilog', 'Verilog'], ['armasm', 'ARM assembly'], ['bash', 'Shell'], ['text', 'Plain text'],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function highlight(code: string, lang: string): string {
  return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : esc(code);
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  highlight: (code, lang) => highlight(code, lang),
}).use((katexPlugin as any).default ?? katexPlugin, { throwOnError: false });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const cache = new Map<string, string>();

export function renderMd(src: string): string {
  let html = cache.get(src);
  if (html === undefined) {
    html = DOMPurify.sanitize(md.render(src ?? ''), { FORBID_TAGS: ['style', 'form', 'input', 'button'] });
    if (cache.size > 500) cache.clear();
    cache.set(src, html);
  }
  return html;
}

export function renderTex(tex: string, display = true): string {
  try {
    return katex.renderToString(tex || '\\,', { displayMode: display, throwOnError: false });
  } catch {
    return esc(tex);
  }
}

export { clozeSource } from '../../shared/cloze.ts';
