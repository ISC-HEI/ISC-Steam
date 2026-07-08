import { Router } from 'express';
import multer from 'multer';
import {
  listGames, listTags, getGame, getMedia, downloadGame,
  inspectRepo, createGame, listMine, rebuildGame, updateGame, deleteGame,
} from '../controllers/gameController.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { listReviews, upsertReview, deleteReview } from '../controllers/reviewController.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 8,
  },
});
const gameUpload = upload.fields([
  { name: 'package', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
  { name: 'screenshots', maxCount: 6 },
]);

// store (public)
router.get('/', listGames);
router.get('/tags', listTags);
router.get('/mine', requireAuth, requireRole('student'), listMine);
router.get('/:slug', optionalAuth, getGame);
router.get('/:slug/media/:mediaId', getMedia);

// downloads require an account (any role)
router.get('/:slug/download', requireAuth, downloadGame);

// reviews
router.get('/:slug/reviews', optionalAuth, listReviews);
router.post('/:slug/reviews', requireAuth, upsertReview);
router.delete('/:slug/reviews', requireAuth, deleteReview);

// publishing (students & admins)
router.post('/inspect-repo', requireAuth, requireRole('student'), inspectRepo);
router.post('/', requireAuth, requireRole('student'), gameUpload, createGame);
router.post('/:slug/rebuild', requireAuth, requireRole('student'), rebuildGame);
router.patch('/:slug', requireAuth, requireRole('student'), gameUpload, updateGame);
router.delete('/:slug', requireAuth, requireRole('student'), deleteGame);

export default router;
