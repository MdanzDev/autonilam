const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  DASHBOARD_URL: "https://ains.moe.gov.my/web/dashboard",
  RECORD_URL: "https://ains.moe.gov.my/web/new-record-book",
  BOOK_FILE: "./books.json",
  SUCCESS_FILE: "./success.json",
  FAILED_FILE: "./failed.json",
  LOG_FILE: "./automation.log",
  SCREENSHOT_DIR: "./screenshots",
  PROFILE_DIR: "./chrome-profile",
  TIMEOUT: 30000,
  LONG_TIMEOUT: 600000, 
  MAX_BOOKS_PER_SESSION: 30,
  MIN_BOOK_GAP: 5000, 
  MAX_BOOK_GAP: 10000  
};

const COLORS = {
  reset: '\x1b[0m', bright: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', red: '\x1b[31m', cyan: '\x1b[36m', magenta: '\x1b[35m', dim: '\x1b[2m'
};

const logStream = fs.createWriteStream(path.resolve(CONFIG.LOG_FILE), { flags: 'a' });

// NEW: Readable Timestamp Function
function getReadableTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function log(message, color = 'reset') {
  // Uses the new readable timestamp
  const cleanMessage = `[${getReadableTimestamp()}] ${message}`;
  console.log(`${COLORS[color] || ''}${cleanMessage}${COLORS.reset}`);
  logStream.write(cleanMessage.replace(/\x1b\[\d+m/g, '') + '\n');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Live Countdown Timer
async function countdownSleep(totalSeconds, reason = "Cooldown") {
  let remaining = totalSeconds;
  while (remaining > 0) {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    log(`⏳ [${reason}] Menunggu... ${mins}m ${secs}s berbaki`, 'yellow');
    
    const step = remaining > 10 ? 10 : remaining; 
    await sleep(step * 1000);
    remaining -= step;
  }
  log(`⏳ [${reason}] Selesai menunggu.`, 'green');
}

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
    await page.waitForFunction((texts) => {
      const bodyText = document.body.innerText.toLowerCase();
      return texts.some(t => bodyText.includes(t.toLowerCase()));
    }, textArray, { timeout });
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

// ROBUST DROPDOWN HANDLER
async function selectDropdown(page, labelName, valueToSelect) {
  log(`    ↳ Memilih ${labelName}: "${valueToSelect}"...`, 'dim');
  await sleep(rand(400, 800));

  const label = page.locator('label').filter({ hasText: new RegExp(labelName, 'i') }).first();
  
  let combobox;
  if (await label.count() > 0) {
    combobox = label.locator('xpath=following::div[@role="combobox"][1] | following::select[1]').first();
  }
  
  if (!combobox || await combobox.count() === 0) {
    const index = labelName === 'Kategori' ? 0 : (labelName === 'Jenis Bahan' ? 1 : 2);
    combobox = page.locator('div[role="combobox"], select').nth(index);
  }

  try {
    const isNative = await combobox.evaluate(el => el.tagName.toLowerCase() === 'select').catch(() => false);
    if (isNative) {
      await combobox.selectOption({ label: valueToSelect }, { timeout: 3000 });
      log(`    ✓ (Native) Berjaya pilih "${valueToSelect}"`, 'dim');
      return;
    }

    await combobox.click({ timeout: 5000, force: true });
    await sleep(800); 
    
    const option = page.getByRole('option', { name: valueToSelect, exact: true }).last();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click({ timeout: 2000 });
      log(`    ✓ Berjaya pilih "${valueToSelect}"`, 'dim');
    } else {
      log(`    ⚠ Gagal cari pilihan, cuba taip & Enter...`, 'yellow');
      await page.keyboard.type(valueToSelect);
      await sleep(500);
      await page.keyboard.press('Enter');
    }
  } catch (e) {
    log(`    ⚠ Isu dropdown ${labelName}: ${e.message.substring(0, 50)}...`, 'yellow');
    await page.keyboard.type(valueToSelect).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
  }
  await sleep(rand(300, 500));
}

// ROBUST INPUT HANDLER
async function fillInput(page, labelName, value) {
  log(`    ↳ Isi ${labelName}: "${String(value).substring(0, 20)}..."`, 'dim');
  const label = page.locator('label').filter({ hasText: new RegExp(labelName, 'i') }).first();
  let input;

  if (await label.count() > 0) {
    input = label.locator('xpath=following::input[1] | following::textarea[1]').first();
  }
  
  if (!input || await input.count() === 0) {
    input = page.getByPlaceholder(new RegExp(labelName, 'i')).first();
  }

  if (input && await input.count() > 0) {
    await input.fill(String(value), { timeout: 5000 }).catch(() => {
      log(`    ⚠ Gagal isi ${labelName}`, 'yellow');
    });
  }
  await sleep(rand(200, 400));
}

async function clickNext(page) {
  log(`    ↳ Klik "Seterusnya"`, 'dim');
  await page.locator('button:has-text("Seterusnya")').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(rand(1000, 1500)); 
}

function padText(text, minLength = 110) {
  let result = text ? text.trim() : '';
  const filler = " Buku ini sangat menarik untuk dibaca kerana jalan ceritanya yang padat dan penuh dengan pengajaran. Ia memberikan impak yang besar kepada pembaca dan sesuai dijadikan bahan rujukan utama dalam pelbagai bidang ilmu.";
  while (result.length < minLength) { result += filler; }
  return result.substring(0, 500);
}

async function fillStep1(page, book) {
  log('  Step 1/4: Kategori dan Jenis', 'cyan');
  await selectDropdown(page, 'Kategori', book.category || 'Fiksyen');
  await selectDropdown(page, 'Jenis Bahan', book.type?.toLowerCase() === 'physical' ? 'Fizikal' : 'E-Buku');
  await selectDropdown(page, 'Bahasa', book.language || 'English');
  await clickNext(page);
  await waitForText(page, ['Maklumat Bacaan']);
}

async function fillStep2(page, book) {
  log('  Step 2/4: Maklumat Bacaan', 'cyan');
  await fillInput(page, 'Tajuk', book.title);
  await fillInput(page, 'Tahun Terbitan', book.year || 2023);
  await fillInput(page, 'Penulis', book.author || 'Penulis Tidak Diketahui');
  if (book.isbn) await fillInput(page, 'ISBN', book.isbn);
  await fillInput(page, 'Mukasurat', book.pages || 100);
  await fillInput(page, 'Penerbit', book.publisher || 'Penerbit Umum');
  
  await clickNext(page);
  await waitForText(page, ['Penilaian dan Rumusan']);
}

async function fillStep3(page, book) {
  log('  Step 3/4: Penilaian dan Rumusan', 'cyan');
  const rating = book.rating || 5;
  
  log(`    ↳ Klik Rating Bintang: ${rating}`, 'dim');
  const stars = page.locator('svg[class*="star"], svg[class*="rating"], i[class*="star"], button[class*="star"]');
  if (await stars.count() >= rating) {
    await stars.nth(rating - 1).click({ force: true, timeout: 3000 }).catch(() => {});
  } else {
    const starContainers = page.locator('div').filter({ has: page.locator('svg') }).filter({ hasText: /^\s*$/ }); 
    await starContainers.nth(rating - 1).click({ force: true, timeout: 3000 }).catch(() => {});
  }
  await sleep(rand(500, 1000));

  log(`    ↳ Isi Rumusan...`, 'dim');
  const summaryBox = page.locator('textarea').first();
  await summaryBox.fill(padText(book.summary, 110), { timeout: 5000 }).catch(() => {});
  await sleep(rand(500, 800));
  
  log(`    ↳ Isi Pengajaran...`, 'dim');
  const lessonBox = page.locator('textarea').nth(1);
  await lessonBox.fill(padText(book.lesson, 110), { timeout: 5000 }).catch(() => {});
  await sleep(rand(500, 800));

  await clickNext(page);
  await waitForText(page, ['Semakan', 'Hantar Rekod']);
}

async function fillStep4AndSubmit(page) {
  log('  Step 4/4: Semakan & Hantar', 'cyan');
  
  log('    ↳ Menanda checkbox pengesahan...', 'dim');
  const checkbox = page.locator('input[type="checkbox"]').first();
  if (await checkbox.isVisible()) {
    await checkbox.check({ force: true, timeout: 3000 }).catch(() => {});
  } else {
    await page.getByText('Ya, saya sahkan maklumat di atas adalah betul.').first().click({ force: true, timeout: 3000 }).catch(() => {});
  }
  await sleep(rand(500, 1000));

  log('    ↳ Klik "Hantar Rekod"...', 'dim');
  await page.locator('button:has-text("Hantar Rekod")').first().click({ timeout: 5000 });
  await sleep(rand(2000, 3000));
  
  if (await waitForText(page, ['terima kasih', 'telah dihantar', 'tahniah', 'berjaya'], 10000) || page.url().includes('/web/dashboard')) {
    log('  ✓ Terima kasih! Rekod berjaya dihantar.', 'green');
    return true;
  }
  throw new Error('Failed to verify submission success.');
}

async function processBook(page, book, index, total) {
  const start = Date.now();
  log(`\n[${index}/${total}] Memproses: ${book.title}`, 'magenta');
  
  let formLoaded = false;
  let cooldownAttempts = 0;

  while (!formLoaded && cooldownAttempts < 5) {
    log('  Membuka halaman rekod...', 'dim');
    await page.goto(CONFIG.RECORD_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2500); 

    if (await checkForBan(page)) throw new Error('BANNED');
    
    if (await waitForText(page, ['Kategori dan Jenis'], 5000)) {
      formLoaded = true;
    } 
    else if (await waitForText(page, ['hanya boleh ditambah semula', 'Sila cuba lagi', 'Makluman'], 2000)) {
      cooldownAttempts++;
      await countdownSleep(185, `AINS Cooldown (Cubaan ${cooldownAttempts})`); 
    } 
    else {
      await takeScreenshot(page, 'no_form');
      throw new Error('Cannot load form (unknown page state)');
    }
  }

  if (!formLoaded) throw new Error('Max cooldown retries reached');

  await fillStep1(page, book);
  await fillStep2(page, book);
  await fillStep3(page, book);
  await fillStep4AndSubmit(page);

  log(`  ✓ Selesai dalam ${((Date.now() - start) / 1000).toFixed(1)}s`, 'green');
}

async function main() {
  log('══════════════════', 'bright');
  log('  AINS NILAM Bot (Readable Timestamps)', 'bright');
  log('══════════════════', 'bright');

  ensureDir(CONFIG.SCREENSHOT_DIR);
  let context, page, success = 0, failed = 0;
  const startTime = Date.now();

  try {
    if (!fs.existsSync(path.resolve(CONFIG.BOOK_FILE))) {
      throw new Error("books.json not found!");
    }

    log('Melancarkan Chrome...', 'yellow');
    try {
      context = await chromium.launchPersistentContext(path.resolve(CONFIG.PROFILE_DIR), {
        channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized']
      });
    } catch (e) {
      context = await chromium.launchPersistentContext(path.resolve(CONFIG.PROFILE_DIR), {
        headless: false, viewport: null, args: ['--start-maximized']
      });
    }

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    page.setDefaultTimeout(CONFIG.TIMEOUT);

    log('Navigasi ke AINS Dashboard...', 'yellow');
    await page.goto(CONFIG.DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await sleep(4000);

    const text = await page.locator('body').innerText().catch(() => '');
    
    if (text.includes('Google') || page.url().includes('accounts.google.com') || page.url().includes('login')) {
      log('⚠ Sila klik "Login with Google" dan log masuk di tetingkap Chrome...', 'yellow');
      await page.waitForFunction(
        () => window.location.href.includes('/web/dashboard') || document.body.innerText.includes('Papan Pemuka'), 
        { timeout: CONFIG.LONG_TIMEOUT }
      );
      log('Login berjaya! Dashboard dimuatkan.', 'green');
      await sleep(3000);
    } else { 
      log('Sudah login dan berada di Dashboard.', 'green'); 
    }

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
            log(`  Jeda pendek: ${Math.round(g/1000)}s sebelum semak cooldown seterusnya...`, 'dim'); 
            await sleep(g); 
        }
      } catch (e) {
        if (e.message === 'BANNED') break;
        log(`  ✗ Ralat: ${e.message}`, 'red');
        await takeScreenshot(page, `err_${books.indexOf(book)}`);
        saveProgress(book, 'failed', e.message); failed++;
        log('  Kembali ke Dashboard untuk pemulihan...', 'yellow');
        await page.goto(CONFIG.DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(5000);
      }
    }
  } catch (e) {
    log(`Error: ${e.message}`, 'red');
  } finally {
    log(`\n✓ Berjaya: ${success} | ✗ Gagal: ${failed} | Masa: ${((Date.now()-startTime)/1000).toFixed(1)}s`, 'cyan');
    if (context) await context.close().catch(() => {});
    logStream.end();
  }
}

main().catch(e => { log(`Crash: ${e.message}`, 'red'); logStream.end(); process.exit(1); });
