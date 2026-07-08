import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import Game from '../models/Game.js';
import { readManifest, ManifestError } from './manifest.js';
import { uploadFromBuffer, uploadFromPath, deleteFile } from '../config/gridfs.js';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor');

const GIT_TIMEOUT = 120000;
const COMPILE_TIMEOUT = 300000;
const PACKAGE_TIMEOUT = 600000;
const MAX_BUFFER = 16 * 1024 * 1024;

const JAVAFX_VERSION = process.env.JAVAFX_VERSION ?? '17.0.13';
const JAVAFX_CACHE = path.join(VENDOR_DIR, 'javafx-cache');
const JAVAFX_JMODS = process.env.JAVAFX_JMODS ?? path.join(VENDOR_DIR, 'javafx-jmods');
const MAVEN_CACHE = path.join(VENDOR_DIR, 'maven-cache');
const MAVEN_REPOSITORY = process.env.MAVEN_REPOSITORY ?? 'https://repo1.maven.org/maven2';

const queue = [];
let busy = false;

export function enqueueBuild(gameId) {
  queue.push(gameId.toString());
  if (!busy) void drain();
}

async function drain() {
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await buildGame(id);
    } catch (err) {
      console.error(`[build] unhandled failure for ${id}:`, err);
    }
  }
  busy = false;
}

class BuildLog {
  constructor(game) {
    this.game = game;
    this.lines = [];
  }

  async phase(status, msg) {
    this.add(msg);
    this.game.buildStatus = status;
    this.game.buildLog = this.text();
    await this.game.save();
  }

  add(msg) {
    for (const line of String(msg).split('\n')) {
      this.lines.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
    }
  }

  text() {
    return this.lines.join('\n').slice(-100000);
  }
}

