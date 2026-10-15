'use strict';

const languages = [
  ['自动中英互译', 'auto'], ['中文', 'zh-CN'], ['英语', 'en'], ['日语', 'ja'],
  ['韩语', 'ko'], ['法语', 'fr'], ['德语', 'de'], ['西班牙语', 'es'],
  ['俄语', 'ru'], ['波兰语', 'pl'], ['瑞典语', 'sv'], ['马扎尔语 / 匈牙利语', 'hu'],
  ['克罗地亚语', 'hr'], ['保加利亚语', 'bg'], ['意大利语', 'it'],
  ['葡萄牙语', 'pt'], ['荷兰语', 'nl'], ['捷克语', 'cs'], ['丹麦语', 'da'],
  ['芬兰语', 'fi'], ['希腊语', 'el'], ['罗马尼亚语', 'ro'], ['斯洛伐克语', 'sk'],
  ['斯洛文尼亚语', 'sl'], ['乌克兰语', 'uk'], ['土耳其语', 'tr'], ['阿拉伯语', 'ar']
];

const engine = document.getElementById('engine');
const target = document.getElementById('target');
const sourceText = document.getElementById('sourceText');
const result = document.getElementById('translatedText');
const status = document.getElementById('status');
const runButton = document.getElementById('runTranslate');
const copyButton = document.getElementById('copyResult');
const selectionMode = new URLSearchParams(location.search).get('mode') === 'selection';

if (selectionMode) {
  document.querySelector('.panel-header strong').textContent = '选中文字翻译';
  document.querySelector('.controls').hidden = true;
  document.querySelector('.actions').hidden = true;
  sourceText.readOnly = true;
  sourceText.placeholder = '选中文字';
  const renderSelection = (value = {}) => {
    sourceText.value = String(value.sourceText || '');
    result.textContent = value.isLoading ? '正在翻译...' : String(value.translatedText || '');
    copyButton.hidden = value.isLoading || !value.translatedText;
    setStatus(value.isLoading ? '' : value.translatedText ? '翻译完成' : '翻译失败', !value.translatedText && !value.isLoading);
  };
  chrome.storage.session.get('selectionTranslation', data => renderSelection(data.selectionTranslation));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.selectionTranslation) renderSelection(changes.selectionTranslation.newValue);
  });
}

for (const [label, code] of languages) {
  const option = document.createElement('option');
  option.value = code;
  option.textContent = label;
  target.appendChild(option);
}

chrome.storage.local.get(['translateEngine', 'translateTargetLang'], settings => {
  engine.value = settings.translateEngine || 'google';
  target.value = settings.translateTargetLang || 'auto';
});

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function getDirection(text) {
  if (target.value !== 'auto') return `auto2${target.value}`;
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const english = (text.match(/[a-zA-Z]/g) || []).length;
  return english > chinese && english >= 2 ? 'en2zh' : 'zh2en';
}

async function translateWithGoogle(text, direction) {
  const targetLang = target.value !== 'auto' ? target.value : direction === 'en2zh' ? 'zh-CN' : 'en';
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetLang, dt: 't', q: text }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google 翻译失败 (${response.status})`);
  const data = await response.json();
  const translated = data?.[0]?.map(part => part?.[0] || '').join('');
  if (!translated) throw new Error('翻译服务未返回结果');
  return translated;
}

async function translateWithDeepL(text, direction) {
  const response = await chrome.runtime.sendMessage({
    action: 'translateWithDeepL',
    payload: { text, direction, target: target.value }
  });
  if (!response?.success) throw new Error(response?.error || 'DeepL 翻译失败');
  return response.translatedText;
}

async function translate() {
  if (selectionMode) return;
  const text = sourceText.value.trim();
  if (!text) {
    setStatus('请输入或粘贴要翻译的文字', true);
    sourceText.focus();
    return;
  }
  runButton.disabled = true;
  setStatus('正在翻译...');
  try {
    const direction = getDirection(text);
    const translated = engine.value === 'deepl'
      ? await translateWithDeepL(text, direction)
      : await translateWithGoogle(text, direction);
    result.textContent = translated;
    copyButton.hidden = false;
    setStatus('翻译完成');
  } catch (error) {
    result.textContent = '';
    copyButton.hidden = true;
    setStatus(error.message || '翻译失败', true);
  } finally {
    runButton.disabled = false;
  }
}

document.getElementById('closePanel').addEventListener('click', () => {
  window.close();
});
document.getElementById('pasteText').addEventListener('click', async () => {
  try {
    sourceText.value = await navigator.clipboard.readText();
    sourceText.focus();
    setStatus('已粘贴');
  } catch (_) {
    setStatus('无法读取剪贴板，请手动粘贴', true);
  }
});
runButton.addEventListener('click', translate);
sourceText.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    translate();
  }
});
document.getElementById('clearText').addEventListener('click', () => {
  sourceText.value = '';
  result.textContent = '';
  copyButton.hidden = true;
  setStatus('');
  sourceText.focus();
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(result.textContent);
    setStatus('译文已复制');
  } catch (_) {
    setStatus('复制失败', true);
  }
});
engine.addEventListener('change', () => chrome.storage.local.set({ translateEngine: engine.value }));
target.addEventListener('change', () => chrome.storage.local.set({ translateTargetLang: target.value }));
