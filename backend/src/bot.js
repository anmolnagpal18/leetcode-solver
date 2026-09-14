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
  getUserTodaySolveStats
} from './leetcode.js';

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

  get isAuthConfigured() {
    if (this.credManager) return this.credManager.isConfigured;
    return Boolean(this.leetcodeSession && this.leetcodeCsrfToken);
  }

  get authCredentials() {
    if (this.credManager && this.credManager.isConfigured) {
      return this.credManager.getCredentials();
    }
    return {
      session: this.leetcodeSession,
      csrfToken: this.leetcodeCsrfToken,
      username: null
    };
  }

  /**
   * Safe Telegram message sender with automatic length-splitting and persistent keyboard
   */
  async sendMessage(chatId, text, parseMode = 'Markdown', customMarkup = null) {
    if (!this.token) return;
    const targetChatId = chatId || this.allowedChatId;
    if (!targetChatId) return;

    const defaultKeyboard = {
      keyboard: [
        [{ text: '🚀 /solve' }, { text: '📅 /today' }],
        [{ text: '⏰ /timer' }, { text: '🕒 /schedule' }],
        [{ text: '🔗 /link' }, { text: '👤 /account' }],
        [{ text: '❌ /unlink' }, { text: '❓ /help' }]
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'Type e.g. /solve 10 cpp, /timer 8 PM, or /today...'
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

    // Whitelist check if TELEGRAM_CHAT_ID is set
    if (this.allowedChatId && chatId !== this.allowedChatId) {
      console.warn(`[Bot] Unauthorized access attempt from chatId: ${chatId}`);
      await this.sendMessage(chatId, '⛔ *Unauthorized.* This bot is restricted to its owner.');
      return;
    }

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

    if (rawText.startsWith('/link') || rawText.startsWith('/login') || rawText.startsWith('/setup')) {
      const args = rawText.replace(/^\/(?:link|login|setup)/i, '').trim();
      await this._handleLinkCommand(chatId, args);
      return;
    }

    if (rawText.startsWith('/account') || rawText.startsWith('/status') || rawText.startsWith('/whoami')) {
      await this._sendAccountStatus(chatId);
      return;
    }

    if (rawText.startsWith('/unlink') || rawText.startsWith('/logout')) {
      await this._handleUnlinkCommand(chatId);
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

⏰ */timer [time | off]*
Sets a daily practice reminder timer so the bot reminds you on Telegram every day to maintain your streak.
• Examples: \`/timer 08:00 PM\`, \`/timer 20:00\`, \`/timer off\`

🕒 */schedule [time] [numQuestions | off]*
Sets an automated daily auto-solve schedule so the cloud bot automatically solves today's challenge at that time every day with laptop OFF.
• Examples: \`/schedule 10:00 PM 1\`, \`/schedule 22:00\`, \`/schedule off\`

🔗 */link*
Links your LeetCode account & GitHub repository interactively (or use the 1-Click Sync button in Chrome extension).

👤 */account*
Displays your linked LeetCode username, GitHub repo sync status, active practice timer, and auto-solve schedule.

❌ */unlink*
Disconnects and permanently clears stored session credentials.

───────────────
💡 *Tip:* You can also tap the buttons below without typing!`;

    await this.sendMessage(chatId, helpText);
  }

  // ── /today ─────────────────────────────────────────────────────────────────
  async _sendToday(chatId) {
    await this.sendMessage(chatId, '⏳ *Fetching today\'s LeetCode challenge & daily progress…*');

    try {
      const daily = await getDailyChallenge();
      if (!daily) {
        await this.sendMessage(chatId, '❌ *Failed to fetch today\'s challenge.* LeetCode API might be temporarily busy.');
        return;
      }

      const creds = this.authCredentials;
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

    const creds = this.authCredentials;
    const ghConfig = this.credManager ? this.credManager.getGitHubConfig() : { repo: 'anmolnagpal18/leetcode-solutions' };
    const timerConfig = this.credManager ? this.credManager.getTimer() : { enabled: false, time: '20:00' };
    const scheduleConfig = this.credManager ? this.credManager.getSchedule() : { enabled: false, time: '22:00', numQuestions: 1 };

    let leetCodeLine = '⚪ *Not linked* (Send `/link` to connect)';
    if (creds.session) {
      const verify = await verifyLeetCodeSession(creds.session, creds.csrfToken);
      if (verify.valid) {
        leetCodeLine = `🟢 *Linked & Verified* (@${verify.username})`;
      } else {
        leetCodeLine = `🟡 *Session Expired* (Send \`/link\` or click 🔗 Sync in Chrome)`;
      }
    }

    const ghLine = ghConfig.repo ? `🟢 *Connected* (\`${ghConfig.repo}\`)` : '⚪ *Not configured*';
    const timerLine = timerConfig.enabled ? `🟢 *Active* (${timerConfig.time})` : '⚪ *Disabled* (Set with `/timer 8 PM`)';
    const scheduleLine = scheduleConfig.enabled ? `🟢 *Active* (${scheduleConfig.time} — ${scheduleConfig.numQuestions} Q)` : '⚪ *Disabled* (Set with `/schedule 10 PM 1`)';

    const text =
`👤 *Account & Automation Status*

━━━━━━━━━━━━━━━━━━━━
🎯 *LeetCode Account:*
${leetCodeLine}

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
• Tap \`/timer\` to update reminder time
• Tap \`/schedule\` to update auto-solve schedule
• Tap \`/link\` to update credentials`;

    await this.sendMessage(chatId, text);
  }

  // ── /timer ─────────────────────────────────────────────────────────────────
  async _handleTimerCommand(chatId, args) {
    if (!args) {
      const timerConfig = this.credManager ? this.credManager.getTimer() : { enabled: false, time: '20:00' };
      const statusText = timerConfig.enabled ? `🟢 *Active at ${timerConfig.time}*` : '⚪ *Currently Disabled*';

      await this.sendMessage(chatId,
`⏰ *Daily Practice Reminder Timer*

Status: ${statusText}

Every day at the scheduled time, the bot will send a reminder message to your Telegram with today's challenge so you never break your streak! 🔥

👉 *How to set or change your reminder time:*
• \`/timer 08:00 PM\`
• \`/timer 20:00\`
• \`/timer 09:30 AM\`
• \`/timer off\` (to disable)

Or reply with your desired time (e.g. *8 PM*):`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_timer_time' });
      return;
    }

    const clean = args.trim().toLowerCase();
    if (clean === 'off' || clean === 'disable' || clean === 'stop') {
      if (this.credManager) this.credManager.setTimer(false);
      await this.sendMessage(chatId, '⚪ *Daily reminder timer disabled.* Send `/timer 8 PM` anytime to re-enable!');
      return;
    }

    if (this.credManager) {
      const updated = this.credManager.setTimer(true, args);
      if (updated && updated.time) {
        await this.sendMessage(chatId,
`⏰ *Daily Reminder Timer Activated!*

🟢 Time set to: *${updated.time}*

Every day at *${updated.time}*, I will send you a reminder message on Telegram with today's daily challenge to keep your streak alive! 🔥`
        );
        return;
      }
    }

    await this.sendMessage(chatId, '⚠️ *Invalid time format.* Please use formats like `/timer 8 PM`, `/timer 20:00`, or `/timer 08:30 PM`.');
  }

  // ── /schedule ──────────────────────────────────────────────────────────────
  async _handleScheduleCommand(chatId, args) {
    if (!args) {
      const scheduleConfig = this.credManager ? this.credManager.getSchedule() : { enabled: false, time: '22:00', numQuestions: 1 };
      const statusText = scheduleConfig.enabled ? `🟢 *Active at ${scheduleConfig.time} (${scheduleConfig.numQuestions} Question)*` : '⚪ *Currently Disabled*';

      await this.sendMessage(chatId,
`🕒 *Autonomous Auto-Solve Schedule*

Status: ${statusText}

When active, the 24/7 Cloud Backend will automatically solve today's challenge at the scheduled time with the self-healing multi-attempt loop, submit to LeetCode, and sync to GitHub!

👉 *How to set or change your schedule:*
• \`/schedule 10:00 PM 1\`
• \`/schedule 22:00\`
• \`/schedule 11:00 PM 2\`
• \`/schedule off\` (to disable)

Or reply with your desired schedule time (e.g. *10 PM*):`
      );
      this.pendingLinking.set(chatId, { step: 'awaiting_schedule_time' });
      return;
    }

    const clean = args.trim().toLowerCase();
    if (clean === 'off' || clean === 'disable' || clean === 'stop') {
      if (this.credManager) this.credManager.setSchedule(false);
      await this.sendMessage(chatId, '⚪ *Auto-solve schedule disabled.* Send `/schedule 10 PM 1` anytime to re-enable!');
      return;
    }

    // Parse time and optional question count
    const parts = args.split(/\s+/);
    let numQ = 1;
    let timeStr = args;

    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
      numQ = parseInt(parts[parts.length - 1], 10);
      timeStr = parts.slice(0, parts.length - 1).join(' ');
    }

    if (this.credManager) {
      const updated = this.credManager.setSchedule(true, timeStr, numQ);
      if (updated && updated.time) {
        await this.sendMessage(chatId,
`🕒 *Autonomous Auto-Solve Schedule Activated!*

🟢 Scheduled Time: *${updated.time}*
📦 Questions per Day: *${updated.numQuestions}*

Every day at *${updated.time}*, the 24/7 Cloud Bot will automatically solve today's challenge, submit to LeetCode, and sync commits to GitHub — even if your laptop is completely turned *OFF*! 🚀`
        );
        return;
      }
    }

    await this.sendMessage(chatId, '⚠️ *Invalid format.* Please use formats like `/schedule 10 PM 1`, `/schedule 22:00`, or `/schedule 11 PM`.');
  }

  // ── /link ──────────────────────────────────────────────────────────────────
  async _handleLinkCommand(chatId, args) {
    // If inline args provided: /link <session> <csrf>
    if (args) {
      const parts = args.split(/\s+/);
      if (parts.length >= 2) {
        const session = parts[0].replace(/^LEETCODE_SESSION=/i, '').replace(/;$/, '').trim();
        const csrf = parts[1].replace(/^csrftoken=/i, '').replace(/;$/, '').trim();

        await this.sendMessage(chatId, '⏳ *Verifying LeetCode credentials…*');
        const verify = await verifyLeetCodeSession(session, csrf);
        if (verify.valid) {
          if (this.credManager) {
            this.credManager.saveCredentials(session, csrf, verify.username);
          }
          await this.sendMessage(chatId,
`🎉 *Account Linked Successfully!*

👤 *LeetCode Username:* @${verify.username}
🟢 *Status:* Authenticated & Saved Permanently
🚀 *24/7 Submissions:* Active (Works even with laptop turned OFF!)`
          );
          return;
        } else {
          await this.sendMessage(chatId, `❌ *Invalid credentials:* ${verify.error}`);
          return;
        }
      }
    }

    // Step-by-step interactive linking
    this.pendingLinking.set(chatId, { step: 'awaiting_session_or_user' });
    await this.sendMessage(chatId,
`🔗 *LeetCode & GitHub Account Setup*

You can link your LeetCode account in two easy ways:

1️⃣ *Zero-Click Chrome Extension (Easiest):*
Open Chrome $\rightarrow$ Click Extension $\rightarrow$ **⚙️ Settings** $\rightarrow$ Click **\`🔗 Sync Account\`**!

2️⃣ *Paste Session Cookie:*
Paste your \`LEETCODE_SESSION\` cookie value here.

*(To cancel, send \`/cancel\`)*`
    );
  }

  // ── /unlink ────────────────────────────────────────────────────────────────
  async _handleUnlinkCommand(chatId) {
    if (this.credManager) {
      this.credManager.clearCredentials();
    }
    this.leetcodeSession = '';
    this.leetcodeCsrfToken = '';
    await this.sendMessage(chatId,
`⚪ *Account Unlinked Successfully.*

Saved LeetCode session credentials have been cleared from the backend database. Automatic submissions are now paused until you re-link.`
    );
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

    if (state.step === 'awaiting_session_or_user') {
      const clean = text.replace(/^LEETCODE_SESSION=/i, '').replace(/;$/, '').trim();
      if (clean.length > 30) {
        state.session = clean;
        state.step = 'awaiting_csrf';
        await this.sendMessage(chatId, `🔑 *Step 2/2:* Please paste your \`csrftoken\` value:`);
        return;
      } else {
        await this.sendMessage(chatId, `⚠️ *Invalid cookie length.* Please paste the full LEETCODE_SESSION value or use the **🔗 Sync Account** button in Chrome.`);
        this.pendingLinking.delete(chatId);
        return;
      }
    }

    if (state.step === 'awaiting_csrf') {
      const cleanCsrf = text.replace(/^csrftoken=/i, '').replace(/;$/, '').trim();
      this.pendingLinking.delete(chatId);

      await this.sendMessage(chatId, '⏳ *Verifying LeetCode session…*');
      const verify = await verifyLeetCodeSession(state.session, cleanCsrf);
      if (verify.valid) {
        if (this.credManager) {
          this.credManager.saveCredentials(state.session, cleanCsrf, verify.username);
        }
        await this.sendMessage(chatId,
`🎉 *LeetCode Account Linked Successfully!*

👤 *Username:* @${verify.username}
🟢 *Status:* Authenticated 24/7
🚀 You can now use \`/solve\` anytime from your phone!`
        );
      } else {
        await this.sendMessage(chatId, `❌ *Authentication Failed:* ${verify.error}\n_Please try copying cookies again or use 1-Click Sync in Chrome._`);
      }
    }
  }

  // ── /solve Pipeline with Self-Healing Multi-Attempt Loop ────────────────────
  async _handleSolveCommand(chatId, rest) {
    const { query, language } = this._extractQueryAndLanguage(rest, 'Python');
    try {
      let problem = null;
      if (!query) {
        // Default to today's daily challenge
        const daily = await getDailyChallenge();
        if (daily) {
          problem = {
            slug: daily.titleSlug,
            title: daily.title,
            frontendId: daily.frontendId,
            difficulty: daily.difficulty
          };
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
    if (!this.groq || !this.groq.isConfigured) {
      await this.sendMessage(chatId, '❌ *Groq AI key not configured in cloud backend.* Please set GROQ_API_KEY.');
      return;
    }

    await this.sendMessage(chatId, `🔎 *Problem found:*\n#${problem.frontendId} *${problem.title}*\nDifficulty: *${problem.difficulty}*`);

    const details = await getProblemDetails(problem.slug);
    const editorData = await getProblemEditorData(problem.slug);

    const targetLangSlug = normalizeLanguageSlug(language);
    const snippet = (editorData.codeSnippets || []).find(s => s.langSlug === targetLangSlug);
    const templateCode = snippet ? snippet.code : '';

    const creds = this.authCredentials;
    if (!this.isAuthConfigured || !creds.session) {
      await this.sendMessage(chatId, `⚙️ *Generating optimal ${language.toUpperCase()} solution...*`);
      const solution = await this.groq.generateSolution(details.title, details.description, language, templateCode);
      await this.sendMessage(chatId,
`⚠️ *Automatic submission is unavailable.*

No LeetCode account is linked to the cloud bot yet.

*Generated Solution Code:*
\`\`\`${targetLangSlug}
${solution.code}
\`\`\`

👉 *To enable 24/7 automatic submissions:*
Click \`/link\` or click **🔗 Sync Account** in Chrome extension settings!`
      );
      return;
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
          return;
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
          break;
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
        break;
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

        // Optional GitHub Sync
        if (this.github && this.github.isConfigured) {
          try {
            const ghRes = await this.github.syncSolution(details.title, details.difficulty, language, currentCode, details.description);
            if (ghRes.synced) {
              acceptedText += `\n🐙 *GitHub Sync:* [View Commit](${ghRes.commitUrl})`;
            }
          } catch (ghErr) {
            acceptedText += `\n⚠️ *GitHub Sync Failed:* ${ghErr.message}`;
          }
        }

        await this.sendMessage(chatId, acceptedText);
        return;
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
        break;
      }
    }
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
        { command: 'schedule', description: 'Set auto-solve schedule (e.g. /schedule 10 PM 1)' },
        { command: 'account', description: 'View linked account & automation status' },
        { command: 'link', description: 'Link LeetCode account & GitHub repository' },
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
