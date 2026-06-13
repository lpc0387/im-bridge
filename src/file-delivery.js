import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const DEFAULT_MIME_TYPES = new Map([
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.pdf', 'application/pdf'],
  ['.csv', 'text/csv'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.zip', 'application/zip'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
]);

const SECRET_FILE_RE = /(^|[._-])(env|secret|secrets|token|credential|credentials|key|private)([._-]|$)/i;

export function getWorkspaceRoot() {
  return path.resolve(config.fileDelivery.workspaceRoot || process.cwd());
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getMimeType(filePath) {
  return DEFAULT_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

export function sanitizeFilename(name) {
  return path.basename(String(name || 'file')).replace(/[\r\n"\\]/g, '_').trim() || 'file';
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function getDeniedReason(filename, ext, stat) {
  if (!stat.isFile()) return '不是普通文件';
  if (filename.startsWith('.')) return '隐藏文件不允许发送';
  if (SECRET_FILE_RE.test(filename)) return '疑似密钥或凭据文件不允许发送';
  if (!config.fileDelivery.extensions.has(ext)) return `文件类型 ${ext || '(none)'} 不在允许列表`;
  if (stat.size > config.fileDelivery.maxBytes) {
    return `文件超过 ${formatBytes(config.fileDelivery.maxBytes)} 限制`;
  }
  return null;
}

export async function classifyDeliverableFile(filePath) {
  if (!filePath) return { ok: false, reason: '文件路径为空' };

  const workspaceRoot = getWorkspaceRoot();
  const resolved = path.resolve(filePath);
  let realPath;
  let rootRealPath;
  let stat;

  try {
    [realPath, rootRealPath] = await Promise.all([
      fs.realpath(resolved),
      fs.realpath(workspaceRoot).catch(() => workspaceRoot),
    ]);
    stat = await fs.stat(realPath);
  } catch (err) {
    return { ok: false, reason: `无法读取文件: ${err.message}` };
  }

  if (!isInside(rootRealPath, realPath)) {
    return { ok: false, reason: '文件不在允许的工作区内' };
  }

  const name = sanitizeFilename(path.basename(realPath));
  const ext = path.extname(name).toLowerCase();
  const denied = getDeniedReason(name, ext, stat);
  if (denied) return { ok: false, reason: denied };

  return {
    ok: true,
    file: {
      path: realPath,
      name,
      size: stat.size,
      ext,
      mimeType: getMimeType(realPath),
      relativePath: path.relative(rootRealPath, realPath),
    },
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractWorkspacePaths(text) {
  if (!text) return [];
  const workspaceRoot = getWorkspaceRoot();
  const escapedRoot = escapeRegExp(workspaceRoot);
  const matches = String(text).match(new RegExp(`${escapedRoot}[^\\s，,。；;：:)）\\]】>"'` + '`' + `]+`, 'g')) || [];
  return matches.map(p => p.replace(/[。；;：:,，.。)）\]】>"'` + '`' + `]+$/, ''));
}

export function stripKnownPaths(text, files = []) {
  if (!text) return text;
  let output = String(text);
  const workspaceRoot = getWorkspaceRoot();
  const replacements = new Map();

  for (const file of files) {
    if (!file?.path || !file?.name) continue;
    replacements.set(file.path, file.name);
    replacements.set(path.resolve(file.path), file.name);
  }

  for (const [needle, replacement] of replacements) {
    output = output.split(needle).join(replacement);
  }

  output = output.split(workspaceRoot + path.sep).join('');
  output = output.split(workspaceRoot).join('');
  return output.replace(/\/root\/im-bridge\//g, '').replace(/\/root\/im-bridge/g, '').trim();
}

export function dedupeFiles(files) {
  const seen = new Set();
  const result = [];
  for (const file of files) {
    if (!file?.path || seen.has(file.path)) continue;
    seen.add(file.path);
    result.push(file);
    if (result.length >= config.fileDelivery.maxFiles) break;
  }
  return result;
}

export async function ensureUploadDir(platform) {
  const root = getWorkspaceRoot();
  const dir = path.join(root, 'uploads', sanitizeFilename(platform), new Date().toISOString().slice(0, 10));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function saveIncomingFile(platform, filename, data) {
  const dir = await ensureUploadDir(platform);
  const safeName = `${Date.now()}-${sanitizeFilename(filename)}`;
  const target = path.join(dir, safeName);
  await fs.writeFile(target, data);
  return target;
}
