const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- TELEGRAM SETUP ---
let bot;
const TG_TOKEN = '9199834783:AAHe2Jv0m0YGeacIaqeuQJnjSF_Oz0hJcw4'; // CHANGE THIS TO YOUR NEW TOKEN
const TG_CHAT_ID = '7619774967';

let isRunning = true;
let currentStatus = { total: 0, success: 0, failed: 0, pending: 0 };

const sendTG = async (msg) => {
  if (!bot) return; 
  try { await bot.sendMessage(TG_CHAT_ID, msg, { parse_mode: 'HTML' }); } catch (e) {}
};
// -----------------------

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
  LONG_TIMEOUT: 600000, // 10 mins for manual login
  MAX_BOOKS_PER_SESSION: 999, 
  MIN_BOOK_GAP: 5000, 
  MAX_BOOK_GAP: 10000  
};

const COLORS = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', magenta: '\x1b[35m', dim: '\x1b[2m' };
const logStream = fs.createWriteStream(path.resolve(CONFIG.LOG_FILE), { flags: 'a' });

function getReadableTimestamp() {
  const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function log(message, color = 'reset') {
  const cleanMessage = `[${getReadableTimestamp()}] ${message}`;
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

async function checkSessionExpired(page) {
  const url = page.url();
  if (url.includes('accounts.google.com') || url.includes('login')) {
    log('⚠ SESSION EXPIRED! Menunggu login manual...', 'red');
    sendTG('⚠️ <b>SESSION EXPIRED!</b>\nSila buka Chrome dan login semula. Bot akan menunggu.');
    await page.waitForFunction(
      () => window.location.href.includes('/web/dashboard') || document.body.innerText.includes('Papan Pemuka'), 
      { timeout: CONFIG.LONG_TIMEOUT }
    );
    log('✓ Login semula berjaya!', 'green');
    sendTG('✅ Login semula berjaya! Meneruskan...');
    await sleep(2000);
  }
}

async function handleCooldown(page) {
  log(`⏳ Cooldown detected. Memulakan refresh automatik setiap 20 saat...`, 'yellow');
  sendTG('⏳ <b>Cooldown Detected!</b> Memulakan refresh automatik...');
  let elapsed = 0;
  while (elapsed < 300) { 
    while (!isRunning) { await sleep(2000); } // Check if paused via /stop
    await sleep(20000); elapsed += 20;
    log(`⏳ [Cooldown] Memuat semula... (${elapsed}s)`, 'yellow');
    await page.goto(CONFIG.RECORD_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await sleep(2500);
    if (await waitForText(page, ['Kategori dan Jenis'], 3000)) {
      log(`✓ Cooldown tamat!`, 'green');
      sendTG('✅ <b>Cooldown Tamat!</b> Meneruskan rekod seterusnya.');
      return true;
    }
  }
  return false;
}

async function selectDropdown(page, labelName, valueToSelect) {
  log(`    ↳ Memilih ${labelName}: "${valueToSelect}"...`, 'dim');
  await sleep(rand(400, 600));

  const label = page.locator('label').filter({ hasText: new RegExp(labelName, 'i') }).first();
  let combobox;

  if (await label.count() > 0) {
    combobox = label.locator('xpath=following::select[1] | following::div[@role="combobox"][1]').first();
  }
  if (!combobox || await combobox.count() === 0 || !await combobox.isVisible()) {
    const index = labelName === 'Kategori' ? 0 : (labelName === 'Jenis Bahan' ? 1 : 2);
    combobox = page.locator('select:visible, div[role="combobox"]:visible').nth(index);
  }

  try {
    const isNative = await combobox.evaluate(el => el.tagName.toLowerCase() === 'select').catch(() => false);
    if (isNative) {
      const options = await combobox.evaluate(el => Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() })));
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = options.find(o => norm(o.text) === norm(valueToSelect)) || options.find(o => norm(o.text).includes(norm(valueToSelect)));
      if (match) {
        await combobox.selectOption(match.value, { timeout: 3000 });
        log(`    ✓ Berjaya pilih "${match.text}"`, 'dim');
      } else {
        const avail = options.map(o => o.text).filter(t => t).join(', ');
        log(`    ⚠ GAGAL! Pilihan "${valueToSelect}" tiada. Pilihan: [${avail}]`, 'red');
      }
      return;
    }
    
    // React custom dropdown fallback
    await combobox.click({ timeout: 5000, force: true });
    await sleep(1000); 
    const option = page.getByRole('option', { name: new RegExp(valueToSelect.replace('-', '.?'), 'i') }).last();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click({ timeout: 2000 });
      log(`    ✓ Berjaya pilih "${valueToSelect}"`, 'dim');
    } else {
      await page.keyboard.type(valueToSelect); await sleep(500); await page.keyboard.press('Enter');
    }
  } catch (e) { log(`    ⚠ Isu dropdown ${labelName}`, 'yellow'); }
  await sleep(rand(300, 500));
}

async function clickNext(page) {
  log(`    ↳ Klik "Seterusnya"`, 'dim');
  await page.locator('button:has-text("Seterusnya"):visible').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(rand(1000, 1500)); 
}

function padText(text, minLength = 110) {
  let result = text ? text.trim() : '';
  const fillers = [
    " Buku ini sangat menarik untuk dibaca kerana jalan ceritanya yang padat dan penuh dengan pengajaran.",
    " Ia memberikan impak yang besar kepada pembaca dan sesuai dijadikan bahan rujukan utama.",
    " Gaya penulisan penulis sangat mudah difahami dan sesuai untuk pelbagai peringkat umur.",
    " Terdapat banyak nilai murni dan teladan yang boleh diambil daripada buku ini untuk diaplikasikan dalam kehidupan."
  ];
  while (result.length < minLength) { result += fillers[Math.floor(Math.random() * fillers.length)]; }
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
  const inputs = page.locator('input[type="text"]:visible, input[type="number"]:visible');
  const fields = [
    { label: 'Tajuk', value: book.title },
    { label: 'Tahun Terbitan', value: book.year || 2023 },
    { label: 'Penulis', value: book.author || 'Penulis Tidak Diketahui' },
    { label: 'ISBN', value: book.isbn || '' },
    { label: 'Bilangan Mukasurat', value: book.pages || 100 },
    { label: 'Penerbit', value: book.publisher || 'Penerbit Umum' }
  ];
  for (let i = 0; i < fields.length; i++) {
    log(`    ↳ Isi ${fields[i].label}...`, 'dim');
    if (await inputs.count() > i) {
       await inputs.nth(i).fill(String(fields[i].value), { timeout: 3000 }).catch(() => {});
    }
    await sleep(rand(150, 300));
  }
  await clickNext(page);
  await waitForText(page, ['Penilaian dan Rumusan']);
}

async function fillStep3(page, book) {
  log('  Step 3/4: Penilaian dan Rumusan', 'cyan');
  const rating = book.rating || 5;
  log(`    ↳ Klik Rating: ${rating}`, 'dim');
  const stars = page.locator('svg[class*="star"]:visible, svg[class*="rating"]:visible, i[class*="star"]:visible, button[class*="star"]:visible');
  if (await stars.count() >= rating) await stars.nth(rating - 1).click({ force: true, timeout: 3000 }).catch(() => {});

  await sleep(rand(500, 1000));
  log(`    ↳ Isi Rumusan...`, 'dim');
  await page.locator('textarea:visible').first().fill(padText(book.summary, 110), { timeout: 5000 }).catch(() => {});
  await sleep(rand(500, 800));
  
  log(`    ↳ Isi Pengajaran...`, 'dim');
  await page.locator('textarea:visible').nth(1).fill(padText(book.lesson, 110), { timeout: 5000 }).catch(() => {});
  await sleep(rand(500, 800));

  await clickNext(page);
  await waitForText(page, ['Semakan', 'Hantar Rekod']);
}

async function fillStep4AndSubmit(page) {
  log('  Step 4/4: Semakan & Hantar', 'cyan');
  log('    ↳ Menanda checkbox...', 'dim');
  const checkbox = page.locator('input[type="checkbox"]:visible').first();
  if (await checkbox.isVisible()) {
    await checkbox.check({ force: true, timeout: 3000 }).catch(() => {});
  } else {
    await page.getByText('Ya, saya sahkan maklumat di atas adalah betul.').first().click({ force: true, timeout: 3000 }).catch(() => {});
  }
  await sleep(rand(500, 1000));

  log('    ↳ Klik "Hantar Rekod"...', 'dim');
  await page.locator('button:has-text("Hantar Rekod"):visible, button:has-text("Hantar"):visible').first().click({ timeout: 5000 });
  await sleep(rand(2000, 3000));
  
  if (await waitForText(page, ['terima kasih', 'telah dihantar', 'tahniah', 'berjaya'], 10000) || page.url().includes('/web/dashboard')) {
    log('  ✓ Terima kasih! Rekod dihantar.', 'green');
    return true;
  }
  throw new Error('Failed to verify submission success.');
}

async function processBook(page, book, index, total) {
  const start = Date.now();
  log(`\n[${index}/${total}] Memproses: ${book.title}`, 'magenta');
  
  let formLoaded = false; let attempts = 0;
  while (!formLoaded && attempts < 3) {
    while (!isRunning) { await sleep(2000); } // Pause check
    await page.goto(CONFIG.RECORD_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2500); 

    await checkSessionExpired(page); 
    
    if (await checkForBan(page)) throw new Error('BANNED');
    if (await waitForText(page, ['Kategori dan Jenis'], 5000)) {
      formLoaded = true;
    } 
    else if (await waitForText(page, ['hanya boleh ditambah semula', 'Sila cuba lagi', 'Makluman'], 2000)) {
      attempts++;
      formLoaded = await handleCooldown(page);
      if (!formLoaded) throw new Error('Gagal melepasi cooldown.');
    } 
    else {
      await takeScreenshot(page, 'no_form');
      throw new Error('Cannot load form.');
    }
  }

  await fillStep1(page, book);
  await fillStep2(page, book);
  await fillStep3(page, book);
  await fillStep4AndSubmit(page);
  log(`  ✓ Selesai dalam ${((Date.now() - start) / 1000).toFixed(1)}s`, 'green');
}

async function main() {
  // --- INITIALIZE TELEGRAM BOT DYNAMICALLY (FIX FOR NODE v23) ---
  try {
    const { default: TelegramBot } = await import('node-telegram-bot-api');
    bot = new TelegramBot(TG_TOKEN, { polling: true });
    console.log('✓ Telegram Bot Loaded');

    bot.onText(/\/status/, (msg) => {
      if (msg.chat.id.toString() !== TG_CHAT_ID) return;
      sendTG(`🤖 <b>Status Bot AINS</b>\n\n` +
             `Sedang berjalan: ${isRunning ? '✅ Ya' : '⏸ Tidak (Paused)'}\n` +
             `Total Buku: ${currentStatus.total}\n` +
             `✅ Selesai: ${currentStatus.success}\n` +
             `❌ Gagal: ${currentStatus.failed}\n` +
             `⏳ Baki: ${currentStatus.pending}`);
    });

    bot.onText(/\/stop/, (msg) => {
      if (msg.chat.id.toString() !== TG_CHAT_ID) return;
      isRunning = false;
      sendTG('⏸ <b>Bot Dihentikan Sementara.</b>\nHantar /start untuk sambung.');
    });

    bot.onText(/\/start/, (msg) => {
      if (msg.chat.id.toString() !== TG_CHAT_ID) return;
      isRunning = true;
      sendTG('▶️ <b>Bot Dimulakan Semula.</b>');
    });

  } catch (e) {
    console.log('⚠ Telegram Bot failed to load:', e.message);
  }
  // -------------------------------------------------------------

  log('══════════════════', 'bright');
  log('  AINS NILAM Bot (Ultimate Overnight)', 'bright');
  log('══════════════════', 'bright');
  sendTG('🚀 <b>Bot AINS Dimulakan!</b>\nHantar /status, /stop, atau /start.');

  ensureDir(CONFIG.SCREENSHOT_DIR);
  let context, page, success = 0, failed = 0;

  try {
    if (!fs.existsSync(path.resolve(CONFIG.BOOK_FILE))) throw new Error("books.json not found!");
    
    log('Melancarkan Chrome...', 'yellow');
    try {
      context = await chromium.launchPersistentContext(path.resolve(CONFIG.PROFILE_DIR), { channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized'] });
    } catch (e) {
      context = await chromium.launchPersistentContext(path.resolve(CONFIG.PROFILE_DIR), { headless: false, viewport: null, args: ['--start-maximized'] });
    }

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    page.setDefaultTimeout(CONFIG.TIMEOUT);

    log('Navigasi ke AINS Dashboard...', 'yellow');
    await page.goto(CONFIG.DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await sleep(4000);
    await checkSessionExpired(page);

    if (await checkForBan(page)) return;

    const books = JSON.parse(fs.readFileSync(path.resolve(CONFIG.BOOK_FILE), 'utf8'));
    const { success: sl, failed: fl } = { success: loadJSON(CONFIG.SUCCESS_FILE) || [], failed: loadJSON(CONFIG.FAILED_FILE) || [] };
    const done = new Set([...sl.map(getBookKey), ...fl.map(getBookKey)]);
    const pending = books.filter(b => !done.has(getBookKey(b)));

    currentStatus = { total: books.length, success: done.size, failed: fl.length, pending: pending.length };
    log(`Total: ${books.length} | Selesai: ${done.size} | Baki: ${pending.length}`, 'cyan');
    
    if (!pending.length) { log('Semua buku diproses!', 'green'); sendTG('🎉 Semua buku selesai!'); return; }

    for (let i = 0; i < pending.length; i++) {
      while (!isRunning) { await sleep(2000); } // Pause check
      const book = pending[i];
      
      try {
        await processBook(page, book, books.indexOf(book) + 1, books.length);
        saveProgress(book, 'success'); success++;
        currentStatus.success++; currentStatus.pending--;
        sendTG(`✅ <b>Berjaya:</b> ${book.title}\nBaki: ${currentStatus.pending}`);
      } catch (e) {
        if (e.message === 'BANNED') { sendTG(`⛔ <b>AKAUN DISEKAT!</b>`); break; }
        log(`  ✗ Ralat: ${e.message}`, 'red');
        await takeScreenshot(page, `err_${books.indexOf(book)}`);
        saveProgress(book, 'failed', e.message); failed++;
        currentStatus.failed++; currentStatus.pending--;
        sendTG(`❌ <b>Gagal:</b> ${book.title}\nError: ${e.message}`);
        
        await page.goto(CONFIG.DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(5000);
      }
    }
  } catch (e) {
    log(`Error: ${e.message}`, 'red'); sendTG(`⚠️ <b>Error:</b> ${e.message}`);
  } finally {
    log(`\n✓ Berjaya: ${success} | ✗ Gagal: ${failed}`, 'cyan');
    sendTG(`🏁 <b>Batch Selesai!</b>\n✅ Berjaya: ${success}\n❌ Gagal: ${failed}`);
    if (context) await context.close().catch(() => {});
    logStream.end();
    process.exit(0); 
  }
}

main().catch(e => { log(`Crash: ${e.message}`, 'red'); sendTG(`💥 <b>Crash:</b> ${e.message}`); logStream.end(); process.exit(1); });
