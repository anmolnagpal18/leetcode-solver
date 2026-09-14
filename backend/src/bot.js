// backend/src/bot.js
// Standalone 24/7 Telegram Bot Controller for Cloud Backend

import { 
  searchProblem, 
  getProblemDetails, 
  getProblemEditorData, 
  getDailyChallenge, 
  getRandomProblem, 
  submitSolution, 
  getSubmissionResult, 
  normalizeLanguageSlug, 
  verifyLeetCodeSession, 
  attemptLeetCodePasswordLogin, 
  getUserTodaySolveStats,
  getUnsolvedProblems
} from './leetcode.js';
import { getUserCurrentTime } from './scheduler.js';

const TIMEZONE_ALIASES = {
  'ist': 'Asia/Kolkata',
  'india': 'Asia/Kolkata',
  'est': 'America/New_York',
  'edt': 'America/New_York',
  'newyork': 'America/New_York',
  'pst': 'America/Los_Angeles',
  'pdt': 'America/Los_Angeles',
  'california': 'America/Los_Angeles',
  'cst': 'America/Chicago',
  'cdt': 'America/Chicago',
  'mst': 'America/Denver',
  'mdt': 'America/Denver',
  'gmt': 'UTC',
  'utc': 'UTC',
  'uk': 'Europe/London',
  'london': 'Europe/London',
  'bst': 'Europe/London',
  'jst': 'Asia/Tokyo',
  'japan': 'Asia/Tokyo',
  'tokyo': 'Asia/Tokyo',
  'sgt': 'Asia/Singapore',
  'singapore': 'Asia/Singapore',
  'cet': 'Europe/Paris',
  'cest': 'Europe/Paris',
  'paris': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'aest': 'Australia/Sydney',
  'sydney': 'Australia/Sydney',
  'pkt': 'Asia/Karachi',
  'pakistan': 'Asia/Karachi',
  'karachi': 'Asia/Karachi',
  'dubai': 'Asia/Dubai',
  'gst': 'Asia/Dubai',
  'uae': 'Asia/Dubai',
  'bdt': 'Asia/Dhaka',
  'bangladesh': 'Asia/Dhaka',
  'dhaka': 'Asia/Dhaka',
  'npt': 'Asia/Kathmandu',
  'nepal': 'Asia/Kathmandu',
  'kathmandu': 'Asia/Kathmandu'
};

function resolveTimezone(tzInput) {
  if (!tzInput) return null;
  const clean = tzInput.trim();
  const lower = clean.toLowerCase();
  const target = TIMEZONE_ALIASES[lower] || clean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: target });
    return target;
  } catch {
    return null;
  }
}

export class TelegramBotService {
  constructor(config = {}, services = {}) {
    this.token = (config.telegramToken || '').trim();
    this.allowedChatId = config.telegramChatId ? String(config.telegramChatId).trim() : null;
    this.leetcodeSession = (config.leetcodeSession || '').trim();
    this.leetcodeCsrfToken = (config.leetcodeCsrfToken || '').trim();
    this.groq = services.groq;
    this.github = services.github;
    this.credManager = services.credManager;

    this.pendingSelections = new Map(); // chatId -> { action, matches, lang, timestamp }
    this.pendingLinking = new Map();    // chatId -> { step, username, session, ... }
    this.lastUpdateId = 0;
    this.isPolling = false;
    this.shouldStop = false;
  }

  get isConfigured() {
    return Boolean(this.token);
  }

  getUserCredentials(chatId = null) {
    if (this.credManager) {
      return this.credManager.getCredentials(chatId);
    }
    return {
      session: this.leetcodeSession,
      csrfToken: this.leetcodeCsrfToken,
      username: null
    };
  }

  isUserAuthConfigured(chatId = null) {
    const creds = this.getUserCredentials(chatId);
    return Boolean(creds.session && creds.csrfToken);
  }

  get isAuthConfigured() {
    if (this.credManager) return this.credManager.isConfigured;
    return Boolean(this.leetcodeSession && this.leetcodeCsrfToken);
  }

  get authCredentials() {
    return this.getUserCredentials(null);
  }

