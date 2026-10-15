const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { jsPDF } = require('../jspdf.umd.min.js');

async function testPdfExport() {
  const image = 'data:image/png;base64,' + fs.readFileSync('icons/icon16.png').toString('base64');
  const pdf = new jsPDF({ orientation: 'p', unit: 'px', format: [16, 16] });
  pdf.addImage(image, 'PNG', 0, 0, 16, 16);
  assert.match(pdf.output(), /^%PDF-/);
}

async function testConfigExport() {
  let exportedBlob;
  const status = { textContent: '' };
  const context = {
    Blob,
    URL: {
      createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; },
      revokeObjectURL() {}
    },
    setTimeout() {},
    document: {
      addEventListener() {},
      createElement() { return { click() {} }; },
      getElementById() { return status; }
    },
    chrome: {
      runtime: { getManifest() { return { version: '1.8.4' }; } },
      storage: { local: { get(_keys, done) {
        assert.ok(Array.isArray(_keys));
        done({ deeplApiKey: 'secret', geminiApiKey: 'legacy-secret', translateTargetLang: 'en',
          translationHistory: [{ source: 'private' }], webCollectorItems: [{ text: 'private' }],
          futureSecret: 'private' });
      } } }
    }
  };
  vm.runInNewContext(fs.readFileSync('options.js', 'utf8'), context);
  context.exportConfig();
  const settings = JSON.parse(await exportedBlob.text()).settings;
  assert.equal(settings.translateTargetLang, 'en');
  assert.equal(Object.hasOwn(settings, 'deeplApiKey'), false);
  assert.equal(Object.hasOwn(settings, 'geminiApiKey'), false);
  assert.equal(Object.hasOwn(settings, 'translationHistory'), false);
  assert.equal(Object.hasOwn(settings, 'webCollectorItems'), false);
  assert.equal(Object.hasOwn(settings, 'futureSecret'), false);
  assert.match(status.textContent, /API Key/);
  const imported = context.sanitizeBackupSettings({
    translateTargetLang: 'ja', screenshotModuleEnabled: false,
    deeplApiKey: 'untrusted', translationHistory: [{ source: 'private' }],
    webCollectorItems: [{ text: 'private' }], unexpected: 'value',
    recordingMaxMinutes: 'not-a-number'
  });
  assert.equal(imported.translateTargetLang, 'ja');
  assert.equal(imported.screenshotModuleEnabled, false);
  for (const key of ['deeplApiKey', 'translationHistory', 'webCollectorItems', 'unexpected', 'recordingMaxMinutes']) {
    assert.equal(Object.hasOwn(imported, key), false);
  }
}

function testSensitiveTranslationFields() {
  const source = fs.readFileSync('content.js', 'utf8');
  const sensitive = source.match(/    function isSensitiveTranslationTarget\(element\) \{[\s\S]*?\n    \}/)?.[0];
  const handler = source.match(/    function handleKeyDown\(event\) \{[\s\S]*?\n    \}\n\n    \/\/ 注册事件监听器/)?.[0]
    ?.replace(/\n\n    \/\/ 注册事件监听器$/, '');
  assert.ok(sensitive && handler, 'translation handlers must be present');

  let shortcutCalls = 0;
  let translationCalls = 0;
  const context = {
    handledKeyEvents: new WeakSet(),
    isEnabled: true,
    spaceCount: 1,
    isInputElement: () => true,
    getEditableElement: field => field,
    getSelectedTextInfo: () => null,
    shouldTriggerTranslationShortcut: () => { shortcutCalls++; return true; },
    handleTranslation: () => { translationCalls++; }
  };
  vm.runInNewContext(`${sensitive}\n${handler}`, context);
  const field = (type, autocomplete = '') => ({
    tagName: 'INPUT', type,
    closest() { return this; },
    getAttribute() { return autocomplete; }
  });
  for (const target of [field('password'), field('text', 'one-time-code'), field('text', 'cc-number')]) {
    context.handleKeyDown({ target, key: ' ', code: 'Space', isTrusted: true });
  }
  assert.equal(shortcutCalls, 0);
  assert.equal(translationCalls, 0);
  context.handleKeyDown({ target: field('text'), key: ' ', code: 'Space', isTrusted: false });
  assert.equal(shortcutCalls, 0);
  context.handleKeyDown({ target: field('text'), key: ' ', code: 'Space', isTrusted: true });
  assert.equal(translationCalls, 1);
}

function testSensitivePanelsAreNotWebAccessible() {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const exposed = manifest.web_accessible_resources?.flatMap(entry => entry.resources) || [];
  for (const path of ['collector-frame.html', 'translator-frame.html', 'panel-frame.css']) {
    assert.equal(exposed.includes(path), false);
  }
}

