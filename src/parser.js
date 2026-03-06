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
 * Supports optional YAML frontmatter at the top for status, affected-contracts, etc.
 * Extracts id, severity, title from the first heading: ### [H-1] Title
 */
function parseFindingChunk(chunk) {
  const trimmed = chunk.trim();
  if (!trimmed) return null;

  const { frontmatter, body } = parseFrontmatter(trimmed);

  const headingMatch = body.match(/^#{1,4}\s+\[([A-Z])-(\d+)\]\s+(.+)/m);
  if (!headingMatch) return null;

  const severityCode = headingMatch[1];
  const number = headingMatch[2];
  const title = headingMatch[3].trim();
  const id = `${severityCode}-${number}`;
  const severity = SEVERITY_MAP[severityCode] || severityCode;

  const status = frontmatter.status || 'Pending';
  const affectedContracts = frontmatter['affected-contracts'] || null;

  return { id, severity, title, status, affectedContracts, content: body };
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
    // Split just before each finding heading ### [X-N] or ## [X-N] etc.
    // This handles both --- separators within a severity and bare headings at category boundaries.
    const chunks = content.split(/(?=^#{1,4}\s+\[[A-Z]-\d+\])/m);
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
