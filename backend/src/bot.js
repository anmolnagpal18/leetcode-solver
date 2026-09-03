// backend/src/bot.js
// Standalone 24/7 Telegram Bot Controller for Cloud Backend

import { searchProblem, getProblemDetails, getProblemEditorData, getDailyChallenge, getRandomProblem, submitSolution, getSubmissionResult, normalizeLanguageSlug, verifyLeetCodeSession, attemptLeetCodePasswordLogin } from './leetcode.js';

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
    this.pendingLinking = new Map();    // chatId -> { step, session }
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
        [{ text: '📅 /today' }, { text: '📊 /status' }],
        [{ text: '💡 /solution' }, { text: '🚀 /solve' }],
        [{ text: '📖 /question' }, { text: '🎲 /random' }],
        [{ text: '🔗 /account' }, { text: '❓ /help' }]
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'Select a command or type e.g. /solve 1...'
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
    // If text was sent via keyboard button (e.g. "📅 /today" or "🚀 /solve"), strip button emoji
    rawText = rawText.replace(/^[^\w\/]*\s*(\/\w+)/, '$1').trim();

    // If user sends any command starting with '/', cancel any pending linking or selection flow
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
      // If user is in an active interactive step (username, password, cookie), route there
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

    // Normal command processing
    if (rawText.startsWith('/start') || rawText.startsWith('/help')) {
      await this._sendHelp(chatId);
      return;
    }

    if (rawText.startsWith('/status')) {
      await this._sendStatus(chatId);
      return;
    }

    if (rawText.startsWith('/account') || rawText.startsWith('/whoami')) {
      await this._sendAccountStatus(chatId);
      return;
    }

    if (rawText.startsWith('/login') || rawText.startsWith('/signin')) {
      await this._handleLoginCommand(chatId);
      return;
    }

    if (rawText.startsWith('/link')) {
      const args = rawText.replace(/^\/link/i, '').trim();
      await this._handleLinkCommand(chatId, args);
      return;
    }

    if (rawText.startsWith('/unlink') || rawText.startsWith('/logout')) {
      await this._handleUnlinkCommand(chatId);
      return;
    }

    if (rawText.startsWith('/today')) {
      await this._sendToday(chatId);
      return;
    }

    if (rawText.startsWith('/random')) {
      await this._sendRandom(chatId, rawText);
      return;
    }

    if (rawText.startsWith('/question')) {
      const query = rawText.replace(/^\/question/i, '').trim();
      await this._handleQuestionCommand(chatId, query);
      return;
    }

    if (rawText.startsWith('/solution')) {
      const rest = rawText.replace(/^\/solution/i, '').trim();
      await this._handleSolutionCommand(chatId, rest);
      return;
    }

    if (rawText.startsWith('/solve')) {
      const rest = rawText.replace(/^\/solve/i, '').trim();
      await this._handleSolveCommand(chatId, rest);
      return;
    }

    // Fallback help
    await this.sendMessage(chatId, '❓ *Unrecognized command.* Type `/help` or use the menu below.');
  }

  async _sendAccountStatus(chatId) {
    const creds = this.authCredentials;
    if (!creds.session) {
      await this.sendMessage(chatId,
`⚪ *No LeetCode account linked.*

To link your account and enable 24/7 automated submissions:
• Send \`/link\` to paste your session cookie
• Or click **"Sync LeetCode Account"** in the Chrome extension settings!`
      );
      return;
    }

    await this.sendMessage(chatId, '🔍 *Verifying linked LeetCode account…*');
    const verify = await verifyLeetCodeSession(creds.session, creds.csrfToken);

    if (verify.valid) {
      await this.sendMessage(chatId,
`👤 *Linked LeetCode Account:*
• Username: *@${verify.username}*
• Status: 🟢 *Active & Authenticated*

🚀 *24/7 Submissions:* Ready! You can run \`/solve\` even when your laptop is turned off.
To disconnect this account, send \`/unlink\`.`
      );
    } else {
      await this.sendMessage(chatId,
`⚠️ *LeetCode Session Expired!*
The saved session token is no longer valid on LeetCode.
Please update it using \`/link\` or from the Chrome extension.`
      );
    }
  }

  async _handleUnlinkCommand(chatId) {
    if (this.credManager) {
      this.credManager.clearCredentials();
    }
    this.leetcodeSession = '';
    this.leetcodeCsrfToken = '';
    this.pendingLinking.delete(chatId);

    await this.sendMessage(chatId,
`⚪ *LeetCode Account Unlinked.*

Your saved session credentials have been deleted. Automatic submissions are now disabled until you link an account again with \`/link\`.`
    );
  }

  async _handleLoginCommand(chatId) {
    this.pendingLinking.set(chatId, { step: 'awaiting_login_user' });
    await this.sendMessage(chatId,
`🔐 *LeetCode Account Login*

👤 *Step 1/2:* Please send your LeetCode *Username* or *Email*:

_(To cancel, send \`/cancel\`)_`
    );
  }

  async _handleLinkCommand(chatId, args) {
    if (args) {
      let session = '';
      let csrf = '';

      if (args.includes('LEETCODE_SESSION=') || args.includes('csrftoken=')) {
        const sessionMatch = args.match(/LEETCODE_SESSION=([^; \n]+)/);
        const csrfMatch = args.match(/csrftoken=([^; \n]+)/);
        if (sessionMatch) session = sessionMatch[1];
        if (csrfMatch) csrf = csrfMatch[1];
      } else {
        const tokens = args.split(/\s+/);
        if (tokens.length >= 2) {
          session = tokens[0];
          csrf = tokens[1];
        }
      }

      if (session && csrf) {
        await this._finalizeLinking(chatId, session, csrf);
        return;
      }
    }

    this.pendingLinking.set(chatId, { step: 'awaiting_session' });
    await this.sendMessage(chatId,
`🔐 *Link Your LeetCode Account (Step 1 of 2)*

To submit solutions when your laptop is closed, the bot needs your LeetCode session cookie.

👉 *Please paste your \`LEETCODE_SESSION\` cookie value:*

_(Tip: In Chrome on leetcode.com, press F12 $\rightarrow$ Application $\rightarrow$ Cookies $\rightarrow$ copy LEETCODE_SESSION)_
_To cancel anytime, send \`/cancel\`._`
    );
  }

  async _handleLinkingStep(chatId, text) {
    if (text.toLowerCase() === '/cancel') {
      this.pendingLinking.delete(chatId);
      await this.sendMessage(chatId, '❌ *Account operation cancelled.*');
      return;
    }

    const state = this.pendingLinking.get(chatId);

    // If user is doing username/password login
    if (state.step === 'awaiting_login_user') {
      const username = text.trim();
      this.pendingLinking.set(chatId, { step: 'awaiting_login_pass', username });
      await this.sendMessage(chatId,
`👍 Got username: \`${username}\`

🔑 *Step 2/2:* Please send your LeetCode *Password*:

_(Your password is transmitted directly to LeetCode for session authentication and is never saved)_`
      );
      return;
    }

    if (state.step === 'awaiting_login_pass') {
      const password = text;
      const username = state.username;
      this.pendingLinking.delete(chatId);

      await this.sendMessage(chatId, `⏳ *Attempting authentication with LeetCode for @${username}…*`);
      const res = await attemptLeetCodePasswordLogin(username, password);

      if (res.success) {
        if (this.credManager) {
          this.credManager.saveCredentials(res.session, res.csrfToken, res.username);
        }
        this.leetcodeSession = res.session;
        this.leetcodeCsrfToken = res.csrfToken;

        await this.sendMessage(chatId,
`🎉 *Logged in successfully!*

👤 *LeetCode Account Linked:* *@${res.username}*
🟢 *Status:* Authenticated & Saved Permanently

🚀 *You can now use \`/solve\` 24/7 even when your laptop is turned off!*
_To unlink in the future, send \`/unlink\`._`
        );
        return;
      }

      if (res.recaptcha) {
        await this.sendMessage(chatId,
`🔒 *LeetCode Security Check: reCAPTCHA Required*

LeetCode requires interactive human reCAPTCHA verification for direct web logins.

✨ *Great News — No typing or cookie copying is needed either!*
Because you have the **LeetCode Companion** Chrome extension on your laptop:
1️⃣ Simply open Chrome with LeetCode logged in.
2️⃣ Your extension **automatically syncs your login to this bot in the background** with 0 typing!
3️⃣ (Or click **🔗 Sync Account** in Extension Settings).

_Once synced, your account remains linked forever so you can use \`/solve\` even when your laptop is closed!_`
        );
        return;
      }

      await this.sendMessage(chatId,
`❌ *Login Failed:* ${res.error || 'Invalid credentials'}

Please check your username and password, or use the 1-Click Sync button in the Chrome extension.`
      );
      return;
    }

    if (text.includes('LEETCODE_SESSION=') && text.includes('csrftoken=')) {
      const sMatch = text.match(/LEETCODE_SESSION=([^; \n]+)/);
      const cMatch = text.match(/csrftoken=([^; \n]+)/);
      if (sMatch && cMatch) {
        this.pendingLinking.delete(chatId);
        await this._finalizeLinking(chatId, sMatch[1], cMatch[1]);
        return;
      }
    }

    if (state.step === 'awaiting_session') {
      const cleanSession = text.replace(/^LEETCODE_SESSION=/i, '').replace(/;$/, '').trim();
      if (cleanSession.length < 20) {
        await this.sendMessage(chatId, '⚠️ *Invalid format.* Please paste the full LEETCODE_SESSION cookie or send /cancel.');
        return;
      }

      this.pendingLinking.set(chatId, { step: 'awaiting_csrf', session: cleanSession });
      await this.sendMessage(chatId,
`👍 *Step 1 Complete!*

👉 *Step 2 of 2: Please paste your \`csrftoken\` cookie value:*
_(Found under the same Cookies tab right next to LEETCODE_SESSION)_`
      );
      return;
    }

    if (state.step === 'awaiting_csrf') {
      const cleanCsrf = text.replace(/^csrftoken=/i, '').replace(/;$/, '').trim();
      const session = state.session;
      this.pendingLinking.delete(chatId);

      await this._finalizeLinking(chatId, session, cleanCsrf);
    }
  }

  async _finalizeLinking(chatId, session, csrfToken) {
    await this.sendMessage(chatId, '⏳ *Verifying credentials with LeetCode API…*');
    const verify = await verifyLeetCodeSession(session, csrfToken);

    if (!verify.valid) {
      await this.sendMessage(chatId,
`❌ *Authentication Failed:* ${verify.error}

Please ensure you are logged into leetcode.com in your browser and copied active cookies.
Send \`/link\` to try again.`
      );
      return;
    }

    if (this.credManager) {
      this.credManager.saveCredentials(session, csrfToken, verify.username);
    }
    this.leetcodeSession = session;
    this.leetcodeCsrfToken = csrfToken;

    await this.sendMessage(chatId,
`🎉 *LeetCode Account Successfully Linked!*

👤 *User:* *@${verify.username}*
🟢 *Status:* Authenticated & Saved Permanently

🚀 *You can now use \`/solve\` anytime — even when your laptop is completely powered off!*
_To unlink in the future, send \`/unlink\`._`
    );
  }

  async _sendHelp(chatId) {
    const text =
`🤖 *LeetCode Companion Cloud Bot* (24/7)

*Available Commands:*
• \`/account\` — View your linked LeetCode account & status
• \`/link\` — Connect your LeetCode account for 24/7 submissions
• \`/unlink\` — Disconnect your LeetCode account
• \`/status\` — System health, API connectivity & auth
• \`/today\` — Today's Daily Challenge details
• \`/question [query]\` — Full problem statement & constraints
• \`/solution [query] [lang]\` — AI solution, approach & complexities
• \`/solve [query] [lang]\` — Full solve pipeline & verified submission
• \`/random [easy|medium|hard]\` — Pick a random challenge
• \`/help\` — Show this guide

*Search Examples:*
• \`/question\` (today's challenge)
• \`/question 1\` or \`/question two-sum\`
• \`/solution 874 cpp\`
• \`/solve walking robot simulation\`
• \`/random medium\`

_Note: This bot runs 24/7 in the cloud. Once linked with \`/link\`, it can solve and submit questions even when your laptop is turned off!_`;

    await this.sendMessage(chatId, text);
  }

  async _sendStatus(chatId) {
    await this.sendMessage(chatId, '🔍 *Checking system status…*');

    // 1. Cloud Backend
    const backendStatus = '🟢 Cloud Backend: Online (24/7)';
    const telegramStatus = '🟢 Telegram Bot: Connected';

    // 2. LeetCode API test
    let leetcodeStatus = '🟢 LeetCode API: Available';
    try {
      const daily = await getDailyChallenge();
      if (!daily) leetcodeStatus = '🟡 LeetCode API: Degraded';
    } catch (e) {
      leetcodeStatus = `🔴 LeetCode API: Error (${e.message})`;
    }

    // 3. Groq AI test
    let groqStatus = '⚪ Groq AI: Not configured';
    if (this.groq) {
      const pingRes = await this.groq.ping();
      if (pingRes.ok) {
        groqStatus = `🟢 Groq AI: Available (${pingRes.model})`;
      } else {
        groqStatus = `🔴 Groq AI: Error (${pingRes.error})`;
      }
    }

    // 4. LeetCode Session Auth test
    let authStatus = '⚪ LeetCode Auth: Not linked (send /link to connect)';
    const creds = this.authCredentials;
    if (creds.session) {
      const verify = await verifyLeetCodeSession(creds.session, creds.csrfToken);
      if (verify.valid) {
        authStatus = `🟢 LeetCode Auth: Linked as @${verify.username} (Ready for 24/7 Submissions)`;
      } else {
        authStatus = '🟡 LeetCode Auth: Session expired (send /link to update)';
      }
    }

    // 5. GitHub sync test
    let githubStatus = '⚪ GitHub Sync: Not configured';
    if (this.github && this.github.isConfigured) {
      const ghPing = await this.github.ping();
      if (ghPing.ok) {
        githubStatus = `🟢 GitHub Sync: Connected (${ghPing.repo})`;
      } else {
        githubStatus = `🟡 GitHub Sync: Error (${ghPing.error})`;
      }
    }

    const report =
`📊 *System Health Report*

${backendStatus}
${telegramStatus}
${leetcodeStatus}
${groqStatus}
${authStatus}
${githubStatus}

_All services running independently from your laptop._`;

    await this.sendMessage(chatId, report);
  }

  async _sendToday(chatId) {
    await this.sendMessage(chatId, '⏳ *Fetching Daily Challenge…*');
    try {
      const daily = await getDailyChallenge();
      const statusIcon = daily.userStatus === 'Finish' ? '✅ Solved' : '❌ Unsolved';

      const text =
`📅 *LeetCode Daily Challenge*

📖 *Title:* #${daily.frontendId} ${daily.title}
🏷️ *Difficulty:* ${daily.difficulty}
📊 *Status:* ${statusIcon}
🏷️ *Topics:* ${(daily.topicTags || []).join(', ') || 'N/A'}

🔗 *Link:* ${daily.url}

_Type \`/solution\` or \`/solve\` to generate or submit code for today's challenge._`;

      await this.sendMessage(chatId, text);
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Failed to fetch Daily Challenge:* ${err.message}`);
    }
  }

  async _sendRandom(chatId, rawText) {
    const parts = rawText.split(/\s+/);
    let diff = '';
    if (parts.length > 1) {
      const arg = parts[1].toLowerCase();
      if (['easy', 'medium', 'hard'].includes(arg)) diff = arg;
    }

    await this.sendMessage(chatId, `🎲 *Finding random ${diff ? diff.toUpperCase() + ' ' : ''}problem…*`);
    try {
      const problem = await getRandomProblem(diff);
      const text =
`🎲 *Random Problem Picked!*

#${problem.frontendId} *${problem.title}*
🏷️ *Difficulty:* ${problem.difficulty}
🏷️ *Topics:* ${(problem.topicTags || []).join(', ') || 'N/A'}

🔗 ${problem.url}

*Quick Actions:*
• View: \`/question ${problem.frontendId}\`
• Solution: \`/solution ${problem.frontendId}\`
• Auto-Solve: \`/solve ${problem.frontendId}\``;

      await this.sendMessage(chatId, text);
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Failed to fetch random problem:* ${err.message}`);
    }
  }

  /**
   * Parses query and optional language (e.g. "two-sum cpp" -> query: "two-sum", lang: "cpp")
   */
  _extractQueryAndLanguage(input = '', defaultLang = 'Python') {
    const trimmed = input.trim();
    if (!trimmed) return { query: '', language: defaultLang };

    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return { query: parts[0], language: defaultLang };
    }

    const lastToken = parts[parts.length - 1].toLowerCase();
    const knownLangs = ['python', 'py', 'python3', 'cpp', 'c++', 'java', 'javascript', 'js', 'typescript', 'ts', 'golang', 'go', 'c#', 'csharp', 'cs', 'rust', 'rs', 'c'];

    if (knownLangs.includes(lastToken)) {
      return {
        query: parts.slice(0, parts.length - 1).join(' '),
        language: lastToken
      };
    }

    return { query: trimmed, language: defaultLang };
  }

  /**
   * Resolves query to a single problem slug or prompts for disambiguation
   */
  async _resolveProblem(chatId, query, action, extraContext = {}) {
    // If query is empty, default to daily challenge
    if (!query || !query.trim()) {
      const daily = await getDailyChallenge();
      return { slug: daily.titleSlug, title: daily.title, frontendId: daily.frontendId, difficulty: daily.difficulty };
    }

    await this.sendMessage(chatId, `🔎 *Searching for:* "${query}"…`);
    const searchRes = await searchProblem(query);

    if (searchRes.exact) {
      const p = searchRes.exact;
      return { slug: p.titleSlug, title: p.title, frontendId: p.frontendQuestionId, difficulty: p.difficulty };
    }

    if (searchRes.matches && searchRes.matches.length > 0) {
      if (searchRes.matches.length === 1) {
        const p = searchRes.matches[0];
        return { slug: p.titleSlug, title: p.title, frontendId: p.frontendQuestionId, difficulty: p.difficulty };
      }

      // Multiple matches -> Store state and ask user to choose
      this.pendingSelections.set(chatId, {
        action,
        matches: searchRes.matches,
        extraContext,
        timestamp: Date.now()
      });

      let listText = `🔎 *Multiple problems found:*\n\n`;
      searchRes.matches.forEach((m, idx) => {
        listText += `${idx + 1}. #${m.frontendQuestionId} ${m.title} (${m.difficulty})\n`;
      });
      listText += `\n*Reply with the number (e.g. 1, 2) to continue.*`;

      await this.sendMessage(chatId, listText);
      return null; // Wait for user choice
    }

    await this.sendMessage(chatId, `❌ *No problems found matching:* "${query}". Please check the number or spelling.`);
    return null;
  }

  async _handleDisambiguationChoice(chatId, choiceNum) {
    const pending = this.pendingSelections.get(chatId);
    this.pendingSelections.delete(chatId);

    if (!pending || !pending.matches) {
      await this.sendMessage(chatId, '⚠️ *No active selection found.* Please run your command again.');
      return;
    }

    const idx = choiceNum - 1;
    if (idx < 0 || idx >= pending.matches.length) {
      await this.sendMessage(chatId, '⚠️ *Invalid choice.* Selection cancelled.');
      return;
    }

    const chosen = pending.matches[idx];
    const resolved = {
      slug: chosen.titleSlug,
      title: chosen.title,
      frontendId: chosen.frontendQuestionId,
      difficulty: chosen.difficulty
    };

    if (pending.action === 'question') {
      await this._executeQuestionDisplay(chatId, resolved);
    } else if (pending.action === 'solution') {
      await this._executeSolutionGeneration(chatId, resolved, pending.extraContext.language || 'Python');
    } else if (pending.action === 'solve') {
      await this._executeSolvePipeline(chatId, resolved, pending.extraContext.language || 'Python');
    }
  }

  // ── /question ──────────────────────────────────────────────────────────────
  async _handleQuestionCommand(chatId, query) {
    try {
      const problem = await this._resolveProblem(chatId, query, 'question');
      if (problem) {
        await this._executeQuestionDisplay(chatId, problem);
      }
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Error fetching question:* ${err.message}`);
    }
  }

  async _executeQuestionDisplay(chatId, problem) {
    await this.sendMessage(chatId, `⏳ *Fetching full details for #${problem.frontendId} ${problem.title}…*`);
    const details = await getProblemDetails(problem.slug);

    const header =
`📖 *#${details.frontendId} ${details.title}*
🏷️ *Difficulty:* ${details.difficulty}
🏷️ *Topics:* ${(details.topicTags || []).join(', ') || 'N/A'}
🔗 ${details.url}

───────────────────

${details.description}`;

    await this.sendMessage(chatId, header);
  }

  // ── /solution ─────────────────────────────────────────────────────────────
  async _handleSolutionCommand(chatId, rest) {
    const { query, language } = this._extractQueryAndLanguage(rest, 'Python');
    try {
      const problem = await this._resolveProblem(chatId, query, 'solution', { language });
      if (problem) {
        await this._executeSolutionGeneration(chatId, problem, language);
      }
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Error processing solution:* ${err.message}`);
    }
  }

  async _executeSolutionGeneration(chatId, problem, language) {
    if (!this.groq || !this.groq.isConfigured) {
      await this.sendMessage(chatId, '❌ *Groq API key not configured in cloud backend.* Please set GROQ_API_KEY.');
      return;
    }

    await this.sendMessage(chatId, `⚙️ *Generating optimal ${language.toUpperCase()} solution for #${problem.frontendId} ${problem.title}…*`);

    const details = await getProblemDetails(problem.slug);
    const editorData = await getProblemEditorData(problem.slug).catch(() => ({ codeSnippets: [] }));

    const targetLangSlug = normalizeLanguageSlug(language);
    const snippet = (editorData.codeSnippets || []).find(s => s.langSlug === targetLangSlug);
    const templateCode = snippet ? snippet.code : '';

    const solution = await this.groq.generateSolution(details.title, details.description, language, templateCode);

    const formattedText =
`💡 *Solution for #${details.frontendId} ${details.title} (${language.toUpperCase()})*

*Approach:*
${solution.approach}

⏱ *Time Complexity:* \`${solution.timeComplexity}\`
💾 *Space Complexity:* \`${solution.spaceComplexity}\`

*Code:*
\`\`\`${targetLangSlug}
${solution.code}
\`\`\``;

    await this.sendMessage(chatId, formattedText);
  }

  // ── /solve ────────────────────────────────────────────────────────────────
  async _handleSolveCommand(chatId, rest) {
    const { query, language } = this._extractQueryAndLanguage(rest, 'Python');
    try {
      const problem = await this._resolveProblem(chatId, query, 'solve', { language });
      if (problem) {
        await this._executeSolvePipeline(chatId, problem, language);
      }
    } catch (err) {
      await this.sendMessage(chatId, `❌ *Error in solve pipeline:* ${err.message}`);
    }
  }

  async _executeSolvePipeline(chatId, problem, language) {
    if (!this.groq || !this.groq.isConfigured) {
      await this.sendMessage(chatId, '❌ *Groq API key not configured.* Please set GROQ_API_KEY.');
      return;
    }

    // Step 1: Notify problem found
    await this.sendMessage(chatId, `🔎 *Problem found:*\n#${problem.frontendId} *${problem.title}*\nDifficulty: *${problem.difficulty}*`);

    // Step 2: Fetch details and editor template
    const details = await getProblemDetails(problem.slug);
    const editorData = await getProblemEditorData(problem.slug);

    const targetLangSlug = normalizeLanguageSlug(language);
    const snippet = (editorData.codeSnippets || []).find(s => s.langSlug === targetLangSlug);
    const templateCode = snippet ? snippet.code : '';

    // Step 3: Check if LeetCode credentials are configured before starting attempts
    const creds = this.authCredentials;
    if (!this.isAuthConfigured || !creds.session) {
      // Still generate solution so user gets value
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

    // Step 4: Self-Healing Multi-Attempt Solve Loop
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
        // Short pause between submissions to prevent LeetCode rate limits
        await new Promise(r => setTimeout(r, 2000));
      } else {
        // All attempts exhausted
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

  async registerBotCommands() {
    if (!this.token) return;
    try {
      const commands = [
        { command: 'account', description: '👤 View linked LeetCode account & status' },
        { command: 'link', description: '🔐 Link LeetCode account for 24/7 submissions' },
        { command: 'unlink', description: '⚪ Disconnect linked LeetCode account' },
        { command: 'status', description: '📊 Live health of backend, AI & credentials' },
        { command: 'today', description: '📅 View today\'s active Daily Challenge' },
        { command: 'question', description: '📖 Problem statement (/question 1)' },
        { command: 'solution', description: '💡 AI optimal solution (/solution 1 cpp)' },
        { command: 'solve', description: '🚀 Headless solve & submit (/solve 1)' },
        { command: 'random', description: '🎲 Pick a random problem (/random medium)' },
        { command: 'help', description: '❓ Show complete command manual' }
      ];

      await fetch(`https://api.telegram.org/bot${this.token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands })
      });
      console.log('[Bot] ✅ Telegram command menu registered successfully.');
    } catch (err) {
      console.warn('[Bot] Failed to register command menu:', err.message);
    }
  }

  /**
   * Long-polling loop for 24/7 cloud execution
   */
  async startPolling() {
    if (!this.token) {
      console.warn('[Bot] TELEGRAM_BOT_TOKEN not provided. Bot polling disabled.');
      return;
    }
    if (this.isPolling) return;
    this.isPolling = true;
    this.shouldStop = false;

    console.log('[Bot] 🚀 Starting 24/7 Telegram long-polling loop...');
    await this.registerBotCommands();

    // Clear backlog on startup
    try {
      const clearRes = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?limit=5`);
      if (clearRes.ok) {
        const data = await clearRes.json();
        if (data.ok && data.result?.length > 0) {
          this.lastUpdateId = data.result[data.result.length - 1].update_id;
        }
      }
    } catch (_) {}

    while (!this.shouldStop) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=25`;
        const res = await fetch(url);
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        const data = await res.json();
        if (data.ok && data.result && data.result.length > 0) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;
            if (update.message) {
              await this.handleMessage(update.message);
            }
          }
        }
      } catch (err) {
        console.error('[Bot] Polling loop error:', err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    this.isPolling = false;
    console.log('[Bot] Telegram polling loop stopped.');
  }

  stopPolling() {
    this.shouldStop = true;
  }
}
