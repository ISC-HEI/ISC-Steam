// Hero section: banner, avatar, name, status, bio, action buttons.
import { Avatar } from './ProfileBits.jsx';

export default function ProfileHeader({ profile, onAddFriend, onMessage, onEdit, feedback }) {
  const { user, friendState, isOwn } = profile;
  const state = user.status?.state ?? 'offline';
  const statusText =
    state === 'ingame' ? `Playing ${user.status.game?.title ?? '...'}` : state === 'online' ? 'Online' : 'Offline';

  return (
    <div
      className={`profile-hero${user.bannerUrl ? ' has-banner' : ''}`}
      style={user.bannerUrl ? { backgroundImage: `url(${user.bannerUrl})` } : undefined}
    >
      <div className="profile-hero-scrim">
        <div className="container profile-hero-inner">
          <div className="profile-avatar-wrap">
            <Avatar user={user} size={112} />
            <span className={`presence-dot ${state}`} title={statusText} />
          </div>

          <div className="profile-identity">
            <h1>{user.displayName}</h1>
            <p className="profile-tag">
              @{user.username}
              {user.role === 'student' && <span className="profile-badge">student publisher</span>}
              {user.role === 'admin' && <span className="profile-badge">admin</span>}
              <span className="profile-status">{statusText}</span>
            </p>
            {user.bio && <p className="profile-bio">{user.bio}</p>}
            <p className="profile-member-since">Member since {new Date(user.memberSince).toLocaleDateString()}</p>
          </div>

          <div className="profile-actions">
            {isOwn ? (
              <button type="button" className="btn btn-primary" onClick={onEdit}>Edit profile</button>
            ) : (
              <>
                {friendState === 'friends' && <span className="btn btn-ghost profile-friend-state">Friends ✓</span>}
                {friendState === 'requested' && <span className="btn btn-ghost profile-friend-state">Request sent</span>}
                {(friendState === 'none' || friendState === 'incoming') && (
                  <button type="button" className="btn btn-primary" onClick={onAddFriend}>
                    {friendState === 'incoming' ? 'Accept friend request' : 'Add friend'}
                  </button>
                )}
                {friendState === 'friends' && (
                  <button type="button" className="btn btn-secondary" onClick={onMessage}>Message</button>
                )}
              </>
            )}
            {feedback && <span className="social-feedback">{feedback}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
