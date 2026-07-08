import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listLibrary, addToLibrary, removeFromLibrary, addPlaytime } from '../controllers/libraryController.js';

const router = Router();

router.use(requireAuth);

router.get('/', listLibrary);
router.post('/:slug', addToLibrary);
router.delete('/:slug', removeFromLibrary);
router.post('/:slug/playtime', addPlaytime);

export default router;
