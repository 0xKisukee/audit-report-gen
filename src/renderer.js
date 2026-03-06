'use strict';

const { marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const hljs = require('highlight.js');
const fs = require('fs');
const path = require('path');
const { SEVERITY_ORDER } = require('./parser');

// Configure marked with syntax highlighting
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      // Handle "diff" blocks specially to preserve +/- coloring
      if (lang === 'diff') return highlightDiff(code);
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  })
);

marked.use({ breaks: false, gfm: true });

function highlightDiff(code) {
  return code
    .split('\n')
    .map(line => {
      if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
      if (line.startsWith('-')) return `<span class="diff-del">${escapeHtml(line)}</span>`;
      if (line.startsWith('@')) return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
      return escapeHtml(line);
    })
    .join('\n');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function md(text) {
  if (!text) return '';
  return marked.parse(text);
}

// Severity display config
const SEVERITY_CONFIG = {
  High:          { color: '#c0392b', bg: '#fdf0ef', badge: 'HIGH' },
  Medium:        { color: '#e67e22', bg: '#fef6ed', badge: 'MEDIUM' },
  Low:           { color: '#f1c40f', bg: '#fefdf0', badge: 'LOW' },
  Informational: { color: '#2980b9', bg: '#eef5fb', badge: 'INFO' },
  Gas:           { color: '#27ae60', bg: '#eefbf3', badge: 'GAS' },
};

function severityBadge(severity) {
  const cfg = SEVERITY_CONFIG[severity] || { color: '#666', bg: '#f5f5f5', badge: severity.toUpperCase() };
  return `<span class="severity-badge" style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.color}">${cfg.badge}</span>`;
}

const STATUS_CONFIG = {
  'Fixed':           { color: '#1e8449', bg: '#eefbf3' },
  'Acknowledged':    { color: '#2980b9', bg: '#eef5fb' },
  "Won't Fix":       { color: '#5d6d7e', bg: '#f5f6fa' },
  'Partially Fixed': { color: '#e67e22', bg: '#fef6ed' },
  'Pending':         { color: '#e67e22', bg: '#fef6ed' },
};

function statusBadge(status) {
  const s = status || 'Pending';
  const cfg = STATUS_CONFIG[s] || STATUS_CONFIG['Pending'];
  return `<span class="status-badge" style="color:${cfg.color};background:${cfg.bg};border-color:${cfg.color}">${escapeHtml(s)}</span>`;
}

// Known finding sub-section labels and their CSS classes
const SUBSECTION_LABELS = {
  'title':                 { display: 'Title',                  cls: 'label-title' },
  'description':           { display: 'Description',           cls: 'label-description' },
  'detailed description':  { display: 'Description',           cls: 'label-description' },
  'impact':                { display: 'Impact',                 cls: 'label-impact' },
  'root cause':            { display: 'Root Cause',             cls: 'label-root-cause' },
  'proof of concept':      { display: 'Proof of Concept',      cls: 'label-poc' },
  'poc':                   { display: 'Proof of Concept',      cls: 'label-poc' },
  'recommended mitigation':{ display: 'Recommended Mitigation',cls: 'label-mitigation' },
  'mitigation':            { display: 'Recommended Mitigation',cls: 'label-mitigation' },
  'recommendation':        { display: 'Recommended Mitigation',cls: 'label-mitigation' },
  'acknowledgement':       { display: 'Acknowledgement',       cls: 'label-ack' },
  'acknowledgment':        { display: 'Acknowledgement',       cls: 'label-ack' },
};

/**
 * Post-process rendered finding HTML to style known sub-section headings.
 * Detects:
 *   - <h3>/<h4> elements matching known labels
 *   - <p><strong>Label:</strong></p> paragraphs used as pseudo-headings
 */
function styleSubsections(html) {
  function toSubsectionDiv(label) {
    const key = label.trim().replace(/:$/, '').trim().toLowerCase();
    const sub = SUBSECTION_LABELS[key];
    return sub ? `<div class="finding-subsection ${sub.cls}">${sub.display}</div>` : null;
  }

  // Special case: **Title**\nTitle text with no blank line renders as a single <p>.
  // Split it into a styled label div + a plain paragraph for the title text.
  html = html.replace(/<p><strong>[Tt]itle<\/strong>\n([^<\n]+)<\/p>/gi, (match, titleText) => {
    return `<div class="finding-subsection label-title">Title</div><p>${titleText.trim()}</p>`;
  });

  // <h3> or <h4> matching a known label
  html = html.replace(/<h[34]>([^<]+)<\/h[34]>/gi, (match, label) => {
    return toSubsectionDiv(label) || match;
  });

  // <p><strong>Label:</strong></p> — whole-paragraph bold used as a pseudo-heading
  html = html.replace(/<p><strong>([^<]+?):?<\/strong><\/p>/gi, (match, label) => {
    return toSubsectionDiv(label) || match;
  });

  return html;
}

function formatDate(metadata) {
  const d = metadata.date;
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (d.from && d.to) return `${d.from} — ${d.to}`;
  if (d.from) return `From ${d.from}`;
  return '';
}

function formatScope(metadata) {
  if (!metadata.scope || !metadata.scope.length) return '';
  const items = metadata.scope.map(s => `<li><code>${escapeHtml(s)}</code></li>`).join('\n');
  return `<ul class="scope-list">${items}</ul>`;
}

function buildToc(findings, sections, auditorName) {
  const links = [];
  if (sections.about) links.push(`<li><a href="#about">About ${escapeHtml(auditorName || 'the Auditor')}</a></li>`);
  links.push(`<li><a href="#disclaimer">Disclaimer</a></li>`);
  links.push(`<li><a href="#risk-classification">Risk Classification</a></li>`);
  if (sections.protocolSummary) links.push(`<li><a href="#protocol-summary">Protocol Summary</a></li>`);
  links.push(`<li><a href="#executive-summary">Executive Summary</a>
    <ul>
      <li><a href="#scope">Scope</a></li>
    </ul>
  </li>`);

  // Group findings by severity for TOC
  const bySeverity = {};
  for (const f of findings) {
    if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
    bySeverity[f.severity].push(f);
  }

  const severityChildren = [];
  severityChildren.push(`<li><a href="#findings-count">Findings Count</a></li>`);
  severityChildren.push(`<li><a href="#findings-summary">Findings Summary</a></li>`);
  for (const sev of SEVERITY_ORDER) {
    if (!bySeverity[sev] || !bySeverity[sev].length) continue;
    const cfg = SEVERITY_CONFIG[sev] || {};
    const children = bySeverity[sev].map(f =>
      `<li><a href="#finding-${f.id}">[${f.id}] ${escapeHtml(f.title)}</a></li>`
    ).join('\n');
    severityChildren.push(`<li style="color:${cfg.color || 'inherit'}"><strong>${sev} Findings</strong><ul>${children}</ul></li>`);
  }
  links.push(`<li><a href="#findings">Findings</a><ul>${severityChildren.join('\n')}</ul></li>`);

  return `<ul class="toc">${links.join('\n')}</ul>`;
}

function buildFindingsCountTable(counts) {
  const rows = SEVERITY_ORDER
    .filter(s => counts[s] > 0)
    .map(s => {
      const cfg = SEVERITY_CONFIG[s] || {};
      return `<tr>
        <td><span style="color:${cfg.color || 'inherit'}">${s}</span></td>
        <td>${counts[s]}</td>
      </tr>`;
    });

  rows.push(`<tr class="total-row"><td><strong>Total</strong></td><td><strong>${counts.Total}</strong></td></tr>`);

  return `<table class="findings-table">
    <thead><tr><th>Severity</th><th>Count</th></tr></thead>
    <tbody>${rows.join('\n')}</tbody>
  </table>`;
}

function buildFindingsSummaryTable(findings) {
  const rows = findings.map(f => {
    const cfg = SEVERITY_CONFIG[f.severity] || {};
    return `<tr>
      <td><a href="#finding-${f.id}"><code>[${f.id}]</code></a></td>
      <td>${escapeHtml(f.title)}</td>
      <td><span style="color:${cfg.color || 'inherit'}">${f.severity}</span></td>
      <td>${statusBadge(f.status)}</td>
    </tr>`;
  });

  return `<table class="findings-table summary-table">
    <thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Status</th></tr></thead>
    <tbody>${rows.join('\n')}</tbody>
  </table>`;
}

function buildFindingsSection(findings) {
  // Group by severity
  const bySeverity = {};
  for (const f of findings) {
    if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
    bySeverity[f.severity].push(f);
  }

  const sections = [];

  for (const sev of SEVERITY_ORDER) {
    if (!bySeverity[sev] || !bySeverity[sev].length) continue;
    const cfg = SEVERITY_CONFIG[sev] || {};

    const findingHtml = bySeverity[sev].map(f => {
      // Strip **Title** label + its text line, and trailing --- separators
      const body = f.content
        .replace(/\*\*[Tt]itle:?\*\*\s*\n+[^\n*][^\n]*\n?/, '')
        .replace(/\n---+\s*$/, '').trim();
      const bodyHtml = styleSubsections(md(body));
      return `<div class="finding" id="finding-${f.id}">
        <div class="finding-header" style="border-left:4px solid ${cfg.color || '#ccc'}">
          <div class="finding-id-title">
            <span class="finding-id">[${f.id}]</span>
            <span class="finding-title">${escapeHtml(f.title)}</span>
          </div>
          <div class="finding-header-right">
            ${severityBadge(f.severity)}
            ${statusBadge(f.status)}
          </div>
        </div>
        <div class="finding-body">
          ${bodyHtml}
        </div>
      </div>`;
    }).join('\n');

    sections.push(`
      <h2 class="severity-section-title" style="color:${cfg.color || 'inherit'}" id="${sev.toLowerCase()}-findings">
        ${sev} Findings
      </h2>
      ${findingHtml}
    `);
  }

  return sections.join('\n');
}

const DEFAULT_DISCLAIMER = `A smart contract security review can never verify the complete absence of vulnerabilities. This is a time, resource and expertise bound effort where I try to find as many vulnerabilities as possible. I cannot guarantee 100% security after the review or even if the review will find any problems with your smart contracts. Subsequent security reviews, bug bounty programs and on-chain monitoring are strongly recommended.`;

function riskBadge(label, color, bg) {
  return `<span class="risk-badge" style="background:${bg};color:${color};border:1.5px solid ${color}">${label}</span>`;
}

const RISK_MATRIX_HTML = `
<table class="risk-matrix">
  <thead>
    <tr>
      <th>Severity</th>
      <th>Impact: High</th>
      <th>Impact: Medium</th>
      <th>Impact: Low</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="risk-row-label">Likelihood: High</td>
      <td>${riskBadge('High',   '#c0392b', '#fdf0ef')}</td>
      <td>${riskBadge('High',   '#c0392b', '#fdf0ef')}</td>
      <td>${riskBadge('Medium', '#e67e22', '#fef6ed')}</td>
    </tr>
    <tr>
      <td class="risk-row-label">Likelihood: Medium</td>
      <td>${riskBadge('High',   '#c0392b', '#fdf0ef')}</td>
      <td>${riskBadge('Medium', '#e67e22', '#fef6ed')}</td>
      <td>${riskBadge('Low',    '#2980b9', '#eef5fb')}</td>
    </tr>
    <tr>
      <td class="risk-row-label">Likelihood: Low</td>
      <td>${riskBadge('Medium', '#e67e22', '#fef6ed')}</td>
      <td>${riskBadge('Low',    '#2980b9', '#eef5fb')}</td>
      <td>${riskBadge('Low',    '#2980b9', '#eef5fb')}</td>
    </tr>
  </tbody>
</table>

${md(`
### Impact
- **High:** leads to a significant material loss of assets in the protocol or significantly harms a group of users.
- **Medium:** leads to a moderate material loss of assets in the protocol or moderately harms a group of users.
- **Low:** leads to a minor material loss of assets in the protocol or harms a small group of users.

### Likelihood
- **High:** attack path is possible with reasonable assumptions that mimic on-chain conditions, and the cost of the attack is relatively low compared to the amount of funds that can be stolen or lost.
- **Medium:** only a conditionally incentivized attack vector, but still relatively likely.
- **Low:** has too many or too unlikely assumptions or requires a significant stake by the attacker with little or no incentive.
`)}
`;

/**
 * Load CSS from templates/styles.css
 */
function loadStyles() {
  const cssPath = path.join(__dirname, '..', 'templates', 'styles.css');
  return fs.readFileSync(cssPath, 'utf8');
}

/**
 * Build the full HTML document.
 */
function render(data) {
  const { metadata, findings, counts, logo, sections } = data;

  const auditors = Array.isArray(metadata.auditors) ? metadata.auditors.join(', ') : (metadata.auditors || '');

  const css = loadStyles();
  const toc = buildToc(findings, sections, auditors);
  const countsTable = buildFindingsCountTable(counts);
  const summaryTable = buildFindingsSummaryTable(findings);
  const findingsHtml = buildFindingsSection(findings);
  const dateStr = formatDate(metadata);
  const repoLink = metadata.repo
    ? `<a href="${metadata.repo}">${metadata.repo}</a>`
    : '';
  const commitLink = metadata.commitHash
    ? (metadata.repo
        ? `<a href="${metadata.repo}/commit/${metadata.commitHash}">${metadata.commitHash.slice(0, 12)}...</a>`
        : `<code>${metadata.commitHash.slice(0, 12)}...</code>`)
    : '';
  const fixesCommitLink = metadata.fixesCommitHash
    ? (metadata.repo
        ? `<a href="${metadata.repo}/commit/${metadata.fixesCommitHash}">${metadata.fixesCommitHash.slice(0, 12)}...</a>`
        : `<code>${metadata.fixesCommitHash.slice(0, 12)}...</code>`)
    : '';

  const logoHtml = logo
    ? `<img src="${logo}" alt="${metadata.protocol || 'Protocol'} logo" class="cover-logo">`
    : '';

  const aboutSection = sections.about
    ? `<section id="about"><h1>About ${escapeHtml(auditors || 'the Auditor')}</h1>${md(sections.about)}</section>`
    : '';

  const disclaimerContent = sections.disclaimer || DEFAULT_DISCLAIMER;
  const protocolSummarySection = sections.protocolSummary
    ? `<section id="protocol-summary"><h1>Protocol Summary</h1>${md(sections.protocolSummary)}</section>`
    : '';

  const executiveSummaryExtra = sections.executiveSummary
    ? md(sections.executiveSummary)
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(metadata.title || 'Audit Report')}</title>
  <style>${css}</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover-page">
  ${logoHtml}
  <div class="cover-content">
    <div class="cover-tag">Security Audit Report</div>
    <h1 class="cover-title">${escapeHtml(metadata.protocol || 'Protocol')} Security Review</h1>
    ${auditors ? `<p class="cover-subtitle">by ${escapeHtml(auditors)}</p>` : ''}
  </div>
</div>

<!-- REPORT BODY -->
<div class="report-body">

  <!-- TABLE OF CONTENTS -->
  <section id="toc">
    <h1>Table of Contents</h1>
    ${toc}
  </section>

  <!-- ABOUT -->
  ${aboutSection}

  <!-- DISCLAIMER -->
  <section id="disclaimer">
    <h1>Disclaimer</h1>
    ${md(disclaimerContent)}
  </section>

  <!-- RISK CLASSIFICATION -->
  <section id="risk-classification">
    <h1>Risk Classification</h1>
    ${RISK_MATRIX_HTML}
  </section>

  <!-- PROTOCOL SUMMARY -->
  ${protocolSummarySection}

  <!-- EXECUTIVE SUMMARY -->
  <section id="executive-summary">
    <h1>Executive Summary</h1>
    <p class="exec-intro">
      A time-boxed security review of the
      ${repoLink ? `<a href="${metadata.repo}">${escapeHtml(metadata.protocol || metadata.repo)}</a>` : `<strong>${escapeHtml(metadata.protocol || 'protocol')}</strong>`}
      repository was conducted by <strong>${escapeHtml(auditors)}</strong>${dateStr ? `, from ${escapeHtml(dateStr)}` : ''}.
      A total of <strong>${counts.Total}</strong> issue${counts.Total !== 1 ? 's were' : ' was'} uncovered.
    </p>

    <h2 id="scope">Scope</h2>
    <table class="meta-table">
      <tbody>
        ${metadata.protocol ? `<tr><td>Protocol</td><td>${escapeHtml(metadata.protocol)}</td></tr>` : ''}
        ${metadata.protocolType ? `<tr><td>Protocol Type</td><td>${escapeHtml(metadata.protocolType)}</td></tr>` : ''}
        ${dateStr ? `<tr><td>Audit Date</td><td>${escapeHtml(dateStr)}</td></tr>` : ''}
        ${metadata.version ? `<tr><td>Audit Version</td><td>${escapeHtml(metadata.version)}</td></tr>` : ''}
        ${repoLink ? `<tr><td>Repository</td><td>${repoLink}</td></tr>` : ''}
        ${commitLink ? `<tr><td>Review Commit Hash</td><td>${commitLink}</td></tr>` : ''}
        ${fixesCommitLink ? `<tr><td>Fixes Commit Hash</td><td>${fixesCommitLink}</td></tr>` : ''}
      </tbody>
    </table>
    ${metadata.scope && metadata.scope.length ? `<h3>In-Scope Files</h3>${formatScope(metadata)}` : ''}
    
    ${executiveSummaryExtra}
  </section>

  <!-- FINDINGS -->
  <section id="findings">
    <h1>Findings</h1>

    <h2 id="findings-count">Findings Count</h2>
    ${countsTable}

    <h2 id="findings-summary">Findings Summary</h2>
    ${summaryTable}

    ${findingsHtml}
  </section>

</div>
</body>
</html>`;
}

module.exports = { render };