async function buildGame(gameId) {
  const game = await Game.findById(gameId);
  if (!game) return;

  const log = new BuildLog(game);
  const work = await mkdtemp(path.join(tmpdir(), 'isc-build-'));
  const repoDir = path.join(work, 'repo');

  try {
    if (process.platform !== 'win32') {
      throw new BuildFailure('This build pipeline currently only supports Windows jpackage builds.');
    }

    await log.phase('cloning', `Cloning ${game.repoUrl}${game.branch ? ` (branch ${game.branch})` : ''} …`);

    await ensureTool('git', ['--version'], 'git is not installed on the build server');

    const cloneArgs = [
      'clone',
      '--depth',
      '1',
      ...(game.branch ? ['--branch', game.branch] : []),
      game.repoUrl,
      repoDir,
    ];

    await run('git', cloneArgs, {
      timeout: GIT_TIMEOUT,
      maxBuffer: MAX_BUFFER,
      shell: false,
    });

    const { stdout: commit } = await run('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
      timeout: GIT_TIMEOUT,
      shell: false,
    });

    game.commit = commit.trim().slice(0, 12);
    log.add(`At commit ${game.commit}`);

    const m = await readManifest(repoDir, game.slug);

    log.add(`${m.inferred ? 'No isc.json found; inferred metadata' : 'Manifest OK'}: "${m.title}" v${m.version} (main: ${m.mainClass}, Scala ${m.scalaVersion} from ${m.scalaVersionSource || 'default'})`);

    Object.assign(game, {
      mainClass: m.mainClass,
      engine: game.metadataLocked ? game.engine : m.engine,
      ...(game.metadataLocked ? {} : {
        title: m.title,
        shortDescription: m.shortDescription,
        description: m.description,
        version: m.version,
        authors: m.authors,
        tags: m.tags,
        controls: m.controls,
        year: m.year,
      }),
    });

    if (!game.mediaLocked) {
      const oldMedia = game.media;
      game.media = [];

      if (m.cover) await importImage(game, repoDir, m.cover, 'cover', log);
      for (const shot of m.screenshots) await importImage(game, repoDir, shot, 'screenshot', log);
      for (const old of oldMedia) await deleteFile(old.fileId);
    } else {
      log.add('Keeping dashboard-managed media.');
    }

    await game.save();

    await log.phase('building', 'Collecting sources …');

    const sourceDirs = m.sources.map((s) => path.join(repoDir, s));
    const scalaFiles = [];

    for (const dir of sourceDirs) {
      await collect(dir, (f) => f.endsWith('.scala'), scalaFiles);
    }

    if (!scalaFiles.length) {
      throw new ManifestError(`No .scala files found under: ${m.sources.join(', ')}`);
    }

    log.add(`${scalaFiles.length} Scala source file(s)`);

    const resolvedMainClass = await resolveMainClass(m.mainClass, scalaFiles, log);
    m.mainClass = resolvedMainClass;
    game.mainClass = resolvedMainClass;
    await game.save();

    const dependencyJars = await findDependencyJars(repoDir, m.engine.name, log);
    const mavenJars = await resolveDeclaredMavenJars(repoDir, m.scalaVersion, m.engine.name, dependencyJars, log);
    const javafxModules = m.javafx ? normalizeJavaFxModules(m.javafxModules) : [];
    const jfxJars = m.javafx ? await ensureJavaFxJars(javafxModules, log) : [];
    await validateRequiredDependencies(scalaFiles, [...dependencyJars, ...mavenJars, ...jfxJars], m.engine.name);

    if (m.javafx) {
      await ensureJavaFxJmods(javafxModules, log);
      log.add(`JavaFX ${JAVAFX_VERSION} enabled for Windows runtime`);
      log.add(`JavaFX modules: ${javafxModules.join(', ')}`);
      log.add('Note: mainClass should be a plain launcher object, not a class extending javafx.application.Application directly.');
    }

    const classesDir = path.join(work, 'classes');
    await mkdir(classesDir, { recursive: true });

    const scala = await findScalaToolchain(m.scalaVersion, log);
    const argsFile = path.join(work, 'sources.txt');
    await writeFile(argsFile, scalaFiles.map((f) => f.replaceAll('\\', '/')).join('\n'));

    const classpathEntries = [...dependencyJars, ...mavenJars, ...jfxJars].filter(Boolean);
    const classpath = classpathEntries.join(path.delimiter);
    const scalacArgs = [
      ...(classpath ? ['-classpath', classpath] : []),
      '-d',
      classesDir,
      `@${argsFile}`,
    ];

    log.add(`Compiling with ${scala.label}${classpathEntries.length ? ` against ${classpathEntries.length} dependency jar(s)` : ''} …`);

    try {
      await run(scala.scalac, scalacArgs, {
        timeout: COMPILE_TIMEOUT,
        maxBuffer: MAX_BUFFER,
        shell: true,
      });
    } catch (err) {
      throw new BuildFailure(`Compilation failed:${compileFailureHint(err, m.engine.name)}\n${err.stderr || err.stdout || err.message}`);
    }

    log.add('Compilation OK');

    await log.phase('packaging', 'Assembling runnable fat jar …');

    const jar = new AdmZip();
    const seen = new Set();

    const put = (entryName, data, options = {}) => {
      const name = entryName.replaceAll('\\', '/');
      if (name.endsWith('/')) return false;
      if (seen.has(name) && !options.overwrite) return false;
      if (!isSafeZipEntryName(name)) {
        log.add(`Warning: skipped invalid package entry: ${JSON.stringify(name)}`);
        return false;
      }

      if (seen.has(name) && options.overwrite) {
        try {
          jar.deleteFile(name);
        } catch {
          // AdmZip is best-effort here; addFile below will still surface issues.
        }
      }

      seen.add(name);

      try {
        jar.addFile(name, data);
      } catch (err) {
        log.add(`Warning: skipped package entry ${JSON.stringify(name)}: ${err.message}`);
        return false;
      }

      return true;
    };

    const scalaLibrary = await findScalaLibraryForToolchain(scala, log);
    const runtimeJars = await readableJarFiles(uniqueJarFiles([...dependencyJars, ...mavenJars, scalaLibrary].filter(Boolean)), log);
    const runtimeJarNames = runtimeJars.map((dep) => safeFileName(path.basename(dep)));
    const manifestClassPath = runtimeJarNames.length ? `Class-Path: ${runtimeJarNames.join(' ')}\r\n` : '';

    put(
        'META-INF/MANIFEST.MF',
        Buffer.from(`Manifest-Version: 1.0\r\nMain-Class: ${m.mainClass}\r\n${manifestClassPath}Created-By: ISC Steam\r\n\r\n`)
    );

    const classFiles = [];
    await collect(classesDir, () => true, classFiles);

    for (const f of classFiles) {
      put(path.relative(classesDir, f), await readFile(f));
    }

    for (const dep of runtimeJars) {
      log.add(`Merging ${path.basename(dep)} …`);
      if (mergeJar(jar, seen, dep, log)) {
        log.add(`Merged ${path.basename(dep)}`);
      }
    }

    const resourceDirs = await resolveResourceDirs(repoDir, m.resources, m.sources);
    const resourceEntries = [];

    for (const resDir of resourceDirs) {
      const abs = path.join(repoDir, resDir);
      const files = [];

      await collect(abs, (f) => isResourceFile(repoDir, f), files);

      const root = resourceStripRoot(resDir, m.sources);

      for (const f of files) {
        const entryName = path.relative(path.join(repoDir, root), f).replaceAll('\\', '/');

        const overridesDependency = seen.has(entryName);

        if (put(entryName, await readFile(f), { overwrite: true })) {
          resourceEntries.push({ file: f, entryName });
          if (overridesDependency) log.add(`Project resource overrides dependency entry: ${entryName}`);
        }

        for (const alias of imageExtensionAliases(entryName)) {
          if (put(alias, await readFile(f), { overwrite: true })) {
            resourceEntries.push({ file: f, entryName: alias });
            log.add(`Added image extension alias: ${alias}`);
          }
        }
      }
    }

    log.add(`Bundled ${resourceEntries.length} resource file(s)`);

    const jarName = `${safeFileName(game.slug)}.jar`;
    const appInputDir = path.join(work, 'app-input');
    const jarPath = path.join(appInputDir, jarName);

    await mkdir(appInputDir, { recursive: true });
    await writeFile(jarPath, jar.toBuffer());

    for (let i = 0; i < runtimeJars.length; i += 1) {
      await writeFile(path.join(appInputDir, runtimeJarNames[i]), await readFile(runtimeJars[i]));
    }

    await log.phase('packaging', 'Generating Windows app-image with jpackage …');

    await ensureTool('jpackage', ['--version'], 'jpackage is not installed on the build server (install a full JDK 17+ or 21+)');

    const appName = safeAppName(game.title, game.slug);
    const outputDir = path.join(work, 'jpackage-output');

    const jpackageArgs = [
      '--type',
      'app-image',

      '--name',
      appName,

      '--input',
      appInputDir,

      '--main-jar',
      jarName,

      '--main-class',
      m.mainClass,

      '--dest',
      outputDir,

      '--vendor',
      'ISC Steam',

      '--copyright',
      'HES-SO Valais',

      '--win-console',
    ];

    if (m.javafx) {
      jpackageArgs.push(
          '--module-path',
          JAVAFX_JMODS,

          '--add-modules',
          javafxModules.join(',')
      );
    }

    try {
      await run('jpackage', jpackageArgs, {
        timeout: PACKAGE_TIMEOUT,
        maxBuffer: MAX_BUFFER,
        shell: false,
      });
    } catch (err) {
      throw new BuildFailure(`jpackage failed:\n${err.stderr || err.stdout || err.message}`);
    }

    log.add('jpackage app-image OK');

    const appRoot = path.join(outputDir, appName);

    await stat(appRoot).catch(() => {
      throw new BuildFailure(`jpackage did not create expected app directory: ${appRoot}`);
    });

    await copyResourceEntries(resourceEntries, appRoot, log, 'app root');
    await copyResourceEntries(resourceEntries, path.join(appRoot, 'app'), log, 'app classpath directory');

    const zip = new AdmZip();
    const packagedFiles = [];

    await collect(appRoot, () => true, packagedFiles);

    for (const file of packagedFiles) {
      const relative = path.relative(appRoot, file).replaceAll('\\', '/');
      zip.addFile(`${game.slug}/${relative}`, await readFile(file));
    }

    zip.addFile(`${game.slug}/README.txt`, Buffer.from(readmeTxt(m, game, appName)));

    const zipBuffer = zip.toBuffer();

    const oldPackage = game.packageFileId;

    game.packageFileId = await uploadFromBuffer(
        zipBuffer,
        `${game.slug}-${game.version}-windows.zip`,
        'application/zip'
    );

    game.packageFilename = `${game.slug}-${game.version}-windows.zip`;
    game.packageContentType = 'application/zip';
    game.packageSize = zipBuffer.length;

    if (oldPackage) await deleteFile(oldPackage);

    game.builtAt = new Date();

    await log.phase('success', `Done — Windows package ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    const msg =
        err instanceof ManifestError || err instanceof BuildFailure
            ? err.message
            : `Unexpected error: ${err.message}`;

    log.add(msg);
    game.buildStatus = 'failed';
    game.buildLog = log.text();
    await game.save().catch(() => {});
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

class BuildFailure extends Error {}

async function ensureTool(cmd, args, message) {
  try {
    await run(cmd, args, {
      timeout: 15000,
      shell: process.platform === 'win32',
    });
  } catch {
    throw new BuildFailure(message);
  }
}

async function collect(dir, filter, out) {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

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

async function resolveMainClass(mainClass, scalaFiles, log) {
  if (!mainClass || mainClass.includes('.')) return mainClass;

  const simpleName = escapeRegExp(mainClass);
  const packageRe = /^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/m;
  const declarationRe = new RegExp(`^\\s*(?:object|class)\\s+${simpleName}\\b`, 'm');
  const runnableRe = new RegExp(
      `^\\s*object\\s+${simpleName}\\b[^\\n]*(?:extends\\s+(?:[\\w.]+\\.)?App\\b|[\\s\\S]*?\\bdef\\s+main\\s*\\()`,
      'm'
  );

  let fallback = null;

  for (const file of scalaFiles) {
    const source = await readFile(file, 'utf8').catch(() => '');
    if (!declarationRe.test(source)) continue;

    const packageName = source.match(packageRe)?.[1];
    const qualified = packageName ? `${packageName}.${mainClass}` : mainClass;

    if (runnableRe.test(source)) {
      if (qualified !== mainClass) log.add(`Resolved mainClass ${mainClass} -> ${qualified}`);
      return qualified;
    }

    fallback ??= qualified;
  }

  if (fallback && fallback !== mainClass) {
    log.add(`Resolved mainClass ${mainClass} -> ${fallback}`);
    return fallback;
  }

  log.add(`Warning: could not resolve package for mainClass ${mainClass}; using it as-is`);
  return mainClass;
}

async function resolveResourceDirs(repoDir, manifestResources, sourceDirs) {
  const dirs = [...manifestResources];
  const rootEntries = await readdir(repoDir, { withFileTypes: true }).catch(() => []);
  const rootDirs = new Map(
      rootEntries
          .filter((entry) => entry.isDirectory())
          .map((entry) => [entry.name.toLowerCase(), entry.name])
  );

  for (const name of ['data', 'assets', 'res', 'resources']) {
    const actual = rootDirs.get(name);
    if (actual) dirs.push(actual);
  }

  for (const nested of ['src/main/resources', 'src/main/resource']) {
    if (await directoryExists(path.join(repoDir, nested))) {
      dirs.push(nested);
    }
  }

  return uniqueRelativeDirs(dirs)
      .filter((dir) => !isGeneratedOrDependencyDir(dir))
      .sort((a, b) => Number(sourceDirs.includes(a)) - Number(sourceDirs.includes(b)));
}

function resourceStripRoot(resDir, sourceDirs) {
  const normalized = resDir.replaceAll('\\', '/').replace(/\/+$/, '');

  if (normalized === 'src/main/resources' || normalized === 'src/main/resource') return normalized;

  return sourceDirs.find((source) => (normalized + '/').startsWith(source.replaceAll('\\', '/') + '/')) ?? '';
}

async function copyResourceEntries(resourceEntries, targetRoot, log, label) {
  let copied = 0;

  for (const { file, entryName } of resourceEntries) {
    if (!isSafeZipEntryName(entryName)) continue;

    const dest = path.join(targetRoot, entryName);

    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(file));
    copied += 1;
  }

  if (copied) log.add(`Copied ${copied} resource file(s) to ${label}`);
}

async function directoryExists(dir) {
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function uniqueRelativeDirs(dirs) {
  const seen = new Set();
  const out = [];

  for (const dir of dirs) {
    const normalized = String(dir || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '') || '.';
    const key = normalized.toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function isGeneratedOrDependencyDir(dir) {
  return /^(?:\.git|target|out|build|dist|node_modules|vendor|lib|libs)(?:\/|$)/i.test(dir);
}

function isResourceFile(repoDir, file) {
  const relative = path.relative(repoDir, file).replaceAll('\\', '/');

  if (/\.(?:scala|java|class|jar)$/i.test(file)) return false;
  if (relative.split('/').some((part) => isGeneratedOrDependencyDir(part))) return false;

  return true;
}

function imageExtensionAliases(entryName) {
  if (/\.jpe?g$/i.test(entryName) === false) return [];

  if (/\.jpeg$/i.test(entryName)) {
    return [entryName.replace(/\.jpeg$/i, '.jpg')];
  }

  return [entryName.replace(/\.jpg$/i, '.jpeg')];
}

async function findDependencyJars(repoDir, engineName, log) {
  const repoJars = [];
  await collect(repoDir, isRuntimeJar, repoJars);

  const vendored = await vendoredDependencyJars(engineName);

  const configured = await configuredDependencyJars(log);
  const baseJars = uniquePaths([...repoJars, ...vendored]);
  const baseKeys = new Set(baseJars.map(pathKey));
  const configuredOnly = configured.filter((jar) => !baseKeys.has(pathKey(jar)));

  const jars = uniqueJarFiles([...baseJars, ...configured]);

  if (repoJars.length) {
    log.add(`Using ${repoJars.length} dependency jar(s) from repo`);
  }

  if (vendored.length) {
    log.add(`Using ${vendored.length} vendored ${engineName || 'engine'} jar(s)`);
  }

  if (configuredOnly.length) {
    log.add(`Using ${configuredOnly.length} configured dependency jar(s) from GAME_DEPENDENCY_JARS`);
  } else if (configured.length) {
    log.add('GAME_DEPENDENCY_JARS did not add new jars; configured jars were already found in repo/vendor');
  }

  if (!jars.length) {
    log.add(`Warning: no dependency jar found for ${engineName || 'the game'} (repo or server/vendor) — compiling without engine`);
  }

  return jars;
}

function isRuntimeJar(file) {
  const name = path.basename(file).toLowerCase();

  if (!name.endsWith('.jar')) return false;
  if (name.includes('-sources') || name.includes('-javadoc')) return false;
  if (name.startsWith('javafx-')) return false;

  return true;
}

async function vendoredDependencyJars(engineName) {
  const entries = await readdir(VENDOR_DIR, { withFileTypes: true }).catch(() => []);
  const jars = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const file = path.join(VENDOR_DIR, entry.name);

    if (isRuntimeJar(file) && matchesEngineJar(file, engineName)) {
      jars.push(file);
    }
  }

  return jars;
}

async function configuredDependencyJars(log) {
  const value = process.env.GAME_DEPENDENCY_JARS;
  if (!value) return [];

  const jars = [];
  const entries = value
      .split(path.delimiter)
      .flatMap((part) => part.split(','))
      .map((part) => part.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);

  for (const entry of entries) {
    const candidates = [
      path.resolve(process.cwd(), entry),
      path.resolve(path.join(__dirname, '..', '..'), entry),
      path.resolve(path.join(__dirname, '..', '..', '..'), entry),
    ];
    const found = await firstExistingFile(candidates);

    if (!found) {
      log.add(`Warning: configured dependency jar not found: ${entry}`);
      continue;
    }

    if (!isRuntimeJar(found)) {
      log.add(`Warning: configured dependency is not a runtime jar: ${entry}`);
      continue;
    }

    jars.push(found);
  }

  return uniquePaths(jars);
}

async function firstExistingFile(files) {
  for (const file of uniquePaths(files.filter(Boolean))) {
    try {
      const s = await stat(file);
      if (s.isFile()) return file;
    } catch {
      // try next
    }
  }

  return null;
}

function matchesEngineJar(file, engineName) {
  const name = path.basename(file).toLowerCase();

  if (engineName === 'gdx2d') {
    return true;
  }

  if (engineName === 'fungraphics') {
    return /fungraphics/.test(name);
  }

  return true;
}

function uniquePaths(files) {
  return [...new Map(files.map((f) => [pathKey(f), f])).values()];
}

function uniqueJarFiles(files) {
  const byFile = new Map();

  for (const file of uniquePaths(files)) {
    const basename = path.basename(file).toLowerCase();

    if (!byFile.has(basename)) {
      byFile.set(basename, file);
    }
  }

  return [...byFile.values()];
}

async function readableJarFiles(files, log) {
  const jars = [];

  for (const file of files) {
    try {
      const s = await stat(file);

      if (!s.isFile()) {
        log.add(`Warning: skipped runtime dependency because it is not a file: ${file}`);
        continue;
      }

      jars.push(file);
    } catch {
      log.add(`Warning: skipped missing runtime dependency: ${file}`);
    }
  }

  return jars;
}

function pathKey(file) {
  return path.resolve(file).toLowerCase();
}

async function validateRequiredDependencies(scalaFiles, classpathJars, engineName) {
  const imports = await sourceDependencyHints(scalaFiles);
  const jarNames = classpathJars.map((jar) => path.basename(jar).toLowerCase());
  const hasJar = (pattern) => jarNames.some((name) => pattern.test(name));

  if ((engineName === 'gdx2d' || imports.gdx2d) && !hasJar(/gdx2d/)) {
    throw new BuildFailure(
        'Missing gdx2d dependency. This project imports ch.hevs.gdx2d.* but no gdx2d runtime jar was found. Add gdx2d-desktop-*.jar to the repository root or libs/, or install it in server/vendor/.'
    );
  }

  if (imports.libgdx && !hasJar(/gdx2d|gdx|lwjgl|badlogic/)) {
    throw new BuildFailure(
        'Missing libGDX dependency. This project imports com.badlogic.gdx.* but no libGDX/gdx2d jar was found. Add the required jars to the repository root or libs/, or declare them in build.sbt/README.'
    );
  }

  if (imports.fungraphics && !hasJar(/fungraphics/)) {
    throw new BuildFailure(
        'Missing FunGraphics dependency. This project imports FunGraphics classes but no fungraphics-*.jar was found. Add the jar to the repository root or libs/, or install it in server/vendor/.'
    );
  }
}

function compileFailureHint(err, engineName) {
  const output = `${err.stderr || ''}\n${err.stdout || ''}\n${err.message || ''}`;

  if (engineName === 'gdx2d' && /(value run is not a member|rotateDeg is not a member|PortableApplication)/i.test(output)) {
    return '\nHint: this looks like a gdx2d/libGDX API version mismatch. In the current gdx2d jars, PortableApplication has no run() method and libGDX Vector2 uses rotate(...) / rotateRad(...), not rotateDeg(...). Use the same gdx2d/libGDX jar version as the student project, or update the student code for the available API.';
  }

  if (/not found: object ch|not found: object hevs|not found: object fungraphics/i.test(output)) {
    return '\nHint: this looks like a missing ISC engine jar. Add the required jar to the repo, server/vendor, or GAME_DEPENDENCY_JARS.';
  }

  return '';
}

async function sourceDependencyHints(scalaFiles) {
  const hints = {
    gdx2d: false,
    libgdx: false,
    fungraphics: false,
  };

  for (const file of scalaFiles) {
    const source = await readFile(file, 'utf8').catch(() => '');

    hints.gdx2d ||= /\bch\.hevs\.gdx2d\b/.test(source);
    hints.libgdx ||= /\bcom\.badlogic\.gdx\b/.test(source);
    hints.fungraphics ||= /\b(?:hevs\.graphics|ch\.hevs\.graphics|fungraphics)\b/i.test(source);

    if (hints.gdx2d && hints.libgdx && hints.fungraphics) break;
  }

  return hints;
}

async function resolveDeclaredMavenJars(repoDir, scalaVersion, engineName, localJars, log) {
  const deps = await readDeclaredDependencies(repoDir, scalaVersion);
  const scalaBinary = scalaVersionPrefix(scalaVersion);
  const hasGdx2dJar = localJars.some((jar) => /gdx2d/i.test(path.basename(jar)));
  const filtered = deps.filter((dep) => {
    if (dep.groupId === 'org.scala-lang') return false;

    if (engineName === 'gdx2d' && hasGdx2dJar && dep.groupId === 'com.badlogicgames.gdx') {
      log.add(`Skipping ${dep.groupId}:${dep.artifactId}:${dep.version}; gdx2d jar already provides libGDX`);
      return false;
    }

    return true;
  });
  const jars = [];
  const seen = new Set();

  for (const dep of filtered) {
    await resolveMavenArtifact(dep, jars, seen, log);
  }

  if (jars.length) {
    log.add(`Using ${jars.length} Maven dependency jar(s) from cache`);
  }

  if (deps.some((dep) => dep.version === scalaBinary)) {
    log.add(`Warning: a Maven dependency uses version ${scalaBinary}; check that this is a library version, not the Scala version.`);
  }

  return uniquePaths(jars);
}

async function readDeclaredDependencies(repoDir, scalaVersion) {
  const files = await dependencyDeclarationFiles(repoDir);
  const scalaBinary = scalaVersionPrefix(scalaVersion);
  const byArtifact = new Map();

  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const regex = /"([^"]+)"\s*(%%?)\s*"([^"]+)"\s*%\s*"([^"]+)"/g;
    let match;

    while ((match = regex.exec(text))) {
      const [, groupId, op, artifact, version] = match;
      const artifactId = op === '%%' ? `${artifact}_${scalaBinary}` : artifact;
      const key = `${groupId}:${artifactId}`;
      const dep = { groupId, artifactId, version };
      const previous = byArtifact.get(key);

      if (!previous || previous.version === scalaBinary) {
        byArtifact.set(key, dep);
      }
    }
  }

  return [...byArtifact.values()];
}

async function dependencyDeclarationFiles(repoDir) {
  const files = [];
  const rootEntries = await readdir(repoDir, { withFileTypes: true }).catch(() => []);

  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (/^readme(?:\..+)?$/i.test(entry.name) || entry.name.toLowerCase() === 'read.me' || entry.name === 'build.sbt') {
      files.push(path.join(repoDir, entry.name));
    }
  }

  await collect(path.join(repoDir, 'project'), (f) => path.basename(f) === 'build.sbt' || f.endsWith('.sbt'), files);

  return files.sort((a, b) => a.localeCompare(b));
}

async function resolveMavenArtifact(dep, jars, seen, log) {
  const key = `${dep.groupId}:${dep.artifactId}:${dep.version}`;

  if (seen.has(key)) return;
  seen.add(key);

  const jar = await ensureMavenFile(dep, 'jar', log);
  const pom = await ensureMavenFile(dep, 'pom', log);

  jars.push(jar);

  const pomText = await readFile(pom, 'utf8').catch(() => '');
  const properties = mavenProperties(pomText, dep);

  for (const child of mavenDependencies(pomText, properties)) {
    await resolveMavenArtifact(child, jars, seen, log);
  }
}

async function ensureMavenFile(dep, ext, log) {
  const groupPath = dep.groupId.replaceAll('.', '/');
  const relative = `${groupPath}/${dep.artifactId}/${dep.version}/${dep.artifactId}-${dep.version}.${ext}`;
  const dest = path.join(MAVEN_CACHE, relative);

  try {
    await stat(dest);
    return dest;
  } catch {
    // download below
  }

  await mkdir(path.dirname(dest), { recursive: true });

  const url = `${MAVEN_REPOSITORY.replace(/\/$/, '')}/${relative}`;
  log.add(`Downloading ${dep.artifactId}-${dep.version}.${ext} …`);

  let res;

  try {
    res = await fetch(url);
  } catch (err) {
    throw new BuildFailure(`Could not reach Maven repository for ${dep.groupId}:${dep.artifactId}:${dep.version}: ${err.message}`);
  }

  if (!res.ok) {
    throw new BuildFailure(`Could not download ${dep.groupId}:${dep.artifactId}:${dep.version} (${ext}): HTTP ${res.status}`);
  }

  await writeFile(dest, Buffer.from(await res.arrayBuffer()));

  return dest;
}

function mavenProperties(pomText, dep) {
  const props = new Map([
    ['project.groupId', dep.groupId],
    ['pom.groupId', dep.groupId],
    ['project.artifactId', dep.artifactId],
    ['pom.artifactId', dep.artifactId],
    ['project.version', dep.version],
    ['pom.version', dep.version],
  ]);
  const propsBody = /<properties>([\s\S]*?)<\/properties>/i.exec(pomText)?.[1] ?? '';
  const propRegex = /<([\w.-]+)>([^<]+)<\/\1>/g;
  let match;

  while ((match = propRegex.exec(propsBody))) {
    props.set(match[1], match[2].trim());
  }

  return props;
}

function mavenDependencies(pomText, properties) {
  const deps = [];
  const depRegex = /<dependency>([\s\S]*?)<\/dependency>/gi;
  let match;

  while ((match = depRegex.exec(pomText))) {
    const block = match[1];
    const scope = xmlTag(block, 'scope');
    const optional = xmlTag(block, 'optional');

    if (['test', 'provided', 'system'].includes(scope) || optional === 'true') continue;

    const groupId = resolveMavenValue(xmlTag(block, 'groupId'), properties);
    const artifactId = resolveMavenValue(xmlTag(block, 'artifactId'), properties);
    const version = resolveMavenValue(xmlTag(block, 'version'), properties);

    if (groupId === 'org.scala-lang') continue;
    if (!groupId || !artifactId || !version || version.includes('${')) continue;

    deps.push({ groupId, artifactId, version });
  }

  return deps;
}

function xmlTag(text, tag) {
  return new RegExp(`<${tag}>([^<]+)<\\/${tag}>`, 'i').exec(text)?.[1]?.trim() ?? '';
}

function resolveMavenValue(value, properties) {
  return value.replace(/\$\{([^}]+)}/g, (_, key) => properties.get(key) ?? `\${${key}}`);
}

async function findEngineJar(repoDir, log) {
  const candidates = [];
  await collect(repoDir, (f) => /fungraphics.*\.jar$/i.test(path.basename(f)), candidates);

  if (candidates[0]) {
    log.add(`Using engine jar from repo: ${path.basename(candidates[0])}`);
    return candidates[0];
  }

  const vendored = [];
  await collect(VENDOR_DIR, (f) => f.endsWith('.jar') && !/javafx-/i.test(path.basename(f)), vendored);

  if (vendored[0]) {
    log.add(`Using vendored engine jar: ${path.basename(vendored[0])}`);
    return vendored[0];
  }

  log.add('Warning: no FunGraphics jar found (repo root or server/vendor) — compiling without engine');
  return null;
}

async function findScalaLibrary(log) {
  if (process.env.SCALA_LIBRARY_JAR) return process.env.SCALA_LIBRARY_JAR;

  try {
    const which = process.platform === 'win32' ? 'where' : 'which';

    const { stdout } = await run(which, ['scalac'], {
      timeout: 10000,
      shell: process.platform === 'win32',
    });

    const scalacPath = stdout.split('\n')[0].trim();

    const { realpath } = await import('node:fs/promises');
    const real = await realpath(scalacPath);

    const lib = path.join(path.dirname(real), '..', 'lib', 'scala-library.jar');

    await stat(lib);

    return lib;
  } catch {
    log.add('Warning: scala-library.jar not found — set SCALA_LIBRARY_JAR in server/.env. The game may not run standalone.');
    return null;
  }
}

async function findScalaToolchain(scalaVersion, log) {
  const wanted = scalaVersionPrefix(scalaVersion);
  const envKey = scalaVersionEnvKey(scalaVersion);
  const scalacNames = process.platform === 'win32'
      ? [`scalac-${wanted}.bat`, `scalac${wanted}.bat`, 'scalac.bat']
      : [`scalac-${wanted}`, `scalac${wanted}`, 'scalac'];
  const candidates = [
    process.env[`SCALAC_${envKey}`],
    scalaHomeScalac(process.env[`SCALA_${envKey}_HOME`]),
    scalaHomeScalac(process.env.SCALA_HOME),
    ...scalacNames,
  ].filter(Boolean);

  for (const scalac of [...new Set(candidates)]) {
    const version = await scalacVersion(scalac);

    if (!version) continue;
    if (!version.startsWith(wanted)) {
      log.add(`Skipping ${scalac}: Scala ${version} does not match requested ${wanted}`);
      continue;
    }

    log.add(`Using Scala ${version} compiler: ${scalac}`);

    return {
      scalac,
      requestedVersion: scalaVersion,
      version,
      label: `scalac ${version}`,
    };
  }

  throw new BuildFailure(
      `Scala ${wanted} compiler not found. Install Scala ${wanted}, add it to PATH, or set SCALAC_${envKey} / SCALA_${envKey}_HOME in server/.env.`
  );
}

function scalaVersionPrefix(version) {
  return String(version).split('.').slice(0, 2).join('.');
}

function scalaVersionEnvKey(version) {
  return scalaVersionPrefix(version).replaceAll('.', '_');
}

function scalaHomeScalac(home) {
  if (!home) return null;
  return path.join(home, 'bin', process.platform === 'win32' ? 'scalac.bat' : 'scalac');
}

async function scalacVersion(scalac) {
  try {
    const { stdout, stderr } = await run(scalac, ['-version'], {
      timeout: 15000,
      maxBuffer: MAX_BUFFER,
      shell: process.platform === 'win32',
    });
    const out = `${stdout}\n${stderr}`;

    return /version\s+(\d+\.\d+(?:\.\d+)?)/i.exec(out)?.[1] ?? '';
  } catch {
    return '';
  }
}

async function findScalaLibraryForToolchain(scala, log) {
  const envKey = scalaVersionEnvKey(scala.requestedVersion);
  const envCandidates = [
    [`SCALA_LIBRARY_JAR_${envKey}`, process.env[`SCALA_LIBRARY_JAR_${envKey}`]],
    ...(scala.version.startsWith('2.13') ? [['SCALA_LIBRARY_JAR', process.env.SCALA_LIBRARY_JAR]] : []),
  ];

  for (const [name, file] of envCandidates) {
    if (!file) continue;

    try {
      const s = await stat(file);

      if (s.isFile()) return file;

      log.add(`Warning: ${name} is not a file: ${file}`);
    } catch {
      log.add(`Warning: ${name} points to a missing scala-library.jar: ${file}`);
    }
  }

  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    let scalacPath = scala.scalac;

    if (!path.isAbsolute(scalacPath)) {
      const { stdout } = await run(which, [scala.scalac], {
        timeout: 10000,
        shell: process.platform === 'win32',
      });

      scalacPath = stdout.split('\n')[0].trim();
    }

    const { realpath } = await import('node:fs/promises');
    const real = await realpath(scalacPath);
    const lib = await firstExistingFile([
      scalaHomeLibrary(process.env[`SCALA_${envKey}_HOME`]),
      scalaHomeLibrary(process.env.SCALA_HOME),
      path.join(path.dirname(real), '..', 'lib', 'scala-library.jar'),
      coursierScalaLibrary(scala.version),
    ]);

    if (!lib) throw new Error('scala-library.jar not found');

    return lib;
  } catch {
    log.add(`Warning: scala-library.jar for Scala ${scala.requestedVersion} not found — set SCALA_LIBRARY_JAR_${envKey} in server/.env. The game may not run standalone.`);
    return null;
  }
}

function normalizeJavaFxModules(modules = []) {
  const set = new Set(modules.filter(Boolean));

  if (set.size === 0) {
    set.add('javafx.controls');
  }

  const normalized = [];

  for (const mod of set) {
    normalized.push(mod.startsWith('javafx.') ? mod : `javafx.${mod}`);
  }

  return normalized;
}

function javaFxArtifactName(moduleName) {
  return moduleName.replace(/^javafx\./, '');
}

function scalaHomeLibrary(home) {
  if (!home) return null;
  return path.join(home, 'lib', 'scala-library.jar');
}

function coursierScalaLibrary(version) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return null;

  return path.join(
      home,
      'AppData',
      'Local',
      'Coursier',
      'Cache',
      'v1',
      'https',
      'repo1.maven.org',
      'maven2',
      'org',
      'scala-lang',
      'scala-library',
      version,
      `scala-library-${version}.jar`
  );
}

async function ensureJavaFxJars(modules, log) {
  const jars = [];

  await mkdir(JAVAFX_CACHE, { recursive: true });

  for (const moduleName of modules) {
    const artifact = javaFxArtifactName(moduleName);
    const name = `javafx-${artifact}-${JAVAFX_VERSION}-win.jar`;
    const dest = path.join(JAVAFX_CACHE, name);

    try {
      await stat(dest);
    } catch {
      const url = `https://repo1.maven.org/maven2/org/openjfx/javafx-${artifact}/${JAVAFX_VERSION}/${name}`;

      log.add(`Downloading ${name} …`);

      let res;

      try {
        res = await fetch(url);
      } catch (err) {
        throw new BuildFailure(`Could not reach Maven Central for JavaFX (${name}): ${err.message}`);
      }

      if (!res.ok) {
        throw new BuildFailure(`Could not download JavaFX (${name}): HTTP ${res.status}`);
      }

      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }

    jars.push(dest);
  }

  return jars;
}

