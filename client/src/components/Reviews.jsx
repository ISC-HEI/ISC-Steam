// Review list + editor shown on the game page.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

function Stars({ value, onChange }) {
  return (
    <span className={`stars${onChange ? ' editable' : ''}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'star filled' : 'star'}
          onClick={onChange ? () => onChange(n) : undefined}
          disabled={!onChange}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export default function Reviews({ slug }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api.get(`/games/${slug}/reviews`).then((d) => {
      setData(d);
      const mine = d.reviews.find((r) => r.mine);
      if (mine) {
        setRating(mine.rating);
        setText(mine.text);
      }
    }).catch(() => {});
  }

  useEffect(load, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    if (!rating) return setError('Pick a rating first');
    try {
      await api.post(`/games/${slug}/reviews`, { rating, text });
      setEditing(false);
      setError('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeMine() {
    await api.delete(`/games/${slug}/reviews`).catch(() => {});
    setRating(0);
    setText('');
    load();
  }

  if (!data) return null;
  const mine = data.reviews.find((r) => r.mine);

  return (
    <section className="reviews">
      <h2 className="section-title" style={{ marginTop: 'var(--space-4)' }}>
        Reviews
        {data.count > 0 && (
          <span className="reviews-average">
            <Stars value={Math.round(data.average)} /> {data.average.toFixed(1)} · {data.count} review{data.count > 1 ? 's' : ''}
          </span>
        )}
      </h2>

      {user ? (
        (!mine || editing) ? (
          <form className="review-form" onSubmit={submit}>
            <Stars value={rating} onChange={setRating} />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What did you think of this game?"
              maxLength={4000}
              rows={3}
            />
            {error && <p className="social-error">{error}</p>}
            <div>
              <button type="submit" className="btn btn-primary">{mine ? 'Update review' : 'Post review'}</button>
              {editing && (
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              )}
            </div>
          </form>
        ) : null
      ) : (
        <p><Link to="/login">Sign in</Link> to write a review.</p>
      )}

      <div className="review-list">
        {data.reviews.length === 0 && <p className="social-empty">No reviews yet — be the first!</p>}
        {data.reviews.map((r) => (
          <article key={r.id} className="review">
            <header>
              <strong>{r.user.displayName}</strong>
              <Stars value={r.rating} />
              <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString()}</time>
              {r.mine && (
                <span className="review-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
                  <button type="button" className="btn btn-ghost" onClick={removeMine}>Delete</button>
                </span>
              )}
            </header>
            {r.text && <p>{r.text}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
