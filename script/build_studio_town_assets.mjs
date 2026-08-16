#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const conceptRoot = path.resolve(process.argv[2] || path.join(repoRoot, '..', 'Agentic Movie Studio Concepts'));
const outputRoot = path.join(repoRoot, 'src', 'modules', 'studio-town', 'assets');
const stagingRoot = `${outputRoot}.staging-${process.pid}`;

const sharpCandidates = [
  process.env.STUDIO_SHARP_MODULE,
  path.join(repoRoot, '..', 'THE_CLOSED_INDEX', 'node_modules', '.pnpm', 'sharp@0.34.5', 'node_modules', 'sharp'),
  path.join(repoRoot, '..', 'AbandonedMuse.com', 'node_modules', '.pnpm', 'sharp@0.34.5', 'node_modules', 'sharp')
].filter(Boolean);

let sharp;
for (const candidate of sharpCandidates) {
  try {
    sharp = require(candidate);
    break;
  } catch {}
}
if (!sharp) throw new Error('A local Sharp installation is required to validate Studio Town source art.');

function insideRepo(candidate) {
  const relative = path.relative(repoRoot, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function removeGenerated(candidate) {
  if (!insideRepo(candidate) || path.basename(candidate).startsWith('assets') === false) {
    throw new Error(`Refusing to replace unexpected path: ${candidate}`);
  }
  fs.rmSync(candidate, { recursive: true, force: true });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function canonicalRoleIds() {
  const html = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');
  const start = html.indexOf('const CREW_ROSTER = [');
  const end = html.indexOf('const CREW_ALL', start);
  if (start < 0 || end <= start) throw new Error('Could not locate the canonical Studio crew roster.');
  const ids = [...html.slice(start, end).matchAll(/\{ id:'([^']+)'/g)].map(match => match[1]);
  if (ids.length !== 23 || new Set(ids).size !== ids.length) {
    throw new Error(`Expected 23 unique canonical roles, found ${ids.length}.`);
  }
  return ids;
}

async function inspectFrame(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`${file} did not decode as RGBA.`);
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let edgeOpaquePixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha > 0 && (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1)) {
        edgeOpaquePixels += 1;
      }
      if (alpha < 96) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error(`${file} has no visible sprite pixels.`);
  const bottomPadding = info.height - 1 - maxY;
  if (edgeOpaquePixels !== 0) throw new Error(`${file} touches its transparent canvas edge.`);
  if (bottomPadding < 12) throw new Error(`${file} has only ${bottomPadding}px of foot clearance.`);
  return {
    width: info.width,
    height: info.height,
    anchor: { x: Math.round(info.width / 2), y: maxY },
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    bottomPadding,
    edgeOpaquePixels,
    sha256: sha256(file)
  };
}

const canonicalRoles = canonicalRoleIds();
const sourceAnimationRoot = path.join(conceptRoot, 'sprites-v1', 'animated');
const sourceManifestPath = path.join(sourceAnimationRoot, 'crew-animation-atlas.json');
const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
const sourceRoles = sourceManifest.sheets.flatMap(sheet => sheet.roles || []);
if (JSON.stringify(sourceRoles) !== JSON.stringify(canonicalRoles)) {
  throw new Error(`Sprite roles do not match Studio's canonical roster.\nStudio: ${canonicalRoles.join(', ')}\nSprites: ${sourceRoles.join(', ')}`);
}

const mapSource = path.join(conceptRoot, 'agentic-movie-studio-town-empty-v2.png');
const mapMetadata = await sharp(mapSource).metadata();
if (mapMetadata.width !== 1672 || mapMetadata.height !== 941) {
  throw new Error(`Studio Town map must be 1672x941, found ${mapMetadata.width}x${mapMetadata.height}.`);
}

removeGenerated(stagingRoot);
fs.mkdirSync(path.join(stagingRoot, 'crew'), { recursive: true });
const mapOutput = path.join(stagingRoot, 'studio-town.png');
fs.copyFileSync(mapSource, mapOutput);

const frameIds = ['idle', 'walk_left', 'walk_right', 'talk'];
const roles = [];
for (const roleId of canonicalRoles) {
  const roleOutput = path.join(stagingRoot, 'crew', roleId);
  fs.mkdirSync(roleOutput, { recursive: true });
  const frames = {};
  let roleDimensions = '';
  for (const frameId of frameIds) {
    const source = path.join(sourceAnimationRoot, 'frames', roleId, `${frameId}.png`);
    if (!fs.existsSync(source)) throw new Error(`Missing ${roleId}/${frameId}.png.`);
    const inspected = await inspectFrame(source);
    const dimensions = `${inspected.width}x${inspected.height}`;
    if (roleDimensions && dimensions !== roleDimensions) {
      throw new Error(`${roleId} frame dimensions drifted: ${roleDimensions} versus ${dimensions}.`);
    }
    roleDimensions = dimensions;
    const destination = path.join(roleOutput, `${frameId}.png`);
    fs.copyFileSync(source, destination);
    frames[frameId] = Object.assign({
      src: `./modules/studio-town/assets/crew/${roleId}/${frameId}.png`
    }, inspected);
  }
  roles.push({ roleId, displayHeight: 64, frames });
}

const manifest = {
  schema: 'agentic-movie-studio/studio-town-assets@1',
  map: {
    src: './modules/studio-town/assets/studio-town.png',
    width: mapMetadata.width,
    height: mapMetadata.height,
    sha256: sha256(mapOutput)
  },
  frameIds,
  roles
};

fs.writeFileSync(path.join(stagingRoot, 'town-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
fs.writeFileSync(path.join(stagingRoot, 'town-assets.js'),
  `globalThis.STUDIO_TOWN_ASSETS = ${JSON.stringify(manifest, null, 2)};\n`, { mode: 0o644 });

if (fs.existsSync(outputRoot)) removeGenerated(outputRoot);
fs.renameSync(stagingRoot, outputRoot);
console.log(`Validated and imported ${roles.length} crew roles, ${roles.length * frameIds.length} source frames, and the original Studio Town map.`);
