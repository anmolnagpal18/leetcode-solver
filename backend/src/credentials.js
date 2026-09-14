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

  _defaultUserData(chatId = '') {
    return {
      session: process.env.LEETCODE_SESSION || '',
      csrfToken: process.env.LEETCODE_CSRF_TOKEN || '',
      username: null,
      groqApiKey: process.env.GROQ_API_KEY || '',
      githubToken: process.env.GITHUB_TOKEN || '',
      githubRepo: process.env.GITHUB_REPO || '',
      githubBranch: process.env.GITHUB_BRANCH || 'main',
      githubFolder: process.env.GITHUB_FOLDER || 'solutions',
      chatId: chatId || process.env.TELEGRAM_CHAT_ID || '',
      timer: { enabled: false, time: '20:00', hour: 20, minute: 0 },
      schedule: { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1, language: 'Python' },
      unlinked: false,
      updatedAt: new Date().toISOString()
    };
  }

  _load() {
    try {
      if (fs.existsSync(this.credFile)) {
        const raw = fs.readFileSync(this.credFile, 'utf8');
        const parsed = JSON.parse(raw);
        const users = parsed.users || {};

        if (parsed.chatId && !users[parsed.chatId]) {
          users[parsed.chatId] = {
            session: parsed.session || '',
            csrfToken: parsed.csrfToken || '',
            username: parsed.username || null,
            groqApiKey: parsed.groqApiKey || '',
            githubToken: parsed.githubToken || '',
            githubRepo: parsed.githubRepo || '',
            githubBranch: parsed.githubBranch || 'main',
            githubFolder: parsed.githubFolder || 'solutions',
            chatId: parsed.chatId,
            timer: parsed.timer || { enabled: false, time: '20:00', hour: 20, minute: 0 },
            schedule: parsed.schedule || { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1, language: 'Python' },
            unlinked: Boolean(parsed.unlinked),
            updatedAt: parsed.updatedAt || new Date().toISOString()
          };
        }

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
          users,
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
      users: {},
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

  _getUser(chatId = null) {
    if (!this.data.users) this.data.users = {};
    if (!chatId) {
      if (this.data.chatId && this.data.users[this.data.chatId]) {
        return this.data.users[this.data.chatId];
      }
      return this.data;
    }

    const idStr = String(chatId).trim();
    if (!this.data.users[idStr]) {
      this.data.users[idStr] = this._defaultUserData(idStr);
    }
    return this.data.users[idStr];
  }

  getAllUsers() {
    if (!this.data.users) this.data.users = {};
    const userList = Object.keys(this.data.users).map(chatId => ({
      chatId,
      ...this.data.users[chatId]
    }));

    if (this.data.chatId && !this.data.users[this.data.chatId]) {
      userList.push({
        chatId: this.data.chatId,
        ...this.data
      });
    }

    return userList;
  }

  getCredentials(chatId = null) {
    const user = this._getUser(chatId);
    return {
      session: user.session || '',
      csrfToken: user.csrfToken || '',
      username: user.username || null,
      groqApiKey: (user.groqApiKey !== undefined && user.groqApiKey !== null) ? user.groqApiKey : (process.env.GROQ_API_KEY || '')
    };
  }

  getGroqApiKey(chatId = null) {
    const user = this._getUser(chatId);
    return (user.groqApiKey !== undefined && user.groqApiKey !== null) ? user.groqApiKey : (process.env.GROQ_API_KEY || '');
  }

  saveGroqApiKey(arg1, arg2 = null) {
    let chatId = null;
    let key = '';

    const isArg1ChatId = (typeof arg1 === 'number') || (typeof arg1 === 'string' && /^\d+$/.test(arg1.trim()));

    if (isArg1ChatId && arg2 !== null && arg2 !== undefined) {
      chatId = String(arg1);
      key = arg2;
    } else if (arg2 !== null && arg2 !== undefined) {
      chatId = arg1;
      key = arg2;
    } else {
      chatId = null;
      key = arg1;
    }

    const user = this._getUser(chatId);
    user.groqApiKey = (key || '').trim();
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      this.data.groqApiKey = user.groqApiKey;
    }
    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] 🤖 Groq API Key updated persistently ${chatId ? `for chat ${chatId}` : ''}.`);
    return true;
  }

  getGitHubConfig(chatId = null) {
    const user = this._getUser(chatId);
    return {
      token: (user.githubToken !== undefined && user.githubToken !== null) ? user.githubToken : (process.env.GITHUB_TOKEN || ''),
      repo: (user.githubRepo !== undefined && user.githubRepo !== null) ? user.githubRepo : (process.env.GITHUB_REPO || ''),
      branch: (user.githubBranch !== undefined && user.githubBranch !== null) ? user.githubBranch : (process.env.GITHUB_BRANCH || 'main'),
      folder: (user.githubFolder !== undefined && user.githubFolder !== null) ? user.githubFolder : (process.env.GITHUB_FOLDER || 'solutions')
    };
  }

  clearGitHub(chatId = null) {
    const user = this._getUser(chatId);
    user.githubToken = '';
    user.githubRepo = '';
    user.githubBranch = 'main';
    user.githubFolder = 'solutions';
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      this.data.githubToken = '';
      this.data.githubRepo = '';
      this.data.githubBranch = 'main';
      this.data.githubFolder = 'solutions';
    }

    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] ⚪ GitHub configuration cleared ${chatId ? `for chat ${chatId}` : ''}.`);
    return true;
  }

  getTimer(chatId = null) {
    const user = this._getUser(chatId);
    return { ...user.timer };
  }

  getSchedule(chatId = null) {
    const user = this._getUser(chatId);
    return { ...user.schedule };
  }

  getChatId(chatId = null) {
    if (chatId) return String(chatId);
    return this.data.chatId || process.env.TELEGRAM_CHAT_ID || '';
  }

  saveChatId(chatId) {
    if (!chatId) return;
    const clean = String(chatId).trim();
    if (!this.data.users) this.data.users = {};
    if (!this.data.users[clean]) {
      this.data.users[clean] = this._defaultUserData(clean);
    }
    if (this.data.chatId !== clean) {
      this.data.chatId = clean;
    }
    this.data.updatedAt = new Date().toISOString();
    this._save();
  }

  saveCredentials(arg1, arg2, arg3 = null, arg4 = null, arg5 = null) {
    let chatId = null;
    let session = '';
    let csrfToken = '';
    let username = null;
    let groqApiKey = null;

    const isArg1ChatId = (typeof arg1 === 'number') || (typeof arg1 === 'string' && /^\d+$/.test(arg1.trim()));

    if (isArg1ChatId && arg2 && arg3) {
      chatId = String(arg1);
      session = arg2;
      csrfToken = arg3;
      username = arg4;
      groqApiKey = arg5;
    } else if (arg5 !== null) {
      chatId = arg1;
      session = arg2;
      csrfToken = arg3;
      username = arg4;
      groqApiKey = arg5;
    } else {
      chatId = null;
      session = arg1 || '';
      csrfToken = arg2 || '';
      username = arg3 || null;
      groqApiKey = arg4 || null;
    }

    const cleanSession = (session || '').trim();
    const cleanCsrf = (csrfToken || '').trim();
    const user = this._getUser(chatId);
    const cleanUser = username ? username.trim() : user.username;
    const cleanGroq = (groqApiKey !== null && groqApiKey !== undefined) ? groqApiKey.trim() : user.groqApiKey;

    user.session = cleanSession;
    user.csrfToken = cleanCsrf;
    user.username = cleanUser;
    user.groqApiKey = cleanGroq;
    user.unlinked = false;
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      this.data.session = cleanSession;
      this.data.csrfToken = cleanCsrf;
      this.data.username = cleanUser;
      this.data.groqApiKey = cleanGroq;
      this.data.unlinked = false;
    }

    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] ✅ LeetCode credentials saved persistently for user: ${user.username || 'Unknown'} ${chatId ? `(chat: ${chatId})` : ''}`);
    return true;
  }

  saveGitHub(arg1, arg2, arg3 = 'main', arg4 = 'solutions', arg5 = 'solutions') {
    let chatId = null;
    let token = '';
    let repo = '';
    let branch = 'main';
    let folder = 'solutions';

    const isArg1ChatId = (typeof arg1 === 'number') || (typeof arg1 === 'string' && /^\d+$/.test(arg1.trim()));

    if (isArg1ChatId && arg2 && arg3) {
      chatId = String(arg1);
      token = arg2;
      repo = arg3;
      branch = arg4 || 'main';
      folder = arg5 || 'solutions';
    } else {
      chatId = null;
      token = arg1 || '';
      repo = arg2 || '';
      branch = arg3 || 'main';
      folder = arg4 || 'solutions';
    }

    const user = this._getUser(chatId);
    if (token) user.githubToken = token.trim();
    if (repo) user.githubRepo = repo.trim();
    if (branch) user.githubBranch = branch.trim();
    if (folder) user.githubFolder = folder.trim();
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      if (token) this.data.githubToken = user.githubToken;
      if (repo) this.data.githubRepo = user.githubRepo;
      if (branch) this.data.githubBranch = user.githubBranch;
      if (folder) this.data.githubFolder = user.githubFolder;
    }

    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] 🐙 GitHub config updated: ${user.githubRepo} ${chatId ? `(chat: ${chatId})` : ''}`);
    return true;
  }

  setTimer(arg1, arg2 = null, arg3 = null) {
    let chatId = null;
    let enabled = false;
    let timeStr = null;

    const isArg1ChatId = (typeof arg1 === 'number' && typeof arg2 === 'boolean') || (typeof arg1 === 'string' && /^\d+$/.test(arg1.trim()) && typeof arg2 === 'boolean');

    if (isArg1ChatId) {
      chatId = String(arg1);
      enabled = Boolean(arg2);
      timeStr = arg3;
    } else {
      chatId = null;
      enabled = Boolean(arg1);
      timeStr = arg2;
    }

    const user = this._getUser(chatId);
    user.timer = user.timer || { enabled: false, time: '20:00', hour: 20, minute: 0 };
    user.timer.enabled = enabled;
    if (timeStr) {
      const parsed = this._parseTime(timeStr);
      if (parsed) {
        user.timer.time = parsed.formatted;
        user.timer.hour = parsed.hour;
        user.timer.minute = parsed.minute;
      }
    }
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      this.data.timer = { ...user.timer };
    }

    this.data.updatedAt = new Date().toISOString();
    this._save();
    return user.timer;
  }

  setSchedule(arg1, arg2 = null, arg3 = null, arg4 = null, arg5 = null) {
    let chatId = null;
    let enabled = false;
    let timeStr = null;
    let numQuestions = null;
    let language = null;

    const isArg1ChatId = (typeof arg1 === 'number' && typeof arg2 === 'boolean') || (typeof arg1 === 'string' && /^\d+$/.test(arg1.trim()) && typeof arg2 === 'boolean');

    if (isArg1ChatId) {
      chatId = String(arg1);
      enabled = Boolean(arg2);
      timeStr = arg3;
      numQuestions = arg4;
      language = arg5;
    } else {
      chatId = null;
      enabled = Boolean(arg1);
      timeStr = arg2;
      numQuestions = arg3;
      language = arg4;
    }

    const user = this._getUser(chatId);
    user.schedule = user.schedule || { enabled: false, time: '22:00', hour: 22, minute: 0, numQuestions: 1, language: 'Python' };
    user.schedule.enabled = enabled;
    if (timeStr) {
      const parsed = this._parseTime(timeStr);
      if (parsed) {
        user.schedule.time = parsed.formatted;
        user.schedule.hour = parsed.hour;
        user.schedule.minute = parsed.minute;
      }
    }
    if (numQuestions !== null && numQuestions > 0) {
      user.schedule.numQuestions = Math.min(Math.max(parseInt(numQuestions, 10), 1), 10);
    }
    if (language) {
      user.schedule.language = language.trim();
    }
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      this.data.schedule = { ...user.schedule };
    }

    this.data.updatedAt = new Date().toISOString();
    this._save();
    return user.schedule;
  }

  _parseTime(str) {
    const clean = str.trim().toUpperCase();
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

  clearCredentials(chatId = null) {
    const user = this._getUser(chatId);
    user.session = '';
    user.csrfToken = '';
    user.username = null;
    user.unlinked = true;
    user.updatedAt = new Date().toISOString();

    if (!chatId || user === this.data) {
      this.data.session = '';
      this.data.csrfToken = '';
      this.data.username = null;
      this.data.unlinked = true;
    }

    this.data.updatedAt = new Date().toISOString();
    this._save();
    console.log(`[Credentials] ⚪ LeetCode credentials cleared ${chatId ? `for chat ${chatId}` : ''}.`);
    return true;
  }

  get isConfigured() {
    return Boolean(this.data.session && this.data.csrfToken);
  }

  get isExplicitlyUnlinked() {
    return Boolean(this.data.unlinked);
  }
}
