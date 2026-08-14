// frontend/src/context/ThemeContext.js
// Theme is stored in DB (user_preferences table) per user.
// On login: theme loaded from login response.preferences
// On switch: instantly applied locally + saved to DB in background.
// Fallback: localStorage if not authenticated or DB unreachable.

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ThemeContext = createContext({ theme: 'dark', setTheme: () => {}, loading: false });

// ── THEME DEFINITIONS ─────────────────────────────────────────────────────────
export const THEMES = {
  dark: {
    label: 'Dark',
    icon:  'moon',
    vars: {
      '--bv-bg':           '#0d1117',
      '--bv-bg2':          '#161b22',
      '--bv-bg3':          '#1c2128',
      '--bv-bg4':          '#21262d',
      '--bv-bg5':          '#2d333b',
      '--bv-bd':           '#30363d',
      '--bv-bd2':          '#444c56',
      '--bv-txt':          '#e6edf3',
      '--bv-txt2':         '#8b949e',
      '--bv-txt3':         '#6e7681',
      '--bv-blue':         '#58a6ff',
      '--bv-blue-dim':     '#1c2a3a',
      '--bv-blue-bg':      '#1f3558',
      '--bv-accent':       '#1a6fb0',
      '--bv-accent-dark':  '#0d4a80',
      '--bv-green':        '#3fb950',
      '--bv-green-bg':     '#1a3428',
      '--bv-green-dim':    '#122a1e',
      '--bv-red':          '#f85149',
      '--bv-red-bg':       '#3d1a18',
      '--bv-red-dim':      '#2d1010',
      '--bv-red-border':   '#5a2020',
      '--bv-amber':        '#e3b341',
      '--bv-amber-bg':     '#3a2a10',
      '--bv-amber-dim':    '#1c1100',
      '--bv-cyan':         '#39d0d8',
      '--bv-cyan-bg':      '#0e2d30',
      '--bv-purple':       '#bc8cff',
      '--bv-purple-bg':    '#2a1a40',
      '--bv-orange':       '#e36209',
      '--bv-card':         '#161b22',
      '--bv-sidebar':      '#161b22',
      '--bv-input':        '#21262d',
      '--bv-hover':        '#1c2128',
      '--bv-shadow':       '0 4px 24px rgba(0,0,0,0.4)',
    }
  },
  light: {
    label: 'Light',
    icon:  'sun',
    vars: {
      '--bv-bg':           '#f6f8fa',
      '--bv-bg2':          '#ffffff',
      '--bv-bg3':          '#f0f3f6',
      '--bv-bg4':          '#e8ecf0',
      '--bv-bg5':          '#dde2e8',
      '--bv-bd':           '#d0d7de',
      '--bv-bd2':          '#afb8c1',
      '--bv-txt':          '#1f2328',
      '--bv-txt2':         '#57606a',
      '--bv-txt3':         '#848d97',
      '--bv-blue':         '#0969da',
      '--bv-blue-dim':     '#dbeafe',
      '--bv-blue-bg':      '#eff6ff',
      '--bv-accent':       '#0969da',
      '--bv-accent-dark':  '#0550ae',
      '--bv-green':        '#1a7f37',
      '--bv-green-bg':     '#d4f4dd',
      '--bv-green-dim':    '#f0fdf4',
      '--bv-red':          '#d1242f',
      '--bv-red-bg':       '#ffddd9',
      '--bv-red-dim':      '#fff5f5',
      '--bv-red-border':   '#ffaba4',
      '--bv-amber':        '#9a6700',
      '--bv-amber-bg':     '#fef3c7',
      '--bv-amber-dim':    '#fffbeb',
      '--bv-cyan':         '#0a7e80',
      '--bv-cyan-bg':      '#ccfbf1',
      '--bv-purple':       '#7c3aed',
      '--bv-purple-bg':    '#ede9fe',
      '--bv-orange':       '#c2410c',
      '--bv-card':         '#ffffff',
      '--bv-sidebar':      '#ffffff',
      '--bv-input':        '#f6f8fa',
      '--bv-hover':        '#f0f3f6',
      '--bv-shadow':       '0 4px 24px rgba(0,0,0,0.1)',
    }
  },
  white: {
    label: 'White',
    icon:  'brightness',
    vars: {
      '--bv-bg':           '#ffffff',
      '--bv-bg2':          '#ffffff',
      '--bv-bg3':          '#f8f9fb',
      '--bv-bg4':          '#f1f4f7',
      '--bv-bg5':          '#e9ecef',
      '--bv-bd':           '#dee2e8',
      '--bv-bd2':          '#ced4da',
      '--bv-txt':          '#212529',
      '--bv-txt2':         '#495057',
      '--bv-txt3':         '#868e96',
      '--bv-blue':         '#1864ab',
      '--bv-blue-dim':     '#e7f5ff',
      '--bv-blue-bg':      '#f0f9ff',
      '--bv-accent':       '#1864ab',
      '--bv-accent-dark':  '#1459a0',
      '--bv-green':        '#2b8a3e',
      '--bv-green-bg':     '#ebfbee',
      '--bv-green-dim':    '#f4fce3',
      '--bv-red':          '#c92a2a',
      '--bv-red-bg':       '#fff5f5',
      '--bv-red-dim':      '#ffe3e3',
      '--bv-red-border':   '#ffc9c9',
      '--bv-amber':        '#e67700',
      '--bv-amber-bg':     '#fff9db',
      '--bv-amber-dim':    '#fff3bf',
      '--bv-cyan':         '#0b7285',
      '--bv-cyan-bg':      '#e3fafc',
      '--bv-purple':       '#6741d9',
      '--bv-purple-bg':    '#f3f0ff',
      '--bv-orange':       '#d9480f',
      '--bv-card':         '#ffffff',
      '--bv-sidebar':      '#f8f9fb',
      '--bv-input':        '#f8f9fb',
      '--bv-hover':        '#f1f4f7',
      '--bv-shadow':       '0 4px 24px rgba(0,0,0,0.08)',
    }
  }
};

