// backend/src/groq.js
// Groq AI Service for Solution Generation and Optimization

const GROQ_BASE = 'https://api.groq.com/openai/v1';

export class GroqService {
  constructor(apiKey) {
    this.apiKey = (apiKey || '').trim();
    this.models = [
      'qwen/qwen3.8-27b',
      'groq/compound',
      'groq/compound-mini',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant'
    ];
    this.activeModel = null;
  }

  get isConfigured() {
    return Boolean(this.apiKey && this.apiKey.startsWith('gsk_'));
  }

  async _fetchChat(model, messages, maxTokens = 2000, temperature = 0.2) {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!res.ok) {
      let body;
      try { body = await res.json(); } catch (_) { body = {}; }
      const msg = body?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg, fatal: res.status === 401 || res.status === 403 };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return { ok: false, error: 'Empty response from model' };
    return { ok: true, content };
  }

  async _queryWithFallback(messages, maxTokens = 2000, temperature = 0.2) {
    if (!this.isConfigured) {
      throw new Error('GROQ_API_KEY is not configured or invalid.');
    }

    // Try cached working model first
    if (this.activeModel) {
      const result = await this._fetchChat(this.activeModel, messages, maxTokens, temperature);
      if (result.ok) return result.content;
      if (result.fatal) throw new Error(`Groq Authentication Failed: ${result.error}`);
      this.activeModel = null; // reset if failed
    }

    const errors = [];
    for (const model of this.models) {
      const result = await this._fetchChat(model, messages, maxTokens, temperature);
      if (result.ok) {
        this.activeModel = model;
        return result.content;
      }
      errors.push(`${model}: ${result.error}`);
      if (result.fatal) throw new Error(`Groq Authentication Failed: ${result.error}`);
    }

    throw new Error(`All Groq AI models failed. Errors:\n${errors.join('\n')}`);
  }

  /**
   * Health check for /status command
   */
  async ping() {
    if (!this.isConfigured) return { ok: false, error: 'Not configured' };
    try {
      const res = await fetch(`${GROQ_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, model: this.activeModel || this.models[0] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Generates a complete, verified solution with approach and complexities
   */
  async generateSolution(title, description, language = 'Python', templateCode = '') {
    const targetLang = language.trim();

    const systemPrompt = `You are a world-class competitive programming Grandmaster who has solved thousands of LeetCode challenges with 100% acceptance.
Provide the optimal, production-grade, accepted solution for the given LeetCode problem in ${targetLang}.
Your code must pass all edge cases, huge inputs, and avoid TLE (Time Limit Exceeded) and MLE (Memory Limit Exceeded).

Respond strictly in the following structured format with these exact markdown sections:

## Approach
Explain the core algorithm, pattern (e.g. Two Pointers, DP, Greedy, Monotonic Stack), and why it is optimal in 2-3 clear paragraphs.

## Complexity
- Time Complexity: O(...) with brief justification
- Space Complexity: O(...) with brief justification

## Code
Provide the complete executable code block inside markdown fences (e.g. \`\`\`${targetLang.toLowerCase()}).
${templateCode ? `CRITICAL: You MUST write your solution inside this exact class/method structure:\n\`\`\`\n${templateCode}\n\`\`\`\n` : ''}
Do not include conversational filler before or after the markdown sections.`;

    const userPrompt = `Problem: ${title}\n\nDescription:\n${description}\n\nLanguage: ${targetLang}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const rawResponse = await this._queryWithFallback(messages, 2500, 0.2);
    return this._parseStructuredSolution(rawResponse, targetLang, templateCode);
  }

  _parseStructuredSolution(rawText, language, templateCode) {
    const normalized = (rawText || '').replace(/\r\n/g, '\n');

    // 1. Extract Code Block
    let code = '';
    const codeMatches = [...normalized.matchAll(/```(?:[a-zA-Z0-9_#+.-]*)[^\n]*\n([\s\S]*?)```/g)].map(m => m[1].trim());

    if (codeMatches.length > 0) {
      // Pick block containing template signature or largest block
      code = codeMatches.find(b => b.includes('class Solution') || b.includes('impl Solution') || /def\s+\w+\s*\(self/.test(b)) || codeMatches[codeMatches.length - 1];
    } else {
      // Unclosed code block fallback
      const unclosed = normalized.match(/```(?:[a-zA-Z0-9_#+.-]*)[^\n]*\n([\s\S]+)$/);
      if (unclosed) code = unclosed[1].trim();
    }

    // 2. Extract Approach
    let approach = '';
    const approachMatch = normalized.match(/##\s*Approach\s*\n([\s\S]*?)(?=##\s*Complexity|##\s*Code|$)/i);
    if (approachMatch) {
      approach = approachMatch[1].trim();
    }

    // 3. Extract Complexity
    let timeComplexity = 'O(N)';
    let spaceComplexity = 'O(1)';
    const timeMatch = normalized.match(/Time Complexity:?\s*(O\([^)]+\)[^\n]*)/i);
    if (timeMatch) timeComplexity = timeMatch[1].trim();

    const spaceMatch = normalized.match(/Space Complexity:?\s*(O\([^)]+\)[^\n]*)/i);
    if (spaceMatch) spaceComplexity = spaceMatch[1].trim();

    // 4. Validate Code
    const isValid = this.validateCode(code, language);

    return {
      raw: normalized,
      approach: approach || 'Optimal algorithmic approach using standard patterns.',
      timeComplexity,
      spaceComplexity,
      code: code || '',
      isValid
    };
  }

  /**
   * Refines and self-heals a previous solution based on LeetCode judge feedback
   */
  async generateRefinedSolution(title, description, language, previousCode, errorFeedback) {
    const targetLang = language.trim();

    const systemPrompt = `You are an elite competitive programmer fixing a failed LeetCode submission in ${targetLang}.
The previous solution was submitted to LeetCode and FAILED the judge.
You must analyze the failure reason carefully:
- If "Time Limit Exceeded": You MUST optimize the time complexity! Replace naive iterations with optimal structures (e.g. Bitsets, HashSets, Sorting + early pruning, Binary Search, or DP).
- If "Wrong Answer": Analyze the failed testcase, expected output vs code output, and fix the edge cases and algorithm logic.
- If "Compile Error" or "Runtime Error": Fix the syntax, undefined references, bounds, or memory issues immediately.

Respond strictly in the structured format:
## Approach
Explain why the previous code failed and how this fix solves it.

## Complexity
- Time Complexity: O(...)
- Space Complexity: O(...)

## Code
\`\`\`${targetLang.toLowerCase()}
// Complete working Solution class
\`\`\``;

    const userPrompt = `Problem: ${title}
Description:
${description}

--- Previous Failed Code (${targetLang}) ---
\`\`\`${targetLang.toLowerCase()}
${previousCode}
\`\`\`

--- LeetCode Judge Failure Feedback ---
${errorFeedback}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const rawResponse = await this._queryWithFallback(messages, 2500, 0.2);
    return this._parseStructuredSolution(rawResponse, targetLang, '');
  }

  validateCode(code, language) {
    if (!code || code.trim().length < 15) return false;
    const clean = code.trim();

    // Basic structure checks
    const lang = (language || '').toLowerCase();
    if (lang.includes('python') || lang === 'py') {
      return clean.includes('def ') || clean.includes('class ');
    }
    if (lang.includes('c++') || lang === 'cpp') {
      return clean.includes('class Solution') || clean.includes('{');
    }
    if (lang.includes('java')) {
      return clean.includes('class Solution') || clean.includes('public ');
    }
    if (lang.includes('javascript') || lang.includes('typescript') || lang === 'js' || lang === 'ts') {
      return clean.includes('function') || clean.includes('=>') || clean.includes('class ');
    }

    return true;
  }
}
