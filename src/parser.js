'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITY_MAP = {
  H: 'High',
  M: 'Medium',
  L: 'Low',
  I: 'Informational',
  G: 'Gas',
};

const SEVERITY_ORDER = ['High', 'Medium', 'Low', 'Informational', 'Gas'];

/**
 * Parse optional YAML frontmatter from the top of a finding chunk.
 * Supports simple key: value pairs only (no nested structures).
 * Returns { frontmatter, body } where body is the markdown without the --- block.
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([^:]+):\s*(.+)$/);
    if (kv) frontmatter[kv[1].trim()] = kv[2].trim();
  }
  return { frontmatter, body: match[2] };
}

/**
 * Parse a single finding markdown chunk.
 * Requires YAML frontmatter with a `severity` field (e.g. severity: [H-1] or H-1).
 * The finding title is the first **bold** line in the body.
 */
function parseFindingChunk(chunk) {
  const trimmed = chunk.trim();
  if (!trimmed) return null;

  const { frontmatter, body } = parseFrontmatter(trimmed);

  // Extract severity code and number from frontmatter: supports "[H-1]" or "H-1"
  const severityRaw = (frontmatter.severity || '').trim();
  const idMatch = severityRaw.match(/\[?([A-Z])-(\d+)\]?/);
  if (!idMatch) return null;

  const severityCode = idMatch[1];
  const number = idMatch[2];
  const id = `${severityCode}-${number}`;
  const severity = SEVERITY_MAP[severityCode] || severityCode;

  // Title is the first **bold-only** line in the body
  const titleMatch = body.match(/^\s*\*\*([^*\n]+)\*\*\s*$/m);
  if (!titleMatch) return null;
  const title = titleMatch[1].trim();

  const status = frontmatter.status || 'Pending';
  const affectedContracts = frontmatter['affected-contracts'] || null;

  return { id, severity, title, status, affectedContracts, content: body };
}

/**
 * Split a findings.md file into individual finding chunks.
 * Each finding must start with a YAML frontmatter block (---).
 * The start of the next frontmatter block acts as the separator between findings.
 * A standalone --- line inside content that is immediately followed by a
 * frontmatter key (word: value) is treated as the start of the next finding.
 */
function splitFindingChunks(content) {
  const results = [];
  const lines = content.split('\n');
  let current = [];
  // States: 'between' (waiting for a finding), 'in_frontmatter', 'in_content'
  let state = 'between';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const nextTrimmed = i + 1 < lines.length ? lines[i + 1].trim() : '';

    if (state === 'between') {
      if (trimmed === '---') {
        // Opening --- of a new finding's frontmatter
        current.push(lines[i]);
        state = 'in_frontmatter';
      }
      // Skip blank lines / separators between findings
    } else if (state === 'in_frontmatter') {
      current.push(lines[i]);
      if (trimmed === '---') {
        // Closing --- of frontmatter, switch to reading content
        state = 'in_content';
      }
    } else { // in_content
      // Detect a standalone --- that is the opening of the next finding's frontmatter.
      // We recognise it by checking that the next non-empty line looks like a YAML key.
      if (trimmed === '---' && /^[a-zA-Z][^:]*:/.test(nextTrimmed)) {
        // Save the current finding, then start the new one with this --- line
        results.push(current.join('\n'));
        current = [lines[i]];
        state = 'in_frontmatter';
      } else {
        current.push(lines[i]);
      }
    }
  }

  if (current.length > 0 && current.join('\n').trim()) {
    results.push(current.join('\n'));
  }

  return results.filter(c => c.trim());
}

/**
 * Parse findings from a single markdown file (separated by `---` on its own line)
 * or from individual .md files in a directory.
 */
function parseFindings(inputDir) {
  const findingsDir = path.join(inputDir, 'findings');
  const findingsFile = path.join(inputDir, 'findings.md');

  let findings = [];

  if (fs.existsSync(findingsDir) && fs.statSync(findingsDir).isDirectory()) {
    // Individual files: H-01.md, M-01.md, etc.
    const files = fs.readdirSync(findingsDir)
      .filter(f => f.endsWith('.md'))
      .sort();

    for (const file of files) {
      const content = fs.readFileSync(path.join(findingsDir, file), 'utf8');
      const finding = parseFindingChunk(content);
      if (finding) findings.push(finding);
    }
  } else if (fs.existsSync(findingsFile)) {
    const content = fs.readFileSync(findingsFile, 'utf8');
    const chunks = splitFindingChunks(content);
    for (const chunk of chunks) {
      const finding = parseFindingChunk(chunk);
      if (finding) findings.push(finding);
    }
  } else {
    throw new Error(`No findings found. Expected "${findingsDir}/" directory or "${findingsFile}" file.`);
  }

  // Sort by severity order then by number
  findings.sort((a, b) => {
    const ai = SEVERITY_ORDER.indexOf(a.severity);
    const bi = SEVERITY_ORDER.indexOf(b.severity);
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  });

  return findings;
}

/**
 * Count findings by severity.
 */
function countBySeverity(findings) {
  const counts = {};
  for (const sev of SEVERITY_ORDER) counts[sev] = 0;
  for (const f of findings) {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  }
  counts.Total = findings.length;
  return counts;
}

/**
 * Read optional markdown section file. Returns empty string if not found.
 */
function readSection(inputDir, filename) {
  const filePath = path.join(inputDir, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

/**
 * Load and validate metadata.json
 */
function loadMetadata(inputDir) {
  const metaPath = path.join(inputDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`metadata.json not found in ${inputDir}`);
  }
  const raw = fs.readFileSync(metaPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Find logo file (svg or png or jpg) in input dir.
 * Returns base64 data URI or null.
 */
function loadLogo(inputDir, metadata) {
  const logoFile = metadata.logo || null;
  const candidates = logoFile
    ? [path.join(inputDir, logoFile)]
    : ['logo.svg', 'logo.png', 'logo.jpg', 'logo.jpeg'].map(f => path.join(inputDir, f));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const ext = path.extname(candidate).toLowerCase().replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
      const data = fs.readFileSync(candidate);
      return `data:${mime};base64,${data.toString('base64')}`;
    }
  }
  return null;
}

/**
 * Main parse function — returns everything the renderer needs.
 */
function parse(inputDir) {
  const metadata = loadMetadata(inputDir);
  const findings = parseFindings(inputDir);
  const counts = countBySeverity(findings);
  const logo = loadLogo(inputDir, metadata);

  const sections = {
    about: readSection(inputDir, 'about.md'),
    disclaimer: readSection(inputDir, 'disclaimer.md'),
    protocolSummary: readSection(inputDir, 'protocol-summary.md'),
    executiveSummary: readSection(inputDir, 'executive-summary.md'),
  };

  return { metadata, findings, counts, logo, sections };
}

module.exports = { parse, SEVERITY_ORDER };
