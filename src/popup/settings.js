// settings.js – LeetCode Companion

function $(id) { return document.getElementById(id); }

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success', duration = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, duration);
}

// ── Toggle password visibility ────────────────────────────────────────────────
document.querySelectorAll('.toggle-vis').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
});

// ── Load saved values ─────────────────────────────────────────────────────────
function loadSettings() {
  const logoEl = $('settings-logo');
  if (logoEl) logoEl.src = chrome.runtime.getURL('assets/icons/icon128.png');

  chrome.storage.sync.get(
    ['grokApiKey', 'githubToken', 'githubRepo', 'githubBranch', 'githubFolder', 'autoSync',
     'telegramEnabled', 'telegramBotToken', 'telegramChatId', 'telegramCloudMode'],
    data => {
      if (data.grokApiKey) {
        $('grok-key').value = data.grokApiKey;
        $('grok-badge').textContent = 'Configured';
        $('grok-badge').className = 'status-badge ok';
      }
      if (data.githubToken) {
        $('github-token').value = data.githubToken;
        $('github-badge').textContent = 'Configured';
        $('github-badge').className = 'status-badge ok';
      }
      if (data.githubRepo)   $('github-repo').value   = data.githubRepo;
      if (data.githubBranch) $('github-branch').value = data.githubBranch;
      if (data.githubFolder) $('github-folder').value = data.githubFolder;
      $('auto-sync').checked = !!data.autoSync;

      // Telegram settings
      $('telegram-enabled').checked = !!data.telegramEnabled;
      $('telegram-cloud-mode').checked = !!data.telegramCloudMode;
      if (data.telegramBotToken) {
        $('telegram-token').value = data.telegramBotToken;
        $('telegram-badge').textContent = 'Configured';
        $('telegram-badge').className = 'status-badge ok';
      }
      if (data.telegramChatId) $('telegram-chatid').value = data.telegramChatId;
    }
  );
}

// ── Save ──────────────────────────────────────────────────────────────────────
$('btn-save').addEventListener('click', () => {
  const settings = {
    grokApiKey:        $('grok-key').value.trim(),
    githubToken:       $('github-token').value.trim(),
    githubRepo:        $('github-repo').value.trim(),
    githubBranch:      $('github-branch').value.trim() || 'main',
    githubFolder:      $('github-folder').value.trim(),
    autoSync:          $('auto-sync').checked,
    telegramEnabled:   $('telegram-enabled').checked,
    telegramCloudMode: $('telegram-cloud-mode').checked,
    telegramBotToken:  $('telegram-token').value.trim(),
    telegramChatId:    $('telegram-chatid').value.trim(),
  };

  if (!settings.grokApiKey)   return showToast('⚠ Grok API key is required.', 'error');
  if (!settings.githubToken)  return showToast('⚠ GitHub token is required.', 'error');
  if (!settings.githubRepo)   return showToast('⚠ GitHub repo is required.', 'error');

  if (settings.telegramEnabled) {
    if (!settings.telegramBotToken) return showToast('⚠ Telegram Bot token is required when enabled.', 'error');
    if (!settings.telegramChatId)   return showToast('⚠ Telegram Chat ID is required when enabled.', 'error');
  }

  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      showToast('❌ Failed to save: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showToast('✅ Settings saved!', 'success');
      $('grok-badge').textContent = 'Configured'; $('grok-badge').className = 'status-badge ok';
      $('github-badge').textContent = 'Configured'; $('github-badge').className = 'status-badge ok';
      if (settings.telegramBotToken) {
        $('telegram-badge').textContent = 'Configured'; $('telegram-badge').className = 'status-badge ok';
      } else {
        $('telegram-badge').textContent = 'Not set'; $('telegram-badge').className = 'status-badge bad';
      }
    }
  });
});

// ── Test Groq API Key ────────────────────────────────────────────
const GROQ_MODELS = [
  'qwen/qwen3.8-27b',
  'groq/compound',
  'groq/compound-mini',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];
const GROQ_BASE   = 'https://api.groq.com/openai/v1';

async function testGroqKey(apiKey) {
  for (const model of GROQ_MODELS) {
    let res;
    try {
      res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with just the word OK' }],
          max_tokens: 5,
        }),
      });
    } catch (e) {
      return { success: false, fatal: true, error: `Network error: ${e.message}` };
    }

    let body;
    try { body = await res.json(); } catch (_) { body = {}; }

    if (res.ok) {
      const text = body?.choices?.[0]?.message?.content?.trim();
      if (text) return { success: true, model };
    }

    const errMsg = body?.error?.message || `HTTP ${res.status}`;

    // Invalid key → stop
    if (res.status === 401 || res.status === 403) {
      return { success: false, fatal: true, error: `Invalid API key (${res.status}): ${errMsg}` };
    }
    // Model issue → try next
  }
  return { success: false, error: 'No working Groq model found for this API key.' };
}

