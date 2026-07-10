import { Router } from 'express';
import multer from 'multer';
import {
  listGames, listTags, getGame, getMedia, downloadGame,
  inspectRepo, createGame, listMine, rebuildGame, updateGame, deleteGame,
  requestCollab, listIncomingCollab, acceptCollab, declineCollab, removeCollaborator,
} from '../controllers/gameController.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { listReviews, upsertReview, deleteReview } from '../controllers/reviewController.js';
import { UPLOAD_LIMITS } from '../config/uploadLimits.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: UPLOAD_LIMITS.gamePackage,
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
// co-ownership requests waiting on games I manage (must precede /:slug)
router.get('/collab-requests', requireAuth, requireRole('student'), listIncomingCollab);
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

// co-ownership: request, then owner/co-owner accepts, declines, or removes
router.post('/:slug/collab-request', requireAuth, requireRole('student'), requestCollab);
router.post('/:slug/collab-request/:userId/accept', requireAuth, requireRole('student'), acceptCollab);
router.post('/:slug/collab-request/:userId/decline', requireAuth, requireRole('student'), declineCollab);
router.delete('/:slug/collaborators/:userId', requireAuth, requireRole('student'), removeCollaborator);

export default router;
