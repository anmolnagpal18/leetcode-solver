<div align="center">

  <img src="assets/icons/icon128.png" alt="LeetCode Solver Logo" width="85" height="85" />

  <br />
  <a href="https://git.io/typing-svg">
    <img src="https://readme-typing-svg.demolab.com?font=Outfit&size=30&duration=4000&pause=3000&color=209ced&center=true&vCenter=true&width=800&height=70&lines=LeetCode+Solver+%E2%80%94+24%2F7+Autonomous+Companion" alt="LeetCode Solver — 24/7 Autonomous Companion" />
  </a>
  <br />

  <p><strong>Autonomous 24/7 Cloud Auto-Solver, Telegram Bot Controller, Self-Healing Judge Feedback Loop, and Chrome Extension.</strong></p>

  <p>
    <a href="https://github.com/anmolnagpal18/leetcode-solver"><img src="https://img.shields.io/badge/GitHub-anmolnagpal18%2Fleetcode--solver-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository" /></a>
    <a href="https://developer.chrome.com/docs/extensions/mv3/"><img src="https://img.shields.io/badge/Manifest-V3-34A853?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-v18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
    <a href="https://telegram.org/"><img src="https://img.shields.io/badge/Telegram-Bot_API-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Bot" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-A855F7?style=for-the-badge" alt="License" /></a>
  </p>

  <p>
    <a href="https://groq.com"><img src="https://img.shields.io/badge/AI_Engine-Groq_Grandmaster-orange?style=flat-square" alt="AI Engine: Groq" /></a>
    <a href="#security--privacy"><img src="https://img.shields.io/badge/Security-Git--Ignored_Credentials-success?style=flat-square" alt="Security: Protected" /></a>
    <a href="#2-autonomous-self-healing-feedback-loop"><img src="https://img.shields.io/badge/Solver-Self--Healing_Auto--Retry-blueviolet?style=flat-square" alt="Self Healing Loop" /></a>
  </p>

  <p>
    24/7 Cloud Execution &nbsp;·&nbsp; Laptop-OFF Solving &nbsp;·&nbsp; Self-Healing Judge Loop &nbsp;·&nbsp; Zero-Click Sync &nbsp;·&nbsp; GitHub Portfolio
  </p>

  <br />

  <img src="assets/screenshots/hero-banner.png" alt="LeetCode Solver Preview" width="600" />

</div>

<br />

---

## 💡 The Problem & The Solution

You have a **70-day streak** on LeetCode. You're traveling, your laptop is closed, you have exams, or you're away from your desk. By midnight, your streak is gone. 

Even worse, when an AI generates a solution, it might pass 53 out of 55 test cases and hit **Time Limit Exceeded (TLE)** on the last two, leaving you stuck.

**LeetCode Solver completely changes this:**
1. **Runs 24/7 in the Cloud:** Works from your phone on Telegram even when your laptop, Windows, and Chrome are **completely turned OFF**.
2. **Autonomous Self-Healing Loop:** If a solution hits TLE or Wrong Answer, the bot captures the judge feedback, refines the algorithm with Groq AI, and retries automatically until **Accepted**!
3. **Zero-Click Account Sync:** No copying cookies, no F12 DevTools. Chrome extension silently links your authenticated account to the cloud backend.
4. **In-Browser Companion:** Instant AI explanations, hints, and Monaco editor injection when you are actively coding on your computer.

<br />

---

## 🏛️ System Architecture

```text
                    ┌────────────────────────────┐
                    │      LeetCode Servers      │
                    │   (GraphQL & Submissions)  │
                    └──────────────▲─────────────┘
                                   │
                    ┌──────────────┴─────────────┐
                    │     24/7 Cloud Backend     │
                    │   (Node.js / Express API)  │
                    │                            │
                    │ • Problem Search Engine    │
                    │ • Groq AI Grandmaster      │
                    │ • Self-Healing Retry Loop  │
                    │ • Midnight UTC Scheduler   │
                    │ • Telegram Bot Service     │
                    └──────▲──────────────▲──────┘
                           │              │
              ┌────────────┴─┐          ┌─┴────────────┐
              │ Telegram App │          │ Chrome Ext.  │
              │  (24/7 📱)   │          │ (Popup & DOM)│
              └──────────────┘          └──────────────┘
```

* **Laptop OFF (Cloud Mode):** Telegram Bot communicates with the Cloud Backend to generate solutions, submit directly to LeetCode, poll the real judge, and sync commits to GitHub.
* **Laptop ON (Browser Mode):** Chrome extension provides on-page AI explanations, Monaco editor code injection, and automatic background cookie sync.