async function ensureJavaFxJmods(modules, log) {
  await stat(JAVAFX_JMODS).catch(() => {
    throw new BuildFailure(`JavaFX JMODS directory not found: ${JAVAFX_JMODS}. Set JAVAFX_JMODS in server/.env.`);
  });

  for (const moduleName of modules) {
    const artifact = javaFxArtifactName(moduleName);
    const jmod = path.join(JAVAFX_JMODS, `javafx.${artifact}.jmod`);

    await stat(jmod).catch(() => {
      throw new BuildFailure(`Missing JavaFX JMOD: ${jmod}`);
    });
  }

  log.add(`Using JavaFX JMODS from ${JAVAFX_JMODS}`);
}

function mergeJar(target, seen, jarPath, log) {
  let dep;
  let entries;

  try {
    dep = new AdmZip(jarPath);
    entries = dep.getEntries();
  } catch (err) {
    log.add(`Warning: could not open dependency jar ${path.basename(jarPath)}: ${err.message}`);
    return false;
  }

  for (const entry of entries) {
    const name = entry.entryName;

    if (!isSafeZipEntryName(name)) {
      log.add(`Warning: skipped invalid jar entry in ${path.basename(jarPath)}: ${JSON.stringify(name)}`);
      continue;
    }

    if (entry.isDirectory) continue;
    if (name === 'META-INF/MANIFEST.MF') continue;
    if (/^META-INF\/.*\.(SF|DSA|RSA)$/i.test(name)) continue;
    if (name === 'module-info.class') continue;
    if (seen.has(name)) continue;

    seen.add(name);

    let data;

    try {
      data = entry.getData();
    } catch (err) {
      log.add(`Warning: skipped unreadable jar entry in ${path.basename(jarPath)} (${JSON.stringify(name)}): ${err.message}`);
      continue;
    }

    try {
      target.addFile(name, data);
    } catch (err) {
      log.add(`Warning: skipped jar entry in ${path.basename(jarPath)} (${JSON.stringify(name)}): ${err.message}`);
    }
  }

  return true;
}

