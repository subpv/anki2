import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, ChartNoAxesColumn, Download, House, Languages, Layers, LogOut, Menu, MessageCircle, Moon, Plus, Search,
  Settings as Cog, Sun, X,
} from 'lucide-react';
import type { Course } from '../../shared/types.ts';
import { api } from './api.ts';
import { lang, setLang, t } from './i18n.ts';
import { Home } from './pages/Home.tsx';
import { CoursePage, CourseModal } from './pages/CoursePage.tsx';
import { Browse } from './pages/Browse.tsx';
import { NoteEditor } from './pages/NoteEditor.tsx';
import { Review } from './pages/Review.tsx';
import { Stats } from './pages/Stats.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { Login } from './pages/Login.tsx';
import { Wiki } from './pages/Wiki.tsx';

export interface Me {
  name: string; email: string; username: string | null; hasPassword: boolean;
  loginMethod: 'oidc' | 'password' | 'dev'; language: 'de' | 'en'; feedbackUrl: string;
}
interface Ctx { courses: Course[] | null; refresh: () => Promise<void>; me: Me | null; reloadMe: () => Promise<void> }
const AppCtx = createContext<Ctx>({ courses: null, refresh: async () => {}, me: null, reloadMe: async () => {} });
export const useApp = () => useContext(AppCtx);

export const CourseDot = ({ course, size = 26 }: { course: { name: string; color: string }; size?: number }) => (
  <span className="dot" style={{ background: course.color, width: size, height: size }}>{course.name.slice(0, 1).toUpperCase()}</span>
);

