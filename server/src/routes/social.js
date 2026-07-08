import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listFriends, addFriend, acceptFriend, removeFriend,
  listMessages, sendMessage, markRead,
} from '../controllers/socialController.js';

const router = Router();

router.use(requireAuth);

router.get('/friends', listFriends);
router.post('/friends', addFriend);
router.post('/friends/:friendshipId/accept', acceptFriend);
router.delete('/friends/:friendshipId', removeFriend);

router.get('/messages/:userId', listMessages);
router.post('/messages/:userId', sendMessage);
router.post('/messages/:userId/read', markRead);

export default router;
