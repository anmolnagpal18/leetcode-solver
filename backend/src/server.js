// backend/src/server.js
// Cloud Backend Entrypoint & HTTP Server

import 'dotenv/config';
import http from 'http';
import { GroqService } from './groq.js';
import { GitHubService } from './github.js';
import { TelegramBotService } from './bot.js';
import { DailyScheduler } from './scheduler.js';
import { CredentialManager } from './credentials.js';
import { searchProblem, getProblemDetails, getDailyChallenge, verifyLeetCodeSession } from './leetcode.js';

// Environment variables
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const LEETCODE_SESSION = process.env.LEETCODE_SESSION || '';
const LEETCODE_CSRF_TOKEN = process.env.LEETCODE_CSRF_TOKEN || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_FOLDER = process.env.GITHUB_FOLDER || 'solutions';
const TELEGRAM_MODE = (process.env.TELEGRAM_MODE || 'polling').toLowerCase();
const AUTO_SOLVE_DAILY = process.env.AUTO_SOLVE_DAILY === 'true';

// Initialize services
const credManager = new CredentialManager();
const groq = new GroqService(GROQ_API_KEY);
const github = new GitHubService(GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, GITHUB_FOLDER);

const bot = new TelegramBotService(
  {
    telegramToken: TELEGRAM_BOT_TOKEN,
    telegramChatId: TELEGRAM_CHAT_ID,
    leetcodeSession: LEETCODE_SESSION,
    leetcodeCsrfToken: LEETCODE_CSRF_TOKEN
  },
  { groq, github, credManager }
);

const scheduler = new DailyScheduler(bot, { autoSolveDaily: AUTO_SOLVE_DAILY });

// Lightweight HTTP Request Handler
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers for Chrome Extension access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'LeetCode-Companion-Cloud-Backend',
      mode: TELEGRAM_MODE,
      time: new Date().toISOString()
    }));
    return;
  }

  // Status endpoint (no secrets exposed)
  if (url.pathname === '/status') {
    const groqPing = await groq.ping();
    const githubPing = await github.ping();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      cloudBackend: 'online',
      telegramBot: bot.isConfigured ? 'connected' : 'not_configured',
      groqAI: groqPing.ok ? 'available' : (groq.isConfigured ? 'error' : 'not_configured'),
      groqModel: groqPing.model || null,
      leetcodeAuth: bot.isAuthConfigured ? 'configured' : 'not_configured',
      githubSync: githubPing.ok ? 'connected' : (github.isConfigured ? 'error' : 'not_configured'),
      githubRepo: githubPing.repo || null,
      time: new Date().toISOString()
    }));
    return;
  }

  // Search API (Used by Chrome Extension quick search)
  if (url.pathname === '/api/search' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const results = await searchProblem(payload.query || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...results }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Problem details API
  if (url.pathname === '/api/problem' && req.method === 'GET') {
    const slug = url.searchParams.get('slug');
    if (!slug) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'slug parameter required' }));
      return;
    }
    try {
      const details = await getProblemDetails(slug);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, details }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Auth Status API (Check if account is linked)
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const creds = credManager.getCredentials();
    let verified = false;
    let username = creds.username;

    if (creds.session) {
      const check = await verifyLeetCodeSession(creds.session, creds.csrfToken);
      verified = check.valid;
      if (check.username) username = check.username;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      linked: credManager.isConfigured,
      verified,
      username: username || null
    }));
    return;
  }

  // Auth Link API (1-Click Link from Extension or Telegram)
  if (url.pathname === '/api/auth/link' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { session, csrfToken } = JSON.parse(body || '{}');
        if (!session || !csrfToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'session and csrfToken are required' }));
          return;
        }

        const verify = await verifyLeetCodeSession(session, csrfToken);
        if (!verify.valid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: verify.error || 'Invalid session credentials' }));
          return;
        }

        credManager.saveCredentials(session, csrfToken, verify.username);
        bot.leetcodeSession = session;
        bot.leetcodeCsrfToken = csrfToken;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, username: verify.username }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Auth Unlink API
  if (url.pathname === '/api/auth/unlink' && req.method === 'POST') {
    credManager.clearCredentials();
    bot.leetcodeSession = '';
    bot.leetcodeCsrfToken = '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Account unlinked successfully' }));
    return;
  }

  // Telegram webhook receiver (if webhook mode enabled)
  if (url.pathname === '/api/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const update = JSON.parse(body || '{}');
        if (update.message) {
          bot.handleMessage(update.message).catch(e => console.error('[Webhook] handle error:', e));
        }
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Start Server & Bot
server.listen(PORT, () => {
  console.log(`[Server] 🌐 Cloud Backend running on port ${PORT}`);
  console.log(`[Server] 🔒 LeetCode Auth: ${bot.isAuthConfigured ? 'Configured ✅' : 'Not Configured (Submissions disabled) ⚪'}`);
  console.log(`[Server] 🤖 Groq AI: ${groq.isConfigured ? 'Configured ✅' : 'Not Configured ⚪'}`);
  console.log(`[Server] 🐙 GitHub Sync: ${github.isConfigured ? 'Configured ✅' : 'Not Configured ⚪'}`);

  // Start Daily Scheduler
  scheduler.start();

  // Start Telegram Bot
  if (TELEGRAM_MODE === 'webhook') {
    console.log('[Server] Telegram configured in Webhook mode. Ensure webhook is pointed to /api/webhook.');
  } else {
    // Default: Long-polling (works everywhere with zero configuration)
    bot.startPolling();
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Shutting down gracefully...');
  scheduler.stop();
  bot.stopPolling();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received. Shutting down gracefully...');
  scheduler.stop();
  bot.stopPolling();
  server.close(() => process.exit(0));
});
