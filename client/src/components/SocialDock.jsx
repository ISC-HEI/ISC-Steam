// Bottom-right friends & chat dock, Steam-style.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocial } from '../context/SocialContext.jsx';

function StatusDot({ status }) {
  const state = status?.state ?? 'offline';
  const label =
    state === 'ingame' ? `Playing ${status.game?.title ?? 'a game'}` : state === 'online' ? 'Online' : 'Offline';
  return <span className={`presence-dot ${state}`} title={label} />;
}

function statusText(status) {
  if (status?.state === 'ingame') return `Playing ${status.game?.title ?? '…'}`;
  if (status?.state === 'online') return 'Online';
  return 'Offline';
}

function ChatView({ friend, onBack }) {
  const { user } = useAuth();
  const { chats, sendMessage } = useSocial();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const messages = chats[friend.id] ?? [];

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages.length]);

  async function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      await sendMessage(friend.id, text);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="social-panel-head">
        <button type="button" className="social-back" onClick={onBack} aria-label="Back">←</button>
        <StatusDot status={friend.status} />
        <div className="social-chat-title">
          <strong>{friend.displayName}</strong>
          <span>{statusText(friend.status)}</span>
        </div>
      </div>
      <div className="social-messages" ref={listRef}>
        {messages.length === 0 && <p className="social-empty">Say hi to {friend.displayName}!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg${m.from === String(user.id) ? ' own' : ''}`}>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      {error && <p className="social-error">{error}</p>}
      <form className="social-input-row" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${friend.displayName}…`}
          maxLength={2000}
        />
        <button type="submit" className="btn btn-primary">Send</button>
      </form>
    </>
  );
}

function FriendsView() {
  const {
    friends, incoming, outgoing, unread,
    addFriend, acceptFriend, removeFriend, openChat,
  } = useSocial();
  const [name, setName] = useState('');
  const [feedback, setFeedback] = useState('');

  async function submitAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await addFriend(name.trim());
      setFeedback('Request sent');
      setName('');
    } catch (err) {
      setFeedback(err.message);
    }
  }

  return (
    <>
      <div className="social-panel-head"><strong>Friends</strong></div>

      <form className="social-input-row" onSubmit={submitAdd}>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setFeedback(''); }}
          placeholder="Add by username…"
          maxLength={32}
        />
        <button type="submit" className="btn btn-secondary">Add</button>
      </form>
      {feedback && <p className="social-feedback">{feedback}</p>}

      <div className="social-list">
        {incoming.length > 0 && (
          <>
            <p className="social-section-label">Requests</p>
            {incoming.map((r) => (
              <div key={r.friendshipId} className="social-row">
                <span className="social-name">{r.displayName}</span>
                <span className="social-row-actions">
                  <button type="button" className="btn btn-primary" onClick={() => acceptFriend(r.friendshipId)}>Accept</button>
                  <button type="button" className="btn btn-ghost" onClick={() => removeFriend(r.friendshipId)}>✕</button>
                </span>
              </div>
            ))}
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <p className="social-section-label">Sent</p>
            {outgoing.map((r) => (
              <div key={r.friendshipId} className="social-row muted">
                <span className="social-name">{r.displayName}</span>
                <button type="button" className="btn btn-ghost" onClick={() => removeFriend(r.friendshipId)}>Cancel</button>
              </div>
            ))}
          </>
        )}

        <p className="social-section-label">Friends — {friends.length}</p>
        {friends.length === 0 && <p className="social-empty">No friends yet. Add classmates by username!</p>}
        {[...friends]
          .sort((a, b) => (a.status?.state === 'offline') - (b.status?.state === 'offline'))
          .map((f) => (
            <button type="button" key={f.friendshipId} className="social-row clickable" onClick={() => openChat(f.id)}>
              <StatusDot status={f.status} />
              <span className="social-name">
                {f.displayName}
                <small>{statusText(f.status)}</small>
              </span>
              {unread[f.id] > 0 && <span className="unread-badge">{unread[f.id]}</span>}
            </button>
          ))}
      </div>
    </>
  );
}

export default function SocialDock() {
  const { user } = useAuth();
  const social = useSocial();
  const [open, setOpen] = useState(false);

  if (!user || !social) return null;

  const { totalUnread, onlineCount, activeChat, setActiveChat, friends } = social;
  const chatFriend = activeChat ? friends.find((f) => f.id === activeChat) : null;

  return (
    <div className="social-dock">
      {open && (
        <div className="social-panel">
          {chatFriend
            ? <ChatView friend={chatFriend} onBack={() => setActiveChat(null)} />
            : <FriendsView />}
        </div>
      )}
      <button type="button" className="social-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`presence-dot ${social.playing ? 'ingame' : 'online'}`} />
        Friends ({onlineCount} online)
        {totalUnread > 0 && <span className="unread-badge">{totalUnread}</span>}
      </button>
    </div>
  );
}
