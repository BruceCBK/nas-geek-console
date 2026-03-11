const fs = require('fs/promises');
const { existsSync } = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MEMORY_DIR, MEMORY_MD } = require('../config/paths');
const { HttpError } = require('../utils/http-error');
const { pickText, toArray, nowIso } = require('../utils/text');

function resolveMemoryPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new HttpError(400, 'INVALID_MEMORY_PATH', 'invalid path');
  }

  const clean = inputPath.trim();
  if (!clean) {
    throw new HttpError(400, 'INVALID_MEMORY_PATH', 'invalid path');
  }

  if (clean === 'MEMORY.md') return MEMORY_MD;

  const base = path.resolve(MEMORY_DIR);
  const resolved = path.resolve(base, clean);
  if (!(resolved === base || resolved.startsWith(base + path.sep))) {
    throw new HttpError(400, 'PATH_TRAVERSAL_BLOCKED', 'path traversal blocked');
  }

  return resolved;
}

function toMemoryRelative(absPath) {
  if (absPath === MEMORY_MD) return 'MEMORY.md';
  const base = path.resolve(MEMORY_DIR);
  return path.relative(base, absPath).split(path.sep).join('/');
}

function normalizeMemoryRelativePath(inputPath) {
  return toMemoryRelative(resolveMemoryPath(inputPath));
}

