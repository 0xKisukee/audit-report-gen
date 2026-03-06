#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');

const { parse } = require('../src/parser');
const { render } = require('../src/renderer');
const { generatePdf } = require('../src/pdf');

const program = new Command();

program
  .name('audit-report')
  .description('Generate a PDF security audit report from markdown findings and metadata')
  .version('1.0.0');

program
  .command('generate', { isDefault: true })
  .description('Generate the PDF report')
  .argument('<input-dir>', 'Directory containing metadata.json, findings.md (or findings/), and optional section .md files')
  .option('-o, --output <file>', 'Output PDF file path', 'report.pdf')
  .option('--html', 'Also save the intermediate HTML (useful for debugging/styling)')
  .action(async (inputDir, options) => {
    const absInput = path.resolve(inputDir);
    const absOutput = path.resolve(options.output);

    if (!fs.existsSync(absInput)) {
      console.error(`Error: input directory not found: ${absInput}`);
      process.exit(1);
    }

    console.log(`Parsing input from: ${absInput}`);

    let data;
    try {
      data = parse(absInput);
    } catch (err) {
      console.error(`Parse error: ${err.message}`);
      process.exit(1);
    }

    const { findings, counts } = data;
    console.log(`Found ${findings.length} finding(s): ` +
      Object.entries(counts)
        .filter(([k, v]) => k !== 'Total' && v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
    );

    console.log('Rendering HTML...');
    let html;
    try {
      html = render(data);
    } catch (err) {
      console.error(`Render error: ${err.message}`);
      process.exit(1);
    }

    if (options.html) {
      const htmlPath = absOutput.replace(/\.pdf$/i, '') + '.html';
      fs.writeFileSync(htmlPath, html, 'utf8');
      console.log(`HTML saved to: ${htmlPath}`);
    }

    console.log(`Generating PDF: ${absOutput}`);
    try {
      await generatePdf(html, absOutput);
    } catch (err) {
      console.error(`PDF generation error: ${err.message}`);
      process.exit(1);
    }

    console.log(`Done! Report saved to: ${absOutput}`);
  });

program.parse();
