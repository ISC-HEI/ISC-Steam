import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectDB, dbReady } from './config/db.js';
import { requireDB } from './middleware/requireDB.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import gamesRouter from './routes/games.js';
import adminRouter from './routes/admin.js';

const app = express();
const port = process.env.PORT ?? 5174;

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: dbReady() ? 'connected' : 'disconnected', time: new Date().toISOString() });
});

app.use('/api/auth', requireDB, authRouter);
app.use('/api/games', requireDB, gamesRouter);
app.use('/api/admin', requireDB, adminRouter);

// In production, serve the built client (client/dist) from the same origin.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API route returns index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
connectDB(); // non-blocking: the API is usable immediately, data routes 503 until connected
