#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const scanStaged = args.has('--staged');
const scanAll = args.has('--all') || !scanStaged;

if (process.env.SECRET_SCAN_BYPASS === '1') {
  console.log('[secret-scan] bypassed by SECRET_SCAN_BYPASS=1');
  process.exit(0);
}

const PATTERNS = [
  { name: 'GitHub PAT (classic)', regex: /ghp_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub PAT (fine-grained)', regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'OpenAI style key', regex: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  {
    name: 'Private key block',
    regex: /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP|PRIVATE) PRIVATE KEY-----/g
  }
];

function runGit(cmdArgs, encoding = 'utf8') {
  const out = spawnSync('git', cmdArgs, {
    cwd: ROOT,
    encoding,
    maxBuffer: 10 * 1024 * 1024
  });
  return out;
}

function listFiles() {
  if (scanStaged) {
    const out = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
    if (out.status !== 0) return [];
    return String(out.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const out = runGit(['ls-files']);
  if (out.status !== 0) return [];
  return String(out.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadFileContent(file) {
  if (scanStaged) {
    const out = runGit(['show', `:${file}`], null);
    if (out.status !== 0) return '';
    return Buffer.isBuffer(out.stdout) ? out.stdout.toString('utf8') : String(out.stdout || '');
  }

  const out = runGit(['show', `HEAD:${file}`], null);
  if (out.status === 0) {
    return Buffer.isBuffer(out.stdout) ? out.stdout.toString('utf8') : String(out.stdout || '');
  }

  const wd = runGit(['show', `:${file}`], null);
  if (wd.status === 0) {
    return Buffer.isBuffer(wd.stdout) ? wd.stdout.toString('utf8') : String(wd.stdout || '');
  }
  return '';
}

function isLikelyText(content) {
  if (!content) return false;
  return !content.includes('\u0000');
}

function scanContent(content) {
  const hits = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    for (const rule of PATTERNS) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(line)) {
        // Ignore obvious placeholders
        if (/<token>|<api[_-]?key>|example|placeholder/i.test(line)) continue;
        hits.push({ lineNo, rule: rule.name, line: line.slice(0, 220) });
      }
    }
  }

  return hits;
}

function main() {
  const files = listFiles();
  if (!files.length) {
    console.log('[secret-scan] no files to scan');
    return;
  }

  const findings = [];

  for (const file of files) {
    // Skip lockfile noise for speed and false positives
    if (file.endsWith('package-lock.json')) continue;

    const content = loadFileContent(file);
    if (!isLikelyText(content)) continue;

    const hits = scanContent(content);
    for (const hit of hits) {
      findings.push({ file, ...hit });
    }
  }

  if (!findings.length) {
    console.log(`[secret-scan] OK (${files.length} files scanned)`);
    return;
  }

  console.error('\n[secret-scan] Potential secret leak detected:\n');
  findings.forEach((f) => {
    console.error(`- ${f.file}:${f.lineNo} [${f.rule}]`);
    console.error(`  ${f.line}`);
  });

  console.error('\nCommit blocked. Please remove secrets or use placeholders.');
  process.exit(1);
}

main();
