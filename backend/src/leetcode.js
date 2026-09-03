// backend/src/leetcode.js
// Centralized LeetCode API Service (GraphQL & Submissions)

const LEETCODE_BASE = 'https://leetcode.com';
const GRAPHQL_URL = `${LEETCODE_BASE}/graphql`;

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': LEETCODE_BASE,
};

/**
 * Strips HTML tags and converts LeetCode HTML into clean Markdown
 */
function htmlToMarkdown(html = '') {
  if (!html) return '';
  return html
    .replace(/<pre>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi, (_, code) => `\n\`\`\`\n${code.trim()}\n\`\`\`\n`)
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<strong class="example">(.*?)<\/strong>/gi, '\n**$1**')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<ul>([\s\S]*?)<\/ul>/gi, (_, content) => content.replace(/<li>([\s\S]*?)<\/li>/gi, '• $1\n'))
    .replace(/<ol>([\s\S]*?)<\/ol>/gi, (_, content) => {
      let idx = 1;
      return content.replace(/<li>([\s\S]*?)<\/li>/gi, () => `${idx++}. $1\n`);
    })
    .replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Searches problems by number, exact slug, exact title, or keywords.
 * Returns { exact: problem, matches: [...] }
 */
export async function searchProblem(query) {
  if (!query || !query.trim()) return { exact: null, matches: [] };
  const clean = query.trim();
  const isNumeric = /^\d+$/.test(clean);

  // LeetCode problemset search GraphQL
  const graphqlQuery = `
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        total: totalNum
        questions: data {
          frontendQuestionId: questionFrontendId
          title
          titleSlug
          difficulty
          topicTags {
            name
            slug
          }
        }
      }
    }
  `;

  const payload = {
    query: graphqlQuery,
    variables: {
      categorySlug: '',
      skip: 0,
      limit: 15,
      filters: { searchKeywords: clean }
    }
  };

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`LeetCode API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const questions = data.data?.problemsetQuestionList?.questions || [];

  if (questions.length === 0) {
    return { exact: null, matches: [] };
  }

  // 1. Exact numeric match on frontendQuestionId
  if (isNumeric) {
    const numMatch = questions.find(q => q.frontendQuestionId === clean);
    if (numMatch) return { exact: numMatch, matches: [numMatch] };
  }

  // 2. Exact slug match
  const slugMatch = questions.find(q => q.titleSlug.toLowerCase() === clean.toLowerCase());
  if (slugMatch) return { exact: slugMatch, matches: [slugMatch] };

  // 3. Exact title match (case-insensitive)
  const titleMatch = questions.find(q => q.title.toLowerCase() === clean.toLowerCase());
  if (titleMatch) return { exact: titleMatch, matches: [titleMatch] };

  // 4. If only 1 result returned, treat as exact
  if (questions.length === 1) {
    return { exact: questions[0], matches: questions };
  }

  // 5. Check if any title starts with query
  const startsWithMatch = questions.filter(q => q.title.toLowerCase().startsWith(clean.toLowerCase()));
  if (startsWithMatch.length === 1) {
    return { exact: startsWithMatch[0], matches: startsWithMatch };
  }

  // Return list for disambiguation
  return { exact: null, matches: questions.slice(0, 5) };
}

/**
 * Fetches complete problem details including description, constraints, examples, topics
 */
export async function getProblemDetails(slug) {
  const graphqlQuery = `
    query questionContent($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        titleSlug
        difficulty
        content
        topicTags {
          name
          slug
        }
        hints
      }
    }
  `;

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ query: graphqlQuery, variables: { titleSlug: slug } })
  });

  if (!res.ok) throw new Error(`LeetCode API returned HTTP ${res.status}`);
  const data = await res.json();
  const q = data.data?.question;
  if (!q) throw new Error(`Problem not found for slug: ${slug}`);

  const cleanDescription = htmlToMarkdown(q.content);

  return {
    questionId: q.questionId,
    frontendId: q.questionFrontendId,
    title: q.title,
    titleSlug: q.titleSlug,
    difficulty: q.difficulty,
    description: cleanDescription,
    topicTags: (q.topicTags || []).map(t => t.name),
    hints: q.hints || [],
    url: `${LEETCODE_BASE}/problems/${q.titleSlug}/`
  };
}

/**
 * Fetches starter code templates and questionId for a problem
 */
export async function getProblemEditorData(slug) {
  const graphqlQuery = `
    query questionEditorData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        codeSnippets {
          lang
          langSlug
          code
        }
      }
    }
  `;

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ query: graphqlQuery, variables: { titleSlug: slug } })
  });

  if (!res.ok) throw new Error(`LeetCode API returned HTTP ${res.status}`);
  const data = await res.json();
  const q = data.data?.question;
  if (!q) throw new Error(`Problem editor data not found for slug: ${slug}`);

  return {
    questionId: q.questionId,
    frontendId: q.questionFrontendId,
    title: q.title,
    codeSnippets: q.codeSnippets || []
  };
}

/**
 * Fetches today's active daily challenge
 */
export async function getDailyChallenge() {
  const graphqlQuery = `
    query questionOfToday {
      activeDailyCodingChallengeQuestion {
        date
        userStatus
        question {
          questionId
          questionFrontendId
          title
          titleSlug
          difficulty
          topicTags {
            name
          }
        }
      }
    }
  `;

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ query: graphqlQuery })
  });

  if (!res.ok) throw new Error(`LeetCode API returned HTTP ${res.status}`);
  const data = await res.json();
  const challenge = data.data?.activeDailyCodingChallengeQuestion;
  if (!challenge || !challenge.question) throw new Error('No active daily challenge found');

  const q = challenge.question;
  return {
    date: challenge.date,
    userStatus: challenge.userStatus,
    questionId: q.questionId,
    frontendId: q.questionFrontendId,
    title: q.title,
    titleSlug: q.titleSlug,
    difficulty: q.difficulty,
    topicTags: (q.topicTags || []).map(t => t.name),
    url: `${LEETCODE_BASE}/problems/${q.titleSlug}/`
  };
}

/**
 * Fetches a random problem, optionally filtered by difficulty
 */
export async function getRandomProblem(difficulty = '') {
  const diffFilter = difficulty ? difficulty.toUpperCase() : null;

  const graphqlQuery = `
    query randomQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        total: totalNum
        questions: data {
          questionFrontendId
          title
          titleSlug
          difficulty
          topicTags {
            name
          }
        }
      }
    }
  `;

  const filters = {};
  if (diffFilter) filters.difficulty = diffFilter;

  const countRes = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      query: graphqlQuery,
      variables: { categorySlug: '', skip: 0, limit: 1, filters }
    })
  });

  if (!countRes.ok) throw new Error(`LeetCode API returned HTTP ${countRes.status}`);
  const countData = await countRes.json();
  const total = countData.data?.problemsetQuestionList?.total || 100;

  const randomSkip = Math.floor(Math.random() * Math.min(total, 2000));

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      query: graphqlQuery,
      variables: { categorySlug: '', skip: randomSkip, limit: 1, filters }
    })
  });

  if (!res.ok) throw new Error(`LeetCode API returned HTTP ${res.status}`);
  const data = await res.json();
  const questions = data.data?.problemsetQuestionList?.questions || [];
  if (questions.length === 0) throw new Error('No problems found');

  const q = questions[0];
  return {
    frontendId: q.questionFrontendId,
    title: q.title,
    titleSlug: q.titleSlug,
    difficulty: q.difficulty,
    topicTags: (q.topicTags || []).map(t => t.name),
    url: `${LEETCODE_BASE}/problems/${q.titleSlug}/`
  };
}

/**
 * Maps common language names or aliases to LeetCode submit langSlug
 */
export function normalizeLanguageSlug(lang = '') {
  const l = (lang || 'python3').toLowerCase().trim();
  if (l.includes('python') || l === 'py') return 'python3';
  if (l.includes('c++') || l === 'cpp') return 'cpp';
  if (l.includes('java') && !l.includes('script')) return 'java';
  if (l.includes('javascript') || l === 'js') return 'javascript';
  if (l.includes('typescript') || l === 'ts') return 'typescript';
  if (l.includes('golang') || l === 'go') return 'golang';
  if (l.includes('c#') || l === 'csharp' || l === 'cs') return 'csharp';
  if (l.includes('rust') || l === 'rs') return 'rust';
  if (l === 'c') return 'c';
  return 'python3';
}

/**
 * Submits solution directly to LeetCode with full session/CSRF validation
 */
export async function submitSolution(slug, questionId, code, language = 'python3', credentials = {}) {
  const { session, csrfToken } = credentials;

  if (!session || !csrfToken) {
    return {
      success: false,
      unavailable: true,
      error: 'LeetCode credentials (LEETCODE_SESSION and LEETCODE_CSRF_TOKEN) are not configured.'
    };
  }

  const langSlug = normalizeLanguageSlug(language);
  const submitUrl = `${LEETCODE_BASE}/problems/${slug}/submit/`;

  const headers = {
    ...DEFAULT_HEADERS,
    'Referer': `${LEETCODE_BASE}/problems/${slug}/`,
    'x-csrftoken': csrfToken,
    'Cookie': `LEETCODE_SESSION=${session}; csrftoken=${csrfToken};`
  };

  const body = JSON.stringify({
    lang: langSlug,
    question_id: String(questionId),
    typed_code: code
  });

  const res = await fetch(submitUrl, {
    method: 'POST',
    headers,
    body
  });

  if (res.status === 403 || res.status === 401) {
    return {
      success: false,
      unavailable: true,
      error: 'LeetCode session expired or CSRF token rejected. Please update your LEETCODE_SESSION.'
    };
  }

  if (!res.ok) {
    return {
      success: false,
      unavailable: true,
      error: `LeetCode submit endpoint returned HTTP ${res.status}`
    };
  }

  const data = await res.json();
  const submissionId = data.submission_id;

  if (!submissionId) {
    return {
      success: false,
      unavailable: true,
      error: 'No submission ID received from LeetCode. Submission was not recorded.'
    };
  }

  return {
    success: true,
    submissionId
  };
}

/**
 * Polls LeetCode submission check endpoint until verdict is completed
 */
export async function getSubmissionResult(submissionId, credentials = {}, maxWaitMs = 30000) {
  const { session, csrfToken } = credentials;
  const checkUrl = `${LEETCODE_BASE}/submissions/detail/${submissionId}/check/`;

  const headers = {
    ...DEFAULT_HEADERS,
    'x-csrftoken': csrfToken || '',
    'Cookie': session ? `LEETCODE_SESSION=${session}; csrftoken=${csrfToken || ''};` : ''
  };

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 1500));

    try {
      const res = await fetch(checkUrl, { headers });
      if (!res.ok) continue;

      const data = await res.json();
      const state = data.state; // PENDING, STARTED, SUCCESS

      if (state === 'SUCCESS') {
        const statusMsg = data.status_msg || 'Unknown';
        const isAccepted = statusMsg === 'Accepted';

        return {
          finished: true,
          accepted: isAccepted,
          verdict: statusMsg,
          runtime: data.status_runtime || 'N/A',
          runtimePercentile: data.runtime_percentile ? `${data.runtime_percentile.toFixed(1)}%` : null,
          memory: data.status_memory || 'N/A',
          memoryPercentile: data.memory_percentile ? `${data.memory_percentile.toFixed(1)}%` : null,
          totalCorrect: data.total_correct,
          totalTestcases: data.total_testcases,
          compileError: data.compile_error || null,
          runtimeError: data.runtime_error || null,
          lastTestcase: data.last_testcase || null,
          expectedOutput: data.expected_output || null,
          codeOutput: data.code_output || null
        };
      }
    } catch (err) {
      // transient network error, retry next loop
    }
  }

  return {
    finished: false,
    accepted: false,
    verdict: 'Timeout',
    error: 'Submission judging timed out after 30 seconds.'
  };
}

/**
 * Verifies if the provided LeetCode session and CSRF token are valid and authenticated.
 * Returns { valid: true, username: '...' } or { valid: false, error: '...' }
 */
export async function verifyLeetCodeSession(session, csrfToken) {
  if (!session) return { valid: false, error: 'Session cookie is missing' };

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        ...DEFAULT_HEADERS,
        'x-csrftoken': csrfToken || '',
        'Cookie': `LEETCODE_SESSION=${session}; csrftoken=${csrfToken || ''};`
      },
      body: JSON.stringify({
        query: `query userStatus {
          userStatus {
            isSignedIn
            username
            userSlug
          }
        }`
      })
    });

    if (!res.ok) return { valid: false, error: `LeetCode API returned HTTP ${res.status}` };
    const data = await res.json();
    const status = data.data?.userStatus;
    if (status?.isSignedIn && status?.username) {
      return { valid: true, username: status.username, userSlug: status.userSlug };
    }
    return { valid: false, error: 'Session cookie is invalid or expired.' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Attempts automated password login to LeetCode with credentials.
 */
export async function attemptLeetCodePasswordLogin(login, password) {
  try {
    // 1. Initial GET to obtain fresh csrftoken
    const initRes = await fetch(LEETCODE_BASE, {
      headers: {
        'User-Agent': DEFAULT_HEADERS['User-Agent']
      }
    });

    const setCookies = initRes.headers.get('set-cookie') || '';
    let csrfToken = '';
    const csrfMatch = setCookies.match(/csrftoken=([^;]+)/);
    if (csrfMatch) csrfToken = csrfMatch[1];

    if (!csrfToken) {
      csrfToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    }

    // 2. POST /accounts/login/
    const loginRes = await fetch(`${LEETCODE_BASE}/accounts/login/`, {
      method: 'POST',
      headers: {
        ...DEFAULT_HEADERS,
        'Origin': LEETCODE_BASE,
        'Referer': `${LEETCODE_BASE}/accounts/login/`,
        'x-csrftoken': csrfToken,
        'Cookie': `csrftoken=${csrfToken};`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: login.trim(),
        password: password
      })
    });

    const loginSetCookies = loginRes.headers.get('set-cookie') || '';
    const sessionMatch = loginSetCookies.match(/LEETCODE_SESSION=([^;]+)/);
    const newCsrfMatch = loginSetCookies.match(/csrftoken=([^;]+)/);

    if (sessionMatch) {
      const session = sessionMatch[1];
      const finalCsrf = newCsrfMatch ? newCsrfMatch[1] : csrfToken;
      const verify = await verifyLeetCodeSession(session, finalCsrf);
      return {
        success: true,
        session,
        csrfToken: finalCsrf,
        username: verify.username || login
      };
    }

    const data = await loginRes.json().catch(() => ({}));
    if (data.recaptcha) {
      return {
        success: false,
        recaptcha: true,
        error: 'LeetCode requires an interactive human reCAPTCHA for password logins.'
      };
    }

    return {
      success: false,
      error: data.error || (loginRes.status === 403 ? 'Bot protection challenge triggered' : `HTTP ${loginRes.status}`)
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}
