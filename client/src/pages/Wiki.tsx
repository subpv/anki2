import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { lang, t } from '../i18n.ts';
import { Md } from '../components/CardView.tsx';
import { AI_SPEC, WIKI } from '../wiki-content.ts';

export function Wiki() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_SPEC);
    } catch {
      // Older browsers or no permission: select the text so it can be copied by hand.
      const el = document.getElementById('ai-spec');
      if (el) window.getSelection()?.selectAllChildren(el);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page narrow wiki">
      <h1>{t('Wiki')}</h1>
      <p className="sub">{t('How to write and import cards, and how studying works.')}</p>
      <nav className="wiki-toc">
        {WIKI.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title[lang]}</a>)}
      </nav>
      {WIKI.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.title[lang]}</h2>
          <Md src={s.body[lang]} />
          {s.spec && (
            <div className="spec">
              <button className="btn primary" onClick={copy}>
                {copied ? <><Check size={16} /> {t('Copied')}</> : <><Copy size={16} /> {t('Copy instructions')}</>}
              </button>
              <pre id="ai-spec">{AI_SPEC}</pre>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
