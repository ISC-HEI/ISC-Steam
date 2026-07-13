// Realtime social state: socket.io connection, friends + presence, chats,
// unread counts, and (in the desktop app) the currently running game.
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { api, getToken } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const SocialContext = createContext(null);

export function SocialProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [unread, setUnread] = useState({});
  const [chats, setChats] = useState({}); // userId -> [messages]
  const [activeChat, setActiveChat] = useState(null); // userId | null
  const [playing, setPlaying] = useState(null); // {slug,title} | null
  const [collabCount, setCollabCount] = useState(0); // pending co-ownership requests on my games
  const [dockOpen, setDockOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [appearOffline, setAppearOfflineState] = useState(
    () => localStorage.getItem('appearOffline') === '1',
  );

  const setAppearOffline = useCallback((value) => {
    setAppearOfflineState(value);
    localStorage.setItem('appearOffline', value ? '1' : '0');
  }, []);

  // AFK detection: no interaction for 5 minutes -> idle
  useEffect(() => {
    if (!user) return undefined;
    let timer;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 5 * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll'];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    reset();
    return () => {
      clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeChatRef = useRef(null);
  activeChatRef.current = activeChat;
  const friendsRef = useRef([]);
  friendsRef.current = friends;

  // native (Windows/macOS) notifications for incoming messages
  useEffect(() => {
    if (!user || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, [user?.id]);

  const notifyMessage = useCallback((m) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const sender = friendsRef.current.find((f) => f.id === m.from);
    const title = sender?.displayName ?? 'New message';
    const body = m.text || (m.imageUrl ? '📷 Sent an image' : 'New message');
    try {
      const n = new Notification(title, {
        body,
        icon: sender?.avatarUrl ?? '/favicon.svg',
        tag: `msg-${m.from}`, // collapse repeated notifications from the same sender
      });
      n.onclick = () => {
        window.focus();
        openChat(m.from); // safe: assigned before any notification can fire
        setDockOpen(true);
      };
    } catch {
      /* Notification constructor can throw on some platforms */
    }
  }, []);

  const refresh = useCallback(() => {
    if (!getToken()) return;
    api
      .get('/social/friends')
      .then((d) => {
        setFriends(d.friends);
        setIncoming(d.incoming);
        setOutgoing(d.outgoing);
        setUnread(d.unread);
      })
      .catch(() => {});
  }, []);

  // socket lifecycle, tied to the signed-in user
  useEffect(() => {
    if (!user) {
      setSocket(null);
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setUnread({});
      setChats({});
      setActiveChat(null);
      return undefined;
    }

    const s = io({ auth: { token: getToken() } });
    setSocket(s);
    refresh();

    s.on('connect', refresh);
    s.on('friends-changed', refresh);

    s.on('presence', (p) => {
      setFriends((fs) =>
        fs.map((f) => (f.id === p.userId ? { ...f, status: { state: p.state, game: p.game } } : f)),
      );
    });

    s.on('message', (m) => {
      const myId = String(user.id);
      const other = m.from === myId ? m.to : m.from;
      setChats((c) => ({ ...c, [other]: [...(c[other] ?? []), m] }));
      if (m.from !== myId) {
        if (activeChatRef.current === other) {
          api.post(`/social/messages/${other}/read`).catch(() => {});
        } else {
          setUnread((u) => ({ ...u, [m.from]: (u[m.from] ?? 0) + 1 }));
        }
        // native toast only when the app is minimized / in a background tab
        if (document.hidden) notifyMessage(m);
      }
    });

    return () => s.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // desktop launcher events: game started / exited
  useEffect(() => {
    const bridge = window.iscSteam;
    if (!bridge?.onGameEvent) return undefined;
    return bridge.onGameEvent((ev) => {
      if (ev.type === 'started') setPlaying({ slug: ev.slug, title: ev.title });
      if (ev.type === 'exited') {
        setPlaying(null);
        if (ev.seconds >= 5) {
          api.post(`/library/${ev.slug}/playtime`, { seconds: ev.seconds }).catch(() => {});
        }
      }
    });
  }, []);

  // tell friends what we're playing and whether we're online / idle / invisible
  useEffect(() => {
    if (!socket) return;
    socket.emit('status', {
      game: playing,
      mode: appearOffline ? 'invisible' : idle ? 'idle' : 'online',
    });
  }, [socket, playing, idle, appearOffline]);

  const addFriend = useCallback(async (username) => {
    await api.post('/social/friends', { username });
    refresh();
  }, [refresh]);

  const acceptFriend = useCallback(async (friendshipId) => {
    await api.post(`/social/friends/${friendshipId}/accept`);
    refresh();
  }, [refresh]);

  const removeFriend = useCallback(async (friendshipId) => {
    await api.delete(`/social/friends/${friendshipId}`);
    refresh();
  }, [refresh]);

  const openChat = useCallback((userId) => {
    setActiveChat(userId);
    setUnread((u) => ({ ...u, [userId]: 0 }));
    api.post(`/social/messages/${userId}/read`).catch(() => {});
    setChats((c) => {
      if (c[userId]) return c;
      api
        .get(`/social/messages/${userId}`)
        .then((d) => setChats((cc) => ({ ...cc, [userId]: d.messages })))
        .catch(() => {});
      return { ...c, [userId]: [] };
    });
  }, []);

  const sendMessage = useCallback(async (userId, text) => {
    await api.post(`/social/messages/${userId}`, { text });
    // the server echoes the message back over the socket; no local append needed
  }, []);

  // poll pending co-ownership requests (students/admins only)
  const refreshCollab = useCallback(() => {
    api.get('/games/collab-requests')
      .then((rs) => setCollabCount(Array.isArray(rs) ? rs.length : 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const canManage = user?.role === 'student' || user?.role === 'admin';
    if (!canManage) {
      setCollabCount(0);
      return undefined;
    }
    refreshCollab();
    const id = setInterval(refreshCollab, 45000);
    return () => clearInterval(id);
  }, [user?.id, user?.role, refreshCollab]);

  const sendImage = useCallback(async (userId, file) => {
    const form = new FormData();
    form.append('image', file);
    await api.postForm(`/social/messages/${userId}/image`, form);
  }, []);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const onlineCount = friends.filter((f) => f.status?.state !== 'offline').length;

  // unread badge: favicon dot + title count in the browser, taskbar badge on desktop
  useEffect(() => {
    const link = document.querySelector('link[rel="icon"]');
    if (link && !link.dataset.originalHref) {
      link.dataset.originalHref = link.href;
      link.dataset.originalType = link.type ?? '';
    }
    document.title = document.title.replace(/^\(\d+\+?\)\s*/, '');
    if (totalUnread > 0) document.title = `(${totalUnread > 99 ? '99+' : totalUnread}) ${document.title}`;

    window.iscSteam?.setBadge?.(totalUnread);

    if (!link) return;
    if (totalUnread === 0) {
      link.href = link.dataset.originalHref;
      link.type = link.dataset.originalType;
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);
      ctx.beginPath();
      ctx.arc(46, 18, 16, 0, 2 * Math.PI);
      ctx.fillStyle = '#e5484d';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(totalUnread > 9 ? '9+' : String(totalUnread), 46, 19);
      link.type = 'image/png';
      link.href = c.toDataURL('image/png');
    };
    img.src = link.dataset.originalHref;
  }, [totalUnread]);

  return (
    <SocialContext.Provider
      value={{
        friends, incoming, outgoing, unread, totalUnread, onlineCount,
        chats, activeChat, setActiveChat, openChat, sendMessage, sendImage,
        addFriend, acceptFriend, removeFriend,
        playing, dockOpen, setDockOpen,
        idle, appearOffline, setAppearOffline,
        collabCount, refreshCollab,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  return useContext(SocialContext);
}
