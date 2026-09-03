// backend/tests/test.js
// Automated verification test suite for LeetCode Companion Cloud Backend

import { searchProblem, getProblemDetails, getDailyChallenge, getRandomProblem, normalizeLanguageSlug } from '../src/leetcode.js';
import { GroqService } from '../src/groq.js';
import { TelegramBotService } from '../src/bot.js';

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

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
