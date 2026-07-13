import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { StatusPill } from '../components/GameCard.jsx';

const ROLES = ['visitor', 'student', 'admin'];

export default function Admin() {
  const { user: me } = useAuth();
  const [stats, setStats] = useState(null);
  const [games, setGames] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    Promise.all([api.get('/admin/stats'), api.get('/admin/games'), api.get('/admin/users')])
      .then(([s, g, u]) => { setStats(s); setGames(g); setUsers(u); setError(''); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(refresh, [refresh]);

  const patchGame = (slug, body) => api.patch(`/games/${slug}`, body).then(refresh).catch((e) => setError(e.message));
  const setRole = (id, role) => api.patch(`/admin/users/${id}`, { role }).then(refresh).catch((e) => setError(e.message));

  async function removeUser(u) {
    if (!confirm(`Delete account "${u.username}"?`)) return;
    api.delete(`/admin/users/${u.id}`).then(refresh).catch((e) => setError(e.message));
  }

  // store-wide announcement banner
  const [announcement, setAnnouncement] = useState({ text: '', link: '', active: false });
  const [announceSaved, setAnnounceSaved] = useState('');

  useEffect(() => {
    api.get('/announcement')
      .then((d) => d.announcement && setAnnouncement({ text: d.announcement.text, link: d.announcement.link ?? '', active: true }))
      .catch(() => {});
  }, []);

  async function saveAnnouncement(active) {
    try {
      await api.put('/admin/announcement', { ...announcement, active });
      setAnnouncement((a) => ({ ...a, active }));
      setAnnounceSaved(active ? 'Announcement is live' : 'Announcement hidden');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">Admin</p>
        <h1 className="section-title" style={{ fontSize: 'var(--text-xl)' }}>Control room</h1>

        {error && <p className="form-error">{error}</p>}

        {stats && (
          <div className="stat-grid" style={{ marginTop: 'var(--space-3)' }}>
            {[['Accounts', stats.users], ['Games', stats.games], ['Published', stats.published], ['Downloads', stats.downloads]].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-value">{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>
        )}

        <h2>Announcement</h2>
        <div className="announce-editor">
          <input
            value={announcement.text}
            onChange={(e) => { setAnnouncement((a) => ({ ...a, text: e.target.value })); setAnnounceSaved(''); }}
            placeholder="Store-wide banner text (e.g. 'Submissions close Friday!')"
            maxLength={500}
          />
          <input
            value={announcement.link}
            onChange={(e) => { setAnnouncement((a) => ({ ...a, link: e.target.value })); setAnnounceSaved(''); }}
            placeholder="Optional link (https://...)"
            maxLength={500}
          />
          <span className="announce-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveAnnouncement(true)} disabled={!announcement.text.trim()}>
              {announcement.active ? 'Update' : 'Publish'}
            </button>
            {announcement.active && (
              <button type="button" className="btn btn-ghost" onClick={() => saveAnnouncement(false)}>Hide</button>
            )}
            {announceSaved && <small>{announceSaved}</small>}
          </span>
        </div>

        <h2>Games</h2>
        {games && (
          <table className="table">
            <thead>
              <tr><th>Game</th><th>Owner</th><th>Build</th><th>Published</th><th>Featured</th><th></th></tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.slug}>
                  <td><Link to={`/game/${g.slug}`}>{g.title}</Link></td>
                  <td>{g.owner?.displayName}</td>
                  <td>
                    {g.sourceType === 'web'
                      ? <span className="badge badge-sky">web</span>
                      : <StatusPill status={g.buildStatus} />}
                  </td>
                  <td>
                    <button
                      className={`btn btn-sm ${g.published ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => patchGame(g.slug, { published: !g.published })}
                      disabled={g.sourceType !== 'web' && !g.downloadable && !g.published}
                      title={g.sourceType !== 'web' && !g.downloadable && !g.published ? 'Needs a successful build first' : ''}
                    >
                      {g.published ? 'Unpublish' : 'Publish'}
                    </button>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => patchGame(g.slug, { featured: !g.featured })}>
                      {g.featured ? '★ featured' : '☆ feature'}
                    </button>
                  </td>
                  <td className="mono" style={{ fontSize: 'var(--text-xs)' }}>{g.downloads} ↓</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 style={{ marginTop: 'var(--space-5)' }}>Accounts</h2>
        {users && (
          <table className="table">
            <thead>
              <tr><th>User</th><th>Email</th><th>Role</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.displayName}</strong> <span className="mono" style={{ color: 'var(--isc-muted)', fontSize: 'var(--text-xs)' }}>@{u.username}</span></td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className="input"
                      style={{ padding: '0.25rem 0.5rem', width: 'auto' }}
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={(e) => setRole(u.id, e.target.value)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.id !== me.id && (
                      <button className="btn btn-ghost btn-sm" onClick={() => removeUser(u)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
