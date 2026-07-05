```markdown
# AINS NILAM Automation Bot

Automated bot for the **Advanced Integrated NILAM System (AINS)** to record books that have been genuinely read by the user.

> ⚠️ **Use responsibly.** This tool only speeds up data entry. You should have actually read the books you're recording.

---

## Setup

### 1. Install Node.js
Download and install from [nodejs.org](https://nodejs.org) (v16+)

### 2. Install dependencies
```bash
npm install
npx playwright install chromium
```

### 3. Prepare your books file
Create `books.json` in the project folder:

```json
[
  {
    "title": "Atomic Habits",
    "type": "physical",
    "category": "Bukan Fiksyen",
    "pages": 320,
    "isbn": "9780735211292",
    "author": "James Clear",
    "publisher": "Penguin",
    "year": 2018,
    "language": "English",
    "summary": "A practical guide on how to build good habits and break bad ones...",
    "lesson": "Small consistent changes lead to remarkable results over time...",
    "rating": 5
  }
]
```

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| `title` | ✅ | Book title |
| `type` | ✅ | `"physical"` or `"ebook"` |
| `category` | ✅ | Book category (see below) |
| `pages` | ✅ | Number of pages |
| `isbn` | ❌ | ISBN number |
| `author` | ✅ | Author name |
| `publisher` | ✅ | Publisher name |
| `year` | ❌ | Publication year |
| `language` | ✅ | `"English"`, `"Bahasa Melayu"`, etc. |
| `summary` | ✅ | Min 10 words |
| `lesson` | ✅ | Min 5 words |
| `rating` | ✅ | 1-5 stars |

**Categories:** `Fiksyen`, `Bukan Fiksyen`, `Komik`, `Majalah`, `Akhbar`, `Lain-lain`

---

## Usage

### Step 1: Launch Chrome with debugging
Close all Chrome windows first, then:

**Windows (Command Prompt):**
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug-profile"
```

**macOS:**
```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile
```

**Linux:**
```
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile
```

### Step 2: Login to AINS
In that Chrome window, go to https://ains.moe.gov.my and login with your DELIMa account.

### Step 3: Run the bot
```bash
npm start
```

The bot will:
- Connect to your Chrome
- Detect you're logged in
- Process books from `books.json`
- Save progress to `success.json` and `failed.json`

### Step 4: Next time
Just launch Chrome with the debug command, make sure you're logged in, and run `npm start` again. Already-processed books will be skipped.

---

## Configuration

Edit the `CONFIG` object in `server.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_BOOKS_PER_SESSION` | `10` | Books per run (avoid detection) |
| `MIN_BOOK_GAP` | `25000` | Min ms between books (25s) |
| `MAX_BOOK_GAP` | `50000` | Max ms between books (50s) |
| `HEADLESS` | `false` | Run without browser window |
| `DEBUG` | `false` | Verbose logging |

---

## Files

| File | Purpose |
|------|---------|
| `books.json` | Your book list (create this) |
| `success.json` | Successfully submitted books |
| `failed.json` | Failed books with error details |
| `automation.log` | Full execution log |
| `screenshots/` | Screenshots of errors |

---

## Safety Tips

- **Max 10 books per session** - don't exceed
- **Wait 10+ minutes between sessions**
- The bot adds **25-50 second random gaps** between books
- Characters are typed one-by-one (human-like)
- Mouse movements are not instant
- Stop immediately if you see "Limit exceeded" or warning messages

---

## Troubleshooting

### "Cannot connect to Chrome"
Make sure Chrome is running with the `--remote-debugging-port=9222` flag.

### "Session expired"
Re-login to AINS in your Chrome window, then run the bot again.

### "Field not found"
The website UI may have changed. Check `screenshots/` folder for error screenshots.

### Rate limited
Wait 30-60 minutes before running again. Reduce `MAX_BOOKS_PER_SESSION` if it happens often.

---

## License

MIT
```