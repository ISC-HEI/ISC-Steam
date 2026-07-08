import User from '../models/User.js';
import Friendship from '../models/Friendship.js';
import Message from '../models/Message.js';
import { statusOf, emitToUser } from '../services/presence.js';

function userCard(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
  };
}

/** GET /api/social/friends — friends with live status + pending requests + unread counts. */
export async function listFriends(req, res) {
  const me = req.user._id;

  const friendships = await Friendship.find({
    $or: [{ requester: me }, { recipient: me }],
  })
    .populate('requester', 'username displayName')
    .populate('recipient', 'username displayName');

  const friends = [];
  const incoming = [];
  const outgoing = [];

  for (const f of friendships) {
    const iAmRequester = f.requester._id.equals(me);
    const other = iAmRequester ? f.recipient : f.requester;
    const item = { friendshipId: f._id.toString(), ...userCard(other) };

    if (f.status === 'accepted') friends.push({ ...item, status: statusOf(other._id) });
    else if (iAmRequester) outgoing.push(item);
    else incoming.push(item);
  }

  // unread message counts per sender
  const unreadRows = await Message.aggregate([
    { $match: { to: me, readAt: null } },
    { $group: { _id: '$from', count: { $sum: 1 } } },
  ]);
  const unread = Object.fromEntries(unreadRows.map((r) => [r._id.toString(), r.count]));

  res.json({ friends, incoming, outgoing, unread });
}

/** POST /api/social/friends { username } — send a request (auto-accepts if they already asked). */
export async function addFriend(req, res) {
  const username = String(req.body.username ?? '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (username === req.user.username) return res.status(400).json({ error: "That's you" });

  const other = await User.findOne({ username });
  if (!other) return res.status(404).json({ error: 'No user with that username' });

  const existing = await Friendship.between(req.user._id, other._id);
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
    if (existing.requester.equals(req.user._id)) return res.status(409).json({ error: 'Request already sent' });
    // they asked us first → accept
    existing.status = 'accepted';
    await existing.save();
    emitToUser(other._id, 'friends-changed', {});
    return res.json({ accepted: true });
  }

  await Friendship.create({ requester: req.user._id, recipient: other._id });
  emitToUser(other._id, 'friends-changed', {});
  res.status(201).json({ requested: true });
}

/** POST /api/social/friends/:friendshipId/accept */
export async function acceptFriend(req, res) {
  const f = await Friendship.findById(req.params.friendshipId);
  if (!f || !f.recipient.equals(req.user._id)) return res.status(404).json({ error: 'Request not found' });
  f.status = 'accepted';
  await f.save();
  emitToUser(f.requester, 'friends-changed', {});
  res.json({ ok: true });
}

/** DELETE /api/social/friends/:friendshipId — decline, cancel, or unfriend. */
export async function removeFriend(req, res) {
  const f = await Friendship.findById(req.params.friendshipId);
  if (!f || (!f.requester.equals(req.user._id) && !f.recipient.equals(req.user._id))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const other = f.requester.equals(req.user._id) ? f.recipient : f.requester;
  await f.deleteOne();
  emitToUser(other, 'friends-changed', {});
  res.status(204).end();
}

async function assertFriends(me, otherId) {
  const f = await Friendship.between(me, otherId);
  return f?.status === 'accepted';
}

/** GET /api/social/messages/:userId — last 50 messages with that friend, oldest first. */
export async function listMessages(req, res) {
  const other = req.params.userId;
  if (!(await assertFriends(req.user._id, other))) {
    return res.status(403).json({ error: 'You can only chat with friends' });
  }
  const messages = await Message.find({
    $or: [
      { from: req.user._id, to: other },
      { from: other, to: req.user._id },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({ messages: messages.reverse().map((m) => m.toPublic()) });
}

/** POST /api/social/messages/:userId { text } */
export async function sendMessage(req, res) {
  const other = req.params.userId;
  const text = String(req.body.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Empty message' });
  if (!(await assertFriends(req.user._id, other))) {
    return res.status(403).json({ error: 'You can only chat with friends' });
  }

  const message = await Message.create({ from: req.user._id, to: other, text: text.slice(0, 2000) });
  const payload = message.toPublic();

  emitToUser(other, 'message', payload);
  emitToUser(req.user._id, 'message', payload); // sender's other tabs
  res.status(201).json({ message: payload });
}

/** POST /api/social/messages/:userId/read — mark everything from them as read. */
export async function markRead(req, res) {
  await Message.updateMany(
    { from: req.params.userId, to: req.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  res.json({ ok: true });
}
