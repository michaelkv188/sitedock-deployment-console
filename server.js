'use strict';

const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_ROOT = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DEPLOYMENTS_ROOT = path.join(DATA_ROOT, 'deployments');
const META_FILE = path.join(DATA_ROOT, 'deployments.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_INSPECT_BYTES = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ZIP_BYTES, files: 1 }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(express.json({ limit: '1mb' }));

function apiAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const supplied = req.get('x-admin-password') || '';
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(ADMIN_PASSWORD);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'Incorrect dashboard password.' });
  }
  next();
}

async function ensureStorage() {
  await fsp.mkdir(DEPLOYMENTS_ROOT, { recursive: true });
  try {
    await fsp.access(META_FILE);
  } catch {
    await fsp.writeFile(META_FILE, '[]\n', 'utf8');
  }
}

async function readMetadata() {
  await ensureStorage();
  try {
    const parsed = JSON.parse(await fsp.readFile(META_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMetadata(items) {
  await ensureStorage();
  const tmp = `${META_FILE}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, META_FILE);
}

function safeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return name.slice(0, 80) || 'Untitled Site';
}

function normalizeZipPath(entryName) {
  const normalized = String(entryName || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error(`Unsafe ZIP path: ${entryName}`);
  }
  const pieces = normalized.split('/');
  if (pieces.some((piece) => piece === '..')) {
    throw new Error(`Unsafe ZIP path: ${entryName}`);
  }
  return normalized;
}

function isSymlink(entry) {
  const unixMode = (entry.header.attr >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function chooseStripPrefix(entries) {
  const files = entries.filter((entry) => !entry.isDirectory).map((entry) => normalizeZipPath(entry.entryName));
  if (files.includes('index.html')) return '';
  if (!files.length) return '';
  const topLevels = new Set(files.map((file) => file.split('/')[0]));
  if (topLevels.size !== 1) return '';
  const [prefix] = [...topLevels];
  return files.includes(`${prefix}/index.html`) ? `${prefix}/` : '';
}

async function extractZip(buffer, siteDir) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('The uploaded file is not a valid ZIP archive.');
  }

  const entries = zip.getEntries().filter((entry) => {
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    return !name.startsWith('__MACOSX/') && !name.endsWith('/.DS_Store') && name !== '.DS_Store';
  });

  if (!entries.length) throw new Error('The ZIP archive is empty.');
  if (entries.length > MAX_FILES) throw new Error(`The ZIP contains more than ${MAX_FILES.toLocaleString()} entries.`);

  let unpackedBytes = 0;
  for (const entry of entries) {
    if (isSymlink(entry)) throw new Error('Symbolic links are not allowed in website ZIPs.');
    unpackedBytes += Number(entry.header.size || 0);
    if (unpackedBytes > MAX_UNPACKED_BYTES) {
      throw new Error('The extracted website is larger than 250 MB.');
    }
    normalizeZipPath(entry.entryName);
  }

  const stripPrefix = chooseStripPrefix(entries);
  await fsp.rm(siteDir, { recursive: true, force: true });
  await fsp.mkdir(siteDir, { recursive: true });

  let fileCount = 0;
  for (const entry of entries) {
    let relative = normalizeZipPath(entry.entryName);
    if (stripPrefix && relative.startsWith(stripPrefix)) relative = relative.slice(stripPrefix.length);
    if (!relative) continue;

    const target = path.resolve(siteDir, relative);
    if (target !== siteDir && !target.startsWith(`${siteDir}${path.sep}`)) {
      throw new Error(`Unsafe ZIP path: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
    fileCount += 1;
  }

  const indexPath = path.join(siteDir, 'index.html');
  try {
    await fsp.access(indexPath);
  } catch {
    await fsp.rm(siteDir, { recursive: true, force: true });
    throw new Error('No index.html was found at the website root. Put index.html at the top level of the ZIP.');
  }

  return { fileCount, unpackedBytes };
}

async function walkFiles(root, current = root, output = []) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) {
      output.push({ path: relative, type: 'directory' });
      await walkFiles(root, absolute, output);
    } else {
      const stat = await fsp.stat(absolute);
      output.push({ path: relative, type: 'file', size: stat.size });
    }
  }
  return output;
}

function resolveDeploymentFile(id, relativePath) {
  const siteRoot = path.resolve(DEPLOYMENTS_ROOT, id, 'site');
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(siteRoot, normalized || 'index.html');
  if (resolved !== siteRoot && !resolved.startsWith(`${siteRoot}${path.sep}`)) return null;
  return { siteRoot, resolved };
}

function makePublicUrl(req, id) {
  return `${req.protocol}://${req.get('host')}/sites/${id}/`;
}

