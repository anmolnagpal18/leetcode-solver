// backend/src/credentials.js
// Persistent LeetCode account credential manager

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
    this.credentials = this._load();
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
        if (parsed.session && parsed.csrfToken) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[Credentials] Failed to read credentials.json:', e.message);
    }

    // Fallback to process.env
    return {
      session: process.env.LEETCODE_SESSION || '',
      csrfToken: process.env.LEETCODE_CSRF_TOKEN || '',
      username: null
    };
  }

  getCredentials() {
    return { ...this.credentials };
  }

  saveCredentials(session, csrfToken, username = null) {
    this.credentials = {
      session: session.trim(),
      csrfToken: csrfToken.trim(),
      username: username ? username.trim() : null,
      updatedAt: new Date().toISOString()
    };

    try {
      this._ensureDir();
      fs.writeFileSync(CRED_FILE, JSON.stringify(this.credentials, null, 2), 'utf8');
      console.log(`[Credentials] ✅ LeetCode credentials saved persistently for user: ${username || 'Unknown'}`);
      return true;
    } catch (err) {
      console.error('[Credentials] Failed to write credentials.json:', err.message);
      return false;
    }
  }

  clearCredentials() {
    this.credentials = {
      session: '',
      csrfToken: '',
      username: null
    };

    try {
      if (fs.existsSync(CRED_FILE)) {
        fs.unlinkSync(CRED_FILE);
      }
      console.log('[Credentials] ⚪ LeetCode credentials cleared.');
      return true;
    } catch (err) {
      console.error('[Credentials] Failed to delete credentials.json:', err.message);
      return false;
    }
  }

  get isConfigured() {
    return Boolean(this.credentials.session && this.credentials.csrfToken);
  }
}
