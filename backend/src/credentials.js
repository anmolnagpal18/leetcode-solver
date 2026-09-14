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
  constructor() {
    this._ensureDir();
    this.data = this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(CRED_FILE)) {
        const raw = fs.readFileSync(CRED_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          session: parsed.session || process.env.LEETCODE_SESSION || '',
          csrfToken: parsed.csrfToken || process.env.LEETCODE_CSRF_TOKEN || '',
          username: parsed.username || null,
          githubToken: parsed.githubToken || process.env.GITHUB_TOKEN || '',
          githubRepo: parsed.githubRepo || process.env.GITHUB_REPO || 'anmolnagpal18/leetcode-solutions',
          timer: parsed.timer || { enabled: false, time: '20:00', hour: 20, minute: 0 },
          schedule: parsed.schedule || { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1 },
          updatedAt: parsed.updatedAt || new Date().toISOString()
        };
      }
    } catch (e) {
      console.warn('[Credentials] Failed to read credentials.json:', e.message);
    }

    return {
      session: process.env.LEETCODE_SESSION || '',
      csrfToken: process.env.LEETCODE_CSRF_TOKEN || '',
      username: null,
      githubToken: process.env.GITHUB_TOKEN || '',
      githubRepo: process.env.GITHUB_REPO || 'anmolnagpal18/leetcode-solutions',
      timer: { enabled: false, time: '20:00', hour: 20, minute: 0 },
      schedule: { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1 },
      updatedAt: new Date().toISOString()
    };
  }

  _save() {
    try {
      this._ensureDir();
      fs.writeFileSync(CRED_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[Credentials] Failed to write credentials.json:', err.message);
      return false;
    }
  }

  getCredentials() {
    return {
      session: this.data.session,
      csrfToken: this.data.csrfToken,
      username: this.data.username
    };
  }

  getGitHubConfig() {
    return {
      token: this.data.githubToken,
      repo: this.data.githubRepo
    };
  }

  getTimer() {
    return { ...this.data.timer };
  }

  getSchedule() {
    return { ...this.data.schedule };
  }

  saveCredentials(session, csrfToken, username = null) {
    this.data.session = session.trim();
    this.data.csrfToken = csrfToken.trim();
    if (username) this.data.username = username.trim();
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] ✅ LeetCode credentials saved persistently for user: ${this.data.username || 'Unknown'}`);
    return true;
  }

  saveGitHub(token, repo) {
    if (token) this.data.githubToken = token.trim();
    if (repo) this.data.githubRepo = repo.trim();
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

  setSchedule(enabled, timeStr = null, numQuestions = null) {
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
    this._save();
    console.log('[Credentials] ⚪ LeetCode credentials cleared.');
    return true;
  }

  get isConfigured() {
    return Boolean(this.data.session && this.data.csrfToken);
  }
}
