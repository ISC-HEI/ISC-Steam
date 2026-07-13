import { Link } from 'react-router-dom';

const FACETS = ['sun', 'sky', 'mint', 'lavender', 'rose'];

export function TagRow({ tags, max = 3 }) {
  if (!tags?.length) return null;
  return (
    <span className="tag-row">
      {tags.slice(0, max).map((t, i) => (
        <span key={t} className={`badge badge-${FACETS[i % FACETS.length]}`}>{t}</span>
      ))}
    </span>
  );
}

export function StatusPill({ status }) {
  const cls =
    status === 'success' ? 'status-success'
    : status === 'failed' ? 'status-failed'
    : status === 'none' ? 'status-none'
    : 'status-running';
  return <span className={`status-pill ${cls}`}>{status}</span>;
}

export default function GameCard({ game }) {
  return (
    <Link to={`/game/${game.slug}`} className="game-card">
      <div className="cover">
        {game.coverUrl
          ? <img src={game.coverUrl} alt={`${game.title} cover`} loading="lazy" />
          : <span className="cover-fallback">{game.title}</span>}
      </div>
      <div className="card-body">
        <h3>{game.title}</h3>
        <p className="card-desc">{game.shortDescription}</p>
        <div className="card-meta">
          <TagRow tags={game.tags} />
          {game.sourceType === 'web'
            ? <span className="badge badge-sky">Web</span>
            : <span>{game.downloads} ↓</span>}
        </div>
      </div>
    </Link>
  );
}
