// backend/src/scheduler.js
// Cloud Daily Challenge Scheduler (runs 24/7 without laptop)

import { getDailyChallenge } from './leetcode.js';

export class DailyScheduler {
  constructor(botService, config = {}) {
    this.bot = botService;
    this.autoSolveDaily = Boolean(config.autoSolveDaily);
    this.lastNotifiedDate = null;
    this.timer = null;
  }

  start(intervalMs = 10 * 60 * 1000) { // Check every 10 minutes
    console.log('[Scheduler] ⏰ Cloud Daily Challenge Scheduler started.');
    // Run initial check
    this.checkDaily();

    this.timer = setInterval(() => {
      this.checkDaily();
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkDaily() {
    try {
      const daily = await getDailyChallenge();
      if (!daily) return;

      const todayUTC = new Date().toISOString().slice(0, 10);

      // If already processed today, skip
      if (this.lastNotifiedDate === todayUTC) return;

      console.log(`[Scheduler] New day detected: ${todayUTC}. Active Daily Challenge: #${daily.frontendId} ${daily.title}`);
      this.lastNotifiedDate = todayUTC;

      const statusMsg = daily.userStatus === 'Finish' ? '✅ Already Solved' : '❌ Unsolved';

      const announcement =
`🌅 *New LeetCode Daily Challenge Available!*

📖 *#${daily.frontendId} ${daily.title}*
🏷️ *Difficulty:* ${daily.difficulty}
📊 *Status:* ${statusMsg}
🔗 ${daily.url}

_Run \`/solution\` to see AI solution or \`/solve\` to protect your streak._`;

      if (this.bot && this.bot.isConfigured) {
        await this.bot.sendMessage(null, announcement);

        // If configured to automatically solve daily challenge
        if (this.autoSolveDaily && daily.userStatus !== 'Finish') {
          console.log('[Scheduler] ⚡ Auto-Solve Daily Challenge enabled. Triggering solve pipeline...');
          await this.bot._executeSolvePipeline(null, {
            slug: daily.titleSlug,
            title: daily.title,
            frontendId: daily.frontendId,
            difficulty: daily.difficulty
          }, 'Python');
        }
      }
    } catch (err) {
      console.warn('[Scheduler] Check error:', err.message);
    }
  }
}
