import User, { SHOWCASE_TYPES } from '../models/User.js';
import Game from '../models/Game.js';
import Review from '../models/Review.js';
import LibraryEntry from '../models/LibraryEntry.js';
import Friendship from '../models/Friendship.js';
import ProfileComment from '../models/ProfileComment.js';
import { statusOf, friendIdsOf } from '../services/presence.js';
import { uploadFromBuffer, openDownload, deleteFile } from '../config/gridfs.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function userCard(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl(),
  };
}

async function findByUsername(username) {
  return User.findOne({ username: String(username).toLowerCase() });
}

/** Games where the user is the publisher, a co-owner, or is listed as an author. */
async function gamesMadeBy(user) {
  const names = [user.username, user.displayName].filter(Boolean).map(
    (n) => new RegExp(`^${escapeRegExp(n)}$`, 'i'),
  );
  return Game.find({
    published: true,
    $or: [{ owner: user._id }, { collaborators: user._id }, { authors: { $in: names } }],
  }).sort({ builtAt: -1 });
}

/* ---------------------------------------------------------------- profile -- */

// GET /api/users/:username - full profile payload
export async function getProfile(req, res, next) {
  try {
    const user = await findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [libraryEntries, reviewCount, friendIds, gamesMade, recentReviews] = await Promise.all([
      LibraryEntry.find({ user: user._id }).sort({ lastPlayedAt: -1 }).populate('game'),
      Review.countDocuments({ user: user._id }),
      friendIdsOf(user._id),
      gamesMadeBy(user),
      Review.find({ user: user._id }).sort({ createdAt: -1 }).limit(5).populate('game', 'slug title media version'),
    ]);

    const hoursPlayed = libraryEntries.reduce((sum, e) => sum + (e.secondsPlayed ?? 0), 0) / 3600;
    const recentGames = libraryEntries
      .filter((e) => e.game && e.lastPlayedAt)
      .slice(0, 6)
      .map((e) => ({
        game: e.game.toStore(),
        secondsPlayed: e.secondsPlayed,
        lastPlayedAt: e.lastPlayedAt,
      }));

    const friends = (await User.find({ _id: { $in: friendIds.slice(0, 12) } })).map((f) => ({
      ...userCard(f),
      status: statusOf(f._id),
    }));

    // friendship state relative to the viewer
    let friendState = 'none';
    if (req.user && !req.user._id.equals(user._id)) {
      const f = await Friendship.between(req.user._id, user._id);
      if (f?.status === 'accepted') friendState = 'friends';
      else if (f) friendState = f.requester.equals(req.user._id) ? 'requested' : 'incoming';
    }

    res.json({
      user: {
        ...userCard(user),
        bio: user.bio,
        bannerUrl: user.bannerUrl(),
        role: user.role,
        memberSince: user.createdAt,
        status: statusOf(user._id),
      },
      stats: {
        gamesOwned: libraryEntries.length,
        hoursPlayed: Math.round(hoursPlayed * 10) / 10,
        gamesMade: gamesMade.length,
        friends: friendIds.length,
        reviews: reviewCount,
      },
      showcases: user.showcases,
      gamesMade: gamesMade.map((g) => g.toStore()),
      recentGames,
      recentReviews: recentReviews
        .filter((r) => r.game)
        .map((r) => ({
          id: r._id.toString(),
          rating: r.rating,
          text: r.text,
          createdAt: r.createdAt,
          game: { slug: r.game.slug, title: r.game.title },
        })),
      friends,
      friendState,
      isOwn: !!req.user && req.user._id.equals(user._id),
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/:username/activity - merged timeline
export async function getActivity(req, res, next) {
  try {
    const user = await findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [reviews, entries, friendships, comments] = await Promise.all([
      Review.find({ user: user._id }).sort({ createdAt: -1 }).limit(15).populate('game', 'slug title media'),
      LibraryEntry.find({ user: user._id }).sort({ updatedAt: -1 }).limit(20).populate('game'),
      Friendship.find({ status: 'accepted', $or: [{ requester: user._id }, { recipient: user._id }] })
        .sort({ updatedAt: -1 })
        .limit(10)
        .populate('requester', 'username displayName avatarFileId updatedAt')
        .populate('recipient', 'username displayName avatarFileId updatedAt'),
      ProfileComment.find({ profile: user._id }).sort({ createdAt: -1 }).limit(10)
        .populate('author', 'username displayName avatarFileId updatedAt'),
    ]);

    const items = [];

    for (const r of reviews) {
      if (!r.game) continue;
      items.push({
        type: 'review',
        at: r.createdAt,
        rating: r.rating,
        text: r.text.slice(0, 200),
        game: { slug: r.game.slug, title: r.game.title, coverUrl: coverOf(r.game) },
      });
    }
    for (const e of entries) {
      if (!e.game) continue;
      const game = { slug: e.game.slug, title: e.game.title, coverUrl: coverOf(e.game) };
      if (e.lastPlayedAt) {
        items.push({ type: 'played', at: e.lastPlayedAt, secondsPlayed: e.secondsPlayed, game });
      }
      items.push({ type: 'library-add', at: e.createdAt, game });
    }
    for (const f of friendships) {
      const other = f.requester._id.equals(user._id) ? f.recipient : f.requester;
      items.push({ type: 'friend', at: f.updatedAt, user: userCard(other) });
    }
    for (const c of comments) {
      items.push({ type: 'comment', at: c.createdAt, user: userCard(c.author), text: c.text.slice(0, 200) });
    }

    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ activity: items.slice(0, 30) });
  } catch (err) {
    next(err);
  }
}

function coverOf(game) {
  const cover = game.media?.find((m) => m.kind === 'cover');
  return cover ? `/api/games/${game.slug}/media/${cover._id}` : null;
}

// GET /api/users/resolve?names=a,b,c - map author names to profile usernames
export async function resolveNames(req, res, next) {
  try {
    const names = String(req.query.names ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 20);
    const out = {};
    for (const name of names) {
      const re = new RegExp(`^${escapeRegExp(name)}$`, 'i');
      const user = await User.findOne({ $or: [{ username: re }, { displayName: re }] });
      if (user) out[name] = user.username;
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------ own profile -- */

// PATCH /api/users/me/profile { displayName?, bio?, showcases? }
export async function updateProfile(req, res, next) {
  try {
    const user = req.user;
    if (typeof req.body.displayName === 'string') user.displayName = req.body.displayName.trim().slice(0, 80);
    if (typeof req.body.bio === 'string') user.bio = req.body.bio.trim().slice(0, 500);
    if (Array.isArray(req.body.showcases)) {
      user.showcases = req.body.showcases
        .filter((s) => s && SHOWCASE_TYPES.includes(s.type))
        .slice(0, 8)
        .map((s) => ({
          type: s.type,
          title: String(s.title ?? '').slice(0, 80),
          text: String(s.text ?? '').slice(0, 2000),
          gameSlug: String(s.gameSlug ?? '').toLowerCase().slice(0, 100),
        }));
    }
    await user.save();
    res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
}

function makeImageUploader(field) {
  return async function uploadImage(req, res, next) {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Image file required' });
      if (!IMAGE_TYPES.has(file.mimetype)) {
        return res.status(400).json({ error: 'Image must be PNG, JPG, GIF or WebP' });
      }
      const old = req.user[field];
      req.user[field] = await uploadFromBuffer(
        file.buffer,
        `${req.user.username}-${field}-${Date.now()}`,
        file.mimetype,
      );
      await req.user.save();
      if (old) await deleteFile(old);
      res.json({ user: req.user.toPublic() });
    } catch (err) {
      next(err);
    }
  };
}

export const uploadAvatar = makeImageUploader('avatarFileId');
export const uploadBanner = makeImageUploader('bannerFileId');

function makeImageStreamer(field) {
  return async function streamImage(req, res, next) {
    try {
      const user = await findByUsername(req.params.username);
      if (!user || !user[field]) return res.status(404).json({ error: 'Not found' });
      res.set('Cache-Control', 'public, max-age=86400');
      openDownload(user[field])
        .on('error', () => res.status(404).end())
        .pipe(res);
    } catch (err) {
      next(err);
    }
  };
}

export const getAvatar = makeImageStreamer('avatarFileId');
export const getBanner = makeImageStreamer('bannerFileId');

/* --------------------------------------------------------------- comments -- */

// GET /api/users/:username/comments
export async function listComments(req, res, next) {
  try {
    const user = await findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const comments = await ProfileComment.find({ profile: user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('author', 'username displayName avatarFileId updatedAt');
    res.json({
      comments: comments.map((c) => ({
        id: c._id.toString(),
        author: userCard(c.author),
        text: c.text,
        likes: c.likes.length,
        likedByMe: req.user ? c.likes.some((id) => id.equals(req.user._id)) : false,
        mine: req.user ? c.author._id.equals(req.user._id) : false,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/users/:username/comments { text }
export async function addComment(req, res, next) {
  try {
    const user = await findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const text = String(req.body.text ?? '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Empty comment' });
    const comment = await ProfileComment.create({ profile: user._id, author: req.user._id, text });
    res.status(201).json({ id: comment._id.toString() });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/users/:username/comments/:commentId - author, profile owner, or admin
export async function deleteComment(req, res, next) {
  try {
    const user = await findByUsername(req.params.username);
    const comment = await ProfileComment.findById(req.params.commentId);
    if (!user || !comment || !comment.profile.equals(user._id)) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const allowed =
      req.user.role === 'admin' ||
      comment.author.equals(req.user._id) ||
      comment.profile.equals(req.user._id);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    await comment.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// POST /api/users/:username/comments/:commentId/like - toggle
export async function likeComment(req, res, next) {
  try {
    const comment = await ProfileComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const liked = comment.likes.some((id) => id.equals(req.user._id));
    if (liked) comment.likes = comment.likes.filter((id) => !id.equals(req.user._id));
    else comment.likes.push(req.user._id);
    await comment.save();
    res.json({ likes: comment.likes.length, likedByMe: !liked });
  } catch (err) {
    next(err);
  }
}
