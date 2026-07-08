import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { StatusPill } from '../components/GameCard.jsx';

const RUNNING = ['queued', 'cloning', 'building', 'packaging'];

export default function Dashboard() {
  const [games, setGames] = useState(null);
  const [error, setError] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [openLog, setOpenLog] = useState(null);
  const timer = useRef(null);

  const refresh = useCallback(() => {
    api.get('/games/mine').then((data) => {
      setGames(data);
      // keep polling while a build is running
      clearTimeout(timer.current);
      if (data.some((g) => RUNNING.includes(g.buildStatus))) {
        timer.current = setTimeout(refresh, 3000);
      }
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/games', { repoUrl, branch });
      setRepoUrl('');
      setBranch('');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(slug) {
    try {
      await api.post(`/games/${slug}/rebuild`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(slug) {
    if (!confirm(`Delete "${slug}" and its package? This cannot be undone.`)) return;
    try {
      await api.delete(`/games/${slug}`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">Publisher dashboard</p>
        <h1 className="section-title" style={{ fontSize: 'var(--text-xl)' }}>My games</h1>

        <form onSubmit={submit} className="store-toolbar" style={{ marginTop: 'var(--space-3)' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: '18rem', maxWidth: 'none' }}
            placeholder="https://github.com/you/your-game"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            required
          />
          <input
            className="input"
            style={{ maxWidth: '10rem' }}
            placeholder="branch (optional)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit game'}</button>
        </form>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--isc-muted)' }}>
          The server clones your repo, reads <code>isc.json</code> when present, falls back to README/source
          detection when needed, compiles your Scala sources against FunGraphics and packages a runnable download. <Link to="/docs/manifest">Manifest reference</Link>
        </p>

        {error && <p className="form-error">{error}</p>}
        {!games && <p>Loading…</p>}
        {games?.length === 0 && <p>No games yet — submit your repo above.</p>}

        {games?.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Game</th><th>Build</th><th>Store</th><th>Downloads</th><th>Version</th><th></th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <Fragment key={g.slug}>
                  <tr>
                    <td>
                      <strong>{g.title}</strong>
                      <br />
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--isc-muted)' }}>
                        {g.slug}{g.commit ? ` @ ${g.commit}` : ''}
                      </span>
                    </td>
                    <td><StatusPill status={g.buildStatus} /></td>
                    <td>{g.published ? 'published' : 'awaiting approval'}</td>
                    <td>{g.downloads}</td>
                    <td className="mono">{g.version}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="btn btn-secondary btn-sm" to={`/game/${g.slug}`}>View</Link>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => rebuild(g.slug)}
                          disabled={RUNNING.includes(g.buildStatus)}
                        >
                          Rebuild
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpenLog(openLog === g.slug ? null : g.slug)}>
                          {openLog === g.slug ? 'Hide log' : 'Log'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(g.slug)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  {openLog === g.slug && (
                    <tr>
                      <td colSpan={6}><pre className="build-log">{g.buildLog || 'No log yet.'}</pre></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