// ── APPLY VARS TO DOM ─────────────────────────────────────────────────────────
function applyTheme(name) {
  const theme = THEMES[name] || THEMES.dark;
  const root  = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  document.body.style.background = theme.vars['--bv-bg'];
  document.body.style.color      = theme.vars['--bv-txt'];
  document.documentElement.setAttribute('data-bv-theme', name);
}

// ── PROVIDER ──────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  // Resolve initial theme: login response > localStorage > default dark
  const [theme,   setThemeState] = useState(() => {
    // Check if login stored a preference
    try {
      const stored = sessionStorage.getItem('bv_theme_session') || localStorage.getItem('bv_theme');
      return THEMES[stored] ? stored : 'dark';
    } catch { return 'dark'; }
  });
  const [saving,  setSaving]  = useState(false);
  const [synced,  setSynced]  = useState(false);
  const saveTimer = useRef(null);

  // Apply immediately on mount and when theme changes
  useEffect(() => { applyTheme(theme); }, [theme]);

  // On mount: if user is logged in, fetch their saved theme from DB
  useEffect(() => {
    const token = localStorage.getItem('bv_token');
    if (!token || synced) return;

    fetch('/api/preferences/theme', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        const dbTheme = data?.value;
        if (dbTheme && THEMES[dbTheme] && dbTheme !== theme) {
          setThemeState(dbTheme);
          localStorage.setItem('bv_theme', dbTheme);
        }
        setSynced(true);
      })
      .catch(() => setSynced(true)); // network error — use local value
  }, []); // eslint-disable-line

  // setTheme: instant local apply + async DB save (debounced 400ms)
  const setTheme = useCallback((name) => {
    if (!THEMES[name]) return;

    // 1. Apply instantly to DOM
    setThemeState(name);
    applyTheme(name);

    // 2. Persist locally (fallback if DB save fails)
    localStorage.setItem('bv_theme', name);

    // 3. Save to DB (debounced — user might click quickly)
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const token = localStorage.getItem('bv_token');
      if (!token) return; // not logged in — local only
      try {
        setSaving(true);
        await fetch('/api/preferences', {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ theme: name }),
        });
      } catch {
        // Silent fail — local preference already applied
      } finally {
        setSaving(false);
      }
    }, 400);
  }, []);

  // Called by AuthContext after login to apply the user's saved theme from DB
  const applyFromLogin = useCallback((preferences) => {
    const savedTheme = preferences?.theme;
    if (savedTheme && THEMES[savedTheme]) {
      setThemeState(savedTheme);
      applyTheme(savedTheme);
      localStorage.setItem('bv_theme', savedTheme);
      setSynced(true);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES, saving, applyFromLogin }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
