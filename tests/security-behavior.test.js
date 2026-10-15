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
      runtime: { getManifest() { return { version: '1.8.2' }; } },
      storage: { local: { get(_keys, done) {
        done({ deeplApiKey: 'secret', geminiApiKey: 'legacy-secret', translateTargetLang: 'en' });
      } } }
    }
  };
  vm.runInNewContext(fs.readFileSync('options.js', 'utf8'), context);
  context.exportConfig();
  const settings = JSON.parse(await exportedBlob.text()).settings;
  assert.equal(settings.translateTargetLang, 'en');
  assert.equal(Object.hasOwn(settings, 'deeplApiKey'), false);
  assert.equal(Object.hasOwn(settings, 'geminiApiKey'), false);
  assert.match(status.textContent, /API Key/);
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

function testSensitivePanelsUseExtensionFrames() {
  const source = fs.readFileSync('content.js', 'utf8');
  const functions = [
    ['showFloatingTranslatorPanel', 'translator-frame.html'],
    ['ensurePanel', 'collector-frame.html']
  ];
  for (const [name, path] of functions) {
    const body = source.match(new RegExp(`    function ${name}\\(\\) \\{[\\s\\S]*?\\n    \\}`))?.[0];
    assert.ok(body, `${name} must be present`);
    const created = [];
    const context = {
      FLOATING_TRANSLATOR_PANEL_ID: 'translator-panel', PANEL_ID: 'collector-panel',
      shouldShowFloatingTranslator: () => true,
      chrome: { runtime: { getURL: value => `chrome-extension://test/${value}` } },
      document: {
        getElementById: () => null,
        createElement(tag) { const node = { tag, style: {} }; created.push(node); return node; },
        body: { appendChild() {} }
      }
    };
    vm.runInNewContext(`${body}\n${name}()`, context);
    assert.equal(created[0]?.tag, 'iframe');
    assert.equal(created[0]?.src, `chrome-extension://test/${path}`);
    assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', path)));
  }
}

async function testCaptureUsesSenderTab() {
  const listeners = [];
  let capturedWindow;
  let recordedTab;
  let sentToTab;
  let activeTabId = 17;
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listeners.push(fn); } } },
    contextMenus: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    storage: { local: { get(_keys, done) { done({}); } } },
    tabs: {
      captureVisibleTab(windowId, _options, done) { capturedWindow = windowId; done('data:image/png;base64,AA=='); },
      sendMessage(tabId, _message, done) { sentToTab = tabId; done({ success: true }); },
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
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), {
    chrome, URL, URLSearchParams, console: { log() {}, warn() {}, error() {} },
    setTimeout(done) { done(); }
  });
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
}

(async () => {
  await testPdfExport();
  await testConfigExport();
  testSensitiveTranslationFields();
  testSensitivePanelsUseExtensionFrames();
  await testCaptureUsesSenderTab();
  console.log('security behavior checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