<br />

---

## 🚀 Key Features

### 1. 24/7 Laptop-OFF Cloud Auto-Solver
Trigger solutions from anywhere in the world straight from your Telegram phone app:
* `/solve 1` $\rightarrow$ Solves **#1 Two Sum** (default Python).
* `/solve 1452 cpp` $\rightarrow$ Solves **#1452** in C++.
* `/solve walking robot` $\rightarrow$ Resolves by title or partial name.
* Works with **zero dependence on Chrome or your laptop being powered on**.

---

### 2. Autonomous Self-Healing Feedback Loop
Most bots fail once and stop. LeetCode Solver runs an **iterative self-healing loop**:

```mermaid
graph TD
    A["Generate Initial Solution"] --> B["Submit to LeetCode Judge"]
    B --> C{"Accepted?"}
    C -->|YES| D["Log Runtime & Memory Percentiles"]
    D --> E["Sync Solution to GitHub"]
    D --> F["Report Success to Telegram 🎉"]
    C -->|NO: TLE / Wrong Answer| G["Capture Failed Testcase & Verdict"]
    G --> H["Feed Error Details to Groq AI"]
    H --> I["Optimize Algorithm (HashSets, Bitsets, Pruning)"]
    I --> J["Auto-Submit Next Attempt (up to 4x)"]
    J --> B
```

* If LeetCode returns `Time Limit Exceeded (Passed: 53/55 test cases)`:
  * The bot captures the failed input.
  * Sends it back to Groq AI to replace naive approaches with $O(N)$ or $O(N \log N)$ optimal algorithms.
  * Automatically submits Attempt 2, 3, 4 until all test cases pass!

---

### 3. Telegram Bot with Clickable Buttons & Command Menu
* **Interactive Button Keyboard:** Persistent buttons at the bottom of the chat (`📅 /today`, `📊 /status`, `💡 /solution`, `🚀 /solve`, `📖 /question`, `🎲 /random`, `🔗 /account`, `❓ /help`) so you can execute commands with one tap.
* **Official Command Menu:** Registered via `setMyCommands` in Telegram's built-in `[/]` drawer.
* **Flexible Input:** Type full custom commands like `/solve 874 cpp` or `/question two-sum` anytime.

---

### 4. Zero-Click Account Sync & Security
* **No DevTools needed:** Whenever you open Chrome with LeetCode logged in, the extension automatically detects your session and links it to the 24/7 Cloud Bot in the background!
* **1-Click Sync Button:** Or click **`🔗 Sync Account`** in Extension Settings for instant confirmation.
* **Full Account Lifecycle:** Manage everything from Telegram with `/account`, `/link`, and `/unlink`.
* **Security First:** Session tokens are stored in a local, `.gitignore`-protected database (`backend/data/credentials.json`) and are never exposed.

---

### 5. Automatic GitHub Portfolio Synchronization
Every accepted solution is automatically formatted and committed to your GitHub repository (e.g. `anmolnagpal18/leetcode-solutions`):
* Includes problem title, difficulty, full markdown description, constraints, and time/space complexities.
* Self-healing Git tree conflict resolution with cache-busting SHA recovery.

---

### 6. Chrome Extension In-Browser Companion
* **Monaco Editor Bridge:** Automatically types AI solutions into LeetCode's in-browser editor with one click.
* **Interactive AI Sidebar:** Draggable panel explaining algorithmic approaches step-by-step.
* **Quick Search UI:** Search any problem in the popup and choose **`📖 View`**, **`💡 Solution`**, or **`🚀 Solve Now`**.

<br />

---

## 📱 Telegram Command Reference

| Command | Description | Example |
|---|---|---|
| **`/status`** | Live health check of Cloud Backend, Telegram, LeetCode API, Groq AI, Auth, and GitHub | `/status` |
| **`/today`** | Today's active LeetCode Daily Challenge details and solve status | `/today` |
| **`/question [query]`** | Full problem statement, examples, constraints, and tags | `/question 1` or `/question` |
| **`/solution [query] [lang]`** | Generates optimal approach, time/space complexities, and code block | `/solution 874 cpp` |
| **`/solve [query] [lang]`** | Full autonomous pipeline: generation, submission, judge checking, and self-healing retries | `/solve 1452 cpp` |
| **`/random [difficulty]`** | Picks a random challenge (optional filter: `easy`, `medium`, `hard`) | `/random medium` |
| **`/account`** | Displays currently linked LeetCode username and 24/7 submission readiness | `/account` |
| **`/link`** | Connects your LeetCode account interactively | `/link` |
| **`/unlink`** | Disconnects and permanently clears stored session credentials | `/unlink` |
| **`/help`** | Displays the complete user manual and tips | `/help` |