const versionLabel = () =>
  `v${__APP_VERSION__} · ${new Date(__BUILD_DATE__).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

function Feedback({ url, open, setOpen, showButton }: { url: string; open: boolean; setOpen: (o: boolean) => void; showButton: boolean }) {
  if (!url) return null;
  return (
    <>
      {showButton && <div className="feedback-fab">
        <button className="feedback-btn" onClick={() => setOpen(true)}><MessageCircle size={20} /> <span>{t('Feedback')}</span></button>
        <div className="version">{versionLabel()}</div>
      </div>}
      {open && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="panel feedback-panel" role="dialog" aria-label={t('Send feedback')}>
            <div className="feedback-head">
              <h2>{t('Send feedback')}</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('Close')}><X size={18} /></button>
            </div>
            <iframe src={url} title={t('Send feedback')} />
            <div className="feedback-foot">
              {t('Form not showing?')} <a href={url} target="_blank" rel="noopener noreferrer">{t('Open it in a new tab')}</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function App() {
  const loc = useLocation();
  if (loc.pathname === '/login') return <Login />;
  return <Shell />;
}

function Shell() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState(false);
  const [newCourse, setNewCourse] = useState(false);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  const refresh = useCallback(async () => setCourses(await api<Course[]>('/api/courses')), []);
  const reloadMe = useCallback(async () => {
    const m = await api<Me>('/api/me');
    setMe(m);
    if (m.language !== lang) setLang(m.language); // follow the account's language on every device
  }, []);
  useEffect(() => { refresh(); reloadMe(); }, [refresh, reloadMe]);
  useEffect(() => { setSide(false); setMenu(false); refresh(); }, [loc.pathname, refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);

  const logout = async () => {
    const { redirect } = await api<{ redirect: string }>('/auth/logout', { method: 'POST' });
    window.location.href = redirect;
  };
  const switchLanguage = async () => {
    const next = lang === 'de' ? 'en' : 'de';
    await api('/api/me/language', { method: 'PUT', body: { language: next } });
    setLang(next);
  };
  const dueOf = (c: Course) => (c.counts ? c.counts.due + c.counts.learning + c.counts.new : 0);
  const studying = /^\/(review|cram)/.test(loc.pathname);

  return (
    <AppCtx.Provider value={{ courses, refresh, me, reloadMe }}>
      <div className={`shell ${studying ? 'studying' : ''}`}>
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setSide((s) => !s)} aria-label={t('Menu')}><Menu size={18} /></button>
          <Link to="/" className="brand">
            <div className="brand-mark"><Layers size={18} /></div>
            <span>Card</span>
          </Link>
          <form className="search" onSubmit={(e) => { e.preventDefault(); nav(`/browse?q=${encodeURIComponent(query)}`); }}>
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search cards')} aria-label={t('Search cards')} />
          </form>
          <div className="topbar-right">
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('Switch theme')}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="icon-btn avatar" onClick={() => setMenu((m) => !m)} aria-label={t('Account')}>
              {(me?.name || '?').slice(0, 1).toUpperCase()}
            </button>
            {menu && (
              <div className="menu">
                <div className="who"><div style={{ fontWeight: 600 }}>{me?.name}</div><div className="muted" style={{ fontSize: 13 }}>{me?.email || me?.username}</div></div>
                <button onClick={switchLanguage}><Languages size={16} /> {lang === 'de' ? 'English' : 'Deutsch'}</button>
                <button onClick={logout}><LogOut size={16} /> {t('Log out')}</button>
              </div>
            )}
          </div>
        </header>

        <aside className={`sidebar ${side ? 'open' : ''}`}>
          <nav className="nav">
            <NavLink to="/" end><House size={19} /> {t('Home')}</NavLink>
            <NavLink to="/browse"><Search size={19} /> {t('Browse')}</NavLink>
            <NavLink to="/stats"><ChartNoAxesColumn size={19} /> {t('Stats')}</NavLink>
            <NavLink to="/import"><Download size={19} /> {t('Import')}</NavLink>
            <NavLink to="/wiki"><BookOpen size={19} /> {t('Wiki')}</NavLink>
            <NavLink to="/settings"><Cog size={19} /> {t('Settings')}</NavLink>
            <div className="nav-label">{t('Courses')}</div>
            {courses?.map((c) => (
              <NavLink key={c.id} to={`/course/${c.id}`}>
                <CourseDot course={c} />
                <span className="name">{c.name}</span>
                {dueOf(c) > 0 && <span className="badge hot">{dueOf(c)}</span>}
              </NavLink>
            ))}
            <button className="add" onClick={() => setNewCourse(true)}><Plus size={19} /> {t('New course')}</button>
            <div className="mobile-only side-extra">
              {me?.feedbackUrl && <button className="add" onClick={() => { setSide(false); setFeedback(true); }}><MessageCircle size={19} /> {t('Feedback')}</button>}
              <div className="version">{versionLabel()}</div>
            </div>
          </nav>
        </aside>
        {side && <div className="sidebar-scrim" onClick={() => setSide(false)} />}

        <main className="main">
          <Routes>
            <Route path="/" element={<Home onNewCourse={() => setNewCourse(true)} />} />
            <Route path="/course/:id" element={<CoursePage />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/new" element={<NoteEditor />} />
            <Route path="/note/:id" element={<NoteEditor />} />
            <Route path="/review" element={<Review mode="review" />} />
            <Route path="/review/:courseId" element={<Review mode="review" />} />
            <Route path="/cram/:courseId" element={<Review mode="cram" />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/wiki" element={<Wiki />} />
            <Route path="*" element={<div className="page"><h1>{t('Not found')}</h1><p className="sub"><Link to="/">{t('Back to Home')}</Link></p></div>} />
          </Routes>
        </main>

        {!studying && (
          <nav className="bottom-nav" aria-label={t('Menu')}>
            <NavLink to="/" end><House size={21} /><span>{t('Home')}</span></NavLink>
            <NavLink to="/browse"><Search size={21} /><span>{t('Browse')}</span></NavLink>
            <NavLink to="/new" className="bn-add" aria-label={t('Add card')}><Plus size={24} /></NavLink>
            <NavLink to="/stats"><ChartNoAxesColumn size={21} /><span>{t('Stats')}</span></NavLink>
            <button onClick={() => setSide(true)}><Menu size={21} /><span>{t('More')}</span></button>
          </nav>
        )}
        <Feedback url={me?.feedbackUrl ?? ''} open={feedback} setOpen={setFeedback} showButton={!studying} />
      </div>
      {newCourse && (
        <CourseModal
          onClose={() => setNewCourse(false)}
          onSaved={async (id) => { setNewCourse(false); await refresh(); nav(`/course/${id}`); }}
        />
      )}
    </AppCtx.Provider>
  );
}
