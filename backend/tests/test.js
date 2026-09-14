// backend/tests/test.js
// Automated verification test suite for LeetCode Companion Cloud Backend

import { searchProblem, getProblemDetails, getDailyChallenge, getRandomProblem, normalizeLanguageSlug } from '../src/leetcode.js';
import { GroqService } from '../src/groq.js';
import { TelegramBotService } from '../src/bot.js';
import { getUserCurrentTime } from '../src/scheduler.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n🧪 Starting LeetCode Companion Cloud Backend Test Suite...\n');

  // Test 1: Search by numeric ID "1"
  console.log('--- Test Group 1: Problem Search Engine ---');
  try {
    const res1 = await searchProblem('1');
    assert(res1.exact && res1.exact.frontendQuestionId === '1', 'searchProblem("1") resolves to #1');
    assert(res1.exact && res1.exact.titleSlug === 'two-sum', 'searchProblem("1") titleSlug is "two-sum"');
  } catch (e) {
    assert(false, `searchProblem("1") threw error: ${e.message}`);
  }

  // Test 2: Search by numeric ID "874"
  try {
    const res874 = await searchProblem('874');
    assert(res874.exact && res874.exact.frontendQuestionId === '874', 'searchProblem("874") resolves to #874');
    assert(res874.exact && res874.exact.titleSlug === 'walking-robot-simulation', 'searchProblem("874") is "walking-robot-simulation"');
  } catch (e) {
    assert(false, `searchProblem("874") threw error: ${e.message}`);
  }

  // Test 3: Search by exact slug "two-sum"
  try {
    const resSlug = await searchProblem('two-sum');
    assert(resSlug.exact && resSlug.exact.titleSlug === 'two-sum', 'searchProblem("two-sum") resolves to exact slug');
  } catch (e) {
    assert(false, `searchProblem("two-sum") threw error: ${e.message}`);
  }

  // Test 4: Search by exact title "Two Sum"
  try {
    const resTitle = await searchProblem('Two Sum');
    assert(resTitle.exact && resTitle.exact.title === 'Two Sum', 'searchProblem("Two Sum") resolves to exact title');
  } catch (e) {
    assert(false, `searchProblem("Two Sum") threw error: ${e.message}`);
  }

  // Test 5: Search by partial title "walking robot"
  try {
    const resPartial = await searchProblem('walking robot');
    assert((resPartial.exact || resPartial.matches.length > 0) && (resPartial.exact?.titleSlug.includes('walking-robot') || resPartial.matches[0].titleSlug.includes('walking-robot')), 'searchProblem("walking robot") finds Walking Robot Simulation');
  } catch (e) {
    assert(false, `searchProblem("walking robot") threw error: ${e.message}`);
  }

  // Test 6: Search with multiple matches "robot" (Disambiguation)
  try {
    const resMulti = await searchProblem('robot');
    assert(resMulti.matches && resMulti.matches.length > 1, 'searchProblem("robot") returns multiple matches for disambiguation');
  } catch (e) {
    assert(false, `searchProblem("robot") threw error: ${e.message}`);
  }

  // Test Group 2: Problem Details & Daily Challenge
  console.log('\n--- Test Group 2: LeetCode Details & Daily ---');
  try {
    const details = await getProblemDetails('two-sum');
    assert(details.title === 'Two Sum', 'getProblemDetails("two-sum") returns correct title');
    assert(details.description.length > 50, 'getProblemDetails("two-sum") returns clean markdown description');
    assert(details.url.includes('leetcode.com/problems/two-sum'), 'getProblemDetails("two-sum") returns valid URL');
  } catch (e) {
    assert(false, `getProblemDetails threw error: ${e.message}`);
  }

  try {
    const daily = await getDailyChallenge();
    assert(Boolean(daily && daily.titleSlug && daily.title), `getDailyChallenge() returns active challenge: "${daily?.title}"`);
  } catch (e) {
    assert(false, `getDailyChallenge threw error: ${e.message}`);
  }

  try {
    const random = await getRandomProblem('medium');
    assert(Boolean(random && random.difficulty === 'Medium'), `getRandomProblem("medium") returns Medium problem: #${random?.frontendId} ${random?.title}`);
  } catch (e) {
    assert(false, `getRandomProblem threw error: ${e.message}`);
  }

  // Test Group 3: Language Normalization
  console.log('\n--- Test Group 3: Language Mapping ---');
  assert(normalizeLanguageSlug('python') === 'python3', 'normalizeLanguageSlug("python") -> python3');
  assert(normalizeLanguageSlug('c++') === 'cpp', 'normalizeLanguageSlug("c++") -> cpp');
  assert(normalizeLanguageSlug('cpp') === 'cpp', 'normalizeLanguageSlug("cpp") -> cpp');
  assert(normalizeLanguageSlug('java') === 'java', 'normalizeLanguageSlug("java") -> java');
  assert(normalizeLanguageSlug('js') === 'javascript', 'normalizeLanguageSlug("js") -> javascript');
  assert(normalizeLanguageSlug('rust') === 'rust', 'normalizeLanguageSlug("rust") -> rust');

  // Test Group 4: Code Validation
  console.log('\n--- Test Group 4: Groq Code Validator ---');
  const groq = new GroqService('');
  assert(groq.validateCode('class Solution:\n    def twoSum(self, nums, target):\n        pass', 'python'), 'Validates Python code');
  assert(groq.validateCode('class Solution {\npublic:\n    vector<int> twoSum() {}\n};', 'cpp'), 'Validates C++ code');
  assert(!groq.validateCode('hello world', 'python'), 'Rejects invalid code');

  // Test Group 5: Telegram Message Splitting
  console.log('\n--- Test Group 5: Message Splitting ---');
  const bot = new TelegramBotService({});
  const shortText = 'Short message';
  assert(bot._splitMessage(shortText, 4000).length === 1, 'Short text is not split');

  const longText = 'Paragraph A\n\n' + 'x'.repeat(3000) + '\n\nParagraph B\n\n' + 'y'.repeat(2000);
  const chunks = bot._splitMessage(longText, 4000);
  assert(chunks.length === 2, `Long text (${longText.length} chars) split into ${chunks.length} chunks`);
  assert(chunks.every(c => c.length <= 4000), 'All chunks are within 4000 char limit');

  // Test Group 6: Query and Language Parser
  console.log('\n--- Test Group 6: Query & Language Parser ---');
  const parsed1 = bot._extractQueryAndLanguage('1 cpp');
  assert(parsed1.query === '1' && parsed1.language === 'cpp', 'Parses "/solution 1 cpp" -> query: "1", lang: "cpp"');

  const parsed2 = bot._extractQueryAndLanguage('walking robot simulation python');
  assert(parsed2.query === 'walking robot simulation' && parsed2.language === 'python', 'Parses multi-word query with language');

  const parsed3 = bot._extractQueryAndLanguage('two-sum');
  assert(parsed3.query === 'two-sum' && parsed3.language === 'Python', 'Defaults language to Python');

  // Test Group 7: Unsolved Problemset & Batching
  console.log('\n--- Test Group 7: Unsolved Problemset & Batching ---');
  try {
    const { getUnsolvedProblems } = await import('../src/leetcode.js');
    const unsolvedList = await getUnsolvedProblems(3);
    assert(Array.isArray(unsolvedList) && unsolvedList.length === 3, 'getUnsolvedProblems(3) returns exactly 3 unsolved problems');
    assert(unsolvedList.every(p => p.slug && p.title && p.frontendId), 'All returned unsolved problems have valid slug, title, frontendId');
    const uniqueSlugs = new Set(unsolvedList.map(p => p.slug));
    assert(uniqueSlugs.size === 3, 'All 3 unsolved problems are unique');
  } catch (e) {
    assert(false, `getUnsolvedProblems threw error: ${e.message}`);
  }

  // Test Group 8: Schedule Language & Parameter Parser
  console.log('\n--- Test Group 8: Schedule Argument & Language Parser ---');
  const sched1 = bot._parseScheduleArgs('10 PM 3 cpp');
  assert(sched1.timeStr === '10 PM' && sched1.numQ === 3 && sched1.lang === 'C++', 'Parses "/schedule 10 PM 3 cpp" -> time: 10 PM, count: 3, lang: C++');

  const sched2 = bot._parseScheduleArgs('22:00 2 py');
  assert(sched2.timeStr === '22:00' && sched2.numQ === 2 && sched2.lang === 'Python', 'Parses "/schedule 22:00 2 py" -> time: 22:00, count: 2, lang: Python');

  const sched3 = bot._parseScheduleArgs('8:30 PM java');
  assert(sched3.timeStr === '8:30 PM' && sched3.numQ === 1 && sched3.lang === 'Java', 'Parses "/schedule 8:30 PM java" -> time: 8:30 PM, count: 1, lang: Java');

  const sched4 = bot._parseScheduleArgs('3 questions in cpp at 10 PM');
  assert(sched4.timeStr === '10 PM' && sched4.numQ === 3 && sched4.lang === 'C++', 'Parses natural language schedule string');

  // Test Group 9: Unlink and Credential Lifecycle
  console.log('\n--- Test Group 9: Unlink & Credential Lifecycle ---');
  const { CredentialManager } = await import('../src/credentials.js');
  const pathModule = await import('path');
  const fsModule = await import('fs');
  const testCredPath = pathModule.resolve(process.cwd(), 'tests/test-credentials.json');
  
  if (fsModule.existsSync(testCredPath)) {
    fsModule.unlinkSync(testCredPath);
  }

  const cm = new CredentialManager(testCredPath);

  // Test save credentials
  cm.saveCredentials('test_session_123', 'test_csrf_456', 'test_user');
  assert(cm.isConfigured === true, 'CredentialManager.isConfigured is true when session & csrf are present');
  assert(cm.getCredentials().session === 'test_session_123', 'getCredentials() returns saved session');
  assert(cm.getCredentials().username === 'test_user', 'getCredentials() returns saved username');

  const testBot = new TelegramBotService({}, { credManager: cm });
  assert(testBot.isAuthConfigured === true, 'bot.isAuthConfigured is true when credManager has credentials');
  assert(testBot.authCredentials.session === 'test_session_123', 'bot.authCredentials returns credManager session');

  // Test clearCredentials (unlink)
  cm.clearCredentials();
  assert(cm.isConfigured === false, 'CredentialManager.isConfigured is false after clearCredentials()');
  assert(cm.isExplicitlyUnlinked === true, 'CredentialManager.isExplicitlyUnlinked is true after clearCredentials()');
  assert(cm.getCredentials().session === '', 'getCredentials().session is empty string after clear');
  assert(cm.getCredentials().username === null, 'getCredentials().username is null after clear');
  assert(testBot.isAuthConfigured === false, 'bot.isAuthConfigured is false after clear');
  assert(testBot.authCredentials.session === '', 'bot.authCredentials.session is empty string after clear');

  // Test GitHub save & clear
  cm.saveGitHub('ghp_test_token', 'user/test-repo');
  assert(cm.getGitHubConfig().repo === 'user/test-repo', 'getGitHubConfig() returns saved repo');
  assert(cm.getGitHubConfig().token === 'ghp_test_token', 'getGitHubConfig() returns saved token');

  cm.clearGitHub();
  assert(cm.getGitHubConfig().repo === '', 'getGitHubConfig().repo is empty after clearGitHub()');
  assert(cm.getGitHubConfig().token === '', 'getGitHubConfig().token is empty after clearGitHub()');

  // Test Group 10: Multi-User Isolation & Independent Profiles
  console.log('\n--- Test Group 10: Multi-User Isolation & Multi-Phone Profiles ---');
  const multiCredPath = pathModule.resolve(process.cwd(), 'tests/test-multi-credentials.json');
  if (fsModule.existsSync(multiCredPath)) {
    fsModule.unlinkSync(multiCredPath);
  }

  const multiCM = new CredentialManager(multiCredPath);

  // Setup User 1 (Phone 1)
  multiCM.saveCredentials('11111', 'session_user1', 'csrf_user1', 'user_one');
  multiCM.saveGroqApiKey('11111', 'gsk_user1_secret_key');
  multiCM.saveGitHub('11111', 'ghp_token1', 'user1/leetcode-solutions');
  multiCM.setTimer('11111', true, '8 PM');
  multiCM.setSchedule('11111', true, '10 PM', 3, 'C++');

  // Setup User 2 (Phone 2)
  multiCM.saveCredentials('22222', 'session_user2', 'csrf_user2', 'user_two');
  multiCM.saveGroqApiKey('22222', 'gsk_user2_secret_key');
  multiCM.saveGitHub('22222', 'ghp_token2', 'user2/my-solutions');
  multiCM.setTimer('22222', true, '9 AM');
  multiCM.setSchedule('22222', true, '8 PM', 1, 'Python');

  // Verify User 1 isolation
  assert(multiCM.getCredentials('11111').username === 'user_one', 'User 1 has username "user_one"');
  assert(multiCM.getCredentials('11111').session === 'session_user1', 'User 1 has isolated session');
  assert(multiCM.getGroqApiKey('11111') === 'gsk_user1_secret_key', 'User 1 has isolated Groq key');
  assert(multiCM.getGitHubConfig('11111').repo === 'user1/leetcode-solutions', 'User 1 has isolated GitHub repo');
  assert(multiCM.getTimer('11111').time === '20:00', 'User 1 has isolated 8 PM timer');
  assert(multiCM.getSchedule('11111').numQuestions === 3 && multiCM.getSchedule('11111').language === 'C++', 'User 1 has isolated 3 Qs C++ schedule');

  // Verify User 2 isolation
  assert(multiCM.getCredentials('22222').username === 'user_two', 'User 2 has username "user_two"');
  assert(multiCM.getCredentials('22222').session === 'session_user2', 'User 2 has isolated session');
  assert(multiCM.getGroqApiKey('22222') === 'gsk_user2_secret_key', 'User 2 has isolated Groq key');
  assert(multiCM.getGitHubConfig('22222').repo === 'user2/my-solutions', 'User 2 has isolated GitHub repo');
  assert(multiCM.getTimer('22222').time === '09:00', 'User 2 has isolated 9 AM timer');
  assert(multiCM.getSchedule('22222').numQuestions === 1 && multiCM.getSchedule('22222').language === 'Python', 'User 2 has isolated 1 Q Python schedule');

  // Verify getAllUsers
  const allUsers = multiCM.getAllUsers();
  assert(allUsers.length === 2, 'getAllUsers() returns exactly 2 distinct user profiles');

  // Verify clearing User 1 does not affect User 2
  multiCM.clearCredentials('11111');
  assert(multiCM.getCredentials('11111').session === '', 'User 1 session cleared after unlinking');
  assert(multiCM.getCredentials('22222').session === 'session_user2', 'User 2 session remains intact after User 1 unlinks');

  // Test Group 11: Timezone Awareness & Scheduler Timing
  console.log('\n--- Test Group 11: Timezone Awareness & Schedule Timing ---');
  const tzIST = getUserCurrentTime('Asia/Kolkata');
  assert(typeof tzIST.hour === 'number' && tzIST.hour >= 0 && tzIST.hour <= 23, 'getUserCurrentTime("Asia/Kolkata") returns valid hour');
  assert(typeof tzIST.minute === 'number' && tzIST.minute >= 0 && tzIST.minute <= 59, 'getUserCurrentTime("Asia/Kolkata") returns valid minute');
  assert(/^\d{2}:\d{2}$/.test(tzIST.formatted), 'getUserCurrentTime returns formatted HH:mm');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(tzIST.todayStr), 'getUserCurrentTime returns formatted YYYY-MM-DD');

  const tzUTC = getUserCurrentTime('UTC');
  const tzEST = getUserCurrentTime('America/New_York');
  assert(tzUTC.formatted.length === 5 && tzEST.formatted.length === 5, 'Timezone formatter works across international timezones');

  // Test Timezone getter/setter
  const tzTestCredPath = pathModule.resolve(process.cwd(), 'tests/test-tz-credentials.json');
  if (fsModule.existsSync(tzTestCredPath)) {
    fsModule.unlinkSync(tzTestCredPath);
  }
  const tzCM = new CredentialManager(tzTestCredPath);
  assert(tzCM.getTimezone('userA') === 'Asia/Kolkata', 'Default timezone is Asia/Kolkata');

  tzCM.setTimezone('userA', 'America/New_York');
  assert(tzCM.getTimezone('userA') === 'America/New_York', 'setTimezone updates userA timezone to America/New_York');

  tzCM.setTimezone('userB', 'Europe/London');
  assert(tzCM.getTimezone('userB') === 'Europe/London', 'setTimezone updates userB timezone to Europe/London');
  assert(tzCM.getTimezone('userA') === 'America/New_York', 'userA timezone remains isolated');

  let invalidTzCaught = false;
  try {
    tzCM.setTimezone('userA', 'Invalid/Timezone_Name_123');
  } catch (err) {
    invalidTzCaught = true;
  }
  assert(invalidTzCaught, 'Setting invalid timezone throws descriptive error');

  if (fsModule.existsSync(tzTestCredPath)) {
    fsModule.unlinkSync(tzTestCredPath);
  }

  // Clean up isolated test credentials file
  if (fsModule.existsSync(testCredPath)) {
    fsModule.unlinkSync(testCredPath);
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();