function isSafeZipEntryName(name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  if (name.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (name.split(/[\\/]+/).includes('..')) return false;

  return true;
}

async function importImage(game, repoDir, rel, kind, log) {
  const abs = path.join(repoDir, rel);

  try {
    await stat(abs);
  } catch {
    log.add(`Warning: ${kind} image not found: ${rel} — skipped`);
    return;
  }

  const ext = path.extname(rel).toLowerCase();

  const contentType = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }[ext];

  if (!contentType) {
    log.add(`Warning: unsupported ${kind} format "${ext}" — skipped`);
    return;
  }

  const fileId = await uploadFromPath(abs, `${game.slug}-${kind}${ext}`, contentType);

  game.media.push({
    fileId,
    contentType,
    kind,
  });

  log.add(`Imported ${kind}: ${rel}`);
}

function safeAppName(name, fallback = 'ISCGame') {
  const clean = String(name)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/[<>:"/\\|?*]/g, ' ')
      .replace(/[. ]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
      .trim();

  if (clean) return clean;

  return safeFileName(fallback)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 60)
      .trim() || 'ISCGame';
}

function safeFileName(name) {
  return String(name)
      .replace(/[<>:"/\\|?*\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'isc-game';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const readmeTxt = (m, game, appName) => `${m.title} v${m.version}
${'='.repeat(m.title.length + m.version.length + 2)}

${m.shortDescription}

By: ${m.authors.join(', ') || 'ISC students'}
${m.controls ? `Controls: ${m.controls}\n` : ''}
How to play
-----------
Windows: double-click ${appName}.exe

No Java installation is required.
The package includes its own Java runtime.

Packaged by ISC Steam from ${game.repoUrl} (commit ${game.commit}).
Made with FunGraphics at HES-SO Valais.
`;
