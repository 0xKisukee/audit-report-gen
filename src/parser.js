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
  for (const line of match[1].split('\n').map(l => l.replace(/\r$/, ''))) {
    const kv = line.match(/^([^:]+):\s*(.+)$/);
    if (kv) frontmatter[kv[1].trim()] = kv[2].trim();
  }
  return { frontmatter, body: match[2] };
}

/**
 * Parse a single finding markdown chunk.
 * Requires YAML frontmatter with a `severity` field (e.g. severity: [H-1] or H-1).
 * The finding title is the line after the first `# Title` heading in the body.
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

  const titleMatch = body.match(/^#{1,6}\s+[Tt]itle\s*\n+([^\n]+)/m);
  if (!titleMatch) return null;
  const title = titleMatch[1].trim();

  const status = frontmatter.status || 'Pending';
  const affectedContracts = frontmatter['affected-contracts'] || null;

  return { id, severity, title, status, affectedContracts, content: body };
}

/**
 * Parse findings from individual .md files in a findings/ directory.
 */
function parseFindings(inputDir) {
  const findingsDir = path.join(inputDir, 'findings');

  if (!fs.existsSync(findingsDir) || !fs.statSync(findingsDir).isDirectory()) {
    throw new Error(`No findings directory found. Expected "${findingsDir}/".`);
  }

  const files = fs.readdirSync(findingsDir).filter(f => f.endsWith('.md')).sort();
  let findings = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(findingsDir, file), 'utf8');
    const finding = parseFindingChunk(content);
    if (finding) findings.push(finding);
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
