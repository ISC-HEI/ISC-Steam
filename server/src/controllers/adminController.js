import User, { ROLES } from '../models/User.js';
import Game from '../models/Game.js';

// GET /api/admin/users
export async function listUsers(req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users.map((u) => u.toPublic()));
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/users/:id  { role }
export async function setRole(req, res, next) {
  try {
    if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: 'You cannot change your own role' });
    const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.toPublic());
  } catch (err) {
    next(err);
  }
}

// DELETE /api/admin/users/:id
export async function deleteUser(req, res, next) {
  try {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: 'You cannot delete yourself' });
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/games - every game, any status (moderation queue)
export async function listAllGames(req, res, next) {
  try {
    const games = await Game.find().sort({ updatedAt: -1 }).populate('owner', 'username displayName');
    res.json(games.map((g) => ({
      ...g.toStore(),
      buildLog: g.buildLog,
      commit: g.commit,
      branch: g.branch,
      owner: { id: g.owner?._id, username: g.owner?.username, displayName: g.owner?.displayName || g.owner?.username },
    })));
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/stats - topbar numbers for the admin page
export async function stats(req, res, next) {
  try {
    const [users, games, published, downloads] = await Promise.all([
      User.estimatedDocumentCount(),
      Game.estimatedDocumentCount(),
      Game.countDocuments({ published: true }),
      Game.aggregate([{ $group: { _id: null, total: { $sum: '$downloads' } } }]),
    ]);
    res.json({ users, games, published, downloads: downloads[0]?.total ?? 0 });
  } catch (err) {
    next(err);
  }
}
