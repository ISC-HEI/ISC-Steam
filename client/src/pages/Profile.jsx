// Steam-style user profile: hero, stats, showcases, activity feed, sidebar,
// comments. Own profiles get an edit mode (bio, images, showcase manager).
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocial } from '../context/SocialContext.jsx';
import ProfileHeader from '../components/profile/ProfileHeader.jsx';
import ShowcaseCard from '../components/profile/ShowcaseCard.jsx';
import Comments from '../components/profile/Comments.jsx';
import { StatCard, SidebarSection, ActivityCard, FriendCard } from '../components/profile/ProfileBits.jsx';
import BannerCrop from '../components/profile/BannerCrop.jsx';

const SHOWCASE_OPTIONS = [
  ['favorite-game', 'Favorite game'],
  ['games-made', 'Games made'],
  ['web-apps-made', 'Web apps made'],
  ['recent-games', 'Recent games'],
  ['reviews', 'Reviews'],
  ['screenshots', 'Screenshot gallery'],
  ['custom', 'Custom panel'],
];

function EditPanel({ profile, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(profile.user.displayName);
  const [bio, setBio] = useState(profile.user.bio ?? '');
  const [showcases, setShowcases] = useState(profile.showcases ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bannerFile, setBannerFile] = useState(null); // pending file for the crop tool

  async function uploadImage(kind, file) {
    if (!file) return;
    const form = new FormData();
    form.append('image', file);
    setBusy(true);
    try {
      await api.postForm(`/users/me/${kind}`, form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateShowcase(i, patch) {
    setShowcases((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function move(i, dir) {
    setShowcases((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api.patch('/users/me/profile', { displayName, bio, showcases });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container profile-edit">
      <h2>Edit profile</h2>
      {error && <p className="social-error">{error}</p>}

      <div className="profile-edit-grid">
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
        </label>
        <label>
          Avatar
          <input type="file" accept="image/*" onChange={(e) => uploadImage('avatar', e.target.files[0])} />
        </label>
        <label>
          Banner
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              if (e.target.files[0]) setBannerFile(e.target.files[0]);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
        </label>
        <label>
          Background
          <input type="file" accept="image/*" onChange={(e) => uploadImage('background', e.target.files[0])} />
        </label>
      </div>

      <label className="profile-edit-bio">
        Bio
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={3} />
      </label>

      <h3>Showcases</h3>
      <div className="showcase-editor">
        {showcases.map((s, i) => (
          <div key={i} className="showcase-editor-row">
            <select value={s.type} onChange={(e) => updateShowcase(i, { type: e.target.value })}>
              {SHOWCASE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input
              placeholder="Title (optional)"
              value={s.title ?? ''}
              onChange={(e) => updateShowcase(i, { title: e.target.value })}
              maxLength={80}
            />
            {s.type === 'favorite-game' && (
              <input
                placeholder="game slug (from the store URL)"
                value={s.gameSlug ?? ''}
                onChange={(e) => updateShowcase(i, { gameSlug: e.target.value })}
              />
            )}
            {(s.type === 'custom' || s.type === 'favorite-game') && (
              <input
                placeholder="Text"
                value={s.text ?? ''}
                onChange={(e) => updateShowcase(i, { text: e.target.value })}
                maxLength={2000}
              />
            )}
            <span className="showcase-editor-actions">
              <button type="button" className="btn btn-ghost" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="btn btn-ghost" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowcases((x) => x.filter((_, j) => j !== i))}>
                Remove
              </button>
            </span>
          </div>
        ))}
        {showcases.length < 8 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowcases((s) => [...s, { type: 'custom', title: '', text: '', gameSlug: '' }])}
          >
            + Add showcase
          </button>
        )}
      </div>

      <div className="profile-edit-buttons">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>

      {bannerFile && (
        <BannerCrop
          file={bannerFile}
          onCancel={() => setBannerFile(null)}
          onApply={(cropped) => {
            setBannerFile(null);
            uploadImage('banner', cropped);
          }}
        />
      )}
    </div>
  );
}

export default function Profile() {
  const { username } = useParams();
  const { user: me, isAdmin } = useAuth();
  const social = useSocial();
  const [profile, setProfile] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showAllActivity, setShowAllActivity] = useState(false);

  const load = useCallback(() => {
    api.get(`/users/${username}`).then(setProfile).catch((err) => setError(err.message));
    api.get(`/users/${username}/activity`).then((d) => setActivity(d.activity)).catch(() => {});
  }, [username]);

  useEffect(() => {
    setEditing(false);
    setFeedback('');
    setShowAllActivity(false);
    load();
  }, [load]);

  async function addFriend() {
    try {
      await social.addFriend(username);
      setFeedback('');
      load();
    } catch (err) {
      setFeedback(err.message);
    }
  }

  function message() {
    social.openChat(profile.user.id);
    social.setDockOpen(true);
  }

  if (error) {
    return <section className="section"><div className="container"><h1>User not found</h1><p>{error}</p></div></section>;
  }
  if (!profile) {
    return <section className="section"><div className="container"><p>Loading...</p></div></section>;
  }

  const showcases = profile.showcases?.length
    ? profile.showcases
    : [
        { type: 'games-made' },
        ...(profile.webAppsMade?.length ? [{ type: 'web-apps-made' }] : []),
        { type: 'recent-games' },
      ];

  const backgroundUrl = profile.user.backgroundUrl;
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 5);

  return (
    <>
      <ProfileHeader
        profile={profile}
        onAddFriend={addFriend}
        onMessage={message}
        onEdit={() => setEditing((e) => !e)}
        feedback={feedback}
      />

      {editing && <EditPanel profile={profile} onClose={() => setEditing(false)} onSaved={load} />}

      <section className="section">
        <div className="container">
          <div className="stats-row">
            <StatCard icon="🎮" value={profile.stats.gamesOwned} label="Games owned" />
            <StatCard icon="⏱" value={`${profile.stats.hoursPlayed} h`} label="Hours played" />
            <StatCard icon="🛠" value={profile.stats.gamesMade} label="Games made" />
            {profile.stats.webAppsMade > 0 && (
              <StatCard icon="🌐" value={profile.stats.webAppsMade} label="Web apps" />
            )}
            <StatCard icon="👥" value={profile.stats.friends} label="Friends" />
            <StatCard icon="★" value={profile.stats.reviews} label="Reviews" />
          </div>
        </div>

        <div className="profile-body">
          {backgroundUrl && (
            <div className="profile-page-bg" aria-hidden="true">
              <img src={backgroundUrl} alt="" />
            </div>
          )}
          <div className="container">
          <div className="profile-columns">
            <div className="profile-main">
              {showcases.map((s, i) => (
                <ShowcaseCard key={`${s.type}-${i}`} showcase={s} profile={profile} />
              ))}

              <section className="showcase-card">
                <h2>Activity feed</h2>
                {activity.length === 0 && <p className="social-empty">Nothing yet.</p>}
                <div className="activity-list">
                  {visibleActivity.map((item, i) => <ActivityCard key={i} item={item} />)}
                </div>
                {activity.length > 5 && (
                  <button
                    type="button"
                    className="btn btn-ghost activity-toggle"
                    onClick={() => setShowAllActivity((v) => !v)}
                  >
                    {showAllActivity ? '− Show less' : `+ Show all activity (${activity.length})`}
                  </button>
                )}
              </section>

              <Comments username={username} canModerate={isAdmin || profile.isOwn} />
            </div>

            <aside className="profile-sidebar">
              <SidebarSection title={`Friends (${profile.stats.friends})`}>
                {profile.friends.length === 0 && <p className="social-empty">No friends yet.</p>}
                {profile.friends.map((f) => <FriendCard key={f.id} friend={f} />)}
              </SidebarSection>

              {profile.recentGames.length > 0 && (
                <SidebarSection title="Recent games">
                  {profile.recentGames.slice(0, 4).map(({ game }) => (
                    <FriendCard
                      key={game.slug}
                      friend={{ username: '', displayName: game.title, avatarUrl: game.coverUrl, status: null }}
                      onClick={() => { window.location.href = `/game/${game.slug}`; }}
                    />
                  ))}
                </SidebarSection>
              )}

              {(profile.gamesMade.length > 0 || profile.webAppsMade?.length > 0) && (
                <SidebarSection title="External links">
                  {profile.gamesMade.filter((g) => g.repoUrl).map((g) => (
                    <a key={g.slug} className="sidebar-link" href={g.repoUrl} target="_blank" rel="noreferrer">
                      {g.title} repository
                    </a>
                  ))}
                  {(profile.webAppsMade ?? []).filter((g) => g.websiteUrl).map((g) => (
                    <a key={g.slug} className="sidebar-link" href={g.websiteUrl} target="_blank" rel="noreferrer">
                      {g.title} website
                    </a>
                  ))}
                </SidebarSection>
              )}
            </aside>
          </div>
          </div>
        </div>
      </section>
    </>
  );
}
