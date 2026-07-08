import Game from '../models/Game.js';
import LibraryEntry from '../models/LibraryEntry.js';

/** GET /api/library — the caller's games, with playtime. */
export async function listLibrary(req, res) {
  const entries = await LibraryEntry.find({ user: req.user._id })
    .sort({ lastPlayedAt: -1, createdAt: -1 })
    .populate('game');

  res.json({
    entries: entries
      .filter((e) => e.game) // game may have been deleted
      .map((e) => ({
        addedAt: e.createdAt,
        secondsPlayed: e.secondsPlayed,
        lastPlayedAt: e.lastPlayedAt,
        game: e.game.toStore(),
      })),
  });
}

/** POST /api/library/:slug — add a game to the caller's library. */
export async function addToLibrary(req, res) {
  const game = await Game.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!game || !game.published) return res.status(404).json({ error: 'Game not found' });

  await LibraryEntry.updateOne(
    { user: req.user._id, game: game._id },
    { $setOnInsert: { secondsPlayed: 0 } },
    { upsert: true },
  );
  res.status(201).json({ ok: true });
}

/** DELETE /api/library/:slug */
export async function removeFromLibrary(req, res) {
  const game = await Game.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (game) await LibraryEntry.deleteOne({ user: req.user._id, game: game._id });
  res.status(204).end();
}

/** POST /api/library/:slug/playtime { seconds } — reported by the desktop launcher after a session. */
export async function addPlaytime(req, res) {
  const game = await Game.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const seconds = Math.min(Math.max(Math.floor(Number(req.body.seconds) || 0), 0), 24 * 3600);

  await LibraryEntry.updateOne(
    { user: req.user._id, game: game._id },
    { $inc: { secondsPlayed: seconds }, $set: { lastPlayedAt: new Date() } },
    { upsert: true },
  );
  res.json({ ok: true });
}
