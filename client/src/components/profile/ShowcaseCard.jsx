// One configurable showcase panel. Renders by type from the profile payload.
import { Link } from 'react-router-dom';
import GameCard from '../GameCard.jsx';
import Gallery from './Gallery.jsx';

const TITLES = {
  'favorite-game': 'Favorite game',
  'games-made': 'Games made',
  'web-apps-made': 'Web apps made',
  'recent-games': 'Recent activity',
  reviews: 'Reviews',
  screenshots: 'Screenshot gallery',
  custom: 'Info',
};

function Stars({ value }) {
  return <span className="stars">{[1, 2, 3, 4, 5].map((n) => (
    <span key={n} className={n <= value ? 'star filled' : 'star'}>★</span>
  ))}</span>;
}

export default function ShowcaseCard({ showcase, profile }) {
  const { gamesMade, webAppsMade = [], recentGames, recentReviews } = profile;
  const title = showcase.title || TITLES[showcase.type];

  let body = null;
  switch (showcase.type) {
    case 'favorite-game': {
      const game =
        gamesMade.find((g) => g.slug === showcase.gameSlug) ??
        recentGames.map((r) => r.game).find((g) => g.slug === showcase.gameSlug);
      body = game ? (
        <div className="showcase-favorite">
          {game.coverUrl && <Link to={`/game/${game.slug}`}><img src={game.coverUrl} alt="" /></Link>}
          <div>
            <Link to={`/game/${game.slug}`} className="showcase-favorite-title">{game.title}</Link>
            <p>{game.shortDescription}</p>
            {showcase.text && <p className="showcase-text">{showcase.text}</p>}
          </div>
        </div>
      ) : (
        <p className="social-empty">Pick a game slug in edit mode.</p>
      );
      break;
    }
    case 'games-made':
      body = gamesMade.length ? (
        <div className="showcase-games">{gamesMade.map((g) => <GameCard key={g.slug} game={g} />)}</div>
      ) : (
        <p className="social-empty">No published games yet.</p>
      );
      break;
    case 'web-apps-made':
      body = webAppsMade.length ? (
        <div className="showcase-games">{webAppsMade.map((g) => <GameCard key={g.slug} game={g} />)}</div>
      ) : (
        <p className="social-empty">No published web apps yet.</p>
      );
      break;
    case 'recent-games':
      body = recentGames.length ? (
        <div className="showcase-recent">
          {recentGames.map(({ game, secondsPlayed, lastPlayedAt }) => (
            <Link key={game.slug} to={`/game/${game.slug}`} className="recent-game-row">
              {game.coverUrl && <img src={game.coverUrl} alt="" />}
              <span className="recent-game-info">
                <strong>{game.title}</strong>
                <small>
                  {secondsPlayed >= 3600
                    ? `${(secondsPlayed / 3600).toFixed(1)} h played`
                    : `${Math.max(1, Math.round(secondsPlayed / 60))} min played`}
                  {' - last played '}
                  {new Date(lastPlayedAt).toLocaleDateString()}
                </small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="social-empty">Nothing played yet.</p>
      );
      break;
    case 'reviews':
      body = recentReviews.length ? (
        <div className="showcase-reviews">
          {recentReviews.map((r) => (
            <article key={r.id}>
              <header>
                <Link to={`/game/${r.game.slug}`}>{r.game.title}</Link>
                <Stars value={r.rating} />
              </header>
              {r.text && <p>{r.text.slice(0, 240)}</p>}
            </article>
          ))}
        </div>
      ) : (
        <p className="social-empty">No reviews yet.</p>
      );
      break;
    case 'screenshots': {
      const images = gamesMade.flatMap((g) => g.screenshotUrls ?? []);
      body = <Gallery images={images} />;
      break;
    }
    case 'custom':
      body = <p className="showcase-text">{showcase.text || 'Empty panel.'}</p>;
      break;
    default:
      return null;
  }

  return (
    <section className="showcase-card">
      <h2>{title}</h2>
      {body}
    </section>
  );
}
