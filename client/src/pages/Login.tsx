import { useEffect, useState } from 'react';
import { KeyRound, Layers, LogIn } from 'lucide-react';
import { api, ApiError } from '../api.ts';
import { lang, setLang, t } from '../i18n.ts';

interface Config { oidc: boolean; setup: boolean; loggedIn: boolean }

export function Login() {
  const [config, setConfig] = useState<Config | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Config>('/auth/config').then((c) => {
      if (c.loggedIn) window.location.href = '/';
      setConfig(c);
    });
    const e = new URLSearchParams(window.location.search).get('error');
    if (e === 'oidc-failed') setError(t('Login with Authentik failed. Please try again.'));
    if (e === 'oidc-unavailable') setError(t('Authentik cannot be reached right now. You can log in with your password.'));
  }, []);

  const chooseLang = (l: 'de' | 'en') => {
    try { localStorage.setItem('langChosen', '1'); } catch { /* private mode */ }
    setLang(l);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    if (config?.setup && password !== password2) return setError(t('The passwords do not match'));
    setBusy(true);
    try {
      await api(config?.setup ? '/auth/setup' : '/auth/password', { body: { username, password } });
      window.location.href = '/';
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-box">
        <div className="login-brand"><div className="brand-mark"><Layers size={22} /></div> Card</div>
        <div className="panel login-panel">
          <div className="seg login-seg" role="radiogroup" aria-label="Sprache / Language">
            <button role="radio" aria-checked={lang === 'de'} className={lang === 'de' ? 'on' : ''} onClick={() => chooseLang('de')}>Deutsch</button>
            <button role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => chooseLang('en')}>English</button>
          </div>
          <h1>{config?.setup ? t('Create your account') : t('Log in')}</h1>
          <p className="sub">{config?.setup ? t('No account exists yet. The first account you create here is yours.') : t('Welcome back.')}</p>
          {error && <div className="error" role="alert">{error}</div>}

          {config?.oidc && (
            <>
              <a className="btn primary lg login-oidc" href="/auth/login"><LogIn size={18} /> {t('Log in with Authentik')}</a>
              <div className="login-or"><span>{t('or with username and password')}</span></div>
            </>
          )}

          {config && (
            <form onSubmit={submit}>
              <label className="field"><span>{t('Username')}</span>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
              </label>
              <label className="field"><span>{t('Password')}</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={config.setup ? 'new-password' : 'current-password'} required />
              </label>
              {config.setup && (
                <label className="field"><span>{t('Repeat password')}</span>
                  <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
                </label>
              )}
              <button className={`btn lg login-submit ${config.oidc ? '' : 'primary'}`} disabled={busy}>
                <KeyRound size={17} /> {config.setup ? t('Create account') : t('Log in')}
              </button>
              {!config.setup && config.oidc && <p className="hint">{t('You can set a password in Settings after logging in with Authentik once.')}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
