import Game from '../models/Game.js';
import { enqueueBuild } from '../services/pipeline.js';
import { readManifest } from '../services/manifest.js';
import { uploadFromBuffer, openDownload, fileInfo, deleteFile } from '../config/gridfs.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const REPO_URL_RE = /^https:\/\/(github\.com|gitlab\.com|githepia\.hesge\.ch)\/[\w.-]+\/[\w.-]+?(\.git)?$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const PACKAGE_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/java-archive',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/octet-stream',
]);
const execFileAsync = promisify(execFile);

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

function canManage(user, game) {
  return user && (user.role === 'admin' || game.owner.toString() === user._id.toString());
}

function metadataFromBody(body, fallback = {}) {
  const title = String(body.title ?? fallback.title ?? '').trim().slice(0, 80);
  const shortDescription = String(body.shortDescription ?? fallback.shortDescription ?? '').trim().slice(0, 200);
  if (!title) throw Object.assign(new Error('Title is required'), { status: 400 });
  if (!shortDescription) throw Object.assign(new Error('Short description is required'), { status: 400 });

  return {
    title,
    shortDescription,
    description: String(body.description ?? fallback.description ?? shortDescription).trim().slice(0, 8000),
    version: String(body.version ?? fallback.version ?? '1.0.0').trim().slice(0, 30) || '1.0.0',
    authors: parseList(body.authors ?? fallback.authors).slice(0, 10),
    tags: parseList(body.tags ?? fallback.tags).map((t) => t.toLowerCase()).slice(0, 8),
    controls: String(body.controls ?? fallback.controls ?? '').trim().slice(0, 300),
    year: parseYear(body.year ?? fallback.year),
    engine: {
      name: String(body.engineName ?? fallback.engine?.name ?? 'fungraphics').trim().toLowerCase() || 'fungraphics',
      version: String(body.engineVersion ?? fallback.engine?.version ?? '').trim().slice(0, 40),
    },
  };
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((v) => v.trim()).filter(Boolean);
  } catch {
    /* comma/newline-separated fallback */
  }
  return String(value)
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseYear(value) {
  if (value === '' || value == null) return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw Object.assign(new Error('Year must be between 2000 and 2100'), { status: 400 });
  }
  return year;
}

function publicMetadata(m) {
  return {
    title: m.title,
    shortDescription: m.shortDescription,
    description: m.description,
    version: m.version,
    authors: m.authors,
    tags: m.tags,
    controls: m.controls,
    year: m.year,
    engineName: m.engine?.name ?? 'fungraphics',
    engineVersion: m.engine?.version ?? '',
    inferred: !!m.inferred,
  };
}

async function addUploadedImages(game, files = {}, { replace = false } = {}) {
  const cover = files.cover?.[0];
  const screenshots = files.screenshots ?? [];
  if (!cover && screenshots.length === 0) return false;

  if (replace) {
    const oldMedia = game.media;
    game.media = [];
    for (const media of oldMedia) await deleteFile(media.fileId);
  } else if (cover) {
    const oldCovers = game.media.filter((m) => m.kind === 'cover');
    game.media = game.media.filter((m) => m.kind !== 'cover');
    for (const media of oldCovers) await deleteFile(media.fileId);
  }

  if (cover) await addImage(game, cover, 'cover');
  for (const shot of screenshots.slice(0, 6)) await addImage(game, shot, 'screenshot');
  game.mediaLocked = true;
  return true;
}

async function addImage(game, file, kind) {
  if (!IMAGE_TYPES.has(file.mimetype)) {
    throw Object.assign(new Error(`${kind} must be a PNG, JPG, GIF or WebP image`), { status: 400 });
  }
  const ext = path.extname(file.originalname || '').toLowerCase() || imageExt(file.mimetype);
  const fileId = await uploadFromBuffer(file.buffer, `${game.slug}-${kind}-${Date.now()}${ext}`, file.mimetype);
  game.media.push({ fileId, contentType: file.mimetype, kind });
}

function imageExt(type) {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[type] ?? '.img';
}

function validateUploads(files = {}, { requirePackage = false } = {}) {
  if (requirePackage && !files.package?.[0]) {
    throw Object.assign(new Error('Executable/package file is required'), { status: 400 });
  }
  for (const file of [files.cover?.[0], ...(files.screenshots ?? [])].filter(Boolean)) {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      throw Object.assign(new Error('Images must be PNG, JPG, GIF or WebP files'), { status: 400 });
    }
  }
  if (files.package?.[0] && !isPackageFile(files.package[0])) {
    throw Object.assign(new Error('Executable upload must be a zip, jar, exe, or binary file'), { status: 400 });
  }
}

async function replacePackage(game, file) {
  if (!file) throw Object.assign(new Error('Executable/package file is required'), { status: 400 });
  if (!isPackageFile(file)) {
    throw Object.assign(new Error('Executable upload must be a zip, jar, exe, or binary file'), { status: 400 });
  }
  if (game.packageFileId) await deleteFile(game.packageFileId);
  game.packageFileId = await uploadFromBuffer(file.buffer, `${game.slug}-${file.originalname}`, file.mimetype);
  game.packageFilename = file.originalname || `${game.slug}.zip`;
  game.packageContentType = file.mimetype || 'application/octet-stream';
  game.packageSize = file.size;
  game.buildStatus = 'success';
  game.buildLog = `Uploaded executable/package: ${game.packageFilename}`;
  game.builtAt = new Date();
}

function isPackageFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return PACKAGE_TYPES.has(file.mimetype) || ['.zip', '.jar', '.exe'].includes(ext);
}

async function inspectRepoMetadata(repoUrl, branch = '') {
  const work = await mkdtemp(path.join(tmpdir(), 'isc-inspect-'));
  const repoDir = path.join(work, 'repo');
  try {
    await execFileAsync('git', [
      'clone',
      '--depth',
      '1',
      ...(branch ? ['--branch', branch] : []),
      repoUrl,
      repoDir,
    ], { timeout: 60000, maxBuffer: 1024 * 1024 * 5 });
    try {
      return await readManifest(repoDir, slugify(repoUrl.split('/').pop().replace(/\.git$/, '')));
    } catch (err) {
      const raw = await readFile(path.join(repoDir, 'isc.json'), 'utf8').catch(() => '');
      if (!raw) throw err;
      const manifest = JSON.parse(raw);
      return metadataFromBody({
        title: manifest.title,
        shortDescription: manifest.shortDescription,
        description: manifest.description,
        version: manifest.version,
        authors: manifest.authors,
        tags: manifest.tags,
        controls: manifest.controls,
        year: manifest.year,
        engineName: manifest.engine?.name,
        engineVersion: manifest.engine?.version,
      }, {
        title: slugify(repoUrl.split('/').pop().replace(/\.git$/, '')) || 'ISC Game',
        shortDescription: 'Imported from isc.json.',
      });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ store -- */

// GET /api/games?search=&tag=&sort=new|popular|title&featured=1
export async function listGames(req, res, next) {
  try {
    const filter = { published: true, buildStatus: 'success' };
    if (req.query.tag) filter.tags = String(req.query.tag).toLowerCase();
    if (req.query.featured) filter.featured = true;
    if (req.query.search) filter.$text = { $search: String(req.query.search) };

    const sort = { popular: { downloads: -1 }, title: { title: 1 }, new: { builtAt: -1 } }[req.query.sort] ?? { featured: -1, builtAt: -1 };
    const games = await Game.find(filter).sort(sort).limit(100);
    res.json(games.map((g) => g.toStore()));
  } catch (err) {
    next(err);
  }
}

// GET /api/games/tags — distinct tags across published games (for filters)
export async function listTags(req, res, next) {
  try {
    const tags = await Game.distinct('tags', { published: true });
    res.json(tags.sort());
  } catch (err) {
    next(err);
  }
}

// GET /api/games/:slug
export async function getGame(req, res, next) {
  try {
    const game = await Game.findOne({ slug: req.params.slug });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!game.published && !canManage(req.user, game)) return res.status(404).json({ error: 'Game not found' });
    res.json(game.toStore());
  } catch (err) {
    next(err);
  }
}

// GET /api/games/:slug/media/:mediaId — cover / screenshots (public)
export async function getMedia(req, res, next) {
  try {
    const game = await Game.findOne({ slug: req.params.slug });
    const media = game?.media.id(req.params.mediaId);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    res.set('Content-Type', media.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    openDownload(media.fileId)
      .on('error', () => res.status(404).end())
      .pipe(res);
  } catch (err) {
    next(err);
  }
}

// GET /api/games/:slug/download — any logged-in account (visitors included)
export async function downloadGame(req, res, next) {
  try {
    const game = await Game.findOne({ slug: req.params.slug });
    if (!game || (!game.published && !canManage(req.user, game))) return res.status(404).json({ error: 'Game not found' });
    if (game.buildStatus !== 'success' || !game.packageFileId) {
      return res.status(409).json({ error: 'No package available for this game yet' });
    }
    const info = await fileInfo(game.packageFileId);
    if (!info) return res.status(404).json({ error: 'Package file missing' });

    await Game.updateOne({ _id: game._id }, { $inc: { downloads: 1 } });
    res.set('Content-Type', game.packageContentType || info.contentType || 'application/octet-stream');
    res.set('Content-Length', info.length);
    res.set('Content-Disposition', `attachment; filename="${game.packageFilename || `${game.slug}-${game.version}.zip`}"`);
    openDownload(game.packageFileId)
      .on('error', next)
      .pipe(res);
  } catch (err) {
    next(err);
  }
}

/* -------------------------------------------------------------- publisher -- */

// POST /api/games/inspect-repo { repoUrl, branch? } — prefill visible metadata
export async function inspectRepo(req, res, next) {
  try {
    const repoUrl = String(req.body.repoUrl ?? '').trim().replace(/\/$/, '');
    if (!REPO_URL_RE.test(repoUrl)) {
      return res.status(400).json({ error: 'repoUrl must be a public https git URL (github.com / gitlab.com / githepia)' });
    }
    const branch = String(req.body.branch ?? '').trim();
    const manifest = await inspectRepoMetadata(repoUrl, branch);
    res.json(publicMetadata(manifest));
  } catch (err) {
    next(err);
  }
}

// POST /api/games — multipart form, sourceType repo|executable
export async function createGame(req, res, next) {
  try {
    const sourceType = req.body.sourceType === 'executable' ? 'executable' : 'repo';
    const repoUrl = String(req.body.repoUrl ?? '').trim().replace(/\/$/, '');
    if (sourceType === 'repo' && !REPO_URL_RE.test(repoUrl)) {
      return res.status(400).json({ error: 'repoUrl must be a public https git URL (github.com / gitlab.com / githepia)' });
    }
    const metadata = metadataFromBody(req.body);
    validateUploads(req.files, { requirePackage: sourceType === 'executable' });
    const slug = slugify(req.body.slug || metadata.title || repoUrl.split('/').pop()?.replace(/\.git$/, ''));
    if (!slug) return res.status(400).json({ error: 'Could not derive a slug from the repo URL' });
    if (await Game.findOne({ slug })) return res.status(409).json({ error: `A game with slug "${slug}" already exists` });

    const game = await Game.create({
      slug,
      owner: req.user._id,
      sourceType,
      repoUrl,
      branch: String(req.body.branch ?? '').trim(),
      metadataLocked: true,
      ...metadata,
      buildStatus: sourceType === 'repo' ? 'queued' : 'none',
      buildLog: sourceType === 'repo' ? 'Queued …' : '',
    });

    await addUploadedImages(game, req.files, { replace: true });
    if (sourceType === 'executable') {
      await replacePackage(game, req.files?.package?.[0]);
    } else {
      enqueueBuild(game._id);
    }
    await game.save();
    res.status(201).json(game.toStore());
  } catch (err) {
    next(err);
  }
}

// GET /api/games/mine — publisher dashboard (includes build state + log)
export async function listMine(req, res, next) {
  try {
    const filter = req.user.role === 'admin' ? {} : { owner: req.user._id };
    const games = await Game.find(filter).sort({ updatedAt: -1 }).populate('owner', 'username displayName');
    res.json(games.map((g) => ({
      ...g.toStore(),
      buildLog: g.buildLog,
      sourceType: g.sourceType,
      branch: g.branch,
      commit: g.commit,
      owner: { username: g.owner?.username, displayName: g.owner?.displayName || g.owner?.username },
    })));
  } catch (err) {
    next(err);
  }
}

// POST /api/games/:slug/rebuild — re-clone, re-import isc.json, re-package
export async function rebuildGame(req, res, next) {
  try {
    const game = await Game.findOne({ slug: req.params.slug });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canManage(req.user, game)) return res.status(403).json({ error: 'Not your game' });
    if (game.sourceType !== 'repo') return res.status(409).json({ error: 'Uploaded executables cannot be rebuilt from a repo' });
    if (['queued', 'cloning', 'building', 'packaging'].includes(game.buildStatus)) {
      return res.status(409).json({ error: 'A build is already running for this game' });
    }
    game.buildStatus = 'queued';
    game.buildLog = 'Queued …';
    await game.save();
    enqueueBuild(game._id);
    res.json(game.toStore());
  } catch (err) {
    next(err);
  }
}

// PATCH /api/games/:slug — owner edits visible metadata/media/source; admin can publish/feature
export async function updateGame(req, res, next) {
  try {
    const game = await Game.findOne({ slug: req.params.slug });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canManage(req.user, game)) return res.status(403).json({ error: 'Not your game' });

    if (typeof req.body.title === 'string') {
      Object.assign(game, metadataFromBody(req.body, game));
      game.metadataLocked = true;
    }
    validateUploads(req.files);

    if (typeof req.body.repoUrl === 'string' && game.sourceType === 'repo') {
      const url = req.body.repoUrl.trim().replace(/\/$/, '');
      if (!REPO_URL_RE.test(url)) return res.status(400).json({ error: 'Invalid repoUrl' });
      game.repoUrl = url;
    }
    if (typeof req.body.branch === 'string') game.branch = req.body.branch.trim();
    await addUploadedImages(game, req.files, { replace: req.body.replaceMedia === 'true' });
    if (req.files?.package?.[0]) {
      game.sourceType = 'executable';
      game.repoUrl = '';
      game.branch = '';
      await replacePackage(game, req.files.package[0]);
    }
    if (req.user.role === 'admin') {
      if (typeof req.body.published === 'boolean') game.published = req.body.published;
      if (typeof req.body.featured === 'boolean') game.featured = req.body.featured;
    }
    await game.save();
    res.json(game.toStore());
  } catch (err) {
    next(err);
  }
}

// DELETE /api/games/:slug — owner or admin; cleans GridFS
export async function deleteGame(req, res, next) {
  try {
    const game = await Game.findOne({ slug: req.params.slug });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!canManage(req.user, game)) return res.status(403).json({ error: 'Not your game' });
    if (game.packageFileId) await deleteFile(game.packageFileId);
    for (const media of game.media) await deleteFile(media.fileId);
    await game.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
