const DEFAULTS = {
  screenshotModuleEnabled: true,
  translateEnabled: true,
  youtubeToolsEnabled: true,
  recordingModuleEnabled: true,
  translateEngine: 'google',
  translateTargetLang: 'auto',
  deeplApiKey: '',
  deeplApiEndpoint: 'auto',
  translateFloatingEnabled: true,
  translateSelectionOnly: true,
  translateHistoryEnabled: true,
  translationPhrases: '',
  translationHistory: [],
  recordingShowBorder: true,
  recordingMaxMinutes: 30,
  recordingMaxSizeMB: 500,
  collectorOpenOnAdd: true,
  collectorFloatingEnabled: true,
  collectorSelectionMenuEnabled: true,
  collectorPageSaveEnabled: true,
  collectorShowImageFilter: true,
  collectorShowTextFilter: true,
  collectorShowPageFilter: true,
  collectorShowLinkFilter: true,
  screenshotFilenameTemplate: '截图凭证-{tool}-{name}-{date}',
  autoCaptureIntervalSeconds: 6,
  autoCaptureDirection: 'right',
  youtubeThumbnailFilenameTemplate: '{channel}-{title}-{date}',
  youtubeHideShorts: false,
  youtubeHideLive: false,
  youtubeHideAds: false,
  hideYoutubeTranslate: false,
  youtubeBlacklist: ''
};

const SETTING_KEYS = Object.keys(DEFAULTS);
const BACKUP_KEYS = [
  ...SETTING_KEYS.filter(key => !['deeplApiKey', 'translationHistory'].includes(key)),
  'customTools', 'customName', 'format', 'tool', 'manualCaptureMode',
  'translateShortcut', 'youtubeRecommendationsMode', 'youtubeRecommendationsWhitelist'
];
const BACKUP_KEY_SET = new Set(BACKUP_KEYS);
const BUILT_IN_TOOLS = ['Midjourney生成', 'Firefly生成', '购买Gemini生成', 'Flow Ultra版', 'Flow Pro版'];

document.addEventListener('DOMContentLoaded', () => {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('versionText').textContent = `v${manifest.version}`;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
    });
  });

  chrome.storage.local.get(SETTING_KEYS, (result) => {
    const settings = { ...DEFAULTS, ...result };
    applySettingsToForm(settings);
    renderHistory(settings.translationHistory || []);
  });

  chrome.storage.local.get(['customTools'], (result) => {
    const customToolsText = document.getElementById('customToolsText');
    if (customToolsText) customToolsText.value = (result.customTools || []).join('\n');
  });

  document.querySelectorAll('[data-setting]').forEach(control => {
    control.addEventListener('change', () => saveControl(control));
    if (control.tagName === 'TEXTAREA') {
      control.addEventListener('input', () => saveControl(control));
    }
  });

  const customToolsText = document.getElementById('customToolsText');
  customToolsText?.addEventListener('input', () => {
    const customTools = customToolsText.value
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index && !BUILT_IN_TOOLS.includes(item));
    chrome.storage.local.set({ customTools });
  });

  document.getElementById('savePhrases').addEventListener('click', () => {
    saveControl(document.getElementById('translationPhrases'));
    showStatus('backupStatus', '短语已保存');
  });

  document.getElementById('clearHistory').addEventListener('click', () => {
    chrome.storage.local.set({ translationHistory: [] }, () => renderHistory([]));
  });

  document.getElementById('exportConfig').addEventListener('click', exportConfig);
  document.getElementById('importConfig').addEventListener('change', importConfig);
});

function applySettingsToForm(settings) {
  document.querySelectorAll('[data-setting]').forEach(control => {
    const key = control.dataset.setting;
    const value = settings[key];
    if (control.type === 'checkbox') {
      control.checked = value !== false;
    } else {
      control.value = value ?? DEFAULTS[key] ?? '';
    }
  });
}

