import Game from '../models/Game.js';
import Review from '../models/Review.js';

async function findGame(slug) {
  return Game.findOne({ slug: String(slug).toLowerCase() });
}

/** GET /api/games/:slug/reviews */
export async function listReviews(req, res) {
  const game = await findGame(req.params.slug);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const reviews = await Review.find({ game: game._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('user', 'username displayName');

  const count = reviews.length;
  const average = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : null;

  res.json({
    average,
    count,
    reviews: reviews.map((r) => ({
      id: r._id.toString(),
      user: {
        id: r.user._id.toString(),
        username: r.user.username,
        displayName: r.user.displayName || r.user.username,
      },
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      mine: req.user ? r.user._id.equals(req.user._id) : false,
    })),
  });
}

/** POST /api/games/:slug/reviews { rating, text } — creates or updates the caller's review. */
export async function upsertReview(req, res) {
  const game = await findGame(req.params.slug);
  if (!game || !game.published) return res.status(404).json({ error: 'Game not found' });

  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
  }
  const text = String(req.body.text ?? '').trim().slice(0, 4000);

  const review = await Review.findOneAndUpdate(
    { user: req.user._id, game: game._id },
    { $set: { rating, text } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.status(201).json({ ok: true, id: review._id.toString() });
}

/** DELETE /api/games/:slug/reviews — deletes the caller's review (admins can pass ?user=id). */
export async function deleteReview(req, res) {
  const game = await findGame(req.params.slug);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const target = req.user.role === 'admin' && req.query.user ? req.query.user : req.user._id;
  await Review.deleteOne({ user: target, game: game._id });
  res.status(204).end();
}
