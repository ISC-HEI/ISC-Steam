import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import logoBlack from '../assets/logo/isc-inline-black.svg';
import logoWhite from '../assets/logo/isc-inline-white.svg';
import useTheme from '../hooks/useTheme.js';
import { useAuth } from '../context/AuthContext.jsx';
import SocialDock from './SocialDock.jsx';

const APP_NAME = 'Steam';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export default function Layout() {
  const { theme, toggleTheme } = useTheme();
  const { user, isStudent, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const logo = theme === 'dark' ? logoWhite : logoBlack;

  function onLogout() {
    logout();
    navigate('/');
  }

  return (
    <>
      <div className="ridge-topline" aria-hidden="true" />
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <img src={logo} alt="ISC" />
            <span className="brand-app">{APP_NAME}</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Store</NavLink>
            {user && <NavLink to="/library">Library</NavLink>}
            {isStudent && <NavLink to="/dashboard">My games</NavLink>}
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            {user ? (
              <button type="button" className="btn btn-ghost" onClick={onLogout} title={`Signed in as ${user.displayName}`}>
                Sign out
              </button>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <NavLink to="/register" className="btn btn-primary" style={{ color: 'var(--isc-on-magenta)' }}>
                  Join
                </NavLink>
              </>
            )}
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </nav>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <img src={logo} alt="" aria-hidden="true" />
          <span>
            ISC Steam — games by ISC students, HES-SO Valais · logos from{' '}
            <a href="https://github.com/ISC-HEI/isc-logos">ISC-HEI/isc-logos</a> (CC BY-NC-SA 4.0)
          </span>
        </div>
      </footer>

      <SocialDock />
    </>
  );
}