function saveControl(control) {
  const key = control.dataset.setting;
  let value;
  if (control.type === 'checkbox') {
    value = control.checked;
  } else if (control.type === 'number') {
    value = Number(control.value) || DEFAULTS[key];
    if (key === 'autoCaptureIntervalSeconds') {
      value = Math.min(10, Math.max(4, Math.round(value)));
      control.value = value;
    }
  } else {
    value = control.value;
  }

  chrome.storage.local.set({ [key]: value }, () => {
    notifyTabs(key, value);
  });
}

function notifyTabs(key, value) {
  const message = {};
  if (key === 'translateEnabled') message.enabled = value;
  if (key === 'translateEngine') message.engine = value;
  if (key === 'translateTargetLang') message.targetLang = value;
  if (key === 'translateFloatingEnabled') message.floatingEnabled = value;
  if (key === 'translateSelectionOnly') message.selectionOnly = value;

  if (Object.keys(message).length > 0) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateTranslateSettings',
          payload: message
        }, () => void chrome.runtime.lastError);
      });
    });
  }

  if (['youtubeToolsEnabled', 'youtubeHideShorts', 'youtubeHideLive', 'youtubeHideAds', 'hideYoutubeTranslate', 'youtubeThumbnailFilenameTemplate', 'youtubeBlacklist'].includes(key)) {
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateYoutubeRecommendationsSettings',
          payload: { [key]: value, enabled: key === 'youtubeToolsEnabled' ? value : undefined }
        }, () => void chrome.runtime.lastError);
      });
    });
  }
}

function renderHistory(history) {
  const list = document.getElementById('historyList');
  list.textContent = '';
  if (!history.length) {
    list.textContent = '暂无翻译历史';
    return;
  }

  history.slice(0, 50).forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const source = document.createElement('div');
    source.textContent = item.source || '';
    const result = document.createElement('strong');
    result.textContent = item.result || '';
    row.appendChild(source);
    row.appendChild(result);
    list.appendChild(row);
  });
}

function exportConfig() {
  chrome.storage.local.get(BACKUP_KEYS, (settings) => {
    const exportSettings = Object.fromEntries(
      Object.entries(settings).filter(([key]) => BACKUP_KEY_SET.has(key))
    );
    const payload = {
      name: 'WebCraft 网页工坊配置',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings: exportSettings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WebCraft网页工坊配置-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus('backupStatus', '配置已导出，API Key、翻译历史和采集画布未包含在文件中');
  });
}

function sanitizeBackupSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('配置格式不正确');
  const safeSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!BACKUP_KEY_SET.has(key)) continue;
    if (key === 'customTools') {
      if (Array.isArray(value) && value.every(item => typeof item === 'string')) safeSettings[key] = value;
    } else if (Object.hasOwn(DEFAULTS, key)) {
      if (typeof value === typeof DEFAULTS[key] &&
          (typeof value !== 'number' || Number.isFinite(value))) safeSettings[key] = value;
    } else if (key === 'manualCaptureMode') {
      if (typeof value === 'boolean') safeSettings[key] = value;
    } else if (typeof value === 'string') safeSettings[key] = value;
  }
  return safeSettings;
}

function importConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const settings = parsed.settings || parsed;
      const safeSettings = sanitizeBackupSettings(settings);

      chrome.storage.local.set(safeSettings, () => {
        if (chrome.runtime.lastError) {
          showStatus('backupStatus', `导入失败：${chrome.runtime.lastError.message}`);
          return;
        }
        chrome.storage.local.get(SETTING_KEYS, (result) => {
          const merged = { ...DEFAULTS, ...result };
          applySettingsToForm(merged);
          renderHistory(merged.translationHistory || []);
          showStatus('backupStatus', '配置已导入');
        });
      });
    } catch (error) {
      showStatus('backupStatus', `导入失败：${error.message}`);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file, 'utf-8');
}

function showStatus(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  setTimeout(() => {
    el.textContent = '';
  }, 2500);
}
