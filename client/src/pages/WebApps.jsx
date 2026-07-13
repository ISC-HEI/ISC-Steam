import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import GameCard from '../components/GameCard.jsx';

export default function WebApps() {
  const [apps, setApps] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ type: 'web' });
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    const t = setTimeout(() => {
      api
        .get(`/games?${params}`)
        .then((data) => { setApps(data); setError(''); })
        .catch((err) => setError(err.message));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, sort]);

  const featured = useMemo(() => apps?.find((a) => a.featured && a.coverUrl) ?? apps?.find((a) => a.coverUrl), [apps]);

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
              <span className="cover-fallback">No web apps published yet</span>
            </div>
          )}
          <div className="hero-side">
            <p className="eyebrow">ISC · HES-SO Valais</p>
            <h1>Web apps by ISC students</h1>
            <p>
              Websites and web apps built and hosted by ISC students - open them right here in the
              store or visit them on their own domain.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="section-title">Browse web apps</h2>

          <div className="store-toolbar">
            <input
              className="input"
              type="search"
              placeholder="Search web apps…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="input" style={{ maxWidth: '11rem' }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">Featured first</option>
              <option value="new">Newest</option>
              <option value="title">A → Z</option>
            </select>
          </div>

          {error && <p className="notice">{error}</p>}
          {!apps && !error && <p>Loading web apps…</p>}
          {apps?.length === 0 && <p>No web apps match - try clearing the search.</p>}

          <div className="capsule-grid">
            {apps?.map((a) => <GameCard key={a.slug} game={a} />)}
          </div>
        </div>
      </section>
    </>
  );
}
