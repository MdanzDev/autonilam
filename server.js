const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  BASE_URL: "https://ains.moe.gov.my",
  RECORD_URL: "https://ains.moe.gov.my/record/add/book",
  BOOK_FILE: "./books.json",
  SUCCESS_FILE: "./success.json",
  FAILED_FILE: "./failed.json",
  LOG_FILE: "./automation.log",
  SCREENSHOT_DIR: "./screenshots",
  CHROME_DEBUG_PORT: 9222,
  HEADLESS: false,
  DEBUG: false,
  TIMEOUT: 30000,
  LONG_TIMEOUT: 300000,
  MAX_BOOKS_PER_SESSION: 30,
  MIN_BOOK_GAP: 1000,
  MAX_BOOK_GAP: 5000
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

function loadBooks() {
  const resolved = path.resolve(CONFIG.BOOK_FILE);
  if (!fs.existsSync(resolved)) throw new Error(`books.json not found`);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function loadProgress() {
  return { success: loadJSON(CONFIG.SUCCESS_FILE) || [], failed: loadJSON(CONFIG.FAILED_FILE) || [] };
}

function getBookKey(book) {
  return book.isbn?.trim() || `${book.title}||${book.author || ''}`.toLowerCase();
}

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

async function getPageText(page) { return await page.locator('body').innerText({ timeout: 3000 }).catch(() => ''); }

async function isOnPage(page, text, timeout = 5000) {
  try { await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout }); return true; } catch { return false; }
}

async function checkForBan(page) {
  const text = (await getPageText(page)).toLowerCase();
  if (['disekat', 'amaran', 'sekatan', 'penyalahgunaan'].filter(k => text.includes(k)).length >= 2) {
    log('⛔ AKAUN DISEKAT!', 'red'); await takeScreenshot(page, 'BANNED'); return true;
  }
  return false;
}

async function clickText(page, text) {
  await sleep(rand(400, 1200));

  const selectors = [
    `button:has-text("${text}")`, `a:has-text("${text}")`, `label:has-text("${text}")`,
    `span:has-text("${text}")`, `div:has-text("${text}")`
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.move(
            box.x + rand(10, box.width - 10),
            box.y + rand(10, box.height - 10),
            { steps: rand(2, 5) }
          );
          await sleep(rand(50, 200));
        }
        await el.click({ timeout: 3000 });
        return;
      }
    } catch {}
  }
  throw new Error(`Cannot click "${text}"`);
}

async function fillField(page, labelRegex, value) {
  await sleep(rand(300, 900));

  const inputs = page.locator('input:visible, textarea:visible');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
    const ariaLabel = (await input.getAttribute('aria-label').catch(() => '')) || '';
    const name = (await input.getAttribute('name').catch(() => '')) || '';
    const id = (await input.getAttribute('id').catch(() => '')) || '';
    const labelText = await page.locator(`label[for="${id}"]`).innerText().catch(() => '');
    if (`${placeholder} ${ariaLabel} ${name} ${id} ${labelText}`.match(labelRegex)) {
      await input.click({ timeout: 2000 });
      await sleep(rand(100, 300));
      
      const strValue = String(value);
      for (let j = 0; j < strValue.length; j++) {
        await input.press(strValue[j]);
        await sleep(rand(30, 100));
      }
      
      await sleep(rand(100, 300));
      return;
    }
  }
  throw new Error(`Field not found: ${labelRegex}`);
}

async function selectDropdown(page, labelText, value) {
  await sleep(rand(400, 1000));

  const selects = page.locator('select'); const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const parentText = await select.evaluate(el => { let p = el.parentElement, text = ''; for (let j = 0; j < 4 && p; j++) { text += ' ' + (p.innerText || ''); p = p.parentElement; } return text; }).catch(() => '');
    if (parentText.toLowerCase().includes(labelText.toLowerCase())) {
      await select.click({ timeout: 2000 });
      await sleep(rand(200, 500));
      const options = await select.locator('option').allTextContents();
      const match = options.find(o => o.trim().toLowerCase().includes(value.toLowerCase()));
      if (match) { await select.selectOption({ label: match.trim(), timeout: 3000 }); await sleep(rand(100, 300)); return; }
    }
  }
  throw new Error(`Dropdown not found: ${labelText}`);
}

async function clickStars(page, rating) {
  await sleep(rand(300, 800));
  try { const stars = page.locator('[class*="star"], [class*="rating"]'); if (await stars.count() >= rating) { await stars.nth(rating - 1).click({ timeout: 2000 }); return; } } catch {}
  try { const labels = page.locator('label'); const count = await labels.count(); for (let i = 0; i < count; i++) { const html = await labels.nth(i).innerHTML().catch(() => ''); if (html.includes('star') || html.includes('★') || html.includes('⭐')) { if (i + 1 === rating || i === rating - 1) { await labels.nth(i).click({ timeout: 2000 }); return; } } } } catch {}
}

