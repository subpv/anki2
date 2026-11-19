import { useEffect, useState } from 'react';
import { KeyRound, Layers, LogIn, UserPlus } from 'lucide-react';
import { api, ApiError } from '../api.ts';
import { lang, t } from '../i18n.ts';

interface Config { oidc: boolean; signup: boolean; signupCode: boolean; loggedIn: boolean }

export function Login() {
  const [config, setConfig] = useState<Config | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<'de' | 'en'>(lang);
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

  const switchMode = (m: 'login' | 'register') => { setMode(m); setError(''); setPassword(''); setPassword2(''); };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    if (mode === 'register' && password !== password2) return setError(t('The passwords do not match'));
    setBusy(true);
    try {
      if (mode === 'register') await api('/auth/register', { body: { username, password, language, code } });
      else await api('/auth/password', { body: { username, password } });
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
          <h1>{mode === 'register' ? t('Create account') : t('Log in')}</h1>
          <p className="sub">{mode === 'register' ? t('Your cards and progress belong to this account only.') : t('Welcome back.')}</p>
          {error && <div className="error" role="alert">{error}</div>}

          {mode === 'login' && config?.oidc && (
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
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 10 : undefined} required />
              </label>
              {mode === 'register' && (
                <>
                  <label className="field"><span>{t('Repeat password')}</span>
                    <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" minLength={10} required />
                  </label>
                  <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>{t('At least 10 characters.')}</p>
                  <div className="field">
                    <span className="field-label">{t('Language')}</span>
                    <div className="seg login-seg" role="radiogroup" aria-label={t('Language')}>
                      <button type="button" role="radio" aria-checked={language === 'de'} className={language === 'de' ? 'on' : ''} onClick={() => setLanguage('de')}>Deutsch</button>
                      <button type="button" role="radio" aria-checked={language === 'en'} className={language === 'en' ? 'on' : ''} onClick={() => setLanguage('en')}>English</button>
                    </div>
                  </div>
                  {config.signupCode && (
                    <label className="field"><span>{t('Invitation code')}</span>
                      <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
                    </label>
                  )}
                </>
              )}
              <button className={`btn lg login-submit ${config.oidc && mode === 'login' ? '' : 'primary'}`} disabled={busy}>
                {mode === 'register' ? <><UserPlus size={17} /> {t('Create account')}</> : <><KeyRound size={17} /> {t('Log in')}</>}
              </button>
            </form>
          )}

          {config?.signup && (
            <p className="login-switch">
              {mode === 'login'
                ? <>{t('No account yet?')} <button type="button" className="linklike" onClick={() => switchMode('register')}>{t('Create account')}</button></>
                : <>{t('Already have an account?')} <button type="button" className="linklike" onClick={() => switchMode('login')}>{t('Log in')}</button></>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
