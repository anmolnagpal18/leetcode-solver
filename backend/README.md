# 🚀 LeetCode Companion — 24/7 Cloud Backend & Telegram Bot

This is the standalone **24/7 Cloud Backend** for LeetCode Companion. It operates completely independently from your laptop, Google Chrome, and the Chrome extension.

```
                    ┌────────────────────────────┐
                    │      Telegram User         │
                    └──────────────┬─────────────┘
                                   │ (24/7 - Laptop ON or OFF)
                                   ▼
                    ┌────────────────────────────┐
                    │     Cloud Backend Bot      │
                    │      (Node.js server)      │
                    └──────┬──────────────┬──────┘
                           │              │
     ┌─────────────────────┴─────┐        │
     ▼                           ▼        ▼
┌───────────────┐       ┌─────────────────┐ ┌──────────────┐
│  LeetCode API │       │   Groq AI API   │ │  GitHub API  │
│  (GraphQL &   │       │   (Qwen 3.8/    │ │  (Optional   │
│  Submissions) │       │   Compound)     │ │   Auto-Sync) │
└───────────────┘       └─────────────────┘ └──────────────┘
```

---

## Features

* 📱 **Works with Laptop Completely Closed**: Your Telegram bot runs in the cloud 24 hours a day, 7 days a week.
* 🔎 **Search Any Problem by Number or Name**: Solve or view any problem (e.g. `/solve 1`, `/question 874`, `/solution two-sum cpp`).
* ⚡ **Verified LeetCode Submissions**: Direct headless submissions to LeetCode with real-time judge verification (`Accepted`, `Wrong Answer`, `Runtime Error`). Never fakes results!
* 🧠 **Groq LLaMA / Qwen AI**: Generates optimal, accepted algorithmic solutions in Python, C++, Java, JS, etc. in < 1 second.
* 🔄 **Optional GitHub Sync**: Automatically commits accepted solutions to your GitHub repository if configured.
* ⏰ **Midnight UTC Daily Scheduler**: Tracks and announces daily challenges when LeetCode resets at 00:00 UTC.

---

## 🔒 Security & Session Cookie Notice

> [!CAUTION]
> **Treat `LEETCODE_SESSION` and `LEETCODE_CSRF_TOKEN` as sensitive passwords.**
> * Never commit your `.env` file to GitHub or share it.
> * Never post your session tokens in public chat channels.
> * The bot will never print, log, or expose your session values in Telegram or server logs.
> * If you do not configure these tokens, the bot will still generate full solutions via Groq AI, but will ask you to submit them manually on LeetCode.

---

## ⚙️ Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required? | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | **Yes** | Bot token from [@BotFather](https://t.me/BotFather) on Telegram |
| `TELEGRAM_CHAT_ID` | Optional | Your Telegram chat ID (from [@userinfobot](https://t.me/userinfobot)) to whitelist messages |
| `GROQ_API_KEY` | **Yes** | 100% Free API key from [console.groq.com/keys](https://console.groq.com/keys) (starts with `gsk_`) |
| `LEETCODE_SESSION` | Optional* | Cookie value of `LEETCODE_SESSION` from your logged-in browser (*Required for automated submissions) |
| `LEETCODE_CSRF_TOKEN`| Optional* | Cookie value of `csrftoken` from your logged-in browser |
| `GITHUB_TOKEN` | Optional | GitHub Personal Access Token (`repo` scope) for auto-committing solutions |
| `GITHUB_REPO` | Optional | Target GitHub repository (e.g. `yourusername/leetcode-solutions`) |
| `AUTO_SOLVE_DAILY` | Optional | Set to `true` to auto-solve daily challenge at midnight UTC |
| `PORT` | Optional | HTTP port for health checks (defaults to `3000`) |
| `TELEGRAM_MODE` | Optional | `polling` (recommended, zero configuration) or `webhook` |

### How to get your LeetCode Cookies:
1. Open your browser and log into [leetcode.com](https://leetcode.com).
2. Press `F12` to open Developer Tools.
3. Go to the **Application** (or **Storage**) tab $\rightarrow$ **Cookies** $\rightarrow$ `https://leetcode.com`.
4. Copy the value of **`LEETCODE_SESSION`**.
5. Copy the value of **`csrftoken`**.

---

## 💻 Local Development

1. Open your terminal and navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   cp .env.example .env
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Test commands from your Telegram app:
   ```text
   /status
   /question 1
   /solution 1 cpp
   /solve 1
   ```

---

## ☁️ 24/7 Cloud Deployment Guide

To keep the bot running after you shut down your laptop, deploy it to a free cloud service:

### Option A: Render.com (Recommended — 100% Free)

1. Push your repository to your private GitHub account.
2. Go to [dashboard.render.com](https://dashboard.render.com) and click **New +** $\rightarrow$ **Web Service**.
3. Connect your GitHub repository.
4. Configure the settings:
   * **Name:** `leetcode-companion-bot`
   * **Root Directory:** `backend`
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
   * **Instance Type:** `Free`
5. In the **Environment Variables** section, add:
   * `TELEGRAM_BOT_TOKEN`
   * `TELEGRAM_CHAT_ID`
   * `GROQ_API_KEY`
   * `LEETCODE_SESSION`
   * `LEETCODE_CSRF_TOKEN`
   * `GITHUB_TOKEN` (optional)
   * `GITHUB_REPO` (optional)
6. Click **Deploy Web Service**.
7. Once deployed, Render provides a live URL (e.g. `https://leetcode-companion-bot.onrender.com`). The server will run 24/7 with health checks enabled at `/health`!

---

### Option B: Railway.app

1. Go to [railway.app](https://railway.app) and click **New Project** $\rightarrow$ **Deploy from GitHub repo**.
2. Select your repository.
3. Click on the service $\rightarrow$ **Settings** $\rightarrow$ **Root Directory** $\rightarrow$ set to `/backend`.
4. Go to **Variables** tab and add your `.env` variables (`TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, etc.).
5. Railway will automatically build and start the bot within 60 seconds.

---

### Option C: Docker Container (Any VPS / Server)

Run directly with Docker:
```bash
docker build -t leetcode-bot .
docker run -d --restart unless-stopped --env-file .env -p 3000:3000 leetcode-bot
```

---

## 📱 Telegram Command Reference

| Command | Description | Example |
|---|---|---|
| `/status` | Check system connectivity, AI engine, and credentials | `/status` |
| `/today` | View today's LeetCode daily challenge | `/today` |
| `/question [query]` | Fetch full problem statement, constraints, examples | `/question 1` or `/question two-sum` |
| `/solution [query] [lang]` | Generate optimal AI solution & complexity analysis | `/solution 874 cpp` or `/solution 1` |
| `/solve [query] [lang]` | Full pipeline: AI generation, direct LeetCode submission & verdict check | `/solve 1` or `/solve walking robot` |
| `/random [easy\|medium\|hard]` | Pick a random LeetCode problem | `/random medium` |
| `/help` | Display command help menu | `/help` |

---

## 🛡️ Anti-Conflict Notice

When the cloud backend is active, disable local Telegram polling inside the Chrome extension settings to prevent the two instances from competing for updates. The Chrome extension will focus on its in-browser UI, quick search, and Monaco editor integration!
