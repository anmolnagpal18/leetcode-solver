// groq-api.js – LeetCode Companion AI backend
//
// Uses GROQ (groq.com) – 100% free, no credit card required, very fast.
// Free models available:
//   llama-3.3-70b-versatile   – Best quality, free
//   llama-3.1-8b-instant      – Fastest, free
//   mixtral-8x7b-32768        – Good for code, free
//   gemma2-9b-it              – Google's Gemma 2, free
//
// Get your FREE API key at: https://console.groq.com  (just sign up, no billing)

export class GrokAPI {   // Class name kept as GrokAPI for backward compatibility with service-worker.js
  /**
   * @param {string} apiKey – Groq API key (starts with "gsk_")
   *                          Get free key: https://console.groq.com/keys
   */
  constructor(apiKey) {
    this.apiKey  = apiKey;
    this.baseUrl = 'https://api.groq.com/openai/v1';

    // Priority order – first working model wins and is cached
    this.MODELS = [
      'qwen/qwen3.8-27b',          // High quality coding & fast
      'groq/compound',             // Compound multi-model
      'groq/compound-mini',        // Fast compound model
      'openai/gpt-oss-120b',       // Open reasoning model
      'openai/gpt-oss-20b',        // Fast open model
      'llama-3.3-70b-versatile',   // Fallback if available
      'llama-3.1-8b-instant',      // Fallback if available
    ];

    this._activeModel = null;
  }