$('btn-test-grok').addEventListener('click', async () => {
  const apiKey = $('grok-key').value.trim();
  if (!apiKey) return showToast('⚠ Enter your Groq API key first.', 'error');
  if (!apiKey.startsWith('gsk_')) {
    showToast('⚠ Groq keys start with "gsk_". Please check your key.', 'error');
    return;
  }

  showToast('🔄 Testing Groq API…', 'success', 10000);
  const result = await testGroqKey(apiKey);

  if (result.success) {
    showToast(`✅ Groq works! Using: ${result.model}`, 'success', 5000);
    $('grok-badge').textContent = result.model;
    $('grok-badge').className = 'status-badge ok';
  } else {
    showToast(`❌ ${result.error}`, 'error', 6000);
    $('grok-badge').textContent = 'Error';
    $('grok-badge').className = 'status-badge bad';
  }
});

// ── Test GitHub Connection ────────────────────────────────────────────────────
$('btn-test').addEventListener('click', async () => {
  const token = $('github-token').value.trim();
  const repo  = $('github-repo').value.trim();
  if (!token || !repo) return showToast('⚠ Fill in GitHub token and repo first.', 'error');

  showToast('🔄 Testing GitHub…', 'success', 10000);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }

    if (res.ok) {
      showToast(`✅ GitHub connected: ${data.full_name}`, 'success');
    } else {
      showToast(`❌ ${data.message || 'Connection failed'}`, 'error');
    }
  } catch (e) {
    showToast('❌ Network error: ' + e.message, 'error');
  }
});

// ── Test Telegram Connection ──────────────────────────────────────────────────
$('btn-test-telegram').addEventListener('click', async () => {
  const token  = $('telegram-token').value.trim();
  const chatId = $('telegram-chatid').value.trim();
  if (!token || !chatId) return showToast('⚠ Fill in Telegram token and Chat ID first.', 'error');

  showToast('🔄 Testing Telegram Bot connection…', 'success', 10000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🔔 *LeetCode Companion* connection test successful!',
        parse_mode: 'Markdown'
      })
    });
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }

    if (res.ok && data.ok) {
      showToast('✅ Telegram test message sent successfully!', 'success');
      $('telegram-badge').textContent = 'Verified';
      $('telegram-badge').className = 'status-badge ok';
    } else {
      showToast(`❌ ${data.description || 'Failed to send message'}`, 'error');
    }
  } catch (e) {
    showToast('❌ Network error: ' + e.message, 'error');
  }
});

// ── Clear all ─────────────────────────────────────────────────────────────────
$('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear all saved settings? This cannot be undone.')) return;
  chrome.storage.sync.clear(() => {
    ['grok-key', 'github-token', 'github-repo', 'github-branch', 'github-folder', 'telegram-token', 'telegram-chatid']
      .forEach(id => { $(id).value = ''; });
    $('auto-sync').checked = false;
    $('telegram-enabled').checked = false;
    $('grok-badge').textContent = 'Not set';   $('grok-badge').className = 'status-badge bad';
    $('github-badge').textContent = 'Not set'; $('github-badge').className = 'status-badge bad';
    $('telegram-badge').textContent = 'Not set'; $('telegram-badge').className = 'status-badge bad';
    showToast('🗑 Settings cleared', 'success');
  });
});

// ── Cloud LeetCode Auth Sync ──────────────────────────────────────────────────
async function checkCloudAuthStatus() {
  const el = $('cloud-auth-status');
  if (!el) return;
  try {
    const res = await fetch('http://localhost:3000/api/auth/status');
    if (res.ok) {
      const data = await res.json();
      if (data.linked && data.username) {
        el.textContent = `🟢 Linked as @${data.username}`;
        el.style.color = '#34d399';
      } else {
        el.textContent = '⚪ Not linked to cloud bot';
        el.style.color = 'var(--text-muted)';
      }
    } else {
      el.textContent = '⚪ Cloud bot offline';
      el.style.color = 'var(--text-muted)';
    }
  } catch (_) {
    el.textContent = '⚪ Cloud bot offline';
    el.style.color = 'var(--text-muted)';
  }
}

$('btn-sync-cloud-auth').addEventListener('click', async () => {
  const btn = $('btn-sync-cloud-auth');
  const el = $('cloud-auth-status');
  btn.disabled = true;
  showToast('🔍 Reading active LeetCode session from Chrome…', 'success', 4000);

  chrome.cookies.getAll({ domain: 'leetcode.com' }, async (cookies) => {
    let session = '';
    let csrf = '';

    if (cookies && cookies.length > 0) {
      const sessionCookie = cookies.find(c => c.name === 'LEETCODE_SESSION');
      const csrfCookie = cookies.find(c => c.name === 'csrftoken');
      if (sessionCookie) session = sessionCookie.value;
      if (csrfCookie) csrf = csrfCookie.value;
    }

    if (!session || !csrf) {
      btn.disabled = false;
      return showToast('⚠ No active LeetCode session found. Please log into leetcode.com first.', 'error');
    }

    try {
      showToast('⏳ Syncing session to 24/7 Cloud Bot…', 'success', 5000);
      const res = await fetch('http://localhost:3000/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, csrfToken: csrf })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Linked LeetCode account @${data.username} to Cloud Bot!`, 'success');
        if (el) {
          el.textContent = `🟢 Linked as @${data.username}`;
          el.style.color = '#34d399';
        }
      } else {
        showToast(`❌ Cloud sync failed: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      showToast(`❌ Cannot connect to Cloud Bot on localhost:3000: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkCloudAuthStatus();
});