async function createOrReplaceDeployment(req, res, existingId = null) {
  if (!req.file) return res.status(400).json({ error: 'Choose a ZIP file to deploy.' });
  if (!/\.zip$/i.test(req.file.originalname || '')) {
    return res.status(400).json({ error: 'Only .zip files are accepted.' });
  }

  const id = existingId || crypto.randomBytes(7).toString('hex');
  const deploymentDir = path.join(DEPLOYMENTS_ROOT, id);
  const siteDir = path.join(deploymentDir, 'site');
  const sourcePath = path.join(deploymentDir, 'source.zip');
  const stagingDir = path.join(deploymentDir, `site-next-${crypto.randomBytes(4).toString('hex')}`);
  const backupDir = path.join(deploymentDir, `site-backup-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.mkdir(deploymentDir, { recursive: true });

  try {
    const result = await extractZip(req.file.buffer, stagingDir);

    let hadExistingSite = false;
    try {
      await fsp.access(siteDir);
      hadExistingSite = true;
      await fsp.rename(siteDir, backupDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    try {
      await fsp.rename(stagingDir, siteDir);
      await fsp.writeFile(sourcePath, req.file.buffer);
      if (hadExistingSite) await fsp.rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      await fsp.rm(siteDir, { recursive: true, force: true });
      if (hadExistingSite) await fsp.rename(backupDir, siteDir).catch(() => {});
      throw error;
    }

    const all = await readMetadata();
    const existing = all.find((item) => item.id === id);
    const now = new Date().toISOString();
    const item = {
      id,
      name: safeName(req.body.name || existing?.name || path.basename(req.file.originalname, path.extname(req.file.originalname))),
      originalFilename: req.file.originalname,
      status: 'live',
      fileCount: result.fileCount,
      sizeBytes: result.unpackedBytes,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    const next = existing
      ? all.map((deployment) => deployment.id === id ? item : deployment)
      : [item, ...all];
    await writeMetadata(next);

    return res.status(existing ? 200 : 201).json({ ...item, url: makePublicUrl(req, id) });
  } catch (error) {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    await fsp.rm(backupDir, { recursive: true, force: true });
    if (!existingId) await fsp.rm(deploymentDir, { recursive: true, force: true });
    return res.status(400).json({ error: error.message || 'Deployment failed.' });
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', apiAuth);

app.get('/api/deployments', async (req, res, next) => {
  try {
    const items = await readMetadata();
    res.json(items.map((item) => ({ ...item, url: makePublicUrl(req, item.id) })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/deployments', upload.single('siteZip'), (req, res, next) => {
  createOrReplaceDeployment(req, res).catch(next);
});
app.put('/api/deployments/:id', upload.single('siteZip'), async (req, res, next) => {
  try {
    const all = await readMetadata();
    if (!all.some((item) => item.id === req.params.id)) return res.status(404).json({ error: 'Deployment not found.' });
    return createOrReplaceDeployment(req, res, req.params.id);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/deployments/:id', async (req, res, next) => {
  try {
    const all = await readMetadata();
    const index = all.findIndex((item) => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Deployment not found.' });
    all[index] = { ...all[index], name: safeName(req.body.name || all[index].name), updatedAt: new Date().toISOString() };
    await writeMetadata(all);
    res.json({ ...all[index], url: makePublicUrl(req, all[index].id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/deployments/:id/files', async (req, res, next) => {
  try {
    const target = resolveDeploymentFile(req.params.id, '');
    if (!target) return res.status(400).json({ error: 'Invalid deployment.' });
    await fsp.access(target.siteRoot);
    res.json(await walkFiles(target.siteRoot));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Deployment not found.' });
    next(error);
  }
});

app.get('/api/deployments/:id/file', async (req, res, next) => {
  try {
    const target = resolveDeploymentFile(req.params.id, req.query.path);
    if (!target) return res.status(400).json({ error: 'Invalid file path.' });
    const stat = await fsp.stat(target.resolved);
    if (!stat.isFile()) return res.status(400).json({ error: 'Choose a file, not a folder.' });
    if (stat.size > MAX_INSPECT_BYTES) {
      return res.status(413).json({ error: 'This file is larger than the 2 MB inspection limit.' });
    }
    const buffer = await fsp.readFile(target.resolved);
    if (buffer.includes(0)) return res.status(415).json({ error: 'Binary files are shown in the live preview instead.' });
    res.type('text/plain').send(buffer.toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found.' });
    next(error);
  }
});

app.get('/api/deployments/:id/download', async (req, res, next) => {
  try {
    const all = await readMetadata();
    const item = all.find((deployment) => deployment.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Deployment not found.' });
    const sourcePath = path.join(DEPLOYMENTS_ROOT, req.params.id, 'source.zip');
    res.download(sourcePath, item.originalFilename || `${item.name}.zip`);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/deployments/:id', async (req, res, next) => {
  try {
    const all = await readMetadata();
    const exists = all.some((item) => item.id === req.params.id);
    if (!exists) return res.status(404).json({ error: 'Deployment not found.' });
    await fsp.rm(path.join(DEPLOYMENTS_ROOT, req.params.id), { recursive: true, force: true });
    await writeMetadata(all.filter((item) => item.id !== req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

async function serveDeployment(req, res, next) {
  try {
    const id = req.params.id;
    const requested = req.params[0] || '';
    const target = resolveDeploymentFile(id, requested);
    if (!target) return res.status(400).send('Invalid path');

    let filePath = target.resolved;
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
      await fsp.access(filePath);
    } catch {
      const acceptsHtml = (req.get('accept') || '').includes('text/html');
      if (acceptsHtml && !path.extname(requested)) filePath = path.join(target.siteRoot, 'index.html');
      else return res.status(404).send('Not found');
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
}

app.get('/sites/:id', (req, res) => res.redirect(302, `/sites/${req.params.id}/`));
app.get('/sites/:id/*', serveDeployment);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The ZIP is larger than 50 MB.' });
  }
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

ensureStorage()
  .then(() => app.listen(PORT, '0.0.0.0', () => {
    console.log(`SiteDock running on http://localhost:${PORT}`);
    console.log(ADMIN_PASSWORD ? 'Dashboard password protection enabled.' : 'WARNING: ADMIN_PASSWORD is not set.');
  }))
  .catch((error) => {
    console.error('Could not initialize storage:', error);
    process.exit(1);
  });
