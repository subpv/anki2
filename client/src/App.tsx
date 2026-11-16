import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChartNoAxesColumn, House, Layers, LogOut, Menu, Moon, Plus, Search, Settings as Cog, Sun } from 'lucide-react';
import type { Course } from '../../shared/types.ts';
import { api } from './api.ts';
import { Home } from './pages/Home.tsx';
import { CoursePage, CourseModal } from './pages/CoursePage.tsx';
import { Browse } from './pages/Browse.tsx';
import { NoteEditor } from './pages/NoteEditor.tsx';
import { Review } from './pages/Review.tsx';
import { Stats } from './pages/Stats.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

interface Ctx { courses: Course[] | null; refresh: () => Promise<void>; me: { name: string; email: string } | null }
const AppCtx = createContext<Ctx>({ courses: null, refresh: async () => {}, me: null });
export const useApp = () => useContext(AppCtx);

export const CourseDot = ({ course, size = 26 }: { course: { name: string; color: string }; size?: number }) => (
  <span className="dot" style={{ background: course.color, width: size, height: size }}>{course.name.slice(0, 1).toUpperCase()}</span>
);

export function App() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [me, setMe] = useState<Ctx['me']>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState(false);
  const [newCourse, setNewCourse] = useState(false);
  const [query, setQuery] = useState('');
  const nav = useNavigate();
  const loc = useLocation();

  const refresh = useCallback(async () => setCourses(await api<Course[]>('/api/courses')), []);
  useEffect(() => { refresh(); api('/api/me').then(setMe); }, [refresh]);
  useEffect(() => { setSide(false); setMenu(false); refresh(); }, [loc.pathname, refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);

  const logout = async () => {
    const { redirect } = await api<{ redirect: string }>('/auth/logout', { method: 'POST' });
    window.location.href = redirect;
  };
  const dueOf = (c: Course) => (c.counts ? c.counts.due + c.counts.learning + c.counts.new : 0);

  return (
    <AppCtx.Provider value={{ courses, refresh, me }}>
      <div className="shell">
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setSide((s) => !s)} aria-label="Menu"><Menu size={18} /></button>
          <Link to="/" className="brand">
            <div className="brand-mark"><Layers size={18} /></div>
            <span>MechDeck</span>
          </Link>
          <form className="search" onSubmit={(e) => { e.preventDefault(); nav(`/browse?q=${encodeURIComponent(query)}`); }}>
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cards" aria-label="Search cards" />
          </form>
          <div className="topbar-right">
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch theme">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="icon-btn avatar" onClick={() => setMenu((m) => !m)} aria-label="Account">
              {(me?.name || '?').slice(0, 1).toUpperCase()}
            </button>
            {menu && (
              <div className="menu">
                <div className="who"><div style={{ fontWeight: 600 }}>{me?.name}</div><div className="muted" style={{ fontSize: 13 }}>{me?.email}</div></div>
                <button onClick={logout}><LogOut size={16} /> Log out</button>
              </div>
            )}
          </div>
        </header>

        <aside className={`sidebar ${side ? 'open' : ''}`}>
          <nav className="nav">
            <NavLink to="/" end><House size={19} /> Home</NavLink>
            <NavLink to="/browse"><Search size={19} /> Browse</NavLink>
            <NavLink to="/stats"><ChartNoAxesColumn size={19} /> Stats</NavLink>
            <NavLink to="/settings"><Cog size={19} /> Settings</NavLink>
            <div className="nav-label">Courses</div>
            {courses?.map((c) => (
              <NavLink key={c.id} to={`/course/${c.id}`}>
                <CourseDot course={c} />
                <span className="name">{c.name}</span>
                {dueOf(c) > 0 && <span className="badge hot">{dueOf(c)}</span>}
              </NavLink>
            ))}
            <button className="add" onClick={() => setNewCourse(true)}><Plus size={19} /> New course</button>
          </nav>
        </aside>

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
            <Route path="*" element={<div className="page"><h1>Not found</h1><p className="sub"><Link to="/">Back to Home</Link></p></div>} />
          </Routes>
        </main>
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
