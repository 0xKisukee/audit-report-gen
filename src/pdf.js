'use strict';

const puppeteer = require('puppeteer');
const path = require('path');

/**
 * Generate a PDF from an HTML string.
 * @param {string} html - Full HTML document
 * @param {string} outputPath - Absolute path to write the PDF
 */
async function generatePdf(html, outputPath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Load HTML directly
    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      // margins reserve space for header/footer and add breathing room at top
      margin: { top: '10mm', right: 0, bottom: '20mm', left: 0 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="
          width: 100%;
          height: 20mm;
          font-size: 12px;
          font-family: 'Inter', sans-serif;
          color: #1a1a2e;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        ">
          <span class="pageNumber"></span>
        </div>`,
    });
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf };
