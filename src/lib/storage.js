// storage.js – Chrome storage helpers

export const StorageService = {

  // ── Settings ───────────────────────────────────────────────────────────────
  async getSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(
        ['grokApiKey', 'githubToken', 'githubRepo', 'githubBranch', 'githubFolder', 'autoSync',
         'streakProtect', 'streakProtectHour', 'streakProtectMinute', 'streakProtectAmPm',
         'telegramEnabled', 'telegramBotToken', 'telegramChatId', 'telegramCloudMode'],
        resolve
      );
    });
  },

  async saveSettings(settings) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  },

  // ── Stats ──────────────────────────────────────────────────────────────────
  async getStats() {
    return new Promise(resolve => {
      chrome.storage.local.get(['stats'], data => {
        resolve(data.stats || { easy: 0, medium: 0, hard: 0, unknown: 0 });
      });
    });
  },

  async incrementStat(difficulty) {
    // difficulty should be 'easy' | 'medium' | 'hard' | 'unknown'
    const stats = await this.getStats();
    const key = difficulty.toLowerCase();
    if (key in stats) {
      stats[key]++;
    } else {
      stats.unknown = (stats.unknown || 0) + 1;
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ stats }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(stats);
      });
    });
  },

  // ── Streak ─────────────────────────────────────────────────────────────────
  async getStreak() {
    return new Promise(resolve => {
      chrome.storage.local.get(['streak'], data => {
        resolve(data.streak || { current: 0, longest: 0, lastSolvedDate: null });
      });
    });
  },

  async updateStreak() {
    const streak = await this.getStreak();
    const today  = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const last   = streak.lastSolvedDate;

    if (last === today) {
      // Already counted today – no change
      return streak;
    }

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    if (last === yesterday) {
      // Consecutive day – extend streak
      streak.current++;
    } else {
      // Gap or first time – reset streak
      streak.current = 1;
    }

    streak.lastSolvedDate = today;
    if (streak.current > streak.longest) streak.longest = streak.current;

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ streak }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(streak);
      });
    });
  },

  // ── Activity ───────────────────────────────────────────────────────────────
  async getActivity() {
    return new Promise(resolve => {
      chrome.storage.local.get(['activity'], data => resolve(data.activity || []));
    });
  },

  async addActivity(entry) {
    const list = await this.getActivity();
    // Deduplicate: if same problem solved today already, update rather than duplicate
    const today = new Date().toISOString().slice(0, 10);
    const existingIdx = list.findIndex(
      a => a.title === entry.title && a.syncedAt?.slice(0, 10) === today
    );
    if (existingIdx !== -1) {
      list[existingIdx] = { ...list[existingIdx], ...entry };
    } else {
      list.unshift(entry);
    }
    const trimmed = list.slice(0, 100); // keep last 100 entries
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ activity: trimmed }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(trimmed);
      });
    });
  },

  // ── Clear ──────────────────────────────────────────────────────────────────
  async clearAll() {
    return new Promise(resolve => {
      chrome.storage.local.clear(() => chrome.storage.sync.clear(resolve));
    });
  },
};
