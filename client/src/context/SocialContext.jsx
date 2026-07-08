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

  const activeChatRef = useRef(null);
  activeChatRef.current = activeChat;

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

  // tell friends what we're playing
  useEffect(() => {
    if (socket) socket.emit('status', { game: playing });
  }, [socket, playing]);

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

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const onlineCount = friends.filter((f) => f.status?.state !== 'offline').length;

  return (
    <SocialContext.Provider
      value={{
        friends, incoming, outgoing, unread, totalUnread, onlineCount,
        chats, activeChat, setActiveChat, openChat, sendMessage,
        addFriend, acceptFriend, removeFriend,
        playing,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  return useContext(SocialContext);
}
