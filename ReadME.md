```markdown
# AINS NILAM Automation Bot 🤖📚

Automated bot for the **Advanced Integrated NILAM System (AINS)** to record books that have been genuinely read by the user. 

> ⚠️ **Use Responsibly.** This tool speeds up data entry. Please ensure you have actually read the books you are recording.

---

## ✨ Features

- **Fully Automated:** Fills out the 4-step AINS wizard automatically.
- **Telegram Controller:** Remote control and live notifications via Telegram (`/status`, `/stop`, `/start`).
- **Smart Cooldown Handling:** Automatically detects AINS's 3-minute rate limit and refreshes the page randomly (3-10s) until the form unlocks.
- **Auto-Text Padding:** Automatically pads `summary` and `lesson` to strictly exceed AINS's 100-character limit if your input is too short.
- **Failure Screenshots:** Sends a screenshot directly to your Telegram if a book fails to process.
- **Session Recovery:** Pauses automatically if your DELIMa/Google session expires, waiting for you to log in again.

---

## 🛠️ Setup

### 1. Install Node.js
Download and install from [nodejs.org](https://nodejs.org) (v18+ recommended).

### 2. Install Dependencies
Run these commands in your project folder:
```bash
npm install playwright node-telegram-bot-api@0.66.0
npx playwright install chromium
```
*(Note: We strictly use `node-telegram-bot-api@0.66.0` because v1.0.0+ breaks CommonJS `require()` statements).*

### 3. Create a Telegram Bot
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the instructions to get your **Bot Token**.
3. Search for `@userinfobot` to get your **Chat ID** (so the bot knows where to message you).
4. Open `server.js` and update these lines:
```javascript
const TG_TOKEN = 'YOUR_NEW_TOKEN_HERE'; 
const TG_CHAT_ID = 'YOUR_CHAT_ID_HERE';
```

### 4. Prepare your `books.json`
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
    "summary": "A practical guide on how to build good habits...",
    "lesson": "Small consistent changes lead to remarkable results...",
    "rating": 5
  }
]
```

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| `title` | ✅ | Book title |
| `type` | ✅ | `"physical"` (maps to Fizikal) or `"ebook"` (maps to E-Buku) |
| `category` | ✅ | e.g., `Bukan Fiksyen`, `Fiksyen`, `Komik` |
| `pages` | ✅ | Number of pages |
| `isbn` | ❌ | ISBN number (can be empty) |
| `author` | ✅ | Author name |
| `publisher` | ✅ | Publisher name |
| `year` | ❌ | Publication year |
| `language` | ✅ | `"English"`, `"Bahasa Melayu"`, etc. |
| `summary` | ✅ | Will be auto-padded to >100 chars |
| `lesson` | ✅ | Will be auto-padded to >100 chars |
| `rating` | ✅ | 1 to 5 |

---

## 🚀 Usage

### Step 1: Run the Bot
You **no longer** need to launch Chrome manually with debug flags. The script will launch a dedicated Chrome profile for you.

In your command prompt, run:
```bash
node server.js
```

### Step 2: Login (First Time Only)
A new Chrome window will open using the `./chrome-profile` folder. 
1. Click **Login with Google**.
2. Log into your DELIMa account.
3. The bot will detect the dashboard and automatically start processing your books!

### Step 3: Monitor via Telegram
Once running, you can leave your PC. Check your Telegram bot for live updates:
- **`/status`** - Shows progress, ETA, and the current book title.
- **`/stop`** - Pauses the bot instantly after the current book finishes.
- **`/start`** - Resumes the bot.

---

## ⚙️ Configuration (`server.js`)

You can tweak these settings at the top of `server.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_BOOKS_PER_SESSION` | `999` | Max books to process in one run. |
| `MIN_BOOK_GAP` / `MAX_BOOK_GAP` | `1000` / `2000` | Time gap (ms) between starting the next book. |
| `LONG_TIMEOUT` | `600000` | How long (10 mins) to wait for manual login if session expires. |

---

## 📂 Files Generated

| File | Purpose |
|------|---------|
| `books.json` | Your list of books to process. |
| `success.json` | Tracks successfully submitted books (prevents duplicates). |
| `failed.json` | Tracks failed books with error details. |
| `automation.log` | Full readable execution log. |
| `screenshots/` | Screenshots saved automatically if the bot errors out. |
| `chrome-profile/` | The browser profile used to keep you logged in. |

---

## ⚠️ Important Safety Tips for Long Runs (100+ Books)

1. **Disable PC Sleep Mode:** If your PC sleeps, the bot stops. Go to Windows Settings > System > Power & Sleep and set it to **Never**.
2. **The 3-Minute Cooldown:** AINS strictly enforces a ~3-minute cooldown between submissions. The bot handles this automatically by refreshing the page every 3-10 seconds. **Do not panic if it looks stuck.** It is working as intended.
3. **Google Session Expiry:** AINS/DELIMa sessions expire every 12-24 hours. When this happens, the bot will message you on Telegram: `⚠️ SESSION EXPIRED!`. Just click Login in the Chrome window, and the bot will auto-resume.
4. **Ban Risk:** Do not use this 24/7 aggressively. It is recommended to let it run overnight while you sleep. 

---

## 🛠️ Troubleshooting

- **"Telegram Bot failed to load"**: Ensure you ran `npm install node-telegram-bot-api@0.66.0` (do not use v1.0.0).
- **"books.json not found"**: Ensure the file is in the exact same folder as `server.js`.
- **Bot is stuck on "Menanda checkbox"**: AINS may have updated their UI. Check the `screenshots/` folder (and your Telegram) for the exact error image.
- **Chrome closes instantly**: You may have a background Chrome process locking the profile. Run `taskkill /F /IM chrome.exe` in CMD before running `node server.js`.

---

## License
MIT
```
