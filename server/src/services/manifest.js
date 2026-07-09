import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Parses and validates isc.json (spec: docs/ISC_MANIFEST.md).
// Throws Error with a student-readable message on any problem.

export class ManifestError extends Error {}

function fail(msg) {
  throw new ManifestError(`isc.json: ${msg}`);
}

function relPath(p, field) {
  if (typeof p !== 'string' || !p.trim()) fail(`"${field}" must be a non-empty path`);
  const clean = p.replaceAll('\\', '/').trim();
  if (clean.startsWith('/') || clean.includes('..')) fail(`"${field}" must be a repo-relative path without ".." (got "${p}")`);
  return clean;
}

export async function readManifest(repoDir, fallbackSlug = 'isc-game') {
  let raw;
  try {
    raw = await readFile(path.join(repoDir, 'isc.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return inferManifest(repoDir, fallbackSlug);
    fail(`could not be read: ${err.message}`);
  }

  let m;
  try {
    m = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON - ${err.message}`);
  }

  if (m.iscVersion !== 1) fail('"iscVersion" must be 1');
  if (typeof m.title !== 'string' || !m.title.trim() || m.title.length > 80) fail('"title" is required (max 80 chars)');
  if (typeof m.shortDescription !== 'string' || !m.shortDescription.trim() || m.shortDescription.length > 200) {
    fail('"shortDescription" is required (max 200 chars)');
  }
  if (typeof m.mainClass !== 'string' || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(m.mainClass)) {
    fail('"mainClass" is required and must be a valid class name (e.g. "Main" or "game.Main")');
  }

  const JFX_MODULES = ['base', 'graphics', 'controls', 'fxml', 'media', 'swing', 'web'];
  const javafx = m.javafx === true;
  let javafxModules = [];
  if (javafx) {
    const wanted = Array.isArray(m.javafxModules) ? m.javafxModules.map((x) => String(x).toLowerCase()) : ['controls', 'media'];
    for (const mod of wanted) {
      if (!JFX_MODULES.includes(mod)) fail(`"javafxModules" contains unknown module "${mod}" (allowed: ${JFX_MODULES.join(', ')})`);
    }
    javafxModules = [...new Set(['base', 'graphics', ...wanted])]; // base+graphics are always required
  }

  const tags = Array.isArray(m.tags) ? m.tags.slice(0, 8).map((t) => String(t).toLowerCase().trim()) : [];
  const authors = Array.isArray(m.authors) ? m.authors.slice(0, 10).map((a) => String(a).trim()) : [];
  const sources = (Array.isArray(m.sources) && m.sources.length ? m.sources : ['src']).map((s, i) => relPath(s, `sources[${i}]`));
  const resources = (Array.isArray(m.resources) ? m.resources : sources).map((r, i) => relPath(r, `resources[${i}]`));
  const screenshots = (Array.isArray(m.screenshots) ? m.screenshots.slice(0, 6) : []).map((s, i) => relPath(s, `screenshots[${i}]`));

  return {
    title: m.title.trim(),
    shortDescription: m.shortDescription.trim(),
    description: typeof m.description === 'string' ? m.description.trim().slice(0, 8000) : m.shortDescription.trim(),
    version: typeof m.version === 'string' && m.version.trim() ? m.version.trim().slice(0, 30) : '1.0.0',
    authors,
    tags,
    controls: typeof m.controls === 'string' ? m.controls.trim().slice(0, 300) : '',
    year: Number.isInteger(m.year) ? m.year : new Date().getFullYear(),
    engine: {
      name: m.engine?.name ? String(m.engine.name).toLowerCase() : 'fungraphics',
      version: m.engine?.version ? String(m.engine.version) : '',
    },
    scalaVersion: normalizeScalaVersion(m.scalaVersion),
    scalaVersionSource: typeof m.scalaVersion === 'string' && m.scalaVersion.trim() ? 'isc.json' : 'default',
    javafx,
    javafxModules,
    mainClass: m.mainClass,
    sources,
    resources,
    cover: m.cover ? relPath(m.cover, 'cover') : null,
    screenshots,
    inferred: false,
  };
}

function normalizeScalaVersion(value) {
  const version = typeof value === 'string' && value.trim() ? value.trim() : '2.13';

  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) {
    fail('"scalaVersion" must look like "2.13" or "2.13.12"');
  }

  return version;
}

async function inferManifest(repoDir, fallbackSlug) {
  const readme = await readReadme(repoDir);
  const sourceDirs = await inferSourceDirs(repoDir);
  const resourceDirs = await inferResourceDirs(repoDir, sourceDirs);
  const scalaFiles = [];

  for (const dir of sourceDirs) {
    await collect(path.join(repoDir, dir), (f) => f.endsWith('.scala'), scalaFiles);
  }

  const title = firstMatch(readme, /^#\s+(.+)$/m)
      || slugToTitle(fallbackSlug)
      || 'ISC Game';
  const description = inferDescription(readme, title);
  const mainClass = await inferMainClass(repoDir, scalaFiles);
  const engine = await inferEngine(readme, scalaFiles);
  const scala = await inferScalaVersion(repoDir, readme);
  const controls = firstMatch(readme, /controls?\s*[:\-]\s*(.+)$/im) || '';

  if (!mainClass) {
    fail('file not found and no main class could be inferred from Scala sources. Add isc.json with "mainClass".');
  }

  return {
    title: cleanMarkdown(title).slice(0, 80) || 'ISC Game',
    shortDescription: description.slice(0, 200) || 'Imported from a repository without isc.json.',
    description: description.slice(0, 8000) || 'Imported from a repository without isc.json.',
    version: '1.0.0',
    authors: inferAuthors(readme),
    tags: [],
    controls: cleanMarkdown(controls).slice(0, 300),
    year: new Date().getFullYear(),
    engine: {
      name: engine,
      version: '',
    },
    scalaVersion: scala.version,
    scalaVersionSource: scala.source,
    javafx: false,
    javafxModules: [],
    mainClass,
    sources: sourceDirs,
    resources: resourceDirs,
    cover: null,
    screenshots: [],
    inferred: true,
  };
}

async function readReadme(repoDir) {
  const entries = await readdir(repoDir, { withFileTypes: true }).catch(() => []);
  const readme = entries.find((e) => e.isFile() && /^readme(?:\..+)?$/i.test(e.name));

  if (!readme) return '';

  return readFile(path.join(repoDir, readme.name), 'utf8').catch(() => '');
}

async function inferSourceDirs(repoDir) {
  const entries = await readdir(repoDir, { withFileTypes: true }).catch(() => []);

  if (entries.some((e) => e.isDirectory() && e.name === 'src')) return ['src'];
  return ['.'];
}

async function inferResourceDirs(repoDir, sourceDirs) {
  const entries = await readdir(repoDir, { withFileTypes: true }).catch(() => []);
  const dirs = [...sourceDirs];

  for (const name of ['data', 'assets', 'res', 'resources']) {
    if (entries.some((e) => e.isDirectory() && e.name.toLowerCase() === name)) {
      dirs.push(name);
    }
  }

  return [...new Set(dirs)];
}

async function inferMainClass(repoDir, scalaFiles) {
  const candidates = [];

  for (const file of scalaFiles) {
    const source = await readFile(file, 'utf8').catch(() => '');
    const pkg = firstMatch(source, /^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/m);
    const appObject = firstMatch(source, /^\s*object\s+([A-Za-z_$][\w$]*)\s+extends\s+App\b/m);
    const mainObject = firstMatch(source, /^\s*object\s+([A-Za-z_$][\w$]*)[\s\S]*?\bdef\s+main\s*\(/m);

    if (appObject) candidates.push({ kind: 'app', name: pkg ? `${pkg}.${appObject}` : appObject });
    if (mainObject) candidates.push({ kind: 'main', name: pkg ? `${pkg}.${mainObject}` : mainObject });
  }

  return candidates.find((c) => c.kind === 'app')?.name ?? candidates[0]?.name ?? '';
}

async function inferEngine(readme, scalaFiles) {
  if (/gdx2d|libgdx|badlogic/i.test(readme)) return 'gdx2d';

  for (const file of scalaFiles) {
    const source = await readFile(file, 'utf8').catch(() => '');

    if (/\bch\.hevs\.gdx2d\b|\bcom\.badlogic\.gdx\b/.test(source)) return 'gdx2d';
  }

  return 'fungraphics';
}

async function inferScalaVersion(repoDir, readme) {
  const projectText = await readProjectText(repoDir);
  const fromBuild = firstMatch(projectText, /\bscalaVersion\b\s*(?::=|=)\s*"(\d+\.\d+(?:\.\d+)?)"/);

  if (fromBuild) return { version: fromBuild, source: 'build.sbt' };

  const fromScalaCli = await readFile(path.join(repoDir, '.scala-version'), 'utf8')
      .then((text) => firstMatch(text, /(\d+\.\d+(?:\.\d+)?)/))
      .catch(() => '');

  if (fromScalaCli) return { version: fromScalaCli, source: '.scala-version' };

  const fromReadme = firstMatch(readme, /scala(?:\s+version)?\s*[:\-]?\s*v?(\d+\.\d+(?:\.\d+)?)/i);

  if (fromReadme) return { version: fromReadme, source: 'README' };

  const fromJar = await inferScalaVersionFromJars(repoDir);

  if (fromJar) return { version: fromJar, source: 'dependency jar name' };

  return { version: '2.13', source: 'default' };
}

async function readProjectText(repoDir) {
  const files = [];

  await collect(repoDir, (f) => {
    const rel = path.relative(repoDir, f).replaceAll('\\', '/');

    if (rel.startsWith('.git/')) return false;
    if (rel === 'build.sbt') return true;
    if (rel.startsWith('project/') && rel.endsWith('.sbt')) return true;
    if (/^readme(?:\..+)?$/i.test(path.basename(f))) return true;
    if (path.basename(f).toLowerCase() === 'read.me') return true;

    return false;
  }, files);

  const chunks = [];

  for (const file of files.slice(0, 20)) {
    chunks.push(await readFile(file, 'utf8').catch(() => ''));
  }

  return chunks.join('\n');
}

async function inferScalaVersionFromJars(repoDir) {
  const jars = [];
  await collect(repoDir, (f) => f.toLowerCase().endsWith('.jar'), jars);

  const scalaLibrary = jars
      .map((f) => /scala-library-(\d+\.\d+(?:\.\d+)?)\.jar$/i.exec(path.basename(f))?.[1])
      .find(Boolean);

  if (scalaLibrary) return scalaLibrary;

  return jars
      .map((f) => /_(\d+\.\d+)(?:[-.])/.exec(path.basename(f))?.[1])
      .find(Boolean) || '';
}

function inferDescription(readme, title) {
  const lines = readme
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'))
      .filter((line) => !/^!\[.*\]\(.+\)$/.test(line));

  const text = lines
      .filter((line) => cleanMarkdown(line).toLowerCase() !== cleanMarkdown(title).toLowerCase())
      .slice(0, 6)
      .join('\n');

  return cleanMarkdown(text);
}

function inferAuthors(readme) {
  const authors = firstMatch(readme, /(?:authors?|made by|created by)\s*[:\-]\s*(.+)$/im);

  if (!authors) return [];

  return authors
      .split(/,|;|\band\b|\bet\b/i)
      .map((author) => cleanMarkdown(author).trim())
      .filter(Boolean)
      .slice(0, 10);
}

function firstMatch(text, regex) {
  return regex.exec(text)?.[1]?.trim() ?? '';
}

function cleanMarkdown(text) {
  return String(text)
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/[`*_>#-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

function slugToTitle(slug) {
  return String(slug)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
}

async function collect(dir, filter, out) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const e of entries) {
    if (e.name === '.git') continue;

    const full = path.join(dir, e.name);

    if (e.isDirectory()) {
      await collect(full, filter, out);
    } else if (filter(full)) {
      out.push(full);
    }
  }
}
