// backend/src/credentials.js
// Persistent LeetCode account, GitHub repository, Timer & Schedule manager

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const CRED_FILE = path.join(DATA_DIR, 'credentials.json');

export class CredentialManager {
  constructor(customFilePath = null) {
    this.credFile = customFilePath || CRED_FILE;
    this.dataDir = path.dirname(this.credFile);
    this._ensureDir();
    this.data = this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.credFile)) {
        const raw = fs.readFileSync(this.credFile, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          session: (parsed.session !== undefined && parsed.session !== null) ? parsed.session : (process.env.LEETCODE_SESSION || ''),
          csrfToken: (parsed.csrfToken !== undefined && parsed.csrfToken !== null) ? parsed.csrfToken : (process.env.LEETCODE_CSRF_TOKEN || ''),
          username: parsed.username || null,
          groqApiKey: (parsed.groqApiKey !== undefined && parsed.groqApiKey !== null) ? parsed.groqApiKey : (process.env.GROQ_API_KEY || ''),
          githubToken: (parsed.githubToken !== undefined && parsed.githubToken !== null) ? parsed.githubToken : (process.env.GITHUB_TOKEN || ''),
          githubRepo: (parsed.githubRepo !== undefined && parsed.githubRepo !== null) ? parsed.githubRepo : (process.env.GITHUB_REPO || ''),
          chatId: (parsed.chatId !== undefined && parsed.chatId !== null) ? parsed.chatId : (process.env.TELEGRAM_CHAT_ID || ''),
          timer: parsed.timer || { enabled: false, time: '20:00', hour: 20, minute: 0 },
          schedule: parsed.schedule ? { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1, language: 'Python', ...parsed.schedule } : { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1, language: 'Python' },
          unlinked: Boolean(parsed.unlinked),
          updatedAt: parsed.updatedAt || new Date().toISOString()
        };
      }
    } catch (e) {
      console.warn('[Credentials] Failed to read credentials file:', e.message);
    }

    return {
      session: process.env.LEETCODE_SESSION || '',
      csrfToken: process.env.LEETCODE_CSRF_TOKEN || '',
      username: null,
      groqApiKey: process.env.GROQ_API_KEY || '',
      githubToken: process.env.GITHUB_TOKEN || '',
      githubRepo: process.env.GITHUB_REPO || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      timer: { enabled: false, time: '20:00', hour: 20, minute: 0 },
      schedule: { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1, language: 'Python' },
      unlinked: false,
      updatedAt: new Date().toISOString()
    };
  }

  _save() {
    try {
      this._ensureDir();
      fs.writeFileSync(this.credFile, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[Credentials] Failed to write credentials file:', err.message);
      return false;
    }
  }

  getCredentials() {
    return {
      session: this.data.session || '',
      csrfToken: this.data.csrfToken || '',
      username: this.data.username || null,
      groqApiKey: (this.data.groqApiKey !== undefined && this.data.groqApiKey !== null) ? this.data.groqApiKey : (process.env.GROQ_API_KEY || '')
    };
  }

  getGroqApiKey() {
    return (this.data.groqApiKey !== undefined && this.data.groqApiKey !== null) ? this.data.groqApiKey : (process.env.GROQ_API_KEY || '');
  }

  saveGroqApiKey(key) {
    this.data.groqApiKey = (key || '').trim();
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log('[Credentials] 🤖 Groq API Key updated persistently.');
    return true;
  }

  getGitHubConfig() {
    return {
      token: (this.data.githubToken !== undefined && this.data.githubToken !== null) ? this.data.githubToken : (process.env.GITHUB_TOKEN || ''),
      repo: (this.data.githubRepo !== undefined && this.data.githubRepo !== null) ? this.data.githubRepo : (process.env.GITHUB_REPO || ''),
      branch: (this.data.githubBranch !== undefined && this.data.githubBranch !== null) ? this.data.githubBranch : (process.env.GITHUB_BRANCH || 'main'),
      folder: (this.data.githubFolder !== undefined && this.data.githubFolder !== null) ? this.data.githubFolder : (process.env.GITHUB_FOLDER || 'solutions')
    };
  }

  clearGitHub() {
    this.data.githubToken = '';
    this.data.githubRepo = '';
    this.data.githubBranch = 'main';
    this.data.githubFolder = 'solutions';
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log('[Credentials] ⚪ GitHub configuration cleared.');
    return true;
  }

  getTimer() {
    return { ...this.data.timer };
  }

  getSchedule() {
    return { ...this.data.schedule };
  }

  getChatId() {
    return this.data.chatId || process.env.TELEGRAM_CHAT_ID || '';
  }

  saveChatId(chatId) {
    if (!chatId) return;
    const clean = String(chatId).trim();
    if (clean && this.data.chatId !== clean) {
      this.data.chatId = clean;
      this.data.updatedAt = new Date().toISOString();
      this._save();
    }
  }

  saveCredentials(session, csrfToken, username = null, groqApiKey = null) {
    const cleanSession = (session || '').trim();
    const cleanCsrf = (csrfToken || '').trim();
    const cleanUser = username ? username.trim() : this.data.username;
    const cleanGroq = (groqApiKey !== null && groqApiKey !== undefined) ? groqApiKey.trim() : this.data.groqApiKey;

    const isSame = (
      this.data.session === cleanSession &&
      this.data.csrfToken === cleanCsrf &&
      this.data.username === cleanUser &&
      this.data.groqApiKey === cleanGroq &&
      !this.data.unlinked
    );

    if (isSame) {
      return true;
    }

    this.data.session = cleanSession;
    this.data.csrfToken = cleanCsrf;
    this.data.username = cleanUser;
    this.data.groqApiKey = cleanGroq;
    this.data.unlinked = false;
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] ✅ LeetCode credentials saved persistently for user: ${this.data.username || 'Unknown'}`);
    return true;
  }

  saveGitHub(token, repo, branch = 'main', folder = 'solutions') {
    if (token) this.data.githubToken = token.trim();
    if (repo) this.data.githubRepo = repo.trim();
    if (branch) this.data.githubBranch = branch.trim();
    if (folder) this.data.githubFolder = folder.trim();
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] 🐙 GitHub config updated: ${this.data.githubRepo}`);
    return true;
  }

  setTimer(enabled, timeStr = null) {
    this.data.timer.enabled = Boolean(enabled);
    if (timeStr) {
      const parsed = this._parseTime(timeStr);
      if (parsed) {
        this.data.timer.time = parsed.formatted;
        this.data.timer.hour = parsed.hour;
        this.data.timer.minute = parsed.minute;
      }
    }
    this.data.updatedAt = new Date().toISOString();
    this._save();
    return this.data.timer;
  }

  setSchedule(enabled, timeStr = null, numQuestions = null, language = null) {
    this.data.schedule.enabled = Boolean(enabled);
    if (timeStr) {
      const parsed = this._parseTime(timeStr);
      if (parsed) {
        this.data.schedule.time = parsed.formatted;
        this.data.schedule.hour = parsed.hour;
        this.data.schedule.minute = parsed.minute;
      }
    }
    if (numQuestions !== null && numQuestions > 0) {
      this.data.schedule.numQuestions = Math.min(Math.max(parseInt(numQuestions, 10), 1), 10);
    }
    if (language) {
      this.data.schedule.language = language.trim();
    }
    this.data.updatedAt = new Date().toISOString();
    this._save();
    return this.data.schedule;
  }

  _parseTime(str) {
    const clean = str.trim().toUpperCase();
    // Match 20:00 or 8:00 PM or 08:00 AM or 8 PM or 20
    const match12 = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
    if (match12) {
      let hour = parseInt(match12[1], 10);
      const minute = match12[2] ? parseInt(match12[2], 10) : 0;
      const ampm = match12[3];
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      return { hour, minute, formatted };
    }

    const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      const hour = parseInt(match24[1], 10);
      const minute = parseInt(match24[2], 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        return { hour, minute, formatted };
      }
    }

    return null;
  }

  clearCredentials() {
    this.data.session = '';
    this.data.csrfToken = '';
    this.data.username = null;
    this.data.unlinked = true;
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log('[Credentials] ⚪ LeetCode credentials cleared.');
    return true;
  }

  get isConfigured() {
    return Boolean(this.data.session && this.data.csrfToken);
  }

  get isExplicitlyUnlinked() {
    return Boolean(this.data.unlinked);
  }
}
