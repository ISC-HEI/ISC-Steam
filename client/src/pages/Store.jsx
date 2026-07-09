import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import GameCard from '../components/GameCard.jsx';

export default function Store() {
  const [games, setGames] = useState(null);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/games/tags').then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (tag) params.set('tag', tag);
    if (sort) params.set('sort', sort);
    const t = setTimeout(() => {
      api
        .get(`/games?${params}`)
        .then((data) => { setGames(data); setError(''); })
        .catch((err) => setError(err.message));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, tag, sort]);

  const featured = useMemo(() => games?.find((g) => g.featured && g.coverUrl) ?? games?.find((g) => g.coverUrl), [games]);

  return (
    <>
      <section className="store-hero">
        <div className="container">
          {featured ? (
            <Link to={`/game/${featured.slug}`} className="featured-capsule">
              <img src={featured.coverUrl} alt={`${featured.title} banner`} />
              <div className="featured-overlay">
                <p className="eyebrow" style={{ color: '#9c9c99' }}>Featured</p>
                <h2>{featured.title}</h2>
                <p>{featured.shortDescription}</p>
              </div>
            </Link>
          ) : (
            <div className="featured-capsule" style={{ display: 'grid', placeItems: 'center' }}>
              <span className="cover-fallback">No games published yet</span>
            </div>
          )}
          <div className="hero-side">
            <p className="eyebrow">ISC · HES-SO Valais</p>
            <h1>Games made by ISC students</h1>
            <p>
              Every game here was built with FunGraphics during the 1st-year course - pulled straight
              from the students' Git repos, compiled and packaged so you can play them anywhere.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="section-title">Browse the library</h2>

          <div className="store-toolbar">
            <input
              className="input"
              type="search"
              placeholder="Search games…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="input" style={{ maxWidth: '11rem' }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">Featured first</option>
              <option value="new">Newest</option>
              <option value="popular">Most downloaded</option>
              <option value="title">A → Z</option>
            </select>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className={`tag-chip${tag === t ? ' active' : ''}`}
                onClick={() => setTag(tag === t ? '' : t)}
              >
                {t}
              </button>
            ))}
          </div>

          {error && <p className="notice">{error}</p>}
          {!games && !error && <p>Loading the library…</p>}
          {games?.length === 0 && <p>No games match - try clearing the filters.</p>}

          <div className="capsule-grid">
            {games?.map((g) => <GameCard key={g.slug} game={g} />)}
          </div>
        </div>
      </section>
    </>
  );
}
