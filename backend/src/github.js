// backend/src/github.js
// Optional GitHub Sync Service for Cloud Backend

export class GitHubService {
  constructor(token, repo, branch = 'main', folder = 'solutions') {
    this.token = (token || '').trim();
    this.repo = (repo || '').trim();
    this.branch = (branch || 'main').trim();
    this.folder = (folder || '').trim().replace(/\/$/, '');
    this.base = 'https://api.github.com';
  }

  get isConfigured() {
    return Boolean(this.token && this.repo && this.repo.includes('/'));
  }

  get headers() {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'LeetCode-Companion-Cloud-Bot'
    };
  }

  async ping() {
    if (!this.isConfigured) {
      return { ok: false, configured: false };
    }
    try {
      const res = await fetch(`${this.base}/repos/${this.repo}`, {
        headers: this.headers
      });
      if (!res.ok) return { ok: false, configured: true, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, configured: true, repo: data.full_name };
    } catch (err) {
      return { ok: false, configured: true, error: err.message };
    }
  }

  async getFileSHA(path) {
    const cleanPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.base}/repos/${this.repo}/contents/${cleanPath}?ref=${encodeURIComponent(this.branch)}&_t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        ...this.headers,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
      cache: 'no-store'
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch (_) { err = {}; }
      throw new Error(`GitHub: ${err?.message || 'Failed to fetch file SHA'}`);
    }
    const data = await res.json();
    return data.sha;
  }

  /**
   * Syncs accepted code to GitHub.
   * If GitHub is not configured, returns { synced: false, reason: 'Not configured' } without error.
   */
  async syncSolution(title, difficulty, language, code, description = '') {
    if (!this.isConfigured) {
      return { synced: false, reason: 'GitHub not configured' };
    }

    const extMap = {
      python: 'py', python3: 'py', py: 'py',
      cpp: 'cpp', 'c++': 'cpp',
      java: 'java',
      javascript: 'js', js: 'js',
      typescript: 'ts', ts: 'ts',
      golang: 'go', go: 'go',
      csharp: 'cs', cs: 'cs',
      rust: 'rs', rs: 'rs',
      c: 'c'
    };

    const ext = extMap[(language || '').toLowerCase().trim()] || 'txt';
    const cleanTitle = (title || 'solution')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const folderPrefix = this.folder ? `${this.folder}/` : '';
    const filePath = `${folderPrefix}${cleanTitle}.${ext}`;
    const commitMsg = `✅ ${title} (${difficulty}) - [${language.toUpperCase()}]`;

    // Format file content with header
    const fileContent = `/**\n * Problem: ${title} (${difficulty})\n * Language: ${language}\n *\n * Description:\n * ${(description || '').replace(/\n/g, '\n * ')}\n */\n\n${code}\n`;

    const cleanPath = filePath.split('/').map(encodeURIComponent).join('/');
    let sha = await this.getFileSHA(filePath);
    const url = `${this.base}/repos/${this.repo}/contents/${cleanPath}`;

    const body = {
      message: commitMsg,
      content: Buffer.from(fileContent, 'utf8').toString('base64'),
      branch: this.branch
    };
    if (sha) body.sha = sha;

    let res = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch (_) { err = {}; }
      const errMsg = err?.message || `HTTP ${res.status}`;

      // Conflict self-healing
      const conflictSha = errMsg.match(/does not match ([a-f0-9]{40})/i)?.[1];
      if (conflictSha || res.status === 409) {
        body.sha = conflictSha || (await this.getFileSHA(filePath));
        res = await fetch(url, {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify(body)
        });
      }

      if (!res.ok) {
        let retryErr;
        try { retryErr = await res.json(); } catch (_) { retryErr = {}; }
        throw new Error(`GitHub Sync Error: ${retryErr?.message || errMsg}`);
      }
    }

    const commitData = await res.json();
    return {
      synced: true,
      commitUrl: commitData?.commit?.html_url || `https://github.com/${this.repo}/blob/${this.branch}/${filePath}`
    };
  }
}
