const fs = require('fs');
const assert = require('assert');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertContains(file, needle, message) {
  assert(
    read(file).includes(needle),
    `${file} should include ${needle}: ${message}`
  );
}

const addedLanguages = [
  ['pl', 'PL'],
  ['sv', 'SV'],
  ['hu', 'HU'],
  ['hr', 'HR'],
  ['bg', 'BG']
];

for (const [googleCode, deeplCode] of addedLanguages) {
  for (const file of ['popup.html', 'options.html']) {
    assertContains(file, `value="${googleCode}"`, `target language ${googleCode} must be selectable`);
  }
  assertContains('translator-frame.js', `'${googleCode}'`, `translator window target language ${googleCode}`);
  assertContains('background.js', `${googleCode}: '${deeplCode}'`, `DeepL target mapping for ${googleCode}`);
}

for (const key of [
  'collectorFloatingEnabled',
  'translateFloatingEnabled',
  'collectorSelectionMenuEnabled'
]) {
  assertContains('options.js', `${key}:`, `default setting for ${key}`);
  assertContains('options.html', `data-setting="${key}"`, `options UI control for ${key}`);
  assertContains('content.js', key, `content script must react to ${key}`);
}

assertContains('manifest.json', '"show-selection-actions"', 'Chrome command for manual selection menu');
assertContains('manifest.json', '"toggle-auto-capture"', 'Chrome command for automatic screenshots');
assertContains('background.js', "command === 'show-selection-actions'", 'background command handler');
assertContains('background.js', "command === 'toggle-auto-capture'", 'background automatic screenshot command handler');
assertContains('background.js', "request.action !== 'autoCaptureStep'", 'background automatic screenshot step handler');
assertContains('content.js', "request.action !== 'showCollectorSelectionActions'", 'content message handler');
assertContains('content.js', "request.action === 'startAutoCaptureLoop'", 'content automatic screenshot loop handler');
assertContains('popup.html', 'btnStartAutoCapture', 'popup automatic screenshot start button');
assertContains('content.js', 'if (!collectorSelectionMenuEnabled) return;', 'automatic selection menu can be disabled');
assertContains('content.js', 'updateTranslatorFloatingVisibility();', 'translator handle visibility follows settings');
assertContains('content.js', 'updateCollectorFloatingVisibility();', 'collector handle visibility follows settings');

const optionSettings = [...read('options.html').matchAll(/data-setting="([^"]+)"/g)]
  .map(match => match[1]);
const missingDefaults = [...new Set(optionSettings)]
  .filter(key => !new RegExp(`${key}\\s*:`).test(read('options.js')));

assert.deepStrictEqual(
  missingDefaults,
  [],
  'all options.html data-setting controls should have matching options.js defaults'
);

console.log('extension behavior checks passed');
