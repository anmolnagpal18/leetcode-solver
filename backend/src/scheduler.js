// backend/src/scheduler.js
// 24/7 Cloud Daily Challenge Scheduler, Reminder Timer & Auto-Solve Engine

import { getDailyChallenge, getUnsolvedProblems } from './leetcode.js';

export class DailyScheduler {
  constructor(botService, credManager, config = {}) {
    this.bot = botService;
    this.credManager = credManager;
    this.lastNotifiedDate = null;
    this.lastTimerTriggerKey = null;
    this.lastScheduleTriggerKey = null;
    this.timer = null;
    this.isSolving = false;
  }

  resetScheduleTrigger() {
    this.lastScheduleTriggerKey = null;
    console.log('[Scheduler] Auto-solve schedule trigger reset.');
  }

  resetTimerTrigger() {
    this.lastTimerTriggerKey = null;
    console.log('[Scheduler] Daily reminder timer trigger reset.');
  }

  start(intervalMs = 45 * 1000) { // Check every 45 seconds
    console.log('[Scheduler] ⏰ 24/7 Cloud Scheduler, Daily Reminder & Auto-Solver started.');
    this.tick();

    this.timer = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    await this.checkDailyMidnight();
    await this.checkReminderTimer();
    await this.checkAutoSolveSchedule();
  }

  /**
   * 1. Midnight UTC Challenge Announcement
   */
  async checkDailyMidnight() {
    try {
      const creds = this.credManager ? this.credManager.getCredentials() : {};
      const daily = await getDailyChallenge(creds);
      if (!daily) return;

      const todayUTC = new Date().toISOString().slice(0, 10);
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

_Tap \`/solve\` to solve directly on your LeetCode account!_`;

      if (this.bot && this.bot.isConfigured) {
        await this.bot.sendMessage(null, announcement);
      }
    } catch (err) {
      console.warn('[Scheduler] checkDailyMidnight error:', err.message);
    }
  }

  /**
   * 2. User's Daily Reminder Timer (/timer)
   */
  async checkReminderTimer() {
    if (!this.credManager) return;
    const timerConfig = this.credManager.getTimer();
    if (!timerConfig || !timerConfig.enabled) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // Check if time matches
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const isMatchingTime = (currentHour === timerConfig.hour && Math.abs(currentMinute - timerConfig.minute) <= 1);
    const triggerKey = `${todayStr}_${timerConfig.hour}:${timerConfig.minute}`;

    if (isMatchingTime && this.lastTimerTriggerKey !== triggerKey) {
      this.lastTimerTriggerKey = triggerKey;
      console.log(`[Scheduler] ⏰ Triggering Daily Reminder for user at ${timerConfig.time}...`);

      try {
        const creds = this.credManager.getCredentials();
        const daily = await getDailyChallenge(creds);
        const statusStr = daily?.userStatus === 'Finish' ? ' (✅ Solved)' : ' (❌ Unsolved)';
        const dailyInfo = daily ? `\n📖 *Today's Challenge:* #${daily.frontendId} ${daily.title} (${daily.difficulty})${statusStr}\n🔗 ${daily.url}` : '';

        const reminderMsg =
`⏰ *Daily LeetCode Practice Reminder!*

It's *${timerConfig.time}* — Time to solve your daily problem and protect your streak! 🔥
${dailyInfo}

👉 *Quick action:* Tap \`/solve\` to generate and submit the solution automatically!`;

        if (this.bot && this.bot.isConfigured) {
          await this.bot.sendMessage(null, reminderMsg);
        }
      } catch (err) {
        console.warn('[Scheduler] checkReminderTimer error:', err.message);
      }
    }
  }

