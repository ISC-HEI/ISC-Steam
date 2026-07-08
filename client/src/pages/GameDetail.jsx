import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { TagRow } from '../components/GameCard.jsx';
import Reviews from '../components/Reviews.jsx';

const isDesktop = typeof window !== 'undefined' && !!window.iscSteam?.desktop;

function formatSize(bytes) {
  if (!bytes) return '—';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default function GameDetail() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');
  const [shot, setShot] = useState(0);
  const [inLibrary, setInLibrary] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get('/library')
      .then((d) => setInLibrary(d.entries.some((e) => e.game.slug === slug)))
      .catch(() => {});
  }, [slug, user]);

  async function addToLibrary() {
    await api.post(`/library/${slug}`);
    setInLibrary(true);
  }

  useEffect(() => {
    api.get(`/games/${slug}`).then(setGame).catch((err) => setError(err.message));
  }, [slug]);

  if (error) {
    return (
      <section className="section">
        <div className="container">
          <h1>Game not found</h1>
          <p>{error}</p>
          <Link className="btn btn-secondary" to="/">← Back to the store</Link>
        </div>
      </section>
    );
  }
  if (!game) return <section className="section"><div className="container"><p>Loading…</p></div></section>;

  const shots = game.screenshotUrls?.length ? game.screenshotUrls : game.coverUrl ? [game.coverUrl] : [];

  return (
    <>
      <div className="game-page-head">
        <div className="container">
          <p className="eyebrow">
            <Link to="/" style={{ color: 'inherit' }}>Store</Link> / {game.title}
          </p>
          <h1>{game.title}</h1>
        </div>
      </div>

      <section className="section">
        <div className="container game-detail">
          <div>
            {shots.length > 0 && (
              <>
                <img className="screenshot-main" src={shots[shot]} alt={`${game.title} screenshot`} />
                {shots.length > 1 && (
                  <div className="screenshot-strip">
                    {shots.map((s, i) => (
                      <img
                        key={s}
                        src={s}
                        alt=""
                        className={`screenshot-thumb${i === shot ? ' active' : ''}`}
                        onClick={() => setShot(i)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <h2 className="section-title" style={{ marginTop: 'var(--space-4)' }}>About this game</h2>
            <p className="game-description">{game.description || game.shortDescription}</p>

            {game.controls && (
              <>
                <h3>Controls</h3>
                <p className="mono">{game.controls}</p>
              </>
            )}

            <Reviews slug={slug} />
          </div>

          <aside className="buybox">
            {game.coverUrl && <img className="cover" src={game.coverUrl} alt="" />}
            <div className="buybox-body">
              <p style={{ margin: 0 }}>{game.shortDescription}</p>
              <TagRow tags={game.tags} max={5} />

              <div className="download-row">
                <span className="price-free">Free</span>
                {user ? (
                  inLibrary ? (
                    <Link className="btn btn-secondary" to="/library">In library ✓</Link>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={addToLibrary}>
                      Add to library
                    </button>
                  )
                ) : (
                  <Link className="btn btn-primary" to="/login">Sign in to play</Link>
                )}
                {user && !isDesktop && game.downloadable && (
                  <a className="btn btn-secondary" href={downloadUrl(game.slug)}>Download</a>
                )}
                {user && !game.downloadable && (
                  <span className="status-pill status-none">no build yet</span>
                )}
              </div>

              <dl className="meta-list">
                <dt>Authors</dt><dd>{game.authors?.join(', ') || '—'}</dd>
                <dt>Version</dt><dd className="mono">{game.version}</dd>
                <dt>Engine</dt><dd className="mono">{game.engine?.name}{game.engine?.version ? ` ${game.engine.version}` : ''}</dd>
                <dt>Year</dt><dd>{game.year ?? '—'}</dd>
                <dt>Size</dt><dd>{formatSize(game.packageSize)}</dd>
                <dt>Downloads</dt><dd>{game.downloads}</dd>
                <dt>Source</dt>
                <dd>
                  {game.repoUrl
                    ? <a href={game.repoUrl} target="_blank" rel="noreferrer">Git repository</a>
                    : 'Uploaded package'}
                </dd>
              </dl>

              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--isc-muted)' }}>
                Runs anywhere with Java 11+ — unzip, then double-click <code>run.bat</code> (Windows)
                or <code>run.sh</code> (macOS/Linux).
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