async function testCaptureUsesSenderTab() {
  const listeners = [];
  let capturedWindow;
  let recordedTab;
  let sentToTab;
  let activeTabId = 17;
  const session = new Map();
  const windows = new Map();
  const createdUrls = [];
  const chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listeners.push(fn); } }
    },
    contextMenus: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    storage: {
      local: { get(_keys, done) { done({}); } },
      session: {
        async get(key) { return { [key]: session.get(key) }; },
        async set(values) { for (const [key, value] of Object.entries(values)) session.set(key, value); },
        async remove(key) { session.delete(key); }
      }
    },
    windows: {
      onRemoved: { addListener() {} },
      async create(options) { const id = 100 + windows.size; windows.set(id, options); createdUrls.push(options.url); return { id }; },
      async get(id) { if (!windows.has(id)) throw new Error('closed'); return { id }; },
      async update(id) { return { id }; },
      async remove(id) { windows.delete(id); }
    },
    tabs: {
      captureVisibleTab(windowId, _options, done) { capturedWindow = windowId; done('data:image/png;base64,AA=='); },
      sendMessage(tabId, _message, done) {
        sentToTab = tabId;
        return done ? done({ success: true }) : Promise.resolve({ success: true });
      },
      query(_options, done) { done([{ id: activeTabId, windowId: 42, active: true }]); }
    },
    tabCapture: { getMediaStreamId(options, done) { recordedTab = options.targetTabId; done('stream-id'); } },
    debugger: {
      attach(_tab, _version, done) { done(); },
      sendCommand(_tab, command, _params, done) {
        done(command === 'Page.getLayoutMetrics' ? { contentSize: { width: 16, height: 16 } } :
          command === 'Page.captureScreenshot' ? { data: 'AA==' } : {});
      },
      detach(_tab, done) { done(); }
    }
  };
  const context = vm.createContext({
    chrome, URL, URLSearchParams, console: { log() {}, warn() {}, error() {} },
    setTimeout(done) { done(); }
  });
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
  assert.equal(vm.runInContext("isAllowedCollectorImageUrl('data:text/html,<script>alert(1)</script>')", context), false);
  assert.equal(vm.runInContext("isAllowedCollectorImageUrl('data:image/png;base64,AA==')", context), true);
  const send = (action, sender, payload = {}) => new Promise(resolve => {
    const listener = listeners.find(fn => fn({ action, payload }, sender, resolve) === true);
    assert.ok(listener, `missing ${action} listener`);
  });
  const sender = { tab: { id: 17, windowId: 42, active: true } };
  assert.equal((await send('captureVisible', {})).success, true);
  assert.equal(capturedWindow, 42);
  assert.equal(sentToTab, 17);
  assert.equal(await send('captureTab', sender), 'data:image/png;base64,AA==');
  assert.equal(capturedWindow, 42);
  assert.equal(await send('captureTab', { tab: { id: 17, windowId: 42, active: false } }), null);
  activeTabId = 18;
  assert.equal(await send('captureTab', sender), null);
  activeTabId = 17;
  assert.equal((await send('startScreenRecording', sender)).success, true);
  assert.equal(recordedTab, 17);
  assert.equal(sentToTab, 17);
  assert.equal((await send('captureFullPage', sender)).success, true);
  assert.equal(sentToTab, 17);
  assert.equal((await send('openExtensionPanel', sender, { kind: 'collector' })).open, true);
  assert.equal(createdUrls[0], 'chrome-extension://test/collector-frame.html');
  assert.equal(session.get('panelWindow_collector').sourceTabId, 17);
  assert.equal((await send('collectorAddCurrentPage', { url: 'chrome-extension://test/collector-frame.html' })).success, true);
  assert.equal(sentToTab, 17);
  assert.equal((await send('collectorAddCurrentPage', { url: 'https://example.com/' })).success, false);
  assert.equal((await send('showSelectionTranslation', sender, {
    sourceText: 'private source', translatedText: 'private result'
  })).success, true);
  assert.equal(createdUrls[1], 'chrome-extension://test/translator-frame.html?mode=selection');
  assert.equal(session.get('selectionTranslation').translatedText, 'private result');
  assert.equal(createdUrls.every(url => !url.includes('private')), true);
  assert.equal((await send('openExtensionPanel', sender, { kind: 'collector', toggle: true })).open, false);
}

(async () => {
  await testPdfExport();
  await testConfigExport();
  testSensitiveTranslationFields();
  testSensitivePanelsAreNotWebAccessible();
  await testCaptureUsesSenderTab();
  console.log('security behavior checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