  /**
   * 3. User's Autonomous Auto-Solve Schedule (/schedule)
   * Solves N strictly unsolved questions without repeating any completed questions.
   */
  async checkAutoSolveSchedule() {
    if (!this.credManager) return;
    const scheduleConfig = this.credManager.getSchedule();
    if (!scheduleConfig || !scheduleConfig.enabled) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const isMatchingTime = (currentHour === scheduleConfig.hour && Math.abs(currentMinute - scheduleConfig.minute) <= 1);
    const triggerKey = `${todayStr}_${scheduleConfig.hour}:${scheduleConfig.minute}`;

    if (isMatchingTime && this.lastScheduleTriggerKey !== triggerKey && !this.isSolving) {
      this.lastScheduleTriggerKey = triggerKey;
      this.isSolving = true;

      const numQuestions = Math.max(1, parseInt(scheduleConfig.numQuestions || 1, 10));
      const targetLang = scheduleConfig.language || 'Python';
      console.log(`[Scheduler] 🕒 Triggering Scheduled Auto-Solve at ${scheduleConfig.time} (Target: ${numQuestions} unsolved questions in ${targetLang})...`);

      try {
        if (this.bot && this.bot.isConfigured) {
          const creds = this.credManager.getCredentials();

          await this.bot.sendMessage(
            null,
            `🕒 *Autonomous Auto-Solve Schedule Triggered (${scheduleConfig.time})!*\n` +
            `🎯 *Target:* Solving *${numQuestions}* strictly unsolved challenge(s) in *${targetLang}*...\n` +
            `🔍 Querying LeetCode for fresh, uncompleted problems...`
          );

          // Query N strictly unsolved problems
          const unsolvedProblems = await getUnsolvedProblems(numQuestions, creds);

          if (!unsolvedProblems || unsolvedProblems.length === 0) {
            await this.bot.sendMessage(
              null,
              '⚠️ *No unsolved problems found matching criteria.* All problems in the search batch may already be completed!'
            );
            this.isSolving = false;
            return;
          }

          const summaryList = unsolvedProblems
            .map((p, idx) => `  *${idx + 1}.* #${p.frontendId} ${p.title} (${p.difficulty}) ${p.isDaily ? '🌟 *[Daily]*' : ''}`)
            .join('\n');

          await this.bot.sendMessage(
            null,
            `📋 *Selected ${unsolvedProblems.length} Fresh Unsolved Challenge(s):*\n${summaryList}\n\n🚀 *Starting autonomous multi-attempt solver in ${targetLang}...*`
          );

          let solvedCount = 0;
          for (let i = 0; i < unsolvedProblems.length; i++) {
            const prob = unsolvedProblems[i];
            const qNum = i + 1;

            await this.bot.sendMessage(
              null,
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `▶️ *[${qNum}/${unsolvedProblems.length}] Processing Challenge [${targetLang}]:*\n` +
              `📖 *#${prob.frontendId} ${prob.title}* (${prob.difficulty})\n` +
              `━━━━━━━━━━━━━━━━━━━━`
            );

            try {
              const solveRes = await this.bot._executeSolvePipeline(null, prob, targetLang);
              if (solveRes && solveRes.success) {
                solvedCount++;
              }
            } catch (pErr) {
              console.error(`[Scheduler] Error solving problem #${prob.frontendId}:`, pErr.message);
              await this.bot.sendMessage(null, `⚠️ *Error solving #${prob.frontendId}:* ${pErr.message}`);
            }

            // Pause 5 seconds between problems to respect LeetCode rate limits
            if (i < unsolvedProblems.length - 1) {
              console.log('[Scheduler] Pausing 5 seconds before next problem...');
              await new Promise(r => setTimeout(r, 5000));
            }
          }

          await this.bot.sendMessage(
            null,
            `🏁 *Scheduled Auto-Solve Complete!* 🏆\n\n` +
            `✅ *Summary:* Successfully resolved *${solvedCount} / ${unsolvedProblems.length}* problems in *${targetLang}*.\n` +
            `🔥 Submissions and GitHub sync are completed!`
          );
        }
      } catch (err) {
        console.warn('[Scheduler] checkAutoSolveSchedule error:', err.message);
        if (this.bot && this.bot.isConfigured) {
          await this.bot.sendMessage(null, `❌ *Scheduled Auto-Solve encountered an error:* ${err.message}`);
        }
      } finally {
        this.isSolving = false;
      }
    }
  }
}