  // ── Single model attempt ───────────────────────────────────────────────────
  async _tryModel(model, messages, maxTokens, temperature) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens:  maxTokens,
          temperature,
        }),
      });
    } catch (netErr) {
      return { ok: false, skip: true, error: `Network error: ${netErr.message}` };
    }

    // Read body ONCE
    let body;
    try { body = await res.json(); } catch (_) { body = {}; }

    if (res.ok) {
      const text = body?.choices?.[0]?.message?.content?.trim();
      if (text) return { ok: true, text };
      return { ok: false, skip: true, error: 'Empty response from model' };
    }

    const errMsg = body?.error?.message || body?.message || `HTTP ${res.status}`;

    // Auth failure – stop immediately
    if (res.status === 401 || res.status === 403) {
      return { ok: false, skip: false, fatal: true,
               error: `Invalid API key (${res.status}): ${errMsg}` };
    }

    // Model not found / overloaded → try next
    return { ok: false, skip: true, error: `${model} (${res.status}): ${errMsg}` };
  }

  // ── Core generate with automatic model fallback ────────────────────────────
  async generate(prompt, { maxTokens = 1024, temperature = 0.4 } = {}) {
    if (!this.apiKey?.trim()) {
      throw new Error('No API key set. Please open Settings and add your Groq API key from console.groq.com');
    }

    const messages = [
      {
        role:    'system',
        content: 'You are an expert software engineer and competitive programmer. Help users understand and solve LeetCode problems. Be concise and use markdown formatting.',
      },
      { role: 'user', content: prompt },
    ];

    // Try cached model first (avoids discovery overhead on subsequent calls)
    if (this._activeModel) {
      const result = await this._tryModel(this._activeModel, messages, maxTokens, temperature);
      if (result.ok) return result.text;
      if (result.fatal) throw new Error(result.error);
      this._activeModel = null;
    }

    // Discover working model
    const errors = [];
    for (const model of this.MODELS) {
      console.log(`[LC-Companion] Trying model: ${model}`);
      const result = await this._tryModel(model, messages, maxTokens, temperature);

      if (result.ok) {
        this._activeModel = model;
        console.log(`[LC-Companion] ✅ Using model: ${model}`);
        return result.text;
      }

      errors.push(result.error);
      console.warn(`[LC-Companion] ❌ ${result.error}`);

      if (result.fatal) throw new Error(result.error);
    }

    throw new Error(
      `All AI models failed.\n\nLast error: ${errors[errors.length - 1]}\n\n` +
      'Please check your API key at console.groq.com'
    );
  }

  // ── Chat-style generate with full message history ──────────────────────────
  async generateChat(messages, { maxTokens = 1200, temperature = 0.35 } = {}) {
    if (!this.apiKey?.trim()) {
      throw new Error('No API key set. Please open Settings and add your Groq API key from console.groq.com');
    }

    // Try cached model first
    if (this._activeModel) {
      const result = await this._tryModel(this._activeModel, messages, maxTokens, temperature);
      if (result.ok) return result.text;
      if (result.fatal) throw new Error(result.error);
      this._activeModel = null;
    }

    // Discover working model
    const errors = [];
    for (const model of this.MODELS) {
      console.log(`[LC-Companion] Chat trying model: ${model}`);
      const result = await this._tryModel(model, messages, maxTokens, temperature);

      if (result.ok) {
        this._activeModel = model;
        console.log(`[LC-Companion] ✅ Chat using model: ${model}`);
        return result.text;
      }

      errors.push(result.error);
      console.warn(`[LC-Companion] ❌ ${result.error}`);
      if (result.fatal) throw new Error(result.error);
    }

    throw new Error(
      `All AI models failed.\n\nLast error: ${errors[errors.length - 1]}\n\n` +
      'Please check your API key at console.groq.com'
    );
  }

  // ── Follow-up chat for 2-way conversation ──────────────────────────────────
  async chatFollowUp(problemTitle, problemDescription, userCode, chatHistory) {
    const systemMsg = {
      role: 'system',
      content: `You are an expert competitive programming tutor helping a student on LeetCode.

Current problem: "${problemTitle}"

Problem description:
${(problemDescription || 'Not available').slice(0, 1500)}

${userCode?.trim() ? "Student's current code:\n```\n" + userCode.slice(0, 1500) + "\n```" : 'No code written yet.'}

Rules:
- Answer the student's question directly and concisely.
- **LeetCode Environment Template**: Any solution code you provide MUST be written inside the exact LeetCode class/method structure (e.g. 'class Solution:' in Python, 'class Solution { ... }' in C++/Java, with matching method signatures). Ensure the code is directly copy-pasteable to LeetCode, has perfect indentation (especially 4-space indentation for Python class methods), and compiles/runs successfully.
- **Clean Code Blocks (No Comments)**: All complete solution code blocks you output MUST be entirely comment-free and properly indented. Do not mix code and comments; explain the code in the text instead. This prevents compilation/indentation issues when the user inserts the code.
- If they share code that has errors, pinpoint the exact bug and explain the fix.
- If they don't understand a concept, explain it simply with an example.
- Always provide code examples when relevant, using markdown fences.
- Be encouraging and supportive — they are learning!
- Use markdown formatting for readability.`
    };

    // Build message array: system + chat history
    const messages = [systemMsg, ...chatHistory];

    return this.generateChat(messages, { maxTokens: 1200, temperature: 0.35 });
  }

  // ── Explain a LeetCode problem ─────────────────────────────────────────────
  async explainProblem(title, description, code = '') {
    const codeSection = code?.trim()
      ? `\n\n**User's current code:**\n\`\`\`\n${code.slice(0, 2000)}\n\`\`\``
      : '';

    const prompt = `You are a senior software engineer and competitive programming coach. Provide a masterclass explanation for this LeetCode problem.

**Problem:** ${title}

${(description || 'No description available.').slice(0, 1800)}${codeSection}

Provide a structured response with these exact markdown sections:

## Summary
A clear 2-3 sentence overview explaining the problem's goal.

## Key Insight
What is the core algorithmic trick or data structure needed to solve this optimally (e.g. dynamic programming, binary search, sliding window)?

## User's Code Analysis
${code.trim() ? `Analyze the User's current code provided. Do a line-by-line review of how it works:
1. Explain what each block of the user's code is doing.
2. Identify any logical bugs, potential edge cases missed, or syntax issues.
3. Assess its efficiency and mention if it is optimal or can be optimized.` : `No code has been provided in the editor. Remind the user to write some code so it can be reviewed.`}

## Optimal Approach
A step-by-step description of the optimal approach.

## Code Implementation
Provide the complete, optimal, and clean solution. Ensure the code is production-quality and fully commented line-by-line. Use the same programming language as the user's current code if provided, otherwise default to C++ or Python.
Wrap the code block in standard markdown fences (e.g., \`\`\`cpp or \`\`\`python).

## Complexity Analysis
- **Time Complexity:** O(?) with brief justification.
- **Space Complexity:** O(?) with brief justification.

## Step-by-Step Walkthrough
Walk through a simple example case tracing the variables so the user can easily visualize how the code runs.`;

    return this.generate(prompt, { maxTokens: 1800, temperature: 0.3 });
  }

  // ── Review submitted code ──────────────────────────────────────────────────
  async reviewCode(title, code, language) {
    const prompt = `Review this LeetCode solution:

**Problem:** ${title}
**Language:** ${language}

\`\`\`${language}
${(code || '').slice(0, 2000)}
\`\`\`

## Correctness
Is the logic correct? Any edge cases missed?

## Time Complexity
Big-O analysis.

## Space Complexity
Memory usage analysis.

## Improvements
How to optimise or simplify this solution.

## Rating
X/10 – one-line reason.`;

    return this.generate(prompt, { maxTokens: 800, temperature: 0.3 });
  }

  // ── Help Me Solve – for students who don't know the answer ─────────────────
  async helpMeSolve(title, description, language = '', editorTemplate = '') {
    const langHint = language ? `Use **${language}** as the programming language.` : 'Use Python or C++ as the default language.';
    const templateHint = editorTemplate?.trim() ? `**LeetCode Editor Template (You MUST write your solution inside this exact class/method structure):**\n\`\`\`${language}\n${editorTemplate}\n\`\`\`\n` : '';

    const prompt = `You are a world-class competitive programming coach and coding mentor. A student is stuck on this LeetCode problem and does NOT know how to solve it. Your job is to teach them step-by-step — from scratch — so they truly understand the solution.

**Problem:** ${title}

${(description || 'No description available.').slice(0, 2000)}

${langHint}
${templateHint}
Provide a structured, teaching-oriented response with these exact markdown sections:

## Problem Understanding
Restate the problem in simple, plain language. Explain what the input is, what the output should be, and any constraints. Use a small example to illustrate.

## Hints (Think Before You Code)
Give 3 progressive hints that guide the student toward the solution WITHOUT revealing it directly:
1. **Hint 1 (Easy):** A general direction or question to think about.
2. **Hint 2 (Medium):** Point toward the data structure or technique to use.
3. **Hint 3 (Strong):** Nearly reveal the approach, like "think about using a two-pointer technique starting from both ends."

## Approach (Step-by-Step Algorithm)
Explain the optimal algorithm in plain English, step by step, as if teaching a beginner:
- Number each step clearly (Step 1, Step 2, etc.)
- Explain WHY each step is needed
- Mention what data structure to use and why

## Pseudocode
Write clean pseudocode that the student can follow before writing real code. Use simple English-like syntax.

## Complete Solution (LeetCode-Ready)
Provide the full, working, optimal solution code. **CRITICAL REQUIREMENT**: The code must be written inside LeetCode's exact template class/method signature format (e.g. 'class Solution:' in Python, 'class Solution { ... }' in C++/Java, with matching method signatures). You MUST match the class name, method name, parameters, parameter types, and return annotations of the provided "LeetCode Editor Template" exactly. Do not invent your own class or method signatures. The code block MUST be entirely comment-free and have perfect, strict indentation (especially 4-space indentation for Python class methods) so that the user can click Insert and compile/run it on LeetCode without any modifications. Wrap the code block in proper markdown fences (e.g. \`\`\`python).

## Dry Run (Trace Through an Example)
Pick a simple example input and trace through the solution step-by-step, showing how each variable changes. Use a table or numbered steps to make it visual. This is critical for the student to understand the flow.

## Complexity Analysis
- **Time Complexity:** O(?) — explain in simple terms why.
- **Space Complexity:** O(?) — explain what extra memory is used.

## Common Mistakes to Avoid
List 2-3 common mistakes or edge cases that students frequently miss on this problem.

## Similar Problems
Suggest 2-3 similar LeetCode problems the student should practice next to reinforce this concept.`;

    return this.generate(prompt, { maxTokens: 2500, temperature: 0.35 });
  }
}
