// backend/src/scheduler.js
// 24/7 Cloud Daily Challenge Scheduler, Reminder Timer & Auto-Solve Engine

import { getDailyChallenge, getUnsolvedProblems } from './leetcode.js';

export class DailyScheduler {
  constructor(botService, credManager, config = {}) {
    this.bot = botService;
    this.credManager = credManager;
    this.lastNotifiedDate = null;
    this.triggeredTimers = new Set();
    this.triggeredSchedules = new Set();
    this.timer = null;
    this.activeSolves = new Set(); // set of chatIds currently solving
  }

  resetScheduleTrigger(chatId = null) {
    if (chatId) {
      for (const k of this.triggeredSchedules) {
        if (k.startsWith(`schedule_${chatId}_`)) this.triggeredSchedules.delete(k);
      }
    } else {
      this.triggeredSchedules.clear();
    }
    console.log('[Scheduler] Auto-solve schedule trigger reset.');
  }

  resetTimerTrigger(chatId = null) {
    if (chatId) {
      for (const k of this.triggeredTimers) {
        if (k.startsWith(`timer_${chatId}_`)) this.triggeredTimers.delete(k);
      }
    } else {
      this.triggeredTimers.clear();
    }
    console.log('[Scheduler] Daily reminder timer trigger reset.');
  }

  start(intervalMs = 45 * 1000) { // Check every 45 seconds
    console.log('[Scheduler] ⏰ 24/7 Cloud Multi-User Scheduler, Daily Reminder & Auto-Solver started.');
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
   * 1. Midnight UTC Challenge Announcement for All Users
   */
  async checkDailyMidnight() {
    try {
      if (!this.bot || !this.bot.isConfigured || !this.credManager) return;
      const users = this.credManager.getAllUsers();
      if (!users || users.length === 0) return;

      const todayUTC = new Date().toISOString().slice(0, 10);
      if (this.lastNotifiedDate === todayUTC) return;

      console.log(`[Scheduler] New day detected: ${todayUTC}. Broadcasting daily challenge to ${users.length} user(s)...`);
      this.lastNotifiedDate = todayUTC;

      // Clean old trigger sets daily
      if (this.triggeredTimers.size > 200) this.triggeredTimers.clear();
      if (this.triggeredSchedules.size > 200) this.triggeredSchedules.clear();

      for (const user of users) {
        const chatId = user.chatId;
        if (!chatId) continue;
        try {
          const daily = await getDailyChallenge(user);
          if (!daily) continue;

          const statusMsg = daily.userStatus === 'Finish' ? '✅ Already Solved' : '❌ Unsolved';
          const announcement =
`🌅 *New LeetCode Daily Challenge Available!*

📖 *#${daily.frontendId} ${daily.title}*
🏷️ *Difficulty:* ${daily.difficulty}
📊 *Status:* ${statusMsg}
🔗 ${daily.url}

_Tap \`/solve\` to solve directly on your LeetCode account!_`;

          await this.bot.sendMessage(chatId, announcement);
        } catch (uErr) {
          console.warn(`[Scheduler] checkDailyMidnight error for user ${chatId}:`, uErr.message);
        }
      }
    } catch (err) {
      console.warn('[Scheduler] checkDailyMidnight error:', err.message);
    }
  }

  /**
   * 2. Per-User Daily Reminder Timer (/timer)
   */
  async checkReminderTimer() {
    if (!this.bot || !this.bot.isConfigured || !this.credManager) return;
    const users = this.credManager.getAllUsers();
    if (!users || users.length === 0) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    for (const user of users) {
      const chatId = user.chatId;
      if (!chatId) continue;

      const timerConfig = user.timer || this.credManager.getTimer(chatId);
      if (!timerConfig || !timerConfig.enabled) continue;

      const isMatchingTime = (currentHour === timerConfig.hour && Math.abs(currentMinute - timerConfig.minute) <= 1);
      const triggerKey = `timer_${chatId}_${todayStr}_${timerConfig.hour}:${timerConfig.minute}`;

      if (isMatchingTime && !this.triggeredTimers.has(triggerKey)) {
        this.triggeredTimers.add(triggerKey);
        console.log(`[Scheduler] ⏰ Triggering Daily Reminder for user ${chatId} at ${timerConfig.time}...`);

        try {
          const daily = await getDailyChallenge(user);
          const statusStr = daily?.userStatus === 'Finish' ? ' (✅ Solved)' : ' (❌ Unsolved)';
          const dailyInfo = daily ? `\n📖 *Today's Challenge:* #${daily.frontendId} ${daily.title} (${daily.difficulty})${statusStr}\n🔗 ${daily.url}` : '';

          const reminderMsg =
`⏰ *Daily LeetCode Practice Reminder!*

It's *${timerConfig.time}* — Time to solve your daily problem and protect your streak! 🔥
${dailyInfo}

👉 *Quick action:* Tap \`/solve\` to generate and submit the solution automatically!`;

          await this.bot.sendMessage(chatId, reminderMsg);
        } catch (err) {
          console.warn(`[Scheduler] checkReminderTimer error for user ${chatId}:`, err.message);
        }
      }
    }
  }

  /**
   * 3. Per-User Autonomous Auto-Solve Schedule (/schedule)
   */
  async checkAutoSolveSchedule() {
    if (!this.bot || !this.bot.isConfigured || !this.credManager) return;
    const users = this.credManager.getAllUsers();
    if (!users || users.length === 0) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    for (const user of users) {
      const chatId = user.chatId;
      if (!chatId) continue;

      const scheduleConfig = user.schedule || this.credManager.getSchedule(chatId);
      if (!scheduleConfig || !scheduleConfig.enabled) continue;

      const isMatchingTime = (currentHour === scheduleConfig.hour && Math.abs(currentMinute - scheduleConfig.minute) <= 1);
      const triggerKey = `schedule_${chatId}_${todayStr}_${scheduleConfig.hour}:${scheduleConfig.minute}`;

      if (isMatchingTime && !this.triggeredSchedules.has(triggerKey) && !this.activeSolves.has(chatId)) {
        this.triggeredSchedules.add(triggerKey);
        this.activeSolves.add(chatId);

        const numQuestions = Math.max(1, parseInt(scheduleConfig.numQuestions || 1, 10));
        const targetLang = scheduleConfig.language || 'Python';
        console.log(`[Scheduler] 🕒 Triggering Scheduled Auto-Solve for user ${chatId} at ${scheduleConfig.time} (${numQuestions} Qs in ${targetLang})...`);

        (async () => {
          try {
            await this.bot.sendMessage(
              chatId,
              `🕒 *Autonomous Auto-Solve Schedule Triggered (${scheduleConfig.time})!*\n` +
              `🎯 *Target:* Solving *${numQuestions}* strictly unsolved challenge(s) in *${targetLang}*...\n` +
              `🔍 Querying LeetCode for fresh, uncompleted problems...`
            );

            const unsolvedProblems = await getUnsolvedProblems(numQuestions, user);

            if (!unsolvedProblems || unsolvedProblems.length === 0) {
              await this.bot.sendMessage(
                chatId,
                '⚠️ *No unsolved problems found matching criteria.* All problems in the search batch may already be completed!'
              );
              return;
            }

            const summaryList = unsolvedProblems
              .map((p, idx) => `  *${idx + 1}.* #${p.frontendId} ${p.title} (${p.difficulty}) ${p.isDaily ? '🌟 *[Daily]*' : ''}`)
              .join('\n');

            await this.bot.sendMessage(
              chatId,
              `📋 *Selected ${unsolvedProblems.length} Fresh Unsolved Challenge(s):*\n${summaryList}\n\n🚀 *Starting autonomous multi-attempt solver in ${targetLang}...*`
            );

            let solvedCount = 0;
            for (let i = 0; i < unsolvedProblems.length; i++) {
              const prob = unsolvedProblems[i];
              const qNum = i + 1;

              await this.bot.sendMessage(
                chatId,
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `▶️ *[${qNum}/${unsolvedProblems.length}] Processing Challenge [${targetLang}]:*\n` +
                `📖 *#${prob.frontendId} ${prob.title}* (${prob.difficulty})\n` +
                `━━━━━━━━━━━━━━━━━━━━`
              );

              try {
                const solveRes = await this.bot._executeSolvePipeline(chatId, prob, targetLang);
                if (solveRes && solveRes.success) {
                  solvedCount++;
                }
              } catch (pErr) {
                console.error(`[Scheduler] Error solving problem #${prob.frontendId}:`, pErr.message);
                await this.bot.sendMessage(chatId, `⚠️ *Error solving #${prob.frontendId}:* ${pErr.message}`);
              }

              if (i < unsolvedProblems.length - 1) {
                await new Promise(r => setTimeout(r, 5000));
              }
            }

            await this.bot.sendMessage(
              chatId,
              `🏁 *Scheduled Auto-Solve Complete!* 🏆\n\n` +
              `✅ *Summary:* Successfully resolved *${solvedCount} / ${unsolvedProblems.length}* problems in *${targetLang}*.\n` +
              `🔥 Submissions and GitHub sync are completed!`
            );
          } catch (err) {
            console.warn(`[Scheduler] checkAutoSolveSchedule error for user ${chatId}:`, err.message);
            await this.bot.sendMessage(chatId, `❌ *Scheduled Auto-Solve encountered an error:* ${err.message}`);
          } finally {
            this.activeSolves.delete(chatId);
          }
        })();
      }
    }
  }
}

