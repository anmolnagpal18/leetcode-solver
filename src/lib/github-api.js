// github-api.js – Wrapper for the GitHub REST API

export class GitHubAPI {
  /**
   * @param {string} token  - Personal Access Token with repo scope
   * @param {string} repo   - "owner/repo" format
   * @param {string} branch - target branch (default: "main")
   */
  constructor(token, repo, branch = 'main') {
    this.token  = token;
    this.repo   = repo;
    this.branch = branch;
    this.base   = 'https://api.github.com';
  }

  get headers() {
    return {
      Authorization:        `token ${this.token}`,
      Accept:               'application/vnd.github.v3+json',
      'Content-Type':       'application/json',
    };
  }

  // ── Get current file SHA (needed for updates) ──────────────────────────────
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
      throw new Error(`GitHub: ${err?.message || 'Failed to fetch file metadata'}`);
    }
    const data = await res.json();
    return data.sha;
  }

  // ── Create or update a file ────────────────────────────────────────────────
  async createOrUpdateFile(path, content, message) {
    const cleanPath = path.split('/').map(encodeURIComponent).join('/');
    let sha = await this.getFileSHA(path);
    const url = `${this.base}/repos/${this.repo}/contents/${cleanPath}`;

    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(content))), // UTF-8 → base64
      branch:  this.branch,
    };
    if (sha) body.sha = sha; // required for updates

    let res = await fetch(url, {
      method:  'PUT',
      headers: this.headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch (_) { err = {}; }
      const errMsg = err?.message || `HTTP ${res.status}`;

      // If SHA conflicted (e.g. "does not match <sha>" or 409 conflict), resolve with exact SHA and retry
      const conflictSha = errMsg.match(/does not match ([a-f0-9]{40})/i)?.[1];
      if (conflictSha || res.status === 409) {
        body.sha = conflictSha || (await this.getFileSHA(path));
        res = await fetch(url, {
          method:  'PUT',
          headers: this.headers,
          body:    JSON.stringify(body),
        });
      }

      if (!res.ok) {
        let retryErr;
        try { retryErr = await res.json(); } catch (_) { retryErr = {}; }
        throw new Error(`GitHub: ${retryErr?.message || errMsg}`);
      }
    }
    return res.json();
  }

  // ── List files in a folder ────────────────────────────────────────────────
  async listFolder(path = '') {
    const url = `${this.base}/repos/${this.repo}/contents/${path}?ref=${this.branch}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`GitHub: ${err.message}`);
    }
    return res.json(); // array of file/dir objects
  }

  // ── Verify token & repo access ────────────────────────────────────────────
  async ping() {
    const url = `${this.base}/repos/${this.repo}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`GitHub: ${err.message}`);
    }
    return res.json();
  }
}
