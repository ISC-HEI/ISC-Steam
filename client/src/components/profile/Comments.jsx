// Profile comment section: post, like, reply (prefill), delete.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Avatar } from './ProfileBits.jsx';

export default function Comments({ username, canModerate }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function load() {
    api.get(`/users/${username}/comments`).then((d) => setComments(d.comments)).catch(() => {});
  }
  useEffect(load, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    try {
      await api.post(`/users/${username}/comments`, { text });
      setDraft('');
      setError('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleLike(c) {
    const { likes, likedByMe } = await api.post(`/users/${username}/comments/${c.id}/like`);
    setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, likes, likedByMe } : x)));
  }

  async function remove(c) {
    await api.delete(`/users/${username}/comments/${c.id}`).catch(() => {});
    load();
  }

  function reply(c) {
    setDraft((d) => (d.startsWith(`@${c.author.username} `) ? d : `@${c.author.username} ${d}`));
    inputRef.current?.focus();
  }

  return (
    <section className="profile-comments">
      <h2>Comments</h2>

      {user ? (
        <form className="comment-form" onSubmit={submit}>
          <Avatar user={{ displayName: user.displayName, avatarUrl: user.avatarUrl }} size={36} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave a comment..."
            maxLength={1000}
          />
          <button type="submit" className="btn btn-primary">Post</button>
        </form>
      ) : (
        <p><Link to="/login">Sign in</Link> to comment.</p>
      )}
      {error && <p className="social-error">{error}</p>}

      <div className="comment-list">
        {comments.length === 0 && <p className="social-empty">No comments yet.</p>}
        {comments.map((c) => (
          <article key={c.id} className="comment">
            <Avatar user={c.author} size={36} />
            <div className="comment-body">
              <header>
                <Link to={`/user/${c.author.username}`}>{c.author.displayName}</Link>
                <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
              </header>
              <p>{c.text}</p>
              <footer>
                {user && (
                  <button type="button" className={`comment-like${c.likedByMe ? ' liked' : ''}`} onClick={() => toggleLike(c)}>
                    ♥ {c.likes > 0 ? c.likes : ''}
                  </button>
                )}
                {user && <button type="button" className="comment-action" onClick={() => reply(c)}>Reply</button>}
                {(c.mine || canModerate) && (
                  <button type="button" className="comment-action" onClick={() => remove(c)}>Delete</button>
                )}
              </footer>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