<br />

---

## 🛠️ Project Structure

```
leetcode-solver/
├── manifest.json                        # Chrome Extension Manifest V3
├── LICENSE                              # MIT License
├── README.md                            # Main Documentation
│
├── 📂 backend/                          # 24/7 Cloud Backend
│   ├── Dockerfile                       # Container deployment config
│   ├── package.json                     # Node.js dependencies
│   ├── .env.example                     # Environment variables template
│   ├── README.md                        # Cloud deployment guide (Render/Railway)
│   ├── 📂 src/
│   │   ├── bot.js                       # 24/7 Telegram bot controller & self-healing solver
│   │   ├── leetcode.js                  # Search engine, GraphQL API, direct submission judge
│   │   ├── groq.js                      # Grandmaster AI model & feedback loop
│   │   ├── credentials.js               # Persistent LeetCode session manager
│   │   ├── scheduler.js                 # Midnight UTC daily challenge scheduler
│   │   ├── server.js                    # Production HTTP API (/health, /status, /api/auth/link)
│   │   └── github.js                    # Safe GitHub commit & sync client
│   └── 📂 tests/
│       └── test.js                      # Test suite (28/28 automated unit tests)
│
├── 📂 src/                              # Chrome Extension
│   ├── 📂 background/
│   │   └── service-worker.js            # Background runner & zero-click session sync
│   ├── 📂 content/
│   │   ├── detector.js                  # DOM observer for accepted submissions
│   │   ├── injector.js                  # Draggable AI learning sidebar
│   │   └── editor-injector.js           # Monaco editor typing bridge
│   ├── 📂 lib/
│   │   ├── groq-api.js                  # Extension Groq API client
│   │   ├── github-api.js                # Extension GitHub sync client
│   │   └── storage.js                   # Chrome storage helpers
│   └── 📂 popup/
│       ├── popup.html / popup.js        # Quick problem search & action cards
│       └── settings.html / settings.js  # Settings & 1-Click Sync button
│
└── 📂 assets/                           # Extension icons and screenshots
```

<br />

---

## ⚡ Quickstart Guide

### Option 1: Run Locally (Desktop)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/anmolnagpal18/leetcode-solver.git
   cd leetcode-solver/backend
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Configure environment:**
   Create `backend/.env` (use `backend/.env.example` as reference):
   ```env
   PORT=3000
   GROQ_API_KEY=gsk_...
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   GITHUB_TOKEN=ghp_...
   GITHUB_REPO=anmolnagpal18/leetcode-solutions
   ```
4. **Start the backend:**
   ```bash
   npm start
   ```

---

### Option 2: 24/7 Free Cloud Deployment (Render.com)

1. Fork or push this repository to your GitHub.
2. Go to **[Render.com Dashboard](https://dashboard.render.com)** $\rightarrow$ **New +** $\rightarrow$ **Web Service**.
3. Select your repository:
   * **Root Directory:** `backend`
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
   * **Instance Type:** `Free`
4. In **Environment Variables**, add:
   * `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   * *(Optional)* `GITHUB_TOKEN`, `GITHUB_REPO`
5. Click **Deploy Web Service** — Your bot will run online 24/7!

---

### Option 3: Load the Chrome Extension

1. Open Google Chrome and go to **`chrome://extensions/`**.
2. Turn on **Developer mode** (top right toggle).
3. Click **Load unpacked** (top left).
4. Select the `leetcode-solver` root folder (containing `manifest.json`).
5. Open the Extension $\rightarrow$ Click **`⚙️ Settings`** $\rightarrow$ Click **`🔗 Sync Account`**!

<br />

---

## 🔒 Security & Privacy

* **Strictly Protected Secrets:** All sensitive credentials (`.env`, `backend/.env`, and `backend/data/credentials.json`) are ignored in `.gitignore` and are **never committed to Git**.
* **Direct Communication:** Telegram commands and LeetCode submissions communicate directly with official APIs over TLS/HTTPS.
* **Zero Tracking:** No external analytics, telemetry, or third-party ads.

<br />

---

## 👨‍💻 Author

<div align="center">

**Designed & Engineered by Anmol Nagpal**

[![GitHub](https://img.shields.io/badge/GitHub-anmolnagpal18-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/anmolnagpal18)
[![Telegram](https://img.shields.io/badge/Telegram-@leetcode__solverbot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/leetcode_solverbot)

</div>

<br />

---

<div align="center">
  <sub>⭐️ If you find this project helpful, please consider starring the repository!</sub>
</div>
