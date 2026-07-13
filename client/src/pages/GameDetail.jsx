import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { TagRow } from '../components/GameCard.jsx';
import Reviews from '../components/Reviews.jsx';

const isDesktop = typeof window !== 'undefined' && !!window.iscSteam?.desktop;

function formatSize(bytes) {
  if (!bytes) return '-';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default function GameDetail() {
  const { slug } = useParams();
  const { user, isStudent } = useAuth();
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');
  const [shot, setShot] = useState(0);
  const [inLibrary, setInLibrary] = useState(false);
  const [authorLinks, setAuthorLinks] = useState({}); // author name -> username
  const [collab, setCollab] = useState('anon'); // owner | collaborator | pending | none | anon
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabError, setCollabError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.get('/library')
      .then((d) => setInLibrary(d.entries.some((e) => e.game.slug === slug)))
      .catch(() => {});
  }, [slug, user]);

  // link author names to profiles when they match an account
  useEffect(() => {
    if (!game?.authors?.length) return;
    api.get(`/users/resolve?names=${encodeURIComponent(game.authors.join(','))}`)
      .then(setAuthorLinks)
      .catch(() => {});
  }, [game?.authors?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addToLibrary() {
    await api.post(`/library/${slug}`);
    setInLibrary(true);
  }

  useEffect(() => {
    api.get(`/games/${slug}`)
      .then((g) => {
        setGame(g);
        setCollab(g.viewerCollab ?? 'anon');
      })
      .catch((err) => setError(err.message));
  }, [slug]);

  async function requestCoOwnership() {
    setCollabBusy(true);
    setCollabError('');
    try {
      await api.post(`/games/${slug}/collab-request`);
      setCollab('pending');
    } catch (err) {
      setCollabError(err.message);
    } finally {
      setCollabBusy(false);
    }
  }

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
  const isWeb = game.sourceType === 'web' && !!game.websiteUrl;
  const siteHost = isWeb ? new URL(game.websiteUrl).hostname : '';

  return (
    <>
      <div className="game-page-head">
        <div className="container">
          <p className="eyebrow">
            {isWeb
              ? <Link to="/web" style={{ color: 'inherit' }}>Web</Link>
              : <Link to="/" style={{ color: 'inherit' }}>Store</Link>} / {game.title}
          </p>
          <h1>{game.title}</h1>
        </div>
      </div>

      <section className="section">
        <div className="container game-detail">
          <div>
            {isWeb && (
              <div className="web-embed">
                <div className="web-embed-bar">
                  <span className="mono" title={game.websiteUrl}>{siteHost}</span>
                  <a className="btn btn-secondary" href={game.websiteUrl} target="_blank" rel="noreferrer">
                    Visit site ↗
                  </a>
                </div>
                <iframe
                  src={game.websiteUrl}
                  title={`${game.title} live preview`}
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                />
                <p className="web-embed-hint">
                  Blank preview? The site probably doesn't allow embedding - use "Visit site" instead.
                </p>
              </div>
            )}

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

            <h2 className="section-title" style={{ marginTop: 'var(--space-4)' }}>
              {isWeb ? 'About this project' : 'About this game'}
            </h2>
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
                {isWeb ? (
                  <a className="btn btn-primary" href={game.websiteUrl} target="_blank" rel="noreferrer">
                    Visit site ↗
                  </a>
                ) : user ? (
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
                {!isWeb && user && !isDesktop && game.downloadable && (
                  <a className="btn btn-secondary" href={downloadUrl(game.slug)}>Windows</a>
                )}
                {!isWeb && user && !isDesktop && game.downloadableLinux && (
                  <a className="btn btn-secondary" href={downloadUrl(game.slug, 'linux')}>Linux</a>
                )}
                {!isWeb && user && !game.downloadable && (
                  <span className="status-pill status-none">no build yet</span>
                )}
              </div>

              <dl className="meta-list">
                <dt>Authors</dt>
                <dd>
                  {game.authors?.length
                    ? game.authors.map((name, i) => (
                        <span key={name}>
                          {i > 0 && ', '}
                          {authorLinks[name]
                            ? <Link to={`/user/${authorLinks[name]}`}>{name}</Link>
                            : name}
                        </span>
                      ))
                    : '-'}
                </dd>
                {game.ownerUser && (
                  <>
                    <dt>Publisher</dt>
                    <dd><Link to={`/user/${game.ownerUser.username}`}>{game.ownerUser.displayName}</Link></dd>
                  </>
                )}
                {game.collaborators?.length > 0 && (
                  <>
                    <dt>Co-owners</dt>
                    <dd>
                      {game.collaborators.map((c, i) => (
                        <span key={c.username}>
                          {i > 0 && ', '}
                          <Link to={`/user/${c.username}`}>{c.displayName}</Link>
                        </span>
                      ))}
                    </dd>
                  </>
                )}
                <dt>Version</dt><dd className="mono">{game.version}</dd>
                {!isWeb && (
                  <>
                    <dt>Engine</dt><dd className="mono">{game.engine?.name}{game.engine?.version ? ` ${game.engine.version}` : ''}</dd>
                  </>
                )}
                <dt>Year</dt><dd>{game.year ?? '-'}</dd>
                {!isWeb && (
                  <>
                    <dt>Size</dt><dd>{formatSize(game.packageSize)}</dd>
                    <dt>Downloads</dt><dd>{game.downloads}</dd>
                  </>
                )}
                <dt>Source</dt>
                <dd>
                  {isWeb
                    ? <a href={game.websiteUrl} target="_blank" rel="noreferrer">{siteHost}</a>
                    : game.repoUrl
                      ? <a href={game.repoUrl} target="_blank" rel="noreferrer">Git repository</a>
                      : 'Uploaded package'}
                </dd>
              </dl>

              {user && isStudent && (collab === 'none' || collab === 'pending') && (
                <div className="collab-request">
                  {collab === 'pending' ? (
                    <button type="button" className="btn btn-secondary" disabled>Co-ownership request sent</button>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={requestCoOwnership} disabled={collabBusy}>
                      {collabBusy ? 'Sending…' : 'Request co-ownership'}
                    </button>
                  )}
                  <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--text-xs)', color: 'var(--isc-muted)' }}>
                    {isWeb ? 'Built this site as a team?' : 'Made this game as a team?'} Ask the owner for shared control.
                  </p>
                  {collabError && <p className="form-error" style={{ marginTop: '0.25rem' }}>{collabError}</p>}
                </div>
              )}

              {!isDesktop && (
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--isc-muted)' }}>
                  Want simpler installs? The{' '}
                  <a href="https://github.com/ISC-HEI/ISC-Steam/releases" target="_blank" rel="noreferrer">
                    ISC Steam desktop app
                  </a>{' '}
                  installs and launches games in one click - no manual setup.
                </p>
              )}
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
