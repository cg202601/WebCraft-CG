document.addEventListener('DOMContentLoaded', () => {
  const openOptionsBtn = document.getElementById('openOptions');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const nameInput = document.getElementById('customName');
  const screenshotStatus = document.getElementById('screenshotStatus');
  const btnVisible = document.getElementById('btnCaptureVisible');
  const btnFull = document.getElementById('btnCaptureFull');
  const btnStartRecording = document.getElementById('btnStartRecording');
  const manualCaptureCheckbox = document.getElementById('manualCaptureMode');
  const customToolsContainer = document.getElementById('customToolsContainer');
  const addCustomToolBtn = document.getElementById('addCustomTool');
  const customToolPanel = document.getElementById('customToolPanel');
  const customToolInput = document.getElementById('customToolInput');
  const confirmCustomToolBtn = document.getElementById('confirmCustomTool');
  const cancelCustomToolBtn = document.getElementById('cancelCustomTool');
  const footerText = document.getElementById('footerText');
  const translateEngineRadios = document.querySelectorAll('input[name="translateEngine"]');
  const deeplEngineDesc = document.getElementById('deeplEngineDesc');
  const translateEnabledCheckbox = document.getElementById('translateEnabled');
  const translateShortcutSelect = document.getElementById('translateShortcut');
  const translateTargetLangSelect = document.getElementById('translateTargetLang');
  const youtubeUrlInput = document.getElementById('youtubeUrl');
  const btnDownloadThumbnail = document.getElementById('btnDownloadThumbnail');
  const youtubeStatus = document.getElementById('youtubeStatus');
  const playlistUrlInput = document.getElementById('playlistUrl');
  const btnBatchDownload = document.getElementById('btnBatchDownload');
  const recommendationModeRadios = document.querySelectorAll('input[name="recommendationsMode"]');
  const recommendationsWhitelistGroup = document.getElementById('recommendationsWhitelistGroup');
  const recommendationsWhitelistInput = document.getElementById('recommendationsWhitelist');

  const DEFAULT_TOOLS = ['Midjourney生成', 'Firefly生成', '购买Gemini生成', 'Flow Ultra版', 'Flow Pro版'];

  openOptionsBtn?.addEventListener('click', () => {
    const fallbackUrl = chrome.runtime.getURL('options.html');
    try {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) chrome.tabs.create({ url: fallbackUrl });
      });
    } catch (error) {
      chrome.tabs.create({ url: fallbackUrl });
    }
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      tabBtns.forEach(item => item.classList.toggle('active', item === btn));
      tabContents.forEach(content => content.classList.toggle('active', content.id === `tab-${targetTab}`));
      chrome.storage.local.set({ activeTab: targetTab });
      updateFooter();
    });
  });

  function showScreenshotStatus(text, type = '') {
    screenshotStatus.textContent = text;
    screenshotStatus.className = `status-message ${type}`;
    if (type === 'success') setTimeout(() => { screenshotStatus.textContent = ''; }, 1800);
  }

  function showYoutubeStatus(text, type = '') {
    youtubeStatus.textContent = text;
    youtubeStatus.className = `status-message ${type}`;
  }

  function getName() {
    return nameInput.value.trim() || '未命名';
  }

  function getFormat() {
    return document.querySelector('input[name="format"]:checked')?.value || 'jpg';
  }

  function getTool() {
    return document.querySelector('input[name="tool"]:checked')?.value || 'Midjourney生成';
  }

  function renderCustomTools(customTools = [], selectedTool = '') {
    customToolsContainer.textContent = '';
    customTools.forEach((toolName, index) => {
      const label = document.createElement('label');
      label.className = 'radio-item custom-item';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'tool';
      radio.value = toolName;
      radio.checked = selectedTool === toolName;
      radio.addEventListener('change', () => chrome.storage.local.set({ tool: toolName }));

      const text = document.createTextNode(` ${toolName} `);
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.title = '删除此选项';
      deleteBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        chrome.storage.local.get(['customTools', 'tool'], (result) => {
          const nextTools = (result.customTools || []).filter((_, itemIndex) => itemIndex !== index);
          const patch = { customTools: nextTools };
          if (result.tool === toolName) patch.tool = 'Midjourney生成';
          chrome.storage.local.set(patch, () => renderCustomTools(nextTools, patch.tool || result.tool));
        });
      });

      label.appendChild(radio);
      label.appendChild(text);
      label.appendChild(deleteBtn);
      customToolsContainer.appendChild(label);
    });
  }

  addCustomToolBtn.addEventListener('click', () => {
    customToolPanel.style.display = 'block';
    customToolInput.value = '';
    customToolInput.focus();
  });

  cancelCustomToolBtn.addEventListener('click', () => {
    customToolPanel.style.display = 'none';
    customToolInput.value = '';
  });

  confirmCustomToolBtn.addEventListener('click', () => {
    const newToolName = customToolInput.value.trim();
    if (!newToolName) return customToolInput.focus();
    chrome.storage.local.get(['customTools'], (result) => {
      const customTools = result.customTools || [];
      const exists = [...DEFAULT_TOOLS, ...customTools].includes(newToolName);
      if (!exists) customTools.push(newToolName);
      chrome.storage.local.set({ customTools, tool: newToolName }, () => {
        renderCustomTools(customTools, newToolName);
        customToolPanel.style.display = 'none';
      });
    });
  });

  customToolInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirmCustomToolBtn.click();
    if (event.key === 'Escape') cancelCustomToolBtn.click();
  });

  document.querySelectorAll('input[name="tool"]').forEach(radio => {
    radio.addEventListener('change', event => chrome.storage.local.set({ tool: event.target.value }));
  });

  document.querySelectorAll('input[name="format"]').forEach(radio => {
    radio.addEventListener('change', event => chrome.storage.local.set({ format: event.target.value }));
  });

  nameInput.addEventListener('input', () => chrome.storage.local.set({ customName: nameInput.value }));
  manualCaptureCheckbox.addEventListener('change', event => chrome.storage.local.set({ manualCaptureMode: event.target.checked }));

  chrome.storage.local.get([
    'customName',
    'format',
    'tool',
    'activeTab',
    'customTools',
    'manualCaptureMode',
    'translateEnabled',
    'translateShortcut',
    'translateTargetLang',
    'translateEngine',
    'deeplApiKey',
    'youtubeRecommendationsMode',
    'youtubeRecommendationsWhitelist'
  ], (result) => {
    if (result.customName) nameInput.value = result.customName;
    if (result.format) document.querySelector(`input[name="format"][value="${result.format}"]`)?.click();
    if (result.tool) {
      const toolRadio = Array.from(document.querySelectorAll('input[name="tool"]')).find(radio => radio.value === result.tool);
      if (toolRadio) toolRadio.checked = true;
    }
    renderCustomTools(result.customTools || [], result.tool);
    manualCaptureCheckbox.checked = !!result.manualCaptureMode;
    translateEnabledCheckbox.checked = result.translateEnabled !== false;
    if (result.translateShortcut) translateShortcutSelect.value = result.translateShortcut;
    if (result.translateTargetLang) translateTargetLangSelect.value = result.translateTargetLang;
    updateTranslateEngineSelection(result.translateEngine || 'google', !!result.deeplApiKey);
    updateStatusCard(translateEnabledCheckbox.checked);
    applyRecommendationMode(result.youtubeRecommendationsMode || 'enabled');
    recommendationsWhitelistInput.value = result.youtubeRecommendationsWhitelist || '';

    if (result.activeTab) {
      const tab = document.querySelector(`.tab-btn[data-tab="${result.activeTab}"]`);
      if (tab) tab.click();
    } else {
      updateFooter();
    }
  });

  chrome.storage.local.get(['screenshotModuleEnabled', 'recordingModuleEnabled', 'youtubeToolsEnabled'], (result) => {
    const screenshotEnabled = result.screenshotModuleEnabled !== false;
    const recordingEnabled = result.recordingModuleEnabled !== false;
    const youtubeEnabled = result.youtubeToolsEnabled !== false;
    btnVisible.disabled = !screenshotEnabled;
    btnFull.disabled = !screenshotEnabled;
    btnStartRecording.disabled = !recordingEnabled;
    btnDownloadThumbnail.disabled = !youtubeEnabled;
    btnBatchDownload.disabled = !youtubeEnabled;
  });

  btnVisible.addEventListener('click', () => {
    if (btnVisible.disabled) return;
    showScreenshotStatus('正在截图...');
    chrome.runtime.sendMessage({
      action: 'captureVisible',
      payload: { name: getName(), format: getFormat(), tool: getTool() }
    }, () => window.close());
  });

  btnFull.addEventListener('click', () => {
    if (btnFull.disabled) return;
    showScreenshotStatus('正在准备长截图...');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'startFullCapture',
        payload: {
          name: getName(),
          format: getFormat(),
          tool: getTool(),
          manualMode: manualCaptureCheckbox.checked,
          startFromCurrent: manualCaptureCheckbox.checked
        }
      }, () => setTimeout(() => window.close(), 100));
    });
  });

  btnStartRecording.addEventListener('click', () => {
    if (btnStartRecording.disabled) return;
    showScreenshotStatus('正在启动录屏...');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'startRegionSelector',
        payload: { name: getName(), tool: getTool() }
      }, () => setTimeout(() => window.close(), 100));
    });
  });

  translateEnabledCheckbox.addEventListener('change', event => {
    const enabled = event.target.checked;
    chrome.storage.local.set({ translateEnabled: enabled }, () => {
      notifyTranslateTabs({ enabled });
      updateStatusCard(enabled);
    });
  });

  translateShortcutSelect.addEventListener('change', event => {
    chrome.storage.local.set({ translateShortcut: event.target.value }, () => notifyTranslateTabs({ shortcut: event.target.value }));
  });

  translateTargetLangSelect.addEventListener('change', event => {
    chrome.storage.local.set({ translateTargetLang: event.target.value }, () => notifyTranslateTabs({ targetLang: event.target.value }));
  });

  translateEngineRadios.forEach(radio => {
    radio.addEventListener('change', event => {
      chrome.storage.local.set({ translateEngine: event.target.value }, () => {
        updateTranslateEngineSelection(event.target.value, null);
        notifyTranslateTabs({ engine: event.target.value });
        updateFooter();
      });
    });
  });

  function updateStatusCard(enabled) {
    const statusText = document.querySelector('.status-text');
    const statusIndicator = document.querySelector('.status-indicator');
    statusText.textContent = enabled ? '翻译功能已启用' : '翻译功能已关闭';
    statusIndicator.classList.toggle('active', enabled);
    statusIndicator.style.background = enabled ? '#4CAF50' : '#ccc';
  }

  function updateTranslateEngineSelection(engine, hasDeepLKey) {
    translateEngineRadios.forEach(radio => { radio.checked = radio.value === engine; });
    if (hasDeepLKey !== null) {
      deeplEngineDesc.textContent = hasDeepLKey ? '质量优先，失败回退 Google' : '请到设置页填写 API Key';
    }
  }

  function notifyTranslateTabs(payload) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateTranslateSettings', payload }, () => void chrome.runtime.lastError);
      });
    });
  }

  function updateFooter() {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'translate') {
      chrome.storage.local.get(['translateEngine'], result => {
        footerText.textContent = result.translateEngine === 'deepl' ? 'Powered by DeepL API' : 'Powered by Google Translate';
      });
    } else if (activeTab === 'youtube') {
      footerText.textContent = 'YouTube 缩略图下载';
    } else {
      footerText.textContent = '快捷键 Ctrl+Shift+S 截图';
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(response);
      });
    });
  }

  function getSafeYoutubeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      const isYoutubeHost = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
      if (!isYoutubeHost || !['http:', 'https:'].includes(parsed.protocol)) return null;
      parsed.protocol = 'https:';
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function extractVideoId(url) {
    const parsed = getSafeYoutubeUrl(url);
    if (!parsed) return null;
    const valid = value => /^[a-zA-Z0-9_-]{11}$/.test(value || '');
    const host = parsed.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = parsed.pathname.split('/').filter(Boolean)[0];
    else if (parsed.pathname === '/watch') id = parsed.searchParams.get('v');
    else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
    }
    return valid(id) ? id : null;
  }

  function sanitizeDownloadFilename(name, fallback = 'video') {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    return (cleaned || fallback).slice(0, 150);
  }

  function getDateForFilename() {
    const date = new Date();
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }

  function buildYoutubeFilename(template, { channel, title, id }) {
    const base = (template || '{channel}-{title}-{date}')
      .replaceAll('{channel}', sanitizeDownloadFilename(channel, '未知频道'))
      .replaceAll('{title}', sanitizeDownloadFilename(title, `video_${id}`))
      .replaceAll('{date}', getDateForFilename())
      .replaceAll('{id}', sanitizeDownloadFilename(id, 'video'));
    return `${sanitizeDownloadFilename(base, `video_${id}`)}.jpg`;
  }

  btnDownloadThumbnail.addEventListener('click', async () => {
    const url = youtubeUrlInput.value.trim();
    const videoId = extractVideoId(url);
    if (!videoId) return showYoutubeStatus('无法识别 YouTube 视频链接', 'error');
    btnDownloadThumbnail.disabled = true;
    showYoutubeStatus('正在下载...', 'info');

    const template = await new Promise(resolve => {
      chrome.storage.local.get(['youtubeThumbnailFilenameTemplate'], result => resolve(result.youtubeThumbnailFilenameTemplate || '{channel}-{title}-{date}'));
    });
    const filename = buildYoutubeFilename(template, { channel: 'YouTube', title: videoId, id: videoId });
    const response = await sendRuntimeMessage({
      action: 'downloadThumbnail',
      payload: { url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, filename }
    });
    btnDownloadThumbnail.disabled = false;
    showYoutubeStatus(response?.success ? '下载成功' : (response?.error || '下载失败'), response?.success ? 'success' : 'error');
  });

  btnBatchDownload.addEventListener('click', async () => {
    const safeUrl = getSafeYoutubeUrl(playlistUrlInput.value.trim());
    if (!safeUrl || safeUrl.hostname === 'youtu.be') return showYoutubeStatus('请提供有效的 YouTube 列表或频道链接', 'error');
    const limit = Number(document.querySelector('input[name="batchLimit"]:checked')?.value || 50);
    btnBatchDownload.disabled = true;
    showYoutubeStatus('正在分析页面...', 'info');
    try {
      const response = await fetch(safeUrl.toString());
      if (!response.ok) throw new Error('无法访问链接');
      const text = await response.text();
      const ids = [...new Set([...text.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(match => match[1]))].slice(0, limit);
      if (!ids.length) throw new Error('未找到公开视频');
      const template = await new Promise(resolve => {
        chrome.storage.local.get(['youtubeThumbnailFilenameTemplate'], result => resolve(result.youtubeThumbnailFilenameTemplate || '{channel}-{title}-{date}'));
      });
      ids.forEach(id => {
        sendRuntimeMessage({
          action: 'downloadThumbnail',
          payload: {
            url: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
            filename: buildYoutubeFilename(template, { channel: 'YouTube', title: id, id })
          }
        });
      });
      showYoutubeStatus(`已开始下载 ${ids.length} 张缩略图`, 'success');
    } catch (error) {
      showYoutubeStatus(error.message || '批量下载失败', 'error');
    } finally {
      btnBatchDownload.disabled = false;
    }
  });

  function applyRecommendationMode(mode) {
    recommendationModeRadios.forEach(radio => { radio.checked = radio.value === mode; });
    recommendationsWhitelistGroup.style.display = mode === 'whitelist' ? 'block' : 'none';
  }

  function notifyYoutubeTabs(payload) {
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateYoutubeRecommendationsSettings', payload }, () => void chrome.runtime.lastError);
      });
    });
  }

  recommendationModeRadios.forEach(radio => {
    radio.addEventListener('change', event => {
      const mode = event.target.value;
      chrome.storage.local.set({ youtubeRecommendationsMode: mode }, () => {
        applyRecommendationMode(mode);
        notifyYoutubeTabs({ mode });
      });
    });
  });

  recommendationsWhitelistInput.addEventListener('input', () => {
    const whitelist = recommendationsWhitelistInput.value;
    chrome.storage.local.set({ youtubeRecommendationsWhitelist: whitelist }, () => notifyYoutubeTabs({ whitelist }));
  });

  youtubeUrlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') btnDownloadThumbnail.click();
  });
});