  /**
   * Safe Telegram message sender with automatic length-splitting and persistent keyboard
   */
  async sendMessage(chatId, text, parseMode = 'Markdown', customMarkup = null) {
    if (!this.token) return;
    const targetChatId = chatId || this.allowedChatId || (this.credManager ? this.credManager.getChatId() : null);
    if (!targetChatId) return;

    const defaultKeyboard = {
      keyboard: [
        [{ text: '🚀 /solve' }, { text: '📅 /today' }],
        [{ text: '⏰ /timer' }, { text: '🕒 /schedule' }],
        [{ text: '🔗 /link' }, { text: '👤 /account' }],
        [{ text: '🔑 /apikey' }, { text: '🐙 /github' }],
        [{ text: '❓ /help' }]
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'Type e.g. /solve 10 cpp, /schedule 10 PM 3 py, /link...'
    };

    const MAX_LEN = 4000;
    const chunks = this._splitMessage(text, MAX_LEN);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const body = {
          chat_id: targetChatId,
          text: chunk
        };
        if (parseMode) body.parse_mode = parseMode;
        if (i === chunks.length - 1) {
          body.reply_markup = customMarkup || defaultKeyboard;
        }

        const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          // If markdown parse error, retry without markdown
          const errData = await res.json().catch(() => ({}));
          if (errData?.description?.includes('entity') || errData?.description?.includes('parse')) {
            const fallbackBody = { chat_id: targetChatId, text: chunk };
            if (i === chunks.length - 1) fallbackBody.reply_markup = customMarkup || defaultKeyboard;
            await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fallbackBody)
            });
          }
        }
      } catch (err) {
        console.error('[Bot] sendMessage error:', err.message);
      }
    }
  }

  _splitMessage(text, maxLen = 4000) {
    if (!text || text.length <= maxLen) return [text || ''];
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
      if (splitIdx === -1 || splitIdx < maxLen / 2) {
        splitIdx = remaining.lastIndexOf('\n', maxLen);
      }
      if (splitIdx === -1 || splitIdx < maxLen / 2) {
        splitIdx = maxLen;
      }

      chunks.push(remaining.substring(0, splitIdx).trim());
      remaining = remaining.substring(splitIdx).trim();
    }
    return chunks;
  }

  /**
   * Main command router
   */
  async handleMessage(msg) {
    if (!msg || !msg.text) return;
    const chatId = String(msg.chat.id);
    // Save active chatId for user session and scheduled background jobs
    if (this.credManager) this.credManager.saveChatId(chatId);

    let rawText = msg.text.trim();
    // If text was sent via keyboard button (e.g. "🚀 /solve"), strip button emoji
    rawText = rawText.replace(/^[^\w\/]*\s*(\/\w+)/, '$1').trim();

    // If user sends any command starting with '/', cancel any pending interactive step
    if (rawText.startsWith('/')) {
      if (rawText === '/cancel') {
        this.pendingLinking.delete(chatId);
        this.pendingSelections.delete(chatId);
        await this.sendMessage(chatId, '❌ *Operation cancelled.*');
        return;
      }
      this.pendingLinking.delete(chatId);
      this.pendingSelections.delete(chatId);
    } else {
      // If user is in an active interactive step (linking/timer/schedule), route there
      if (this.pendingLinking.has(chatId)) {
        await this._handleLinkingStep(chatId, rawText);
        return;
      }

      // Check if user is replying to a numbered disambiguation selection (e.g. "1", "2")
      if (/^[1-9]$/.test(rawText) && this.pendingSelections.has(chatId)) {
        await this._handleDisambiguationChoice(chatId, parseInt(rawText, 10));
        return;
      }
    }

    // ── Command Routing ──────────────────────────────────────────────────────
    if (rawText.startsWith('/start') || rawText.startsWith('/help')) {
      await this._sendHelp(chatId);
      return;
    }

    if (rawText.startsWith('/today')) {
      await this._sendToday(chatId);
      return;
    }

    if (rawText.startsWith('/solve')) {
      const rest = rawText.replace(/^\/solve/i, '').trim();
      await this._handleSolveCommand(chatId, rest);
      return;
    }

    if (rawText.startsWith('/timer') || rawText.startsWith('/remind')) {
      const rest = rawText.replace(/^\/(?:timer|remind)/i, '').trim();
      await this._handleTimerCommand(chatId, rest);
      return;
    }

    if (rawText.startsWith('/schedule') || rawText.startsWith('/cron')) {
      const rest = rawText.replace(/^\/(?:schedule|cron)/i, '').trim();
      await this._handleScheduleCommand(chatId, rest);
      return;
    }

    if (rawText.startsWith('/timezone') || rawText.startsWith('/tz')) {
      const rest = rawText.replace(/^\/(?:timezone|tz)/i, '').trim();
      await this._handleTimezoneCommand(chatId, rest);
      return;
    }

    if (rawText.startsWith('/link') || rawText.startsWith('/login') || rawText.startsWith('/setup')) {
      const args = rawText.replace(/^\/(?:link|login|setup)/i, '').trim();
      await this._handleLinkCommand(chatId, args);
      return;
    }

    if (rawText.startsWith('/apikey') || rawText.startsWith('/groq') || rawText.startsWith('/key')) {
      const args = rawText.replace(/^\/(?:apikey|groq|key)/i, '').trim();
      await this._handleApiKeyCommand(chatId, args);
      return;
    }

    if (rawText.startsWith('/github') || rawText.startsWith('/repo') || rawText.startsWith('/git')) {
      const args = rawText.replace(/^\/(?:github|repo|git)/i, '').trim();
      await this._handleGitHubCommand(chatId, args);
      return;
    }

    if (rawText.startsWith('/account') || rawText.startsWith('/status') || rawText.startsWith('/whoami')) {
      await this._sendAccountStatus(chatId);
      return;
    }

    if (rawText.startsWith('/unlink') || rawText.startsWith('/logout') || rawText.startsWith('/disconnect')) {
      const args = rawText.replace(/^\/(?:unlink|logout|disconnect)/i, '').trim();
      await this._handleUnlinkCommand(chatId, args);
      return;
    }

    // Direct solver trigger for problem numbers (e.g. user sends "10 cpp" or "1")
    if (/^\d+(\s+[a-zA-Z+#]+)?$/.test(rawText)) {
      await this._handleSolveCommand(chatId, rawText);
      return;
    }

    // Fallback: Show help menu
    await this.sendMessage(chatId, `❓ *Unrecognized command.* Tap a button below or type \`/help\` to see what the bot can do!`);
  }

  // ── /help ──────────────────────────────────────────────────────────────────
  async _sendHelp(chatId) {
    const helpText =
`🤖 *LeetCode Autonomous Companion — User Manual*

Welcome! I am your 24/7 AI-powered LeetCode companion that works even when your laptop and Chrome are completely turned *OFF*.

───────────────
📌 *Available Commands:*

🚀 */solve [number | name] [lang]*
Solves any problem with Grandmaster AI, submits directly to LeetCode, runs the self-healing multi-attempt retry loop on judge feedback, and syncs to GitHub!
• Examples: \`/solve 1452 cpp\`, \`/solve 1\`, \`/solve two sum\`, or just \`/solve\` for today's daily!

📅 */today*
Fetches today's official LeetCode Daily Challenge, tells you its solve status, and shows how many problems you have completed today!

⏰ */timer [time | off | now]*
Sets a daily practice reminder timer so the bot reminds you on Telegram every day to maintain your streak.
• Examples: \`/timer 08:00 PM\`, \`/timer 20:00\`, \`/timer off\`, \`/timer now\` (instant test)

🕒 */schedule [time] [N] [lang | off | now]*
Sets an automated daily auto-solve schedule so the cloud bot automatically solves fresh unsolved challenges at that time every day with laptop OFF.
• Examples: \`/schedule 10:00 PM 3 cpp\`, \`/schedule 22:00 1 py\`, \`/schedule 8 PM java\`, \`/schedule off\`, \`/schedule now\` (instant test)

🌐 */timezone [tz] (or /tz [tz])*
Sets your local timezone so schedules and reminders fire at the exact right local hour. Defaults to \`Asia/Kolkata\` (IST).
• Examples: \`/tz IST\`, \`/timezone Asia/Kolkata\`, \`/tz EST\`, \`/tz PST\`, \`/tz UTC\`, \`/tz London\`

🔗 */link*
Complete 5-step wizard to link LeetCode, Groq AI, and GitHub Sync interactively.

🔑 */apikey [key]*
Configures or updates your Groq AI API Key (\`gsk_...\`) for 24/7 autonomous code generation.

🐙 */github [token] [owner/repo]*
Configures or updates your GitHub Personal Access Token and repository sync.

👤 */account*
Displays your linked LeetCode username, timezone, Groq AI engine status, GitHub repo sync status, and active schedules.

❌ */unlink [all | github | apikey]*
Disconnects and permanently clears stored session credentials and configurations.

───────────────
💡 *Tip:* You can also tap the buttons below without typing!`;

    await this.sendMessage(chatId, helpText);
  }

  // ── /today ─────────────────────────────────────────────────────────────────
  async _sendToday(chatId) {
    await this.sendMessage(chatId, '⏳ *Fetching today\'s LeetCode challenge & daily progress…*');

    try {
      const creds = this.getUserCredentials(chatId);
      const daily = await getDailyChallenge(creds);
      if (!daily) {
        await this.sendMessage(chatId, '❌ *Failed to fetch today\'s challenge.* LeetCode API might be temporarily busy.');
        return;
      }

      let solveStats = { count: 0, questions: [] };
      if (creds.username) {
        solveStats = await getUserTodaySolveStats(creds.username, creds.session, creds.csrfToken);
      }

      const statusIcon = daily.userStatus === 'Finish' ? '✅' : '❌';
      const statusMsg = daily.userStatus === 'Finish' ? 'Already Solved' : 'Unsolved';

      let solvedSection = '';
      if (creds.username) {
        if (solveStats.count > 0) {
          const listStr = solveStats.questions.map(q => `  • *${q.title}*`).join('\n');
          solvedSection = `\n🏆 *Questions Solved Today (${solveStats.count}):*\n${listStr}\n`;
        } else {
          solvedSection = `\n🏆 *Questions Solved Today:* 0 questions solved today.\n`;
        }
      }

      const text =
`📅 *LeetCode Daily Challenge*

📖 *#${daily.frontendId} ${daily.title}*
🏷️ *Difficulty:* ${daily.difficulty}
📊 *Daily Challenge Status:* ${statusIcon} ${statusMsg}
${solvedSection}
🔗 ${daily.url}

👉 *Tap \`/solve\` to solve today's challenge automatically!*`;

      await this.sendMessage(chatId, text);
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Error fetching daily challenge:* ${err.message}`);
    }
  }

  // ── /account ───────────────────────────────────────────────────────────────
  async _sendAccountStatus(chatId) {
    await this.sendMessage(chatId, '⏳ *Checking linked account details…*');

    const creds = this.getUserCredentials(chatId);
    const ghConfig = this.credManager ? this.credManager.getGitHubConfig(chatId) : { repo: this.github?.repo || '', token: this.github?.token || '' };
    const timerConfig = this.credManager ? this.credManager.getTimer(chatId) : { enabled: false, time: '20:00' };
    const scheduleConfig = this.credManager ? this.credManager.getSchedule(chatId) : { enabled: false, time: '22:00', numQuestions: 1 };
    const userTz = this.credManager ? this.credManager.getTimezone(chatId) : 'Asia/Kolkata';
    const userTime = getUserCurrentTime(userTz);

    let leetCodeLine = '⚪ *Not linked* (Send `/link` to connect)';
    if (creds.session) {
      const verify = await verifyLeetCodeSession(creds.session, creds.csrfToken);
      if (verify.valid) {
        leetCodeLine = `🟢 *Linked & Verified* (@${verify.username})`;
      } else {
        leetCodeLine = `🟡 *Session Expired* (Send \`/link\` or click 🔗 Sync in Chrome)`;
      }
    }

    const groqKey = this.credManager ? this.credManager.getGroqApiKey(chatId) : (this.groq?.apiKey || '');
    let groqLine = '⚪ *Not configured* (Send `/apikey <key>`)';
    if (groqKey) {
      const masked = groqKey.length > 10 ? `${groqKey.slice(0, 7)}...${groqKey.slice(-4)}` : 'Configured';
      if (this.groq) {
        this.groq.setApiKey(groqKey);
        const groqPing = await this.groq.ping();
        groqLine = groqPing.ok ? `🟢 *Connected & Active* (\`${masked}\`)` : `🟡 *Key Configured* (\`${masked}\` - Ping Warning)`;
      } else {
        groqLine = `🟢 *Connected* (\`${masked}\`)`;
      }
    }

    const effectiveGhToken = ghConfig.token || this.github?.token || '';
    const effectiveGhRepo = ghConfig.repo || this.github?.repo || '';
    let ghLine = '⚪ *Not configured* (Send `/github` to connect)';
    if (effectiveGhRepo && effectiveGhToken) {
      if (this.github) {
        this.github.setConfig(effectiveGhToken, effectiveGhRepo, ghConfig.branch || 'main', ghConfig.folder || 'solutions');
        const ghPing = await this.github.ping();
        if (ghPing.ok) {
          ghLine = `🟢 *Connected & Verified* (\`${effectiveGhRepo}\`)`;
        } else {
          ghLine = `🔴 *Authentication Failed* (\`${effectiveGhRepo}\` - ${ghPing.error || 'Check Token'})`;
        }
      } else {
        ghLine = `🟢 *Configured* (\`${effectiveGhRepo}\`)`;
      }
    }
    const timerLine = timerConfig.enabled ? `🟢 *Active* (${timerConfig.time})` : '⚪ *Disabled* (Set with `/timer 8 PM`)';
    const scheduleLine = scheduleConfig.enabled ? `🟢 *Active* (${scheduleConfig.time} — ${scheduleConfig.numQuestions} Q [${scheduleConfig.language || 'Python'}])` : '⚪ *Disabled* (Set with `/schedule 10 PM 3 cpp`)';
    const tzLine = `🟢 *${userTz}* (Local Time: *${userTime.formatted}*)`;

    const text =
`👤 *Account & Automation Status*

━━━━━━━━━━━━━━━━━━━━
🎯 *LeetCode Account:*
${leetCodeLine}

🌐 *Timezone:*
${tzLine}

🤖 *Groq AI Engine:*
${groqLine}

🐙 *GitHub Sync Repository:*
${ghLine}

⏰ *Daily Practice Reminder:*
${timerLine}

🕒 *Autonomous Auto-Solve Schedule:*
${scheduleLine}

🚀 *24/7 Cloud Engine:*
🟢 *Online* (Works 24/7 even when your laptop is turned OFF)
━━━━━━━━━━━━━━━━━━━━

👉 *Quick Actions:*
• Tap \`/solve\` to solve a problem
• Tap \`/timezone\` to change timezone
• Tap \`/timer\` to update reminder time
• Tap \`/schedule\` to update auto-solve schedule
• Tap \`/link\` to link LeetCode & API key
• Tap \`/apikey\` to update Groq AI key`;

    await this.sendMessage(chatId, text);
  }

  // ── /timer ─────────────────────────────────────────────────────────────────
  async _handleTimerCommand(chatId, args) {
    if (!args) {
      const timerConfig = this.credManager ? this.credManager.getTimer(chatId) : { enabled: false, time: '20:00' };
      const userTz = this.credManager ? this.credManager.getTimezone(chatId) : 'Asia/Kolkata';
      const userTime = getUserCurrentTime(userTz);
      const statusText = timerConfig.enabled ? `🟢 *Active at ${timerConfig.time}* (${userTz})` : '⚪ *Currently Disabled*';

      await this.sendMessage(chatId,
`⏰ *Daily Practice Reminder Timer*

Status: ${statusText}
🌐 Current Timezone: *${userTz}* (Local Time: *${userTime.formatted}*)

Every day at the scheduled time, the bot will send a reminder message to your Telegram with today's challenge so you never break your streak! 🔥

👉 *How to set or change your reminder time:*
• \`/timer 08:00 PM\`
• \`/timer 20:00\`
• \`/timer 09:30 AM\`
• \`/timer now\` (to test immediately)
• \`/timer off\` (to disable)

Or reply with your desired time (e.g. *8 PM*):`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_timer_time' });
      return;
    }

    const clean = args.trim().toLowerCase();
    if (clean === 'off' || clean === 'disable' || clean === 'stop') {
      if (this.credManager) this.credManager.setTimer(chatId, false);
      if (this.scheduler) this.scheduler.resetTimerTrigger(chatId);
      await this.sendMessage(chatId, '⚪ *Daily reminder timer disabled.* Send `/timer 8 PM` anytime to re-enable!');
      return;
    }

    if (clean === 'now' || clean === 'test' || clean === 'run') {
      const timerConfig = this.credManager ? this.credManager.getTimer(chatId) : { enabled: true, time: '20:00' };
      const user = this.credManager ? this.credManager._getUser(chatId) : { chatId };
      try {
        const daily = await getDailyChallenge(user);
        const statusStr = daily?.userStatus === 'Finish' ? ' (✅ Solved)' : ' (❌ Unsolved)';
        const dailyInfo = daily ? `\n📖 *Today's Challenge:* #${daily.frontendId} ${daily.title} (${daily.difficulty})${statusStr}\n🔗 ${daily.url}` : '';

        const reminderMsg =
`⏰ *Instant Test: Daily LeetCode Practice Reminder!*

It's *${timerConfig.time}* — Time to solve your daily problem and protect your streak! 🔥
${dailyInfo}

👉 *Quick action:* Tap \`/solve\` to generate and submit the solution automatically!`;

        await this.sendMessage(chatId, reminderMsg);
      } catch (err) {
        await this.sendMessage(chatId, `❌ *Instant reminder test error:* ${err.message}`);
      }
      return;
    }

    if (this.credManager) {
      const updated = this.credManager.setTimer(chatId, true, args);
      if (this.scheduler) this.scheduler.resetTimerTrigger(chatId);
      if (updated && updated.time) {
        const userTz = this.credManager.getTimezone(chatId);
        const userTime = getUserCurrentTime(userTz);
        await this.sendMessage(chatId,
`⏰ *Daily Reminder Timer Activated!*

🟢 Time set to: *${updated.time}*
🌐 Timezone: *${userTz}* (Current Time: *${userTime.formatted}*)

Every day at *${updated.time}* (${userTz}), I will send you a reminder message on Telegram with today's daily challenge to keep your streak alive! 🔥

💡 *Tip:* Test your reminder immediately with \`/timer now\`!`
        );
        return;
      }
    }

    await this.sendMessage(chatId, '⚠️ *Invalid time format.* Please use formats like `/timer 8 PM`, `/timer 20:00`, or `/timer 08:30 PM`.');
  }

  // ── /schedule ──────────────────────────────────────────────────────────────
  async _handleScheduleCommand(chatId, args) {
    const existingSchedule = this.credManager ? this.credManager.getSchedule(chatId) : { enabled: false, time: '22:00', numQuestions: 1, language: 'Python' };
    const userTz = this.credManager ? this.credManager.getTimezone(chatId) : 'Asia/Kolkata';
    const userTime = getUserCurrentTime(userTz);

    if (!args) {
      const statusText = existingSchedule.enabled 
        ? `🟢 *Active at ${existingSchedule.time} (${existingSchedule.numQuestions} Question${existingSchedule.numQuestions > 1 ? 's' : ''}, ${existingSchedule.language || 'Python'})*` 
        : '⚪ *Currently Disabled*';

      await this.sendMessage(chatId,
`🕒 *Autonomous Auto-Solve Schedule*

Status: ${statusText}
🌐 Current Timezone: *${userTz}* (Local Time: *${userTime.formatted}*)

When active, the 24/7 Cloud Backend will automatically solve fresh unsolved challenges at the scheduled time in your chosen language, submit to LeetCode, and sync to GitHub!

👉 *How to set or change your schedule:*
• \`/schedule 10:00 PM 3 cpp\`
• \`/schedule 22:00 1 py\`
• \`/schedule 08:30 PM 2 java\`
• \`/schedule 11 PM rust\`
• \`/schedule now\` (to test immediately)
• \`/schedule off\` (to disable)

Or reply with your desired schedule (e.g. *10 PM 3 cpp*):`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_schedule_time' });
      return;
    }

    const clean = args.trim().toLowerCase();
    if (clean === 'off' || clean === 'disable' || clean === 'stop') {
      if (this.credManager) this.credManager.setSchedule(chatId, false);
      if (this.scheduler) this.scheduler.resetScheduleTrigger(chatId);
      await this.sendMessage(chatId, '⚪ *Auto-solve schedule disabled.* Send `/schedule 10 PM 3 cpp` anytime to re-enable!');
      return;
    }

    if (clean === 'now' || clean === 'test' || clean === 'run') {
      const schedule = this.credManager ? this.credManager.getSchedule(chatId) : { enabled: true, numQuestions: 1, language: 'Python' };
      const numQuestions = Math.max(1, parseInt(schedule.numQuestions || 1, 10));
      const targetLang = schedule.language || 'Python';

      await this.sendMessage(
        chatId,
        `🕒 *Instant Test: Triggering Auto-Solve Schedule Now...*\n` +
        `🎯 *Target:* Solving *${numQuestions}* strictly unsolved challenge(s) in *${targetLang}*...\n` +
        `🔍 Querying LeetCode for fresh, uncompleted problems...`
      );

      const user = this.credManager ? this.credManager._getUser(chatId) : { chatId };
      try {
        const unsolvedProblems = await getUnsolvedProblems(numQuestions, user);

        if (!unsolvedProblems || unsolvedProblems.length === 0) {
          await this.sendMessage(
            chatId,
            '⚠️ *No unsolved problems found matching criteria.* All problems in the search batch may already be completed!'
          );
          return;
        }

        const summaryList = unsolvedProblems
          .map((p, idx) => `  *${idx + 1}.* #${p.frontendId} ${p.title} (${p.difficulty}) ${p.isDaily ? '🌟 *[Daily]*' : ''}`)
          .join('\n');

        await this.sendMessage(
          chatId,
          `📋 *Selected ${unsolvedProblems.length} Fresh Unsolved Challenge(s):*\n${summaryList}\n\n🚀 *Starting autonomous multi-attempt solver in ${targetLang}...*`
        );

        let solvedCount = 0;
        for (let i = 0; i < unsolvedProblems.length; i++) {
          const prob = unsolvedProblems[i];
          const qNum = i + 1;

          await this.sendMessage(
            chatId,
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `▶️ *[${qNum}/${unsolvedProblems.length}] Processing Challenge [${targetLang}]:*\n` +
            `📖 *#${prob.frontendId} ${prob.title}* (${prob.difficulty})\n` +
            `━━━━━━━━━━━━━━━━━━━━`
          );

          try {
            const solveRes = await this._executeSolvePipeline(chatId, prob, targetLang);
            if (solveRes && solveRes.success) {
              solvedCount++;
            }
          } catch (pErr) {
            console.error(`[Bot] Instant test error solving problem #${prob.frontendId}:`, pErr.message);
            await this.sendMessage(chatId, `⚠️ *Error solving #${prob.frontendId}:* ${pErr.message}`);
          }

          if (i < unsolvedProblems.length - 1) {
            await new Promise(r => setTimeout(r, 5000));
          }
        }

        await this.sendMessage(
          chatId,
          `🏁 *Instant Auto-Solve Test Complete!* 🏆\n\n` +
          `✅ *Summary:* Successfully resolved *${solvedCount} / ${unsolvedProblems.length}* problems in *${targetLang}*.\n` +
          `🔥 Submissions and GitHub sync are completed!`
        );
      } catch (err) {
        await this.sendMessage(chatId, `❌ *Instant Auto-Solve encountered an error:* ${err.message}`);
      }
      return;
    }

    const { timeStr, numQ, lang } = this._parseScheduleArgs(args, existingSchedule.language || 'Python');

    if (this.credManager) {
      const updated = this.credManager.setSchedule(chatId, true, timeStr, numQ, lang);
      if (this.scheduler) this.scheduler.resetScheduleTrigger(chatId);
      if (updated && updated.time) {
        const userTz = this.credManager.getTimezone(chatId);
        const userTime = getUserCurrentTime(userTz);
        await this.sendMessage(chatId,
`🕒 *Autonomous Auto-Solve Schedule Activated!*

🟢 Scheduled Time: *${updated.time}*
🌐 Timezone: *${userTz}* (Current Time: *${userTime.formatted}*)
📦 Questions per Day: *${updated.numQuestions}* (Strictly Unsolved)
💻 Language: *${updated.language || 'Python'}*

Every day at *${updated.time}* (${userTz}), the 24/7 Cloud Bot will automatically solve *${updated.numQuestions}* fresh unsolved challenge(s) in *${updated.language || 'Python'}*, submit to LeetCode, and sync commits to GitHub — completely autonomous even when your laptop is turned *OFF*! 🚀

💡 *Tip:* Test your schedule immediately with \`/schedule now\`!`
        );
        return;
      }
    }

    await this.sendMessage(chatId, '⚠️ *Invalid format.* Please use formats like `/schedule 10 PM 3 cpp`, `/schedule 22:00 2 py`, or `/schedule 11 PM java`.');
  }

  // ── /timezone ──────────────────────────────────────────────────────────────
  async _handleTimezoneCommand(chatId, args) {
    const currentTz = this.credManager ? this.credManager.getTimezone(chatId) : 'Asia/Kolkata';
    const currentTime = getUserCurrentTime(currentTz);

    if (!args) {
      await this.sendMessage(chatId,
`🌐 *Timezone Configuration*

Current Timezone: 🟢 *${currentTz}*
🕒 Local Time: *${currentTime.formatted}* (Date: *${currentTime.todayStr}*)

Your reminder timer (\`/timer\`) and auto-solve schedule (\`/schedule\`) trigger based on this timezone!

👉 *How to change your timezone:*
• \`/tz IST\` or \`/timezone Asia/Kolkata\`
• \`/tz EST\` or \`/timezone America/New_York\`
• \`/tz PST\` or \`/timezone America/Los_Angeles\`
• \`/tz CST\` or \`/timezone America/Chicago\`
• \`/tz London\` or \`/timezone Europe/London\`
• \`/tz UTC\` or \`/tz GMT\`
• \`/tz Dubai\` or \`/timezone Asia/Dubai\`
• \`/tz Dhaka\` or \`/timezone Asia/Dhaka\`
• \`/tz Karachi\` or \`/timezone Asia/Karachi\`
• \`/tz Singapore\` or \`/timezone Asia/Singapore\`
• \`/tz Tokyo\` or \`/timezone Asia/Tokyo\`

Or reply with your timezone name or city (e.g. *Asia/Kolkata* or *IST*):`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_timezone' });
      return;
    }

    const resolved = resolveTimezone(args);
    if (!resolved) {
      await this.sendMessage(chatId,
`⚠️ *Invalid Timezone: "${args.trim()}"*

Please provide a valid IANA timezone name (e.g. \`Asia/Kolkata\`, \`America/New_York\`, \`Europe/London\`) or shortcut (e.g. \`IST\`, \`EST\`, \`PST\`, \`GMT\`, \`UTC\`, \`Dubai\`).`
      );
      return;
    }

    if (this.credManager) {
      this.credManager.setTimezone(chatId, resolved);
      if (this.scheduler) {
        this.scheduler.resetScheduleTrigger(chatId);
        this.scheduler.resetTimerTrigger(chatId);
      }
    }

    const newTime = getUserCurrentTime(resolved);
    await this.sendMessage(chatId,
`🌐 *Timezone Updated Successfully!*

🟢 Timezone: *${resolved}*
🕒 Current Local Time: *${newTime.formatted}* (${newTime.todayStr})

All your \`/timer\` and \`/schedule\` jobs are now precisely aligned to this timezone! 🚀`
    );
  }

  _parseScheduleArgs(args, defaultLang = 'Python') {
    let clean = (args || '').trim();
    let lang = defaultLang;
    let numQ = 1;

    const knownLangsMap = {
      'python': 'Python', 'py': 'Python', 'python3': 'Python',
      'cpp': 'C++', 'c++': 'C++',
      'java': 'Java',
      'javascript': 'JavaScript', 'js': 'JavaScript',
      'typescript': 'TypeScript', 'ts': 'TypeScript',
      'golang': 'Go', 'go': 'Go',
      'rust': 'Rust',
      'csharp': 'C#', 'c#': 'C#',
      'c': 'C'
    };

    const tokens = clean.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].toLowerCase();
      if (knownLangsMap[t]) {
        lang = knownLangsMap[t];
        tokens.splice(i, 1);
        break;
      }
    }
    clean = tokens.join(' ').replace(/\b(?:in|at|for)\b/gi, '').trim();

    const countMatch = clean.match(/(\d+)\s*(?:questions?|problems?|q)\b/i);
    if (countMatch) {
      numQ = parseInt(countMatch[1], 10);
      clean = clean.replace(countMatch[0], '').trim();
    } else {
      const remainingTokens = clean.split(/\s+/);
      if (remainingTokens.length > 1 && /^\d+$/.test(remainingTokens[remainingTokens.length - 1])) {
        numQ = parseInt(remainingTokens[remainingTokens.length - 1], 10);
        clean = remainingTokens.slice(0, -1).join(' ').trim();
      }
    }

    numQ = Math.min(Math.max(numQ, 1), 10);
    const timeStr = clean.trim();

    return { timeStr, numQ, lang };
  }

  // ── /link ──────────────────────────────────────────────────────────────────
  async _handleLinkCommand(chatId, args) {
    const clean = (args || '').trim().toLowerCase();

    if (clean === 'github' || clean === 'repo') {
      await this._handleGitHubCommand(chatId, '');
      return;
    }

    if (clean === 'apikey' || clean === 'groq' || clean === 'ai') {
      await this._handleApiKeyCommand(chatId, '');
      return;
    }

    if (clean === 'leetcode' || clean === 'lc') {
      this.pendingLinking.set(chatId, { step: 'awaiting_session_or_user', mode: 'leetcode_only' });
      await this.sendMessage(chatId,
`🔗 *LeetCode Account Setup (Step 1/2)*

Please paste your \`LEETCODE_SESSION\` cookie value:

💡 *(Found in Chrome DevTools → Application → Cookies → leetcode.com)*
❌ *(To cancel, send \`/cancel\`)*`
      );
      return;
    }

    // If inline args provided: /link <session> <csrf> [groq_key] [github_token] [github_repo]
    if (args && !['leetcode', 'groq', 'github', 'ai', 'repo', 'lc'].includes(clean)) {
      const parts = args.split(/\s+/);
      if (parts.length >= 2) {
        const session = parts[0].replace(/^LEETCODE_SESSION=/i, '').replace(/;$/, '').trim();
        const csrf = parts[1].replace(/^csrftoken=/i, '').replace(/;$/, '').trim();
        const apiKey = (parts.length >= 3 && parts[2] !== '-' && parts[2] !== 'none') ? parts[2].trim() : null;
        const ghToken = (parts.length >= 4 && parts[3] !== '-' && parts[3] !== 'none') ? parts[3].trim() : null;
        const ghRepo = (parts.length >= 5 && parts[4] !== '-' && parts[4] !== 'none') ? parts[4].trim() : null;

        await this.sendMessage(chatId, '⏳ *Verifying LeetCode credentials…*');
        const verify = await verifyLeetCodeSession(session, csrf);
        if (verify.valid) {
          if (this.credManager) {
            this.credManager.saveCredentials(chatId, session, csrf, verify.username, apiKey);
            if (ghToken && ghRepo) {
              this.credManager.saveGitHub(chatId, ghToken, ghRepo);
            }
          }
          if (apiKey && this.groq) {
            this.groq.setApiKey(apiKey);
          }
          if (ghToken && ghRepo && this.github) {
            this.github.setConfig(ghToken, ghRepo);
          }
          this.leetcodeSession = session;
          this.leetcodeCsrfToken = csrf;

          await this._sendSetupComplete(chatId, { username: verify.username }, ghRepo);
          return;
        } else {
          await this.sendMessage(chatId, `❌ *Invalid credentials:* ${verify.error}`);
          return;
        }
      }
    }

    // Step-by-step interactive linking (full 5-step wizard)
    this.pendingLinking.set(chatId, { step: 'awaiting_session_or_user' });
    await this.sendMessage(chatId,
`🔗 *Autonomous Companion Setup Wizard (Step 1/5: LeetCode Session)*

Welcome! Let's connect your accounts so the bot can autonomously solve and sync solutions 24/7.

Please paste your \`LEETCODE_SESSION\` cookie value:

💡 *How to get your session cookie:*
1. Open [leetcode.com](https://leetcode.com) and log into your account
2. Press \`F12\` → **Application** tab → **Cookies** → \`https://leetcode.com\`
3. Copy the value of \`LEETCODE_SESSION\` and paste it here

*(Or use the **🔗 Sync** button in Chrome Extension settings)*
*(To cancel anytime, send \`/cancel\`)*`
    );
  }

  // ── /apikey ────────────────────────────────────────────────────────────────
  async _handleApiKeyCommand(chatId, args) {
    if (!args) {
      const currentKey = this.credManager ? this.credManager.getGroqApiKey(chatId) : (this.groq?.apiKey || '');
      const statusText = currentKey ? `🟢 *Configured* (\`${currentKey.slice(0, 7)}...${currentKey.slice(-4)}\`)` : '⚪ *Not Configured*';

      await this.sendMessage(chatId,
`🤖 *Groq AI API Key Configuration*

Current Status: ${statusText}

Groq AI powers the Grandmaster solver and self-healing error correction loop with blazing fast generation.

👉 *How to set or change your Groq API Key:*
• \`/apikey gsk_...\`
• Or reply with your Groq API Key directly:
*(Get a 100% free key from console.groq.com)*`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_direct_groq_key' });
      return;
    }

    const clean = args.trim();
    if (clean.length > 10) {
      if (this.credManager) {
        this.credManager.saveGroqApiKey(chatId, clean);
      }
      if (this.groq) {
        this.groq.setApiKey(clean);
      }

      const masked = clean.length > 10 ? `${clean.slice(0, 7)}...${clean.slice(-4)}` : 'Saved';
      await this.sendMessage(chatId,
`🤖 *Groq AI API Key Saved Successfully!*

🟢 API Key: \`${masked}\`
⚡ *AI Engine:* Connected & Ready for 24/7 automated solving! 🚀`
      );
      return;
    }

    await this.sendMessage(chatId, '⚠️ *Invalid API Key format.* Please provide a valid Groq API key starting with `gsk_...`.');
  }

  // ── /github ────────────────────────────────────────────────────────────────
  async _handleGitHubCommand(chatId, args) {
    if (!args) {
      const currentConfig = this.credManager ? this.credManager.getGitHubConfig(chatId) : { repo: this.github?.repo || '', token: this.github?.token || '' };
      const statusText = (currentConfig.repo && (currentConfig.token || this.github?.token))
        ? `🟢 *Connected* (\`${currentConfig.repo}\`)`
        : '⚪ *Not Configured*';

      await this.sendMessage(chatId,
`🐙 *GitHub Sync Configuration*

Current Status: ${statusText}

When configured, the bot automatically syncs your accepted code submissions to your GitHub repository with markdown problem descriptions!

👉 *How to set or change your GitHub Sync:*
• \`/github <token> <owner/repo>\`
  _(Example: \`/github ghp_abc123 anmolnagpal18/leetcode-solutions\`)_
• Or reply with your GitHub Personal Access Token (\`ghp_...\`):
  _(Create a token with \`repo\` scope at github.com/settings/tokens)_`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_direct_github_token' });
      return;
    }

    const parts = args.split(/\s+/);
    if (parts.length >= 2) {
      const token = parts[0].trim();
      const repo = parts[1].trim();
      const branch = parts[2] ? parts[2].trim() : 'main';
      const folder = parts[3] ? parts[3].trim() : 'solutions';

      if (this.credManager) {
        this.credManager.saveGitHub(chatId, token, repo, branch, folder);
      }
      if (this.github) {
        this.github.setConfig(token, repo, branch, folder);
      }

      await this.sendMessage(chatId, '⏳ *Testing GitHub repository connection…*');
      const pingRes = this.github ? await this.github.ping() : { ok: true };

      if (pingRes.ok) {
        await this.sendMessage(chatId,
`🐙 *GitHub Repository Linked Successfully!*

🟢 Repository: \`${repo}\`
📁 Branch: \`${branch}\` | Folder: \`${folder}\`
✅ *Connection Verified:* Solutions will automatically sync on every accepted submission!`
        );
      } else {
        await this.sendMessage(chatId,
`⚠️ *GitHub Config Saved with Warning:*
Could not verify repository access: ${pingRes.error || 'Check repository name or token permissions.'}

Saved configuration: \`${repo}\``
        );
      }
      return;
    }

    // If single arg provided: could be just token or repo
    if (parts[0].startsWith('ghp_') || parts[0].length > 20) {
      this.pendingLinking.set(chatId, { step: 'awaiting_direct_github_repo', githubToken: parts[0] });
      await this.sendMessage(chatId, `🔑 *GitHub Token Saved.* Now enter your GitHub Repository name (\`owner/repo\`), e.g. \`anmolnagpal18/leetcode-solutions\`:`);
      return;
    }

    await this.sendMessage(chatId, '⚠️ *Invalid format.* Use `/github <token> <owner/repo>` or send `/github` to configure step-by-step.');
  }

  // ── /unlink ────────────────────────────────────────────────────────────────
  async _handleUnlinkCommand(chatId, args = '') {
    const clean = (args || '').trim().toLowerCase();

    if (clean === 'apikey' || clean === 'groq' || clean === 'key') {
      if (this.credManager) {
        this.credManager.saveGroqApiKey(chatId, '');
      }
      if (this.groq) {
        this.groq.setApiKey('');
      }
      await this.sendMessage(chatId,
`⚪ *Groq AI API Key Cleared.*

The Groq API key has been removed. You can set a new key anytime with \`/apikey <key>\`.`
      );
      return;
    }

    if (clean === 'github' || clean === 'repo' || clean === 'git') {
      if (this.credManager) {
        this.credManager.clearGitHub(chatId);
      }
      if (this.github) {
        this.github.token = '';
        this.github.repo = '';
      }
      await this.sendMessage(chatId,
`⚪ *GitHub Sync Repository Cleared.*

GitHub sync configuration and personal access token have been removed.`
      );
      return;
    }

    if (clean === 'all' || clean === 'everything' || clean === 'reset') {
      if (this.credManager) {
        this.credManager.clearCredentials(chatId);
        this.credManager.saveGroqApiKey(chatId, '');
        this.credManager.clearGitHub(chatId);
        this.credManager.setTimer(chatId, false);
        this.credManager.setSchedule(chatId, false);
      }
      this.leetcodeSession = '';
      this.leetcodeCsrfToken = '';
      if (this.groq) {
        this.groq.setApiKey('');
      }
      if (this.github) {
        this.github.token = '';
        this.github.repo = '';
      }
      await this.sendMessage(chatId,
`⚪ *All Credentials & Schedules Cleared.*

• LeetCode session: Unlinked
• Groq AI API Key: Cleared
• GitHub Sync Repository: Cleared
• Practice Timer: Disabled
• Auto-solve Schedule: Disabled

Send \`/link\` to connect your account again.`
      );
      return;
    }

    // Default: Clear LeetCode session credentials
    if (this.credManager) {
      this.credManager.clearCredentials(chatId);
    }
    this.leetcodeSession = '';
    this.leetcodeCsrfToken = '';
    await this.sendMessage(chatId,
`⚪ *Account Unlinked Successfully.*

Saved LeetCode session credentials have been cleared from the backend database. Automatic submissions are now paused until you re-link.

💡 *Tips:*
• Use \`/link\` to connect your account
• Use \`/unlink apikey\` to clear Groq API key
• Use \`/unlink github\` to clear GitHub sync
• Use \`/unlink all\` to reset everything`
    );
  }

  async _sendSetupComplete(chatId, state, githubRepo = null) {
    const creds = this.getUserCredentials(chatId);
    const groqKey = this.credManager ? this.credManager.getGroqApiKey(chatId) : (this.groq?.apiKey || '');
    const ghConfig = this.credManager ? this.credManager.getGitHubConfig(chatId) : { repo: githubRepo || '' };

    const username = creds.username || state?.username;
    const lcLine = username ? `🟢 *Linked & Verified* (@${username})` : '⚪ *Not linked*';
    
    let groqLine = '⚪ *Not configured* (Send `/apikey <key>`)';
    if (groqKey) {
      const masked = groqKey.length > 10 ? `${groqKey.slice(0, 7)}...${groqKey.slice(-4)}` : 'Configured';
      groqLine = `🟢 *Connected* (\`${masked}\`)`;
    }

    const effectiveGhToken = ghConfig.token || state?.githubToken || this.github?.token || '';
    const effectiveGhRepo = ghConfig.repo || githubRepo || this.github?.repo || '';
    let ghLine = '⚪ *Not configured* (Send `/github <token> <repo>`)';
    if (effectiveGhRepo && effectiveGhToken) {
      if (this.github) {
        this.github.setConfig(effectiveGhToken, effectiveGhRepo, ghConfig.branch || 'main', ghConfig.folder || 'solutions');
        const ping = await this.github.ping();
        if (ping.ok) {
          ghLine = `🟢 *Connected & Verified* (\`${effectiveGhRepo}\`)`;
        } else {
          ghLine = `🟡 *Configured with Warning* (\`${effectiveGhRepo}\` - ${ping.error || 'Access warning'})`;
        }
      } else {
        ghLine = `🟢 *Connected* (\`${effectiveGhRepo}\`)`;
      }
    }

    const text =
`🎉 *All Services Linked & Configured Successfully!*

━━━━━━━━━━━━━━━━━━━━
🎯 *LeetCode Account:*
${lcLine}

🤖 *Groq AI Engine:*
${groqLine}

🐙 *GitHub Sync Repository:*
${ghLine}

🚀 *24/7 Cloud Engine:*
🟢 *Online & Submissions Active* (Works even with laptop OFF!)
━━━━━━━━━━━━━━━━━━━━

👉 *Quick Actions:*
• Tap \`/today\` to check today's daily challenge
• Tap \`/solve\` to solve any problem with AI
• Tap \`/timer 8 PM\` to set your daily reminder
• Tap \`/schedule 10 PM 3 cpp\` to set auto-solving
• Tap \`/account\` to view full status`;

    await this.sendMessage(chatId, text);
  }

  // ── Interactive State Machine ──────────────────────────────────────────────
  async _handleLinkingStep(chatId, text) {
    const state = this.pendingLinking.get(chatId);
    if (!state) return;

    if (state.step === 'awaiting_timer_time') {
      this.pendingLinking.delete(chatId);
      await this._handleTimerCommand(chatId, text);
      return;
    }

    if (state.step === 'awaiting_schedule_time') {
      this.pendingLinking.delete(chatId);
      await this._handleScheduleCommand(chatId, text);
      return;
    }

    if (state.step === 'awaiting_timezone') {
      this.pendingLinking.delete(chatId);
      await this._handleTimezoneCommand(chatId, text);
      return;
    }

    if (state.step === 'awaiting_direct_groq_key') {
      this.pendingLinking.delete(chatId);
      await this._handleApiKeyCommand(chatId, text);
      return;
    }

    if (state.step === 'awaiting_direct_github_token') {
      const clean = text.trim();
      if (clean.toLowerCase() === '/cancel' || clean.toLowerCase() === 'cancel') {
        this.pendingLinking.delete(chatId);
        await this.sendMessage(chatId, '❌ *GitHub setup cancelled.*');
        return;
      }

      const isTokenFormat = clean.startsWith('ghp_') || clean.startsWith('github_pat_') || clean.startsWith('gho_') || clean.startsWith('ghs_');
      if (isTokenFormat || (clean.length > 20 && !clean.includes(';'))) {
        state.githubToken = clean;
        state.step = 'awaiting_direct_github_repo';
        await this.sendMessage(chatId,
`🐙 *GitHub Token Received!*

Now enter your repository name in \`owner/repo\` format (e.g. \`anmolnagpal18/leetcode-solutions\`):`
        );
        return;
      } else {
        await this.sendMessage(chatId,
`⚠️ *Invalid GitHub Token format.*

GitHub Personal Access Tokens start with \`ghp_...\` (Classic) or \`github_pat_...\` (Fine-grained).
_(Make sure you didn't paste a CSRF token or session cookie)_

👉 Create a token with **\`repo\`** scope at [github.com/settings/tokens](https://github.com/settings/tokens) and paste it here:`
        );
        return;
      }
    }

    if (state.step === 'awaiting_direct_github_repo') {
      this.pendingLinking.delete(chatId);
      const cleanRepo = text.trim();
      if (!cleanRepo.includes('/')) {
        await this.sendMessage(chatId, '⚠️ *Invalid repository format.* Must be in `owner/repo` format, e.g. `anmolnagpal18/leetcode-solutions`. Configuration not saved.');
        return;
      }

      if (this.credManager) {
        this.credManager.saveGitHub(chatId, state.githubToken, cleanRepo, 'main', 'solutions');
      }
      if (this.github) {
        this.github.setConfig(state.githubToken, cleanRepo, 'main', 'solutions');
      }

      await this.sendMessage(chatId, '⏳ *Testing GitHub repository connection…*');
      const pingRes = this.github ? await this.github.ping() : { ok: true };
      if (pingRes.ok) {
        await this.sendMessage(chatId,
`🐙 *GitHub Sync Configured Successfully!*

🟢 Repository: \`${cleanRepo}\`
📁 Branch: \`main\` | Folder: \`solutions/\`
✅ Verified & Ready to sync solutions automatically!`
        );
      } else {
        await this.sendMessage(chatId,
`⚠️ *GitHub Config Saved with Notice:*
Could not verify repository access: ${pingRes.error || 'Check repository permissions.'}
Saved repository: \`${cleanRepo}\``
        );
      }
      return;
    }

    // Step 1: Session Cookie
    if (state.step === 'awaiting_session_or_user') {
      const clean = text.replace(/^LEETCODE_SESSION=/i, '').replace(/;$/, '').trim();
      if (clean.length > 30) {
        state.session = clean;
        state.step = 'awaiting_csrf';
        await this.sendMessage(chatId,
`🔑 *Account Setup Wizard (Step 2/5: LeetCode CSRF Token)*

Please paste your \`csrftoken\` cookie value:
*(Found right next to LEETCODE_SESSION in Chrome DevTools)*
*(To cancel, send \`/cancel\`)*`
        );
        return;
      } else {
        await this.sendMessage(chatId, `⚠️ *Invalid cookie length.* Please paste the full LEETCODE_SESSION value or use the **🔗 Sync** button in Chrome.`);
        this.pendingLinking.delete(chatId);
        return;
      }
    }

    // Step 2: CSRF Token & Verification
    if (state.step === 'awaiting_csrf') {
      const cleanCsrf = text.replace(/^csrftoken=/i, '').replace(/;$/, '').trim();
      await this.sendMessage(chatId, '⏳ *Verifying LeetCode session…*');
      const verify = await verifyLeetCodeSession(state.session, cleanCsrf);
      if (verify.valid) {
        state.csrf = cleanCsrf;
        state.username = verify.username;
        if (this.credManager) {
          this.credManager.saveCredentials(chatId, state.session, cleanCsrf, verify.username);
        }
        this.leetcodeSession = state.session;
        this.leetcodeCsrfToken = cleanCsrf;

        if (state.mode === 'leetcode_only') {
          this.pendingLinking.delete(chatId);
          await this.sendMessage(chatId,
`🎉 *LeetCode Account Linked Successfully!*

👤 *LeetCode Username:* @${verify.username}
🟢 *Status:* Authenticated & Saved 24/7
🚀 Automatic submissions are now active!`
          );
          return;
        }

        state.step = 'awaiting_groq_key';
        await this.sendMessage(
          chatId,
`✅ *LeetCode Authenticated:* @${verify.username}

🤖 *Account Setup Wizard (Step 3/5: Groq AI API Key)*
Please paste your Groq AI API Key (\`gsk_...\`):
• Get a 100% free key at [console.groq.com/keys](https://console.groq.com/keys)
• Or send \`/skip\` to keep your current AI configuration.`
        );
        return;
      } else {
        this.pendingLinking.delete(chatId);
        await this.sendMessage(chatId, `❌ *Authentication Failed:* ${verify.error}\n_Please try copying cookies again or use 1-Click Sync in Chrome._`);
        return;
      }
    }

    // Step 3: Groq AI Key
    if (state.step === 'awaiting_groq_key') {
      const clean = text.trim();
      const isSkip = clean.toLowerCase() === '/skip' || clean.toLowerCase() === 'skip';

      if (!isSkip && clean.length > 10) {
        if (this.credManager) {
          this.credManager.saveGroqApiKey(chatId, clean);
        }
        if (this.groq) {
          this.groq.setApiKey(clean);
        }
        const masked = clean.length > 10 ? `${clean.slice(0, 7)}...${clean.slice(-4)}` : 'Saved';
        await this.sendMessage(chatId, `🤖 *Groq AI Key Saved:* \`${masked}\` ✅`);
      }

      state.step = 'awaiting_github_token';
      await this.sendMessage(
        chatId,
`🐙 *Account Setup Wizard (Step 4/5: GitHub Personal Access Token)*
Please paste your GitHub Personal Access Token (\`ghp_...\` with \`repo\` scope):
• Create one at [github.com/settings/tokens](https://github.com/settings/tokens)
• Or send \`/skip\` to finish without GitHub sync.`
      );
      return;
    }

    // Step 4: GitHub Token
    if (state.step === 'awaiting_github_token') {
      const clean = text.trim();
      const isSkip = clean.toLowerCase() === '/skip' || clean.toLowerCase() === 'skip';

      if (isSkip) {
        this.pendingLinking.delete(chatId);
        await this._sendSetupComplete(chatId, state);
        return;
      }

      const isTokenFormat = clean.startsWith('ghp_') || clean.startsWith('github_pat_') || clean.startsWith('gho_') || clean.startsWith('ghs_');
      if (isTokenFormat || (clean.length > 20 && !clean.includes(';'))) {
        state.githubToken = clean;
        state.step = 'awaiting_github_repo';
        await this.sendMessage(
          chatId,
`📁 *Account Setup Wizard (Step 5/5: GitHub Repository)*
Please enter your GitHub repository in \`owner/repo\` format:
• Example: \`anmolnagpal18/leetcode-solutions\`
• Or send \`/skip\` to use default (\`${state.username || 'anmolnagpal18'}/leetcode-solutions\`):`
        );
        return;
      } else {
        await this.sendMessage(
          chatId,
`⚠️ *Invalid GitHub Token format.*
GitHub Personal Access Tokens start with \`ghp_...\` (Classic) or \`github_pat_...\` (Fine-grained).
_(Note: Do not paste CSRF token or session cookies here)_

👉 Paste your GitHub PAT or send \`/skip\` to finish without GitHub:`
        );
        return;
      }
    }

    // Step 5: GitHub Repo
    if (state.step === 'awaiting_github_repo') {
      this.pendingLinking.delete(chatId);
      const clean = text.trim();
      const isSkip = clean.toLowerCase() === '/skip' || clean.toLowerCase() === 'skip';
      const repo = isSkip ? (state.username ? `${state.username}/leetcode-solutions` : 'anmolnagpal18/leetcode-solutions') : clean;

      if (this.credManager && state.githubToken) {
        this.credManager.saveGitHub(chatId, state.githubToken, repo, 'main', 'solutions');
      }
      if (this.github && state.githubToken) {
        this.github.setConfig(state.githubToken, repo, 'main', 'solutions');
      }

      await this._sendSetupComplete(chatId, state, repo);
      return;
    }
  }

  // ── /solve Pipeline with Self-Healing Multi-Attempt Loop ────────────────────
  async _handleSolveCommand(chatId, rest) {
    const cleanRest = (rest || '').trim();

    // Check if user requested batch unsolved solving: e.g. "3 questions cpp", "10 problems", "batch 3"
    const batchRegex = /^(?:batch\s+)?(\d+)\s*(?:questions?|problems?|q|unsolved)\s*([a-zA-Z+#]*)$/i;
    const batchMatch = cleanRest.match(batchRegex);

    if (batchMatch) {
      const count = Math.min(Math.max(parseInt(batchMatch[1], 10), 1), 10);
      const lang = batchMatch[2] ? batchMatch[2].trim() : 'Python';
      const creds = this.getUserCredentials(chatId);

      await this.sendMessage(chatId, `🎯 *Batch Solver Triggered:* Fetching *${count}* strictly unsolved problem(s)...`);
      const unsolvedProblems = await getUnsolvedProblems(count, creds);

      if (!unsolvedProblems || unsolvedProblems.length === 0) {
        await this.sendMessage(chatId, '⚠️ *No unsolved problems found.*');
        return;
      }

      const summaryList = unsolvedProblems
        .map((p, idx) => `  *${idx + 1}.* #${p.frontendId} ${p.title} (${p.difficulty}) ${p.isDaily ? '🌟 *[Daily]*' : ''}`)
        .join('\n');

      await this.sendMessage(chatId, `📋 *Selected ${unsolvedProblems.length} Unsolved Challenge(s):*\n${summaryList}\n\n🚀 *Starting solve pipeline...*`);

      let solvedCount = 0;
      for (let i = 0; i < unsolvedProblems.length; i++) {
        const prob = unsolvedProblems[i];
        await this.sendMessage(
          chatId,
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `▶️ *[${i + 1}/${unsolvedProblems.length}] Solving #${prob.frontendId} ${prob.title}* (${prob.difficulty})\n` +
          `━━━━━━━━━━━━━━━━━━━━`
        );

        const res = await this._executeSolvePipeline(chatId, prob, lang);
        if (res && res.success) solvedCount++;

        if (i < unsolvedProblems.length - 1) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      await this.sendMessage(chatId, `🏁 *Batch Solving Complete!* Successfully resolved *${solvedCount}/${unsolvedProblems.length}* problems. 🏆`);
      return;
    }

    const { query, language } = this._extractQueryAndLanguage(cleanRest, 'Python');
    try {
      let problem = null;
      if (!query) {
        // Default: Fetch next unsolved challenge (daily if unsolved, else fresh problemset question)
        const creds = this.getUserCredentials(chatId);
        await this.sendMessage(chatId, '🔍 *Finding next unsolved challenge...*');
        const unsolved = await getUnsolvedProblems(1, creds);
        if (unsolved && unsolved.length > 0) {
          problem = unsolved[0];
        } else {
          await this.sendMessage(chatId, '❌ *Could not find an unsolved challenge.*');
          return;
        }
      } else {
        problem = await this._resolveProblem(chatId, query, 'solve', { language });
      }

      if (problem) {
        await this._executeSolvePipeline(chatId, problem, language);
      }
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Error in solve pipeline:* ${err.message}`);
    }
  }

  async _executeSolvePipeline(chatId, problem, language) {
    const userGroqKey = this.credManager ? this.credManager.getGroqApiKey(chatId) : (this.groq?.apiKey || '');
    if (!userGroqKey) {
      await this.sendMessage(chatId, '❌ *Groq AI key not configured.* Please send `/apikey <key>` with your free Groq API key.');
      return { success: false, problem, error: 'Groq not configured' };
    }
    if (this.groq) {
      this.groq.setApiKey(userGroqKey);
    }

    await this.sendMessage(chatId, `🔎 *Problem target:*\n#${problem.frontendId} *${problem.title}*\nDifficulty: *${problem.difficulty}*`);

    const details = await getProblemDetails(problem.slug);
    const editorData = await getProblemEditorData(problem.slug);

    const targetLangSlug = normalizeLanguageSlug(language);
    const snippet = (editorData.codeSnippets || []).find(s => s.langSlug === targetLangSlug);
    const templateCode = snippet ? snippet.code : '';

    const creds = this.getUserCredentials(chatId);
    if (!creds || !creds.session) {
      await this.sendMessage(chatId, `⚙️ *Generating optimal ${language.toUpperCase()} solution...*`);
      const solution = await this.groq.generateSolution(details.title, details.description, language, templateCode);
      await this.sendMessage(chatId,
`⚠️ *Automatic submission is unavailable.*

No LeetCode account is linked for your chat yet.

*Generated Solution Code:*
\`\`\`${targetLangSlug}
${solution.code}
\`\`\`

👉 *To enable 24/7 automatic submissions:*
Send \`/link\` or click **🔗 Sync Account** in Chrome extension settings!`
      );
      return { success: false, problem, error: 'Not authenticated' };
    }

    // ── Self-Healing Multi-Attempt Loop ──────────────────────────────────────
    const MAX_ATTEMPTS = 4;
    let currentAttempt = 1;
    let currentCode = '';
    let lastFailureFeedback = '';

    while (currentAttempt <= MAX_ATTEMPTS) {
      if (currentAttempt === 1) {
        await this.sendMessage(chatId, `⚙️ *Generating optimal ${language.toUpperCase()} solution (Attempt 1/${MAX_ATTEMPTS})...*`);
        const solution = await this.groq.generateSolution(details.title, details.description, language, templateCode);
        if (!solution.isValid || !solution.code) {
          await this.sendMessage(chatId, '❌ *AI generated incomplete code. Aborting submission.*');
          return { success: false, problem, error: 'Incomplete AI code' };
        }
        currentCode = solution.code;
      } else {
        await this.sendMessage(chatId, `🔄 *Self-healing code based on LeetCode judge feedback (Attempt ${currentAttempt}/${MAX_ATTEMPTS})…*`);
        const refined = await this.groq.generateRefinedSolution(
          details.title,
          details.description,
          language,
          currentCode,
          lastFailureFeedback
        );
        if (!refined || !refined.code || !refined.isValid) {
          await this.sendMessage(chatId, '⚠️ *Could not refine solution code further. Stopping attempts.*');
          return { success: false, problem, error: 'Refinement stopped' };
        }
        currentCode = refined.code;
      }

      // Submit to LeetCode
      await this.sendMessage(chatId, `🚀 *Submitting Attempt ${currentAttempt} to LeetCode...*`);
      const submitRes = await submitSolution(
        problem.slug,
        editorData.questionId,
        currentCode,
        language,
        { session: creds.session, csrfToken: creds.csrfToken }
      );

      if (!submitRes.success) {
        await this.sendMessage(chatId,
`⚠️ *Submission attempt ${currentAttempt} error:*
${submitRes.error}

*Generated Solution Code:*
\`\`\`${targetLangSlug}
${currentCode}
\`\`\`
_Send \`/link\` if you need to refresh your session cookie._`
        );
        return { success: false, problem, error: submitRes.error };
      }

      // Poll real verdict from LeetCode judge
      await this.sendMessage(chatId, `⏳ *Checking Attempt ${currentAttempt} result from LeetCode judge...*`);
      const result = await getSubmissionResult(
        submitRes.submissionId,
        { session: creds.session, csrfToken: creds.csrfToken }
      );

      if (result.accepted) {
        let acceptedText =
`🎉 *Accepted on Attempt ${currentAttempt}! All testcases passed!* 🏆

📖 *Problem:* #${details.frontendId} ${details.title}
⚡ *Runtime:* ${result.runtime} ${result.runtimePercentile ? `(Beats ${result.runtimePercentile})` : ''}
💾 *Memory:* ${result.memory} ${result.memoryPercentile ? `(Beats ${result.memoryPercentile})` : ''}`;

        // Optional GitHub Sync with dynamic credential check
        const ghConfig = this.credManager ? this.credManager.getGitHubConfig(chatId) : { repo: this.github?.repo || '', token: this.github?.token || '' };
        if (ghConfig.token && ghConfig.repo && this.github) {
          this.github.setConfig(ghConfig.token, ghConfig.repo, ghConfig.branch || 'main', ghConfig.folder || 'solutions');
        }

        if (this.github && this.github.isConfigured) {
          try {
            console.log(`[Bot] Syncing accepted solution to GitHub (${this.github.repo})...`);
            const ghRes = await this.github.syncSolution(details.title, details.difficulty, language, currentCode, details.description);
            if (ghRes.synced) {
              console.log('[Bot] ✅ GitHub sync successful:', ghRes.commitUrl);
              acceptedText += `\n🐙 *GitHub Sync:* [View Commit](${ghRes.commitUrl})`;
            }
          } catch (ghErr) {
            console.error('[Bot] ⚠️ GitHub sync failed:', ghErr.message);
            acceptedText += `\n⚠️ *GitHub Sync Failed:* ${ghErr.message}`;
          }
        }

        await this.sendMessage(chatId, acceptedText);
        return { success: true, problem, runtime: result.runtime, memory: result.memory };
      }

      // Failed verdict - assemble judge feedback for next attempt
      lastFailureFeedback =
`Verdict: ${result.verdict}
${(result.totalCorrect !== undefined && result.totalTestcases !== undefined) ? `Passed: ${result.totalCorrect} / ${result.totalTestcases} test cases` : ''}
${result.compileError ? `Compiler Error: ${result.compileError}` : ''}
${result.runtimeError ? `Runtime Error: ${result.runtimeError}` : ''}
${result.lastTestcase ? `Failed Testcase: ${result.lastTestcase}` : ''}
${result.expectedOutput ? `Expected Output: ${result.expectedOutput}` : ''}
${result.codeOutput ? `Code Output: ${result.codeOutput}` : ''}`;

      if (currentAttempt < MAX_ATTEMPTS) {
        let retryMsg = `⚠️ *Attempt ${currentAttempt} Failed: ${result.verdict}*`;
        if (result.totalCorrect !== undefined && result.totalTestcases !== undefined) {
          retryMsg += ` (${result.totalCorrect}/${result.totalTestcases} passed)`;
        }
        retryMsg += `\n🤖 *Self-correcting algorithm to fix ${result.verdict} and retrying automatically...*`;
        await this.sendMessage(chatId, retryMsg);
        currentAttempt++;
        await new Promise(r => setTimeout(r, 2000));
      } else {
        let failText =
`❌ *Could not achieve Accepted after ${MAX_ATTEMPTS} self-healing attempts.*
Final Verdict: *${result.verdict}*`;

        if (result.totalCorrect !== undefined && result.totalTestcases !== undefined) {
          failText += `\nPassed: ${result.totalCorrect} / ${result.totalTestcases} test cases`;
        }
        if (result.lastTestcase) {
          failText += `\n\n*Failed Testcase:*\n\`${result.lastTestcase.slice(0, 300)}\``;
        }
        failText += `\n\n*Latest Code Attempt:*\n\`\`\`${targetLangSlug}\n${currentCode}\n\`\`\``;

        await this.sendMessage(chatId, failText);
        return { success: false, problem, verdict: result.verdict };
      }
    }
    return { success: false, problem, error: 'Max attempts reached' };
  }

  // ── Problem Resolver ───────────────────────────────────────────────────────
  async _resolveProblem(chatId, query, action, context = {}) {
    await this.sendMessage(chatId, `🔎 *Searching for problem: "${query}"…*`);
    const searchRes = await searchProblem(query);

    if (searchRes.exactMatch) {
      return searchRes.matches[0];
    }

    if (searchRes.matches.length === 0) {
      await this.sendMessage(chatId, `❌ *No problem found matching "${query}".* Please check the problem number or title.`);
      return null;
    }

    if (searchRes.matches.length === 1) {
      return searchRes.matches[0];
    }

    // Multiple matches: Disambiguation
    this.pendingSelections.set(chatId, {
      action,
      matches: searchRes.matches,
      lang: context.language || 'Python',
      timestamp: Date.now()
    });

    let msg = `🔎 *Multiple problems matched "${query}":*\n\n`;
    searchRes.matches.forEach((p, idx) => {
      msg += `*${idx + 1}.* #${p.frontendId} ${p.title} (${p.difficulty})\n`;
    });
    msg += `\n👉 *Reply with the number (1-${searchRes.matches.length}) to proceed.*`;

    await this.sendMessage(chatId, msg);
    return null;
  }

  async _handleDisambiguationChoice(chatId, choiceNum) {
    const pending = this.pendingSelections.get(chatId);
    if (!pending) return;

    const idx = choiceNum - 1;
    if (idx < 0 || idx >= pending.matches.length) {
      await this.sendMessage(chatId, `⚠️ Invalid selection. Please enter a number between 1 and ${pending.matches.length}.`);
      return;
    }

    const selected = pending.matches[idx];
    const action = pending.action;
    const lang = pending.lang;
    this.pendingSelections.delete(chatId);

    if (action === 'solve') {
      await this._executeSolvePipeline(chatId, selected, lang);
    }
  }

  _extractQueryAndLanguage(text, defaultLang = 'Python') {
    if (!text || !text.trim()) return { query: '', language: defaultLang };

    const parts = text.trim().split(/\s+/);
    const lastToken = parts[parts.length - 1].toLowerCase();
    const knownLangs = ['python', 'py', 'python3', 'cpp', 'c++', 'java', 'javascript', 'js', 'typescript', 'ts', 'golang', 'go', 'rust', 'csharp', 'c#'];

    if (parts.length > 1 && knownLangs.includes(lastToken)) {
      return {
        query: parts.slice(0, parts.length - 1).join(' '),
        language: lastToken
      };
    } else if (parts.length === 1 && knownLangs.includes(lastToken)) {
      return { query: '', language: lastToken };
    }

    return { query: text.trim(), language: defaultLang };
  }

  /**
   * Registers official commands in Telegram's menu
   */
  async registerBotCommands() {
    if (!this.token) return;
    try {
      const commands = [
        { command: 'solve', description: 'Solve problem & submit to LeetCode (e.g. /solve 10 cpp)' },
        { command: 'today', description: 'Today\'s challenge & questions solved today' },
        { command: 'timer', description: 'Set daily reminder message timer (e.g. /timer 8 PM)' },
        { command: 'schedule', description: 'Set auto-solve schedule (e.g. /schedule 10 PM 3 cpp)' },
        { command: 'account', description: 'View linked account & automation status' },
        { command: 'link', description: 'Link LeetCode account & Groq API Key' },
        { command: 'apikey', description: 'Configure or update Groq AI API Key' },
        { command: 'unlink', description: 'Unlink and clear stored credentials' },
        { command: 'help', description: 'Bot manual & instructions' }
      ];

      const res = await fetch(`https://api.telegram.org/bot${this.token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands })
      });

      if (res.ok) {
        console.log('[Bot] ✅ Telegram command menu registered successfully.');
      }
    } catch (err) {
      console.warn('[Bot] Failed to register commands:', err.message);
    }
  }

  /**
   * 24/7 Telegram Long-Polling Loop
   */
  async startPolling() {
    if (!this.token) {
      console.warn('[Bot] TELEGRAM_BOT_TOKEN not configured. Bot polling disabled.');
      return;
    }

    this.isPolling = true;
    this.shouldStop = false;
    console.log('[Bot] 🚀 Starting 24/7 Telegram long-polling loop...');
    await this.registerBotCommands();

    while (!this.shouldStop) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=25`;
        const res = await fetch(url);
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;
            if (update.message && update.message.text) {
              await this.handleMessage(update.message);
            }
          }
        }
      } catch (err) {
        console.warn('[Bot] Polling loop warning:', err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    this.isPolling = false;
  }

  stopPolling() {
    this.shouldStop = true;
  }
}
