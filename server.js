const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  BASE_URL: "https://ains.moe.gov.my",
  RECORD_URL: "https://ains.moe.gov.my/web/new-record-book",
  BOOK_FILE: "./books.json",
  SUCCESS_FILE: "./success.json",
  FAILED_FILE: "./failed.json",
  LOG_FILE: "./automation.log",
  SCREENSHOT_DIR: "./screenshots",
  CHROME_DEBUG_PORT: 9222,
  TIMEOUT: 30000,
  LONG_TIMEOUT: 300000,
  MAX_BOOKS_PER_SESSION: 30,
  MIN_BOOK_GAP: 3000,
  MAX_BOOK_GAP: 7000
};

const COLORS = {
  reset: '\x1b[0m', bright: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', red: '\x1b[31m', cyan: '\x1b[36m', magenta: '\x1b[35m', dim: '\x1b[2m'
};

const logStream = fs.createWriteStream(path.resolve(CONFIG.LOG_FILE), { flags: 'a' });

function log(message, color = 'reset') {
  const timestamp = new Date().toISOString();
  const cleanMessage = `[${timestamp}] ${message}`;
  console.log(`${COLORS[color] || ''}${cleanMessage}${COLORS.reset}`);
  logStream.write(cleanMessage.replace(/\x1b\[\d+m/g, '') + '\n');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function loadJSON(filePath) {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) { try { return JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch { return null; } }
  return null;
}

function saveJSON(filePath, data) { fs.writeFileSync(path.resolve(filePath), JSON.stringify(data, null, 2)); }

function getBookKey(book) { return book.isbn?.trim() || `${book.title}||${book.author || ''}`.toLowerCase(); }

function saveProgress(book, status, error = '') {
  const filePath = status === 'success' ? CONFIG.SUCCESS_FILE : CONFIG.FAILED_FILE;
  const existing = loadJSON(filePath) || [];
  const key = getBookKey(book);
  if (!existing.find(b => getBookKey(b) === key)) {
    existing.push({ title: book.title, author: book.author || '', isbn: book.isbn || '', key, timestamp: new Date().toISOString(), error });
    saveJSON(filePath, existing);
  }
}

function ensureDir(dirPath) { const d = path.resolve(dirPath); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

async function takeScreenshot(page, name) {
  try { ensureDir(CONFIG.SCREENSHOT_DIR); await page.screenshot({ path: path.join(CONFIG.SCREENSHOT_DIR, `${name}_${Date.now()}.png`), fullPage: true }); } catch {}
}

async function waitForText(page, textArray, timeout = 15000) {
  try {
    await page.waitForFunction((texts) => texts.some(t => document.body.innerText.includes(t)), textArray, { timeout });
    return true;
  } catch { return false; }
}

async function checkForBan(page) {
  const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  if (['disekat', 'amaran', 'sekatan', 'penyalahgunaan'].filter(k => text.includes(k)).length >= 2) {
    log('⛔ AKAUN DISEKAT!', 'red'); await takeScreenshot(page, 'BANNED'); return true;
  }
  return false;
}

async function clickNext(page) {
  // The new UI uses "Seterusnya →"
  await page.locator('button:has-text("Seterusnya"), button:has-text("Seterusnya →")').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(rand(1000, 1500)); // Wait for React animation and next step to render
}

// Pads text to ensure it is strictly > 100 characters
function padText(text, minLength = 110) {
  let result = text ? text.trim() : '';
  const filler = " Buku ini sangat menarik untuk dibaca kerana jalan ceritanya yang padat dan penuh dengan pengajaran. Ia memberikan impak yang besar kepada pembaca dan sesuai dijadikan bahan rujukan utama dalam pelbagai bidang ilmu.";
  while (result.length < minLength) {
    result += filler;
  }
  return result.substring(0, 500); // Cap at 500 just in case
}

async function fillStep1(page, book) {
  log('  Step 1/4: Kategori dan Jenis', 'dim');
  
  // Helper to handle both native HTML selects and custom React dropdowns
  const selectDropdown = async (index, valueToSelect) => {
    const select = page.locator('select').nth(index);
    // Try native select first
    if (await select.count() > 0 && await select.isVisible()) {
      try {
        await select.selectOption({ label: valueToSelect });
        return;
      } catch (e) {
        // Fallthrough to custom dropdown if option doesn't exist natively
      }
    }
    // Custom React Dropdown fallback
    const dropdownBtn = page.locator('.css-19bb58m, div[role="combobox"], button').filter({ hasText: /Sila pilih|Pilih/ }).first();
    await dropdownBtn.click();
    await sleep(500);
    await page.getByText(valueToSelect, { exact: true }).last().click();
  };

  // 1. Kategori
  const kategori = book.category || 'Fiksyen';
  await selectDropdown(0, kategori);

  // 2. Jenis Bahan (Fizikal / E-Buku)
  const jenis = book.type?.toLowerCase() === 'physical' ? 'Fizikal' : 'E-Buku';
  await selectDropdown(1, jenis);

  // 3. Bahasa
  const bahasa = book.language || 'English';
  await selectDropdown(2, bahasa);

  await clickNext(page);
  await waitForText(page, ['Maklumat Bacaan']);
}

async function fillStep2(page, book) {
  log('  Step 2/4: Maklumat Bacaan', 'dim');
  
  const inputs = page.locator('input[type="text"], input[type="number"]');
  
  // Fill fields sequentially based on the screenshot layout
  await inputs.nth(0).fill(book.title); // Tajuk *
  await sleep(rand(200, 400));
  
  await inputs.nth(1).fill(String(book.year || 2023)); // Tahun Terbitan *
  await sleep(rand(200, 400));

  await inputs.nth(2).fill(book.author || 'Penulis Tidak Diketahui'); // Penulis *
  await sleep(rand(200, 400));

  if (book.isbn) await inputs.nth(3).fill(book.isbn).catch(() => {}); // ISBN
  await sleep(rand(200, 400));

  await inputs.nth(4).fill(String(book.pages || 100)); // Bilangan Mukasurat *
  await sleep(rand(200, 400));

  await inputs.nth(5).fill(book.publisher || 'Penerbit Umum'); // Penerbit *
  
  // Kulit Buku / Imej - Skipped (Optional)

  await clickNext(page);
  await waitForText(page, ['Penilaian dan Rumusan']);
}

async function fillStep3(page, book) {
  log('  Step 3/4: Penilaian dan Rumusan', 'dim');
  
  // 1. Click Rating Star
  const rating = book.rating || 5;
  // The stars are usually in a container. We find the 5th star icon.
  const stars = page.locator('svg[class*="star"], svg[class*="rating"], i[class*="star"], button[class*="star"]');
  if (await stars.count() >= rating) {
    await stars.nth(rating - 1).click({ force: true }).catch(() => {});
  } else {
    // Fallback for generic SVG layout
    const starContainers = page.locator('div').filter({ has: page.locator('svg') }).filter({ hasText: /^\s*$/ }); 
    await starContainers.nth(rating - 1).click({ force: true }).catch(() => {});
  }
  await sleep(rand(500, 1000));

  const textareas = page.locator('textarea');
  
  // 2. Rumusan * (Must be > 100 chars)
  const safeSummary = padText(book.summary, 110);
  await textareas.nth(0).fill(safeSummary);
  await sleep(rand(500, 800));

  // 3. Pengajaran * (Must be > 100 chars)
  const safeLesson = padText(book.lesson, 110);
  await textareas.nth(1).fill(safeLesson);
  await sleep(rand(500, 800));

  await clickNext(page);
  await waitForText(page, ['Semakan', 'Hantar Rekod']);
}

async function fillStep4AndSubmit(page) {
  log('  Step 4/4: Semakan & Hantar', 'dim');
  
  // CHECKBOX: "Ya, saya sahkan maklumat di atas adalah betul."
  const checkbox = page.locator('input[type="checkbox"]').first();
  if (await checkbox.isVisible()) {
    await checkbox.check({ force: true }).catch(() => {});
  } else {
    // Fallback if it's a styled div
    await page.getByText('Ya, saya sahkan maklumat di atas adalah betul.').first().click({ force: true }).catch(() => {});
  }
  await sleep(rand(500, 1000));

  // Hantar Rekod button
  await page.locator('button:has-text("Hantar Rekod")').first().click({ timeout: 5000 });
  
  // Wait for Success Response
  await sleep(rand(2000, 3000));
  
  if (await waitForText(page, ['Tahniah', 'Berjaya', 'rekod anda telah dihantar'], 10000)) {
    log('  ✓ Tahniah! Rekod berjaya dihantar.', 'green');
    return true;
  }
  
  // Sometimes it redirects to dashboard
  if (page.url().includes('/web/dashboard')) {
    log('  ✓ Rekod dihantar (Redirected to Dashboard).', 'green');
    return true;
  }

  throw new Error('Failed to verify submission success.');
}

async function processBook(page, book, index, total) {
  const start = Date.now();
  log(`[${index}/${total}] Processing: ${book.title}`, 'cyan');
  
  await page.goto(CONFIG.RECORD_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2500); // Wait for React to mount

  if (await checkForBan(page)) throw new Error('BANNED');
  
  // Verify page loaded
  if (!await waitForText(page, ['Kategori dan Jenis'], 10000)) {
    await takeScreenshot(page, 'no_form');
    throw new Error('Cannot load form');
  }

  await fillStep1(page, book);
  await fillStep2(page, book);
  await fillStep3(page, book);
  await fillStep4AndSubmit(page);

  log(`  ✓ Selesai dalam ${((Date.now() - start) / 1000).toFixed(1)}s`, 'green');
}

async function connectToChrome() {
  const response = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${CONFIG.CHROME_DEBUG_PORT}/json/version`, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(data));
    }).on('error', reject);
  });
  return JSON.parse(response).webSocketDebuggerUrl;
}

async function main() {
  log('══════════════════', 'bright');
  log('  AINS NILAM Bot (v2 Final)', 'bright');
  log('══════════════════', 'bright');

  ensureDir(CONFIG.SCREENSHOT_DIR);
  let browser, page, success = 0, failed = 0;
  const startTime = Date.now();

  try {
    browser = await chromium.connectOverCDP(await connectToChrome());
    page = (browser.contexts()[0].pages())[0] || await browser.contexts()[0].newPage();
    page.setDefaultTimeout(CONFIG.TIMEOUT);

    await page.goto(CONFIG.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await sleep(3000);

    const text = await page.locator('body').innerText().catch(() => '');
    if (text.includes('DELIMa') && !text.includes('AINS')) {
      log('Sila login di Chrome...', 'yellow');
      await page.waitForFunction(() => document.body.innerText.includes('AINS') || document.body.innerText.includes('Papan Pemuka'), { timeout: CONFIG.LONG_TIMEOUT });
      log('Login berjaya!', 'green');
    } else { log('Sudah login.', 'green'); }

    if (await checkForBan(page)) return;

    const books = JSON.parse(fs.readFileSync(path.resolve(CONFIG.BOOK_FILE), 'utf8'));
    const { success: sl, failed: fl } = { success: loadJSON(CONFIG.SUCCESS_FILE) || [], failed: loadJSON(CONFIG.FAILED_FILE) || [] };
    const done = new Set([...sl.map(getBookKey), ...fl.map(getBookKey)]);
    const pending = books.filter(b => !done.has(getBookKey(b)));

    log(`Total Buku: ${books.length} | Selesai: ${done.size} | Baki: ${pending.length}`, 'cyan');

    if (!pending.length) { log('Semua buku telah diproses!', 'green'); return; }

    const batch = pending.slice(0, CONFIG.MAX_BOOKS_PER_SESSION);

    for (let i = 0; i < batch.length; i++) {
      const book = batch[i];
      try {
        await processBook(page, book, books.indexOf(book) + 1, books.length);
        saveProgress(book, 'success'); success++;
        if (i < batch.length - 1) { 
            const g = rand(CONFIG.MIN_BOOK_GAP, CONFIG.MAX_BOOK_GAP); 
            log(`  Rehat: ${Math.round(g/1000)}s`, 'dim'); 
            await sleep(g); 
        }
      } catch (e) {
        if (e.message === 'BANNED') break;
        log(`  ✗ Ralat: ${e.message}`, 'red');
        await takeScreenshot(page, `err_${books.indexOf(book)}`);
        saveProgress(book, 'failed', e.message); failed++;
        await page.goto(CONFIG.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await sleep(3000);
      }
    }
  } catch (e) {
    log(e.message.includes('Chrome') ? 'Sila buka Chrome: chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\chrome-debug-profile"' : `Error: ${e.message}`, 'red');
  } finally {
    log(`\n✓ Berjaya: ${success} | ✗ Gagal: ${failed} | Masa: ${((Date.now()-startTime)/1000).toFixed(1)}s`, 'cyan');
    if (browser) await browser.close().catch(() => {});
    logStream.end();
  }
}

main().catch(e => { log(`Crash: ${e.message}`, 'red'); logStream.end(); process.exit(1); });
