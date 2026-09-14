// backend/src/scheduler.js
// 24/7 Cloud Daily Challenge Scheduler, Reminder Timer & Auto-Solve Engine

import { getDailyChallenge } from './leetcode.js';

export class DailyScheduler {
  constructor(botService, credManager, config = {}) {
    this.bot = botService;
    this.credManager = credManager;
    this.lastNotifiedDate = null;
    this.lastTimerTriggeredDate = null;
    this.lastScheduleTriggeredDate = null;
    this.timer = null;
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
      const daily = await getDailyChallenge();
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
    
    // Check if time matches (checking both local and UTC hours for flexibility)
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const isMatchingTime = (currentHour === timerConfig.hour && Math.abs(currentMinute - timerConfig.minute) <= 1);

    if (isMatchingTime && this.lastTimerTriggeredDate !== todayStr) {
      this.lastTimerTriggeredDate = todayStr;
      console.log(`[Scheduler] ⏰ Triggering Daily Reminder for user at ${timerConfig.time}...`);

      try {
        const daily = await getDailyChallenge();
        const dailyInfo = daily ? `\n📖 *Today's Challenge:* #${daily.frontendId} ${daily.title} (${daily.difficulty})\n🔗 ${daily.url}` : '';

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

    if (isMatchingTime && this.lastScheduleTriggeredDate !== todayStr) {
      this.lastScheduleTriggeredDate = todayStr;
      console.log(`[Scheduler] 🕒 Triggering Scheduled Auto-Solve at ${scheduleConfig.time} (Questions: ${scheduleConfig.numQuestions})...`);

      try {
        if (this.bot && this.bot.isConfigured) {
          await this.bot.sendMessage(null, `🕒 *Scheduled Auto-Solve Triggered (${scheduleConfig.time})!*\nSolving today's challenge with autonomous self-healing loop...`);
          
          const daily = await getDailyChallenge();
          if (daily) {
            await this.bot._executeSolvePipeline(null, {
              slug: daily.titleSlug,
              title: daily.title,
              frontendId: daily.frontendId,
              difficulty: daily.difficulty
            }, 'Python');
          }
        }
      } catch (err) {
        console.warn('[Scheduler] checkAutoSolveSchedule error:', err.message);
      }
    }
  }
}
