// Small reusable profile building blocks: StatCard, SidebarSection,
// ActivityCard, FriendCard, Avatar.
import { Link } from 'react-router-dom';

export function Avatar({ user, size = 40 }) {
  return user?.avatarUrl ? (
    <img
      className="p-avatar"
      src={user.avatarUrl}
      alt=""
      style={{ width: size, height: size }}
    />
  ) : (
    <span className="p-avatar p-avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(user?.displayName ?? '?')[0]?.toUpperCase()}
    </span>
  );
}

export function StatCard({ value, label, icon }) {
  return (
    <div className="stat-card">
      <span className="stat-icon" aria-hidden="true">{icon}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function SidebarSection({ title, children }) {
  return (
    <section className="sidebar-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function FriendCard({ friend, onClick }) {
  const state = friend.status?.state ?? 'offline';
  const label =
    state === 'ingame' ? `Playing ${friend.status.game?.title ?? '...'}` : state === 'online' ? 'Online' : 'Offline';
  const body = (
    <>
      <Avatar user={friend} size={32} />
      <span className="friend-card-name">
        {friend.displayName}
        <small>{label}</small>
      </span>
      <span className={`presence-dot ${state}`} />
    </>
  );
  return onClick ? (
    <button type="button" className="friend-card" onClick={onClick}>{body}</button>
  ) : (
    <Link className="friend-card" to={`/user/${friend.username}`}>{body}</Link>
  );
}

const ACTIVITY_META = {
  review: { icon: '★', text: (a) => `reviewed ${a.game.title} (${a.rating}/5)` },
  played: {
    icon: '▶',
    text: (a) => `played ${a.game.title}${a.secondsPlayed ? ` - ${Math.max(1, Math.round(a.secondsPlayed / 60))} min total` : ''}`,
  },
  'library-add': { icon: '+', text: (a) => `added ${a.game.title} to their library` },
  friend: { icon: '👥', text: (a) => `became friends with ${a.user.displayName}` },
  comment: { icon: '💬', text: (a) => `received a comment from ${a.user.displayName}` },
};

export function ActivityCard({ item }) {
  const meta = ACTIVITY_META[item.type];
  if (!meta) return null;
  return (
    <article className="activity-card">
      <span className="activity-icon" aria-hidden="true">{meta.icon}</span>
      <div className="activity-body">
        <p>
          {item.game ? <Link to={`/game/${item.game.slug}`}>{meta.text(item)}</Link> : meta.text(item)}
        </p>
        {item.text && <blockquote>{item.text}</blockquote>}
        <time dateTime={item.at}>{new Date(item.at).toLocaleDateString()}</time>
      </div>
      {item.game?.coverUrl && (
        <Link to={`/game/${item.game.slug}`}>
          <img className="activity-media" src={item.game.coverUrl} alt="" />
        </Link>
      )}
    </article>
  );
}
