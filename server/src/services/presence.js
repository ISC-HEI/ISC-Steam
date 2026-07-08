// Realtime layer: socket.io with JWT auth. Tracks who is online / in game and
// pushes presence changes, chat messages and friend events to connected users.
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Friendship from '../models/Friendship.js';

const SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';

// userId -> { sockets: Set<Socket>, game: {slug,title} | null }
const online = new Map();
let io = null;

export function statusOf(userId) {
  const entry = online.get(String(userId));
  if (!entry) return { state: 'offline', game: null };
  return entry.game ? { state: 'ingame', game: entry.game } : { state: 'online', game: null };
}

export async function friendIdsOf(userId) {
  const friendships = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { recipient: userId }],
  });
  return friendships.map((f) =>
    f.requester.toString() === String(userId) ? f.recipient.toString() : f.requester.toString(),
  );
}

/** Sends an event to every open socket of one user (all tabs / the desktop app). */
export function emitToUser(userId, event, payload) {
  const entry = online.get(String(userId));
  if (!entry) return;
  for (const socket of entry.sockets) socket.emit(event, payload);
}

async function broadcastPresence(userId) {
  const payload = { userId: String(userId), ...statusOf(userId) };
  emitToUser(userId, 'presence', payload); // the user's own other tabs
  for (const friendId of await friendIdsOf(userId)) {
    emitToUser(friendId, 'presence', payload);
  }
}

export function initPresence(httpServer, corsOrigin) {
  io = new Server(httpServer, { cors: { origin: corsOrigin } });

  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, SECRET);
      socket.userId = String(payload.sub);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const id = socket.userId;
    let entry = online.get(id);
    const cameOnline = !entry;

    if (!entry) {
      entry = { sockets: new Set(), game: null };
      online.set(id, entry);
    }
    entry.sockets.add(socket);
    if (cameOnline) void broadcastPresence(id).catch(() => {});

    // Desktop launcher reports what the user is playing: { game: {slug,title} | null }
    socket.on('status', (data) => {
      const game =
        data?.game && typeof data.game.slug === 'string'
          ? {
              slug: String(data.game.slug).slice(0, 100),
              title: String(data.game.title ?? data.game.slug).slice(0, 120),
            }
          : null;
      entry.game = game;
      void broadcastPresence(id).catch(() => {});
    });

    socket.on('disconnect', () => {
      entry.sockets.delete(socket);
      if (entry.sockets.size === 0) {
        online.delete(id);
        void broadcastPresence(id).catch(() => {});
      }
    });
  });

  return io;
}
