// detector.js – Detects accepted submissions on LeetCode and auto-syncs to GitHub

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let lastUrl        = location.href;
  let hasReported    = false;   // per-page guard
  let checkInterval  = null;
  let observer       = null;
  let lastSubmitTime = 0;

  // ── Context Check & Cleanup ────────────────────────────────────────────────
  function checkContext() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      cleanup();
      return false;
    }
    return true;
  }

  function cleanup() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ── Page helpers ──────────────────────────────────────────────────────────
  function isProblemPage() {
    return /leetcode\.com\/problems\/[^/]+/.test(location.href);
  }

  function getDescription() {
    const el = document.querySelector('[data-track-load="description_content"]')
             || document.querySelector('.question-content')
             || document.querySelector('div[class*="description"]');
    return el ? el.innerText.slice(0, 20000) : '';
  }

  function getProblemSlug() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : '';
  }

  function getProblemTitle() {
    // Try multiple selectors used by different LeetCode versions
    const tries = [
      () => document.querySelector('[data-cy="question-title"]')?.textContent.trim(),
      () => document.querySelector('a[class*="title"]')?.textContent.trim(),
      () => document.querySelector('div[class*="title__"] a')?.textContent.trim(),
      () => document.querySelector('.text-title-large')?.textContent.trim(),
      () => document.title.replace(/\s*-\s*LeetCode.*/, '').trim(),
      () => {
        const slug = getProblemSlug();
        return slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
      },
    ];
    for (const fn of tries) {
      try { const v = fn(); if (v) return v; } catch (_) {}
    }
    return 'Unknown Problem';
  }

  function getDifficulty() {
    // 1. Look for a span/div whose sole text is exactly Easy/Medium/Hard
    const allEls = document.querySelectorAll('span, div, p');
    for (const el of allEls) {
      const t = el.textContent.trim();
      if (t === 'Easy' || t === 'Medium' || t === 'Hard') return t;
    }
    return 'Unknown';
  }

  function getLanguage() {
    // LeetCode 2024 – language shown in a button inside the editor toolbar
    const candidates = [
      document.querySelector('button[id*="headlessui-listbox-button"]'),
      document.querySelector('.ant-select-selection-item'),
      // newer LeetCode: a span that says "Python3", "JavaScript", etc. near editor
      ...[...document.querySelectorAll('button')].filter(b =>
        /^(Python3?|JavaScript|TypeScript|Java|C\+\+|C#?|Go|Rust|Kotlin|Swift|Ruby|Scala)$/i
          .test(b.textContent.trim())
      ),
    ].filter(Boolean);

    const raw = candidates[0]?.textContent.trim().toLowerCase() || '';
    const map = {
      python: 'py', python3: 'py', javascript: 'js', typescript: 'ts',
      java: 'java', 'c++': 'cpp', c: 'c', 'c#': 'cs', go: 'go',
      rust: 'rs', kotlin: 'kt', swift: 'swift', ruby: 'rb', scala: 'scala',
    };
    return map[raw] || raw || 'txt';
  }

  // ── Robust "Accepted" detection ───────────────────────────────────────────
  // Strategy 1 – look for a DOM element whose text is exactly "Accepted"
  //              (no strict children.length check – LeetCode wraps it in spans)
  function isAcceptedInDOM() {
    const els = document.querySelectorAll('span, div, p, h5, h4');
    for (const el of els) {
      if (el.textContent.trim() === 'Accepted') return true;
    }
    return false;
  }

  // Strategy 2 – URL-based: LeetCode navigates to /submissions/<id>/ on accept
  function isAcceptedByURL() {
    return /\/submissions\/\d+\/?$/.test(location.href);
  }

  // Strategy 3 – look for a green check SVG or "Accepted" in the result banner
  function isAcceptedByBanner() {
    // "You have solved this problem!" banner
    const banner = document.querySelector('[class*="success"], [class*="accepted"]');
    if (banner) return true;
    // Result tabs: "Accepted" tab is selected
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    return tabs.some(t => t.textContent.trim() === 'Accepted' &&
                          t.getAttribute('aria-selected') === 'true');
  }

  function isAccepted() {
    return isAcceptedInDOM() || isAcceptedByURL() || isAcceptedByBanner();
  }

  // ── Code extraction ───────────────────────────────────────────────────────
  // Monaco editor stores lines in .view-line elements – join them properly
  async function getFullMonacoCode() {
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.id = 'lc-companion-extract-comm-div';
      document.body.appendChild(div);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        div.remove();
      };

      div.addEventListener('lc-code-extracted', () => {
        const code = div.dataset.code || '';
        cleanup();
        resolve(code);
      });

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/content/editor-injector.js');
      (document.head || document.documentElement).appendChild(script);

      setTimeout(() => {
        if (!cleanedUp) {
          const code = div.dataset.code || '';
          cleanup();
          resolve(code);
        }
      }, 100);
    });
  }

  async function getEditorCode() {
    try {
      const monacoCode = await getFullMonacoCode();
      if (monacoCode && monacoCode.trim()) return monacoCode;
    } catch (_) {}

    // Method 1: Monaco view-lines (each .view-line is one line)
    const viewLines = document.querySelectorAll('.view-line');
    if (viewLines.length > 0) {
      return [...viewLines].map(l => l.textContent).join('\n');
    }
    // Method 2: CodeMirror
    const cm = document.querySelector('.CodeMirror');
    if (cm?.CodeMirror) return cm.CodeMirror.getValue();
    // Method 3: textarea fallback
    const ta = document.querySelector('textarea.inputarea');
    if (ta) return ta.value;
    return '';
  }

  // ── Report accepted submission ────────────────────────────────────────────
  async function reportAccepted() {
    if (!checkContext()) return;
    if (hasReported) return;
    
    // Only report if submit button clicked or keyboard shortcut pressed within the last 120s
    const timeSinceSubmit = Date.now() - lastSubmitTime;
    if (timeSinceSubmit > 120000) {
      console.log('[LC-AI] Skipping accepted report: no recent submit click/shortcut detected (old submission page loaded or tab reloaded).');
      return;
    }
    
    hasReported = true;

    const title       = getProblemTitle();
    const difficulty  = getDifficulty();
    const language    = getLanguage();
    const code        = await getEditorCode();
    const slug        = getProblemSlug();
    const description = getDescription();

    console.log('[LC-AI] Accepted detected:', { title, difficulty, language, slug, codeLen: code.length });

    // Always update stats
    chrome.runtime.sendMessage({
      type:    'ACCEPTED_SUBMISSION',
      payload: { title, difficulty, language, code, slug, description },
    }, res => {
      if (chrome.runtime.lastError) {
        console.warn('[LC-AI] Message error:', chrome.runtime.lastError.message);
      } else {
        console.log('[LC-AI] Background responded:', res);
      }
    });
  }

  // ── URL change watcher (LeetCode is a React SPA) ──────────────────────────
  function handleUrlChange() {
    if (!checkContext()) return;
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;

    console.log('[LC-AI] URL changed:', lastUrl, '→', currentUrl);
    lastUrl     = currentUrl;
    hasReported = false;   // reset for new page

    // Slight delay so React can render the result
    setTimeout(() => {
      if (isProblemPage() && isAccepted()) {
        reportAccepted();
      }
    }, 1500);
  }

  // ── Polling check (catches DOM updates that don't change the URL) ─────────
  function pollCheck() {
    if (!checkContext()) return;
    if (!isProblemPage() || hasReported) return;
    if (isAccepted()) reportAccepted();
  }

  // ── Track Submit Events (Button Clicks & Keyboard Shortcuts) ────────────────
  document.addEventListener('click', (e) => {
    if (!checkContext()) return;
    const btn = e.target.closest('[data-cy="submit-code-btn"]') || 
                e.target.closest('button[class*="submit"]') ||
                (e.target.tagName === 'BUTTON' && e.target.textContent.trim().toLowerCase().includes('submit'));
    if (btn) {
      lastSubmitTime = Date.now();
      console.log('[LC-AI] Submit click detected at:', lastSubmitTime);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!checkContext()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      lastSubmitTime = Date.now();
      console.log('[LC-AI] Submit keydown shortcut (Ctrl/Cmd+Enter) detected at:', lastSubmitTime);
    }
  });

  // ── Observe DOM mutations (catches SPA navigations + result rendering) ─────
  observer = new MutationObserver(() => {
    if (!checkContext()) return;
    handleUrlChange();
    if (!hasReported && isProblemPage()) pollCheck();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree:   true,
  });

  // Fallback polling every 2 s
  checkInterval = setInterval(pollCheck, 2000);

  // Initial check (in case page already shows "Accepted" on load)
  setTimeout(pollCheck, 1000);

  // Cleanup
  window.addEventListener('pagehide', () => {
    cleanup();
  });

  console.log('[LC-AI] detector.js loaded on', location.href);
})();