function parseLimit(limitInput, fallback, min, max) {
  const n = Number.parseInt(String(limitInput || fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isFenceLine(line) {
  return /^(`{3,}|~{3,})/.test(line.trim());
}

function getFenceMarker(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) return '`';
  if (trimmed.startsWith('~~~')) return '~';
  return '';
}

function isMarkdownSensitiveLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|`{3,}|~{3,}|\|)/.test(trimmed);
}

function shrinkSnippet(input, maxLen = 600) {
  const text = String(input || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

async function cleanupEmptyMemoryDirs(startDir) {
  const base = path.resolve(MEMORY_DIR);
  let current = path.resolve(startDir);

  while (current.startsWith(base + path.sep)) {
    let entries = [];
    try {
      entries = await fs.readdir(current);
    } catch {
      break;
    }

    if (entries.length > 0) break;
    try {
      await fs.rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

function compressMemoryText(contentInput) {
  const source = typeof contentInput === 'string' ? contentInput : '';
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const output = [];

  let inFence = false;
  let fenceMarker = '';
  let blankRun = 0;
  let prevEmitted = '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, '');
    const trimmed = line.trim();

    if (isFenceLine(line)) {
      output.push(line);
      blankRun = 0;
      prevEmitted = line;

      const currentMarker = getFenceMarker(line);
      if (!inFence) {
        inFence = true;
        fenceMarker = currentMarker;
      } else if (fenceMarker && currentMarker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (!inFence && !trimmed) {
      blankRun += 1;
      if (blankRun > 1) continue;
      output.push('');
      prevEmitted = '';
      continue;
    }

    blankRun = 0;
    if (!inFence && line === prevEmitted && !isMarkdownSensitiveLine(line)) {
      continue;
    }

    output.push(line);
    prevEmitted = line;
  }

  let compressedContent = output.join('\n');
  if (normalized.endsWith('\n') && compressedContent && !compressedContent.endsWith('\n')) {
    compressedContent += '\n';
  }

  const originalLength = source.length;
  const compressedLength = compressedContent.length;
  const ratio = originalLength > 0 ? Number((compressedLength / originalLength).toFixed(4)) : 1;

  return {
    originalLength,
    compressedLength,
    ratio,
    compressedContent
  };
}

function getTemplateContent(templateType, payload = {}) {
  const title = pickText(payload.title, 'Untitled');
  const date = new Date().toISOString().slice(0, 10);
  const uuid = crypto.randomUUID().slice(0, 8);

  if (templateType === 'tool-card') {
    return `# Tool Card: ${title}\n\n- Date: ${date}\n- ID: ${uuid}\n- Category:\n- Source:\n\n## Problem\n\n## Tool Summary\n\n## Setup Steps\n1. \n2. \n\n## Usage Notes\n\n## Cost / Limits\n\n## Next Action\n`;
  }

  if (templateType === 'topic-card') {
    return `# Topic Card: ${title}\n\n- Date: ${date}\n- ID: ${uuid}\n- Platform:\n- Priority:\n\n## Why This Topic\n\n## Audience\n\n## Core Points\n1. \n2. \n3. \n\n## References\n\n## Draft Hook\n`;
  }

  if (templateType === 'knowledge-card') {
    return `# Knowledge Card: ${title}\n\n- Date: ${date}\n- ID: ${uuid}\n- Domain:\n- Confidence: medium\n\n## Key Insight\n\n## Supporting Details\n\n## Example\n\n## Open Questions\n\n## Related Files\n`;
  }

  throw new HttpError(400, 'INVALID_TEMPLATE_TYPE', 'templateType must be tool-card/topic-card/knowledge-card');
}

class MemoryService {
  constructor(indexStore) {
    this.indexStore = indexStore;
  }

  async init() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    await this.indexStore.init();
    await this.rebuildIndex();
  }

  async listFiles() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    const files = [];

    const walk = async (dir, prefix = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absPath = resolveMemoryPath(relativePath);

        if (entry.isDirectory()) {
          await walk(absPath, relativePath);
          continue;
        }
        if (!entry.isFile()) continue;

        const stat = await fs.stat(absPath);
        files.push({
          path: relativePath,
          modifiedAt: stat.mtime.toISOString(),
          size: stat.size
        });
      }
    };

    await walk(MEMORY_DIR);

    files.sort((a, b) => a.path.localeCompare(b.path));

    if (existsSync(MEMORY_MD)) {
      const stat = await fs.stat(MEMORY_MD);
      files.unshift({
        path: 'MEMORY.md',
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size
      });
    }

    return files;
  }

  async rebuildIndex() {
    const files = await this.listFiles();
    const payload = {
      updatedAt: nowIso(),
      files
    };
    await this.indexStore.write(payload);
    return payload;
  }

  async getIndex() {
    const index = await this.indexStore.read();
    const files = toArray(index?.files);
    if (!files.length) {
      return this.rebuildIndex();
    }
    return {
      updatedAt: pickText(index?.updatedAt) || nowIso(),
      files
    };
  }

  async recent(limitInput = 12) {
    const limit = parseLimit(limitInput, 12, 1, 100);
    const index = await this.getIndex();
    return toArray(index.files)
      .slice()
      .sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')))
      .slice(0, limit);
  }

  async search(queryInput, limitInput = 20) {
    const query = pickText(queryInput).toLowerCase();
    const limit = parseLimit(limitInput, 20, 1, 80);
    if (!query) return [];

    const files = await this.listFiles();
    const rows = [];

    for (const file of files) {
      const pathHit = file.path.toLowerCase().includes(query);
      let contentHit = false;
      let snippet = '';

      if (!pathHit) {
        try {
          const abs = resolveMemoryPath(file.path);
          const content = await fs.readFile(abs, 'utf8');
          const lower = content.toLowerCase();
          const idx = lower.indexOf(query);
          if (idx >= 0) {
            contentHit = true;
            const from = Math.max(0, idx - 40);
            const to = Math.min(content.length, idx + query.length + 60);
            snippet = content.slice(from, to).replace(/\s+/g, ' ').trim();
          }
        } catch {
          // ignore single file search errors
        }
      }

      if (pathHit || contentHit) {
        rows.push({
          path: file.path,
          modifiedAt: file.modifiedAt,
          snippet,
          score: pathHit ? 2 : 1
        });
      }
    }

    return rows
      .sort((a, b) => b.score - a.score || String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
      .slice(0, limit)
      .map(({ score, ...rest }) => rest);
  }

  async readFile(pathInput) {
    const absPath = resolveMemoryPath(pathInput);
    try {
      const content = await fs.readFile(absPath, 'utf8');
      return {
        path: toMemoryRelative(absPath),
        content
      };
    } catch (err) {
      throw new HttpError(400, 'MEMORY_READ_FAILED', err?.message || 'Failed to read memory file');
    }
  }

  async writeFile(pathInput, content) {
    if (typeof content !== 'string') {
      throw new HttpError(400, 'INVALID_MEMORY_CONTENT', 'content must be string');
    }

    const absPath = resolveMemoryPath(pathInput);
    try {
      if (absPath !== MEMORY_MD) {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
      }
      await fs.writeFile(absPath, content, 'utf8');
      await this.rebuildIndex();
      return {
        path: toMemoryRelative(absPath)
      };
    } catch (err) {
      throw new HttpError(400, 'MEMORY_WRITE_FAILED', err?.message || 'Failed to save memory file');
    }
  }

  async createFile(pathInput, content = '') {
    if (typeof content !== 'string') {
      throw new HttpError(400, 'INVALID_MEMORY_CONTENT', 'content must be string');
    }

    const absPath = resolveMemoryPath(pathInput);
    if (existsSync(absPath)) {
      throw new HttpError(409, 'MEMORY_FILE_EXISTS', 'file already exists');
    }

    try {
      if (absPath !== MEMORY_MD) {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
      }
      await fs.writeFile(absPath, content, 'utf8');
      await this.rebuildIndex();
      return {
        path: toMemoryRelative(absPath)
      };
    } catch (err) {
      throw new HttpError(400, 'MEMORY_CREATE_FAILED', err?.message || 'Failed to create file');
    }
  }

  async deleteFile(pathInput) {
    const absPath = resolveMemoryPath(pathInput);
    if (absPath === MEMORY_MD) {
      throw new HttpError(400, 'MEMORY_PROTECTED', 'MEMORY.md cannot be deleted');
    }

    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        throw new HttpError(400, 'MEMORY_DELETE_FAILED', 'path is not a file');
      }
      await fs.unlink(absPath);
      await cleanupEmptyMemoryDirs(path.dirname(absPath));
      await this.rebuildIndex();
      return {
        path: toMemoryRelative(absPath)
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err?.code === 'ENOENT') {
        throw new HttpError(404, 'MEMORY_FILE_NOT_FOUND', 'memory file not found');
      }
      throw new HttpError(400, 'MEMORY_DELETE_FAILED', err?.message || 'Failed to delete file');
    }
  }

  async renameFile(fromPathInput, toPathInput) {
    const fromAbsPath = resolveMemoryPath(fromPathInput);
    const toAbsPath = resolveMemoryPath(toPathInput);
    if (fromAbsPath === MEMORY_MD || toAbsPath === MEMORY_MD) {
      throw new HttpError(400, 'MEMORY_PROTECTED', 'MEMORY.md cannot be renamed');
    }
    if (fromAbsPath === toAbsPath) {
      throw new HttpError(400, 'INVALID_RENAME_TARGET', 'fromPath and toPath cannot be the same');
    }
    if (existsSync(toAbsPath)) {
      throw new HttpError(409, 'MEMORY_FILE_EXISTS', 'target file already exists');
    }

    try {
      const stat = await fs.stat(fromAbsPath);
      if (!stat.isFile()) {
        throw new HttpError(400, 'MEMORY_RENAME_FAILED', 'source path is not a file');
      }
      await fs.mkdir(path.dirname(toAbsPath), { recursive: true });
      await fs.rename(fromAbsPath, toAbsPath);
      await cleanupEmptyMemoryDirs(path.dirname(fromAbsPath));
      await this.rebuildIndex();
      return {
        fromPath: toMemoryRelative(fromAbsPath),
        toPath: toMemoryRelative(toAbsPath),
        path: toMemoryRelative(toAbsPath)
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err?.code === 'ENOENT') {
        throw new HttpError(404, 'MEMORY_FILE_NOT_FOUND', 'memory file not found');
      }
      throw new HttpError(400, 'MEMORY_RENAME_FAILED', err?.message || 'Failed to rename file');
    }
  }

  async compressFile(pathInput, contentInput, applyInput = false) {
    const absPath = resolveMemoryPath(pathInput);
    const relativePath = toMemoryRelative(absPath);
    const apply = applyInput === true;

    let source = '';
    if (typeof contentInput === 'string') {
      source = contentInput;
    } else {
      try {
        source = await fs.readFile(absPath, 'utf8');
      } catch (err) {
        throw new HttpError(400, 'MEMORY_READ_FAILED', err?.message || 'Failed to read memory file');
      }
    }

    const compressed = compressMemoryText(source);

    if (apply) {
      try {
        const stat = await fs.stat(absPath);
        if (!stat.isFile()) {
          throw new HttpError(400, 'MEMORY_WRITE_FAILED', 'path is not a file');
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err?.code === 'ENOENT') {
          throw new HttpError(404, 'MEMORY_FILE_NOT_FOUND', 'memory file not found');
        }
        throw new HttpError(400, 'MEMORY_WRITE_FAILED', err?.message || 'Failed to compress file');
      }

      try {
        await fs.writeFile(absPath, compressed.compressedContent, 'utf8');
        await this.rebuildIndex();
      } catch (err) {
        throw new HttpError(400, 'MEMORY_WRITE_FAILED', err?.message || 'Failed to save compressed file');
      }
    }

    return {
      ...compressed,
      path: relativePath,
      applied: apply
    };
  }

  async extract(queryInput, limitInput = 20) {
    const query = pickText(queryInput).toLowerCase();
    const limit = parseLimit(limitInput, 20, 1, 100);
    if (!query) return [];

    const terms = Array.from(new Set(query.split(/\s+/).map((item) => item.trim()).filter(Boolean)));
    if (!terms.length) return [];

    const files = await this.listFiles();
    const rows = [];

    for (const file of files) {
      const abs = resolveMemoryPath(file.path);
      let content = '';
      try {
        content = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }

      const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      const pathLower = file.path.toLowerCase();
      const pathBoost = pathLower.includes(query) ? 2 : 0;

      let skipUntil = -1;
      for (let i = 0; i < lines.length; i += 1) {
        if (i <= skipUntil) continue;
        const lineLower = lines[i].toLowerCase();
        const fullHit = lineLower.includes(query);
        let termHits = 0;
        for (const term of terms) {
          if (lineLower.includes(term)) termHits += 1;
        }
        if (!fullHit && termHits === 0) continue;

        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        const snippet = shrinkSnippet(lines.slice(start, end + 1).join('\n'));
        rows.push({
          path: file.path,
          lineStart: start + 1,
          lineEnd: end + 1,
          score: pathBoost + (fullHit ? 8 : 0) + termHits * 3,
          snippet: snippet || lines[i].trim()
        });
        skipUntil = end;
      }
    }

    return rows
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.lineStart - b.lineStart)
      .slice(0, limit);
  }

  async createFromTemplate(templateType, payload = {}) {
    const content = getTemplateContent(templateType, payload);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `cards/${templateType}-${ts}.md`;
    const pathInput = pickText(payload.path, defaultName);
    const result = await this.createFile(pathInput, content);

    return {
      ...result,
      templateType,
      content
    };
  }
}

module.exports = {
  MemoryService,
  resolveMemoryPath,
  toMemoryRelative,
  normalizeMemoryRelativePath,
  compressMemoryText
};