async function goToRecordPage(page) {
  await page.goto(CONFIG.RECORD_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await sleep(rand(800, 1500));
  if (await checkForBan(page)) throw new Error('BANNED');
  if (!await isOnPage(page, 'Maklumat Buku', 5000)) throw new Error('Not on book page');
}

async function fillBookInfo(page, book) {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = page.locator('input[type="date"]').first();
  if (await dateInput.count() > 0) { await dateInput.fill(today).catch(() => {}); await sleep(rand(200, 500)); }

  await fillField(page, /Tajuk/i, book.title);
  await clickText(page, book.type?.toLowerCase() === 'physical' ? 'Fizikal' : 'E-Buku');
  if (book.category) await selectDropdown(page, 'Kategori', book.category);
  if (book.pages) await fillField(page, /Mukasurat|Muka surat|Bilangan/i, String(book.pages));
  if (book.isbn?.trim()) await fillField(page, /ISBN/i, book.isbn);
  if (book.author) await fillField(page, /Penulis/i, book.author);
  if (book.publisher) await fillField(page, /Penerbit/i, book.publisher);
  if (book.year) await fillField(page, /Tahun Terbitan/i, String(book.year));
  if (book.language) await selectDropdown(page, 'Bahasa', book.language);

  await clickText(page, 'Seterusnya');
  await isOnPage(page, 'Rumusan', 5000);
}

async function fillEnrichment(page, book) {
  if (book.summary) {
    let summary = book.summary.trim();
    if (summary.split(/\s+/).length < 10) summary += ' Buku ini sangat menarik dan memberi banyak manfaat kepada pembaca.';
    await fillField(page, /Rumusan/i, summary.substring(0, 500));
  }
  if (book.lesson) {
    let lesson = book.lesson.trim();
    if (lesson.split(/\s+/).length < 5) lesson += ' Memberikan pengajaran yang sangat bermakna.';
    await fillField(page, /Pengajaran/i, lesson.substring(0, 300));
  }
  if (book.rating >= 1 && book.rating <= 5) await clickStars(page, book.rating);
  await clickText(page, 'Seterusnya');
  await isOnPage(page, 'Tambah gambar', 5000);
}

async function skipCover(page) {
  await clickText(page, 'Seterusnya');
  await isOnPage(page, 'Sila semak', 5000);
}

async function submit(page) {
  await clickText(page, 'Hantar');
  await sleep(rand(600, 1200));
  if (await checkForBan(page)) throw new Error('BANNED');
  await clickText(page, 'Pasti');
  await sleep(rand(800, 1500));
  if (await checkForBan(page)) throw new Error('BANNED');
  if (await isOnPage(page, 'Tahniah', 10000)) { log('  ✓ Tahniah!', 'green'); return true; }
  const text = await getPageText(page);
  if (text.includes('berjaya') || text.includes('Berjaya')) { log('  ✓ Success!', 'green'); return true; }
  if (text.includes('OK') || text.includes('Ok')) { await page.locator('button:has-text("OK"), button:has-text("Ok")').first().click().catch(() => {}); await sleep(500); }
  return false;
}

async function processBook(page, book, index, total) {
  const start = Date.now();
  log(`[${index}/${total}] ${book.title}`, 'cyan');
  await goToRecordPage(page);
  await fillBookInfo(page, book);
  await fillEnrichment(page, book);
  await skipCover(page);
  if (!await submit(page)) throw new Error('Submit failed');
  log(`  ✓ ${((Date.now() - start) / 1000).toFixed(1)}s`, 'green');
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
  log('  AINS NILAM Bot', 'bright');
  log('══════════════════', 'bright');

  ensureDir(CONFIG.SCREENSHOT_DIR);
  let browser, page, success = 0, failed = 0;
  const startTime = Date.now();

  try {
    browser = await chromium.connectOverCDP(await connectToChrome());
    page = (browser.contexts()[0].pages())[0] || await browser.contexts()[0].newPage();
    page.setDefaultTimeout(CONFIG.TIMEOUT);

    await page.goto(CONFIG.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await sleep(2000);

    const text = await getPageText(page);
    if (text.includes('DELIMa') && !text.includes('AINS+')) {
      log('Login in Chrome...', 'yellow');
      await page.waitForFunction(() => document.body.innerText.includes('AINS+') || document.body.innerText.includes('Rekod Terkini'), { timeout: CONFIG.LONG_TIMEOUT });
      log('Logged in!', 'green');
    } else { log('Already logged in.', 'green'); }

    if (await checkForBan(page)) return;

    const books = loadBooks();
    const { success: sl, failed: fl } = loadProgress();
    const done = new Set([...sl.map(getBookKey), ...fl.map(getBookKey)]);
    const pending = books.filter(b => !done.has(getBookKey(b)));

    log(`Total: ${books.length} | Done: ${done.size} | Left: ${pending.length}`, 'cyan');

    if (!pending.length) { log('All done!', 'green'); return; }

    const batch = pending.slice(0, CONFIG.MAX_BOOKS_PER_SESSION);

    for (let i = 0; i < batch.length; i++) {
      const book = batch[i];
      try {
        await processBook(page, book, books.indexOf(book) + 1, books.length);
        saveProgress(book, 'success'); success++;
        if (i < batch.length - 1) { const g = rand(CONFIG.MIN_BOOK_GAP, CONFIG.MAX_BOOK_GAP); log(`  Gap: ${Math.round(g/1000)}s`, 'dim'); await sleep(g); }
      } catch (e) {
        if (e.message === 'BANNED') break;
        log(`  ✗ ${e.message}`, 'red');
        await takeScreenshot(page, `err_${books.indexOf(book)}`);
        saveProgress(book, 'failed', e.message); failed++;
        await page.goto(CONFIG.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await sleep(3000);
      }
    }
  } catch (e) {
    log(e.message.includes('Chrome') ? 'Start Chrome: chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\chrome-debug-profile"' : `Error: ${e.message}`, 'red');
  } finally {
    log(`\n✓ ${success} | ✗ ${failed} | ${((Date.now()-startTime)/1000).toFixed(1)}s`, 'cyan');
    if (browser) await browser.close().catch(() => {});
    logStream.end();
  }
}

main().catch(e => { log(`Crash: ${e.message}`, 'red'); logStream.end(); process.exit(1); });