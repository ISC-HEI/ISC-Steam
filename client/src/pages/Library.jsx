// The user's library. On the web it offers downloads; in the desktop app it
// installs, launches and uninstalls games through the iscSteam bridge.
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken, downloadUrl } from '../api/client.js';
import { useSocial } from '../context/SocialContext.jsx';

const bridge = typeof window !== 'undefined' ? window.iscSteam : null;

function formatPlaytime(seconds) {
  if (!seconds) return 'Never played';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min played`;
  return `${(seconds / 3600).toFixed(1)} h played`;
}

export default function Library() {
  const social = useSocial();
  const playing = social?.playing;
  const [entries, setEntries] = useState(null);
  const [installed, setInstalled] = useState({}); // slug -> {version}
  const [installDir, setInstallDir] = useState('');
  const [busy, setBusy] = useState(null); // slug being installed
  const [error, setError] = useState('');

  const refreshLocal = useCallback(() => {
    if (!bridge) return;
    bridge.installed().then(setInstalled).catch(() => {});
    bridge.getInstallDir().then((d) => setInstallDir(d ?? '')).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/library').then((d) => setEntries(d.entries)).catch((err) => setError(err.message));
    refreshLocal();
  }, [refreshLocal]);

  // refresh hours after a session ends
  useEffect(() => {
    if (playing === null) {
      api.get('/library').then((d) => setEntries(d.entries)).catch(() => {});
    }
  }, [playing]);

  async function chooseFolder() {
    const dir = await bridge.chooseInstallDir();
    if (dir) setInstallDir(dir);
  }

  async function install(game) {
    setError('');
    try {
      let dir = installDir;
      if (!dir) {
        dir = await bridge.chooseInstallDir();
        if (!dir) return;
        setInstallDir(dir);
      }
      setBusy(game.slug);
      await bridge.install(
        { slug: game.slug, title: game.title, version: game.version, coverUrl: game.coverUrl },
        getToken(),
      );
      refreshLocal();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(slug) {
    await bridge.uninstall(slug).catch(() => {});
    refreshLocal();
  }

  async function play(game) {
    setError('');
    try {
      await bridge.play(game.slug);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeFromLibrary(slug) {
    await api.delete(`/library/${slug}`).catch(() => {});
    setEntries((es) => es.filter((e) => e.game.slug !== slug));
  }

  if (error && !entries) {
    return <section className="section"><div className="container"><p>{error}</p></div></section>;
  }
  if (!entries) {
    return <section className="section"><div className="container"><p>Loading…</p></div></section>;
  }

  return (
    <section className="section">
      <div className="container">
        <h1>Library</h1>

        {bridge && (
          <p className="library-installdir">
            Install folder: <code>{installDir || 'not set'}</code>{' '}
            <button type="button" className="btn btn-ghost" onClick={chooseFolder}>Change</button>
          </p>
        )}
        {error && <p className="social-error">{error}</p>}

        {entries.length === 0 && (
          <p>Your library is empty — find something in the <Link to="/">store</Link>.</p>
        )}

        <div className="library-grid">
          {entries.map(({ game, secondsPlayed }) => {
            const isInstalled = !!installed[game.slug];
            const updateAvailable = isInstalled && installed[game.slug].version !== game.version;
            const isPlaying = playing?.slug === game.slug;
            return (
              <article key={game.slug} className="library-card">
                <Link to={`/game/${game.slug}`}>
                  {game.coverUrl
                    ? <img src={game.coverUrl} alt="" />
                    : <div className="library-cover-fallback">{game.title}</div>}
                </Link>
                <div className="library-card-body">
                  <strong>{game.title}</strong>
                  <span className="library-playtime">{formatPlaytime(secondsPlayed)}</span>

                  <div className="library-actions">
                    {bridge ? (
                      isInstalled ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => play(game)}
                            disabled={isPlaying}
                          >
                            {isPlaying ? 'Running…' : 'Play'}
                          </button>
                          {updateAvailable && (
                            <button type="button" className="btn btn-secondary" onClick={() => install(game)} disabled={busy === game.slug}>
                              {busy === game.slug ? 'Updating…' : 'Update'}
                            </button>
                          )}
                          <button type="button" className="btn btn-ghost" onClick={() => uninstall(game.slug)} disabled={isPlaying}>
                            Uninstall
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => install(game)}
                          disabled={!game.downloadable || busy === game.slug}
                        >
                          {busy === game.slug ? 'Installing…' : game.downloadable ? 'Install' : 'No build yet'}
                        </button>
                      )
                    ) : (
                      game.downloadable && <a className="btn btn-primary" href={downloadUrl(game.slug)}>Download</a>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => removeFromLibrary(game.slug)}>
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
