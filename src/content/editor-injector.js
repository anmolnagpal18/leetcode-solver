(function() {
  try {
    const commDiv = document.getElementById('lc-companion-comm-div');
    if (commDiv) {
      const code = commDiv.dataset.code;
      if (typeof window.monaco !== 'undefined' && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          models[0].setValue(code);
        }
      }
      commDiv.remove();
    }

    const extractDiv = document.getElementById('lc-companion-extract-comm-div');
    if (extractDiv) {
      if (typeof window.monaco !== 'undefined' && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          extractDiv.dataset.code = models[0].getValue();
        }
      }
      extractDiv.dispatchEvent(new CustomEvent('lc-code-extracted'));
    }
  } catch (err) {
    console.error('[LC-Companion] Monaco bridge error:', err);
  }

  const scripts = document.getElementsByTagName('script');
  for (let s of scripts) {
    if (s.src && s.src.includes('editor-injector.js')) {
      s.remove();
      break;
    }
  }
})();
