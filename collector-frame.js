'use strict';

const STORAGE_KEY = 'webCollectorItems';
const list = document.getElementById('itemList');
const search = document.getElementById('searchItems');
const typeFilter = document.getElementById('typeFilter');
const status = document.getElementById('status');
const collectorSettingKeys = [
  'collectorPageSaveEnabled', 'collectorShowTextFilter', 'collectorShowImageFilter',
  'collectorShowPageFilter', 'collectorShowLinkFilter'
];
let items = [];

function applyCollectorSettings(settings) {
  document.getElementById('savePage').hidden = settings.collectorPageSaveEnabled === false;
  for (const option of typeFilter.options) {
    if (option.value === 'all') continue;
    const key = `collectorShow${option.value[0].toUpperCase()}${option.value.slice(1)}Filter`;
    option.hidden = settings[key] === false;
    option.disabled = settings[key] === false;
  }
  if (typeFilter.selectedOptions[0]?.disabled) typeFilter.value = 'all';
  render();
}

function text(value) { return String(value || ''); }
function typeOf(item) { return ['text', 'image', 'page', 'link'].includes(item.type) ? item.type : 'text'; }
function itemText(item) { return text(item.type === 'image' ? item.src || item.alt : item.type === 'link' || item.type === 'page' ? item.href || item.text : item.text); }
function safeUrl(value, allowed = ['http:', 'https:']) {
  try {
    const url = new URL(value);
    return allowed.includes(url.protocol) ? url.href : '';
  } catch (_) { return ''; }
}
function safeFilename(value, fallback) {
  return (text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || fallback).slice(0, 120);
}
function imageExtension(source) {
  const mime = text(source).match(/^data:image\/([a-z0-9+.-]+);/i)?.[1];
  if (mime) return mime.toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  try {
    return new URL(source).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || 'jpg';
  } catch (_) { return 'jpg'; }
}
function setStatus(value) { status.textContent = value; }
function makeButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}
function save(next, message) {
  items = next.slice(0, 200);
  chrome.storage.local.set({ [STORAGE_KEY]: items }, () => {
    if (chrome.runtime.lastError) return setStatus(chrome.runtime.lastError.message);
    if (message) setStatus(message);
    render();
  });
}
function downloadText(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function markdown() {
  const lines = ['# 网页采集画布', ''];
  for (const [index, item] of items.entries()) {
    lines.push(`## ${index + 1}. ${text(item.title) || '未命名页面'}`, '');
    lines.push(`- 来源: ${text(item.url)}`, `- 时间: ${text(item.createdAt)}`);
    if (item.note) lines.push(`- 备注: ${text(item.note)}`);
    lines.push('');
    if (typeOf(item) === 'image') lines.push(`![${text(item.alt) || 'image'}](${text(item.src)})`);
    else if (typeOf(item) === 'page' || typeOf(item) === 'link') lines.push(`[${text(item.text) || text(item.href)}](${text(item.href)})`);
    else lines.push('```text', text(item.text), '```');
    if (item.excerpt) lines.push('', `> ${text(item.excerpt)}`);
    lines.push('');
  }
  return lines.join('\n');
}
function normalizeImportedItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const kind = typeOf(item);
  const normalized = {
    id: text(item.id) || crypto.randomUUID(), type: kind, title: text(item.title),
    url: safeUrl(item.url), createdAt: Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : new Date().toISOString(),
    text: text(item.text), note: text(item.note), pinned: item.pinned === true
  };
  if (kind === 'image') {
    normalized.src = safeUrl(item.src, ['http:', 'https:', 'data:', 'blob:']);
    normalized.alt = text(item.alt);
    if (!normalized.src) return null;
  } else if (kind === 'page' || kind === 'link') {
    normalized.href = safeUrl(item.href || item.url);
    if (!normalized.href) return null;
    if (kind === 'page') {
      normalized.excerpt = text(item.excerpt);
      normalized.favicon = safeUrl(item.favicon, ['http:', 'https:', 'data:']);
      normalized.domain = text(item.domain);
    }
  } else if (!normalized.text) return null;
  return normalized;
}

async function addImageBlobs(blobs) {
  const images = [];
  for (const blob of Array.from(blobs || []).filter(file => file.type?.startsWith('image/')).slice(0, 20)) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const label = text(blob.name) || '剪贴板图片';
    images.push({ id: crypto.randomUUID(), type: 'image', title: label, url: '',
      createdAt: new Date().toISOString(), text: label, alt: label, src: data });
  }
  if (!images.length) return setStatus('没有图片');
  save([...images, ...items], `已添加 ${images.length} 张图片`);
}

function render() {
  document.getElementById('itemCount').textContent = String(items.length);
  list.replaceChildren();
  const query = search.value.trim().toLowerCase();
  const visible = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => (typeFilter.value === 'all' || typeOf(item) === typeFilter.value) &&
      (!query || [item.title, item.url, item.text, item.href, item.alt, item.note, item.excerpt]
        .some(value => text(value).toLowerCase().includes(query))))
    .sort((a, b) => Number(!!b.item.pinned) - Number(!!a.item.pinned));
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = items.length ? '没有符合条件的内容' : '画布是空的';
    list.appendChild(empty);
    return;
  }
  for (const { item, index } of visible) {
    const card = document.createElement('article');
    card.className = 'collector-card';
    const title = document.createElement('strong');
    title.textContent = `${item.pinned ? '置顶 · ' : ''}${text(item.title) || '未命名页面'}`;
    card.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${{ text: '文字', image: '图片', page: '网页', link: '链接' }[typeOf(item)]} · ${text(item.createdAt)}`;
    card.appendChild(meta);

    if (typeOf(item) === 'image') {
      const image = document.createElement('img');
      image.src = safeUrl(item.src, ['http:', 'https:', 'data:', 'blob:']);
      image.alt = text(item.alt);
      card.appendChild(image);
    }
    const content = document.createElement(typeOf(item) === 'page' || typeOf(item) === 'link' ? 'a' : 'div');
    content.className = 'text';
    content.textContent = text(item.text) || text(item.alt) || text(item.href);
    if (content.tagName === 'A') {
      content.href = safeUrl(item.href) || '#';
      content.target = '_blank';
      content.rel = 'noopener noreferrer';
    }
    card.appendChild(content);
    if (item.excerpt) {
      const excerpt = document.createElement('div');
      excerpt.className = 'text';
      excerpt.textContent = text(item.excerpt);
      card.appendChild(excerpt);
    }
    const note = document.createElement('textarea');
    note.placeholder = '备注';
    note.value = text(item.note);
    note.addEventListener('change', () => {
      items[index].note = note.value.trim();
      save(items, '备注已保存');
    });
    card.appendChild(note);
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(makeButton(item.pinned ? '取消置顶' : '置顶', () => {
      items[index].pinned = !item.pinned;
      save(items);
    }));
    actions.appendChild(makeButton('复制', async () => {
      try { await navigator.clipboard.writeText(itemText(item)); setStatus('已复制'); }
      catch (_) { setStatus('复制失败'); }
    }));
    const source = safeUrl(item.url);
    if (source) actions.appendChild(makeButton('来源', () => window.open(source, '_blank', 'noopener')));
    if (typeOf(item) === 'image') actions.appendChild(makeButton('下载', () => downloadImage(item, index + 1)));
    actions.appendChild(makeButton('删除', () => save(items.filter((_, itemIndex) => itemIndex !== index))));
    card.appendChild(actions);
    list.appendChild(card);
  }
}

async function downloadImage(item, number) {
  const url = safeUrl(item.src, ['http:', 'https:', 'data:', 'blob:']);
  if (!url) return setStatus('图片地址无效');
  const filename = `采集画布图片/${String(number).padStart(3, '0')}-${safeFilename(item.alt || item.title, `image-${number}`)}.${imageExtension(url)}`;
  const response = await chrome.runtime.sendMessage({ action: 'downloadCollectorImage', payload: { url, filename } });
  setStatus(response?.success ? '已开始下载' : response?.error || '下载失败');
}

document.getElementById('closePanel').addEventListener('click', () => {
  parent.postMessage({ type: 'webcraft-close-collector' }, '*');
});
document.getElementById('savePage').addEventListener('click', () => {
  parent.postMessage({ type: 'webcraft-add-current-page' }, '*');
  setStatus('已请求保存当前网页');
});
document.getElementById('downloadImages').addEventListener('click', () => {
  const images = items.filter(item => typeOf(item) === 'image');
  images.forEach((item, index) => downloadImage(item, index + 1));
  if (!images.length) setStatus('画布中没有图片');
});
document.getElementById('exportMarkdown').addEventListener('click', () => {
  if (!items.length) return setStatus('画布是空的');
  downloadText(`网页采集画布-${new Date().toISOString().slice(0, 10)}.md`, markdown(), 'text/markdown;charset=utf-8');
});
document.getElementById('copyMarkdown').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(markdown()); setStatus('已复制全部'); }
  catch (_) { setStatus('复制失败'); }
});
document.getElementById('exportJson').addEventListener('click', () => {
  downloadText(`网页采集画布-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(items, null, 2), 'application/json');
});
document.getElementById('importJsonButton').addEventListener('click', () => document.getElementById('importJson').click());
document.getElementById('importJson').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(incoming)) throw new Error('配置格式不正确');
    const seen = new Set();
    const merged = [...incoming.map(normalizeImportedItem).filter(Boolean), ...items].filter(item => {
      const key = `${typeOf(item)}|${itemText(item)}|${text(item.url)}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    save(merged, '已导入');
  } catch (error) { setStatus(`导入失败：${error.message}`); }
  event.target.value = '';
});
document.getElementById('dedupeItems').addEventListener('click', () => {
  const seen = new Set();
  save(items.filter(item => {
    const key = `${typeOf(item)}|${itemText(item)}|${text(item.url)}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }), '已去重');
});
document.getElementById('clearItems').addEventListener('click', () => save([], '画布已清空'));
document.getElementById('pasteImages').addEventListener('click', async () => {
  try {
    const clipboardItems = await navigator.clipboard.read();
    const blobs = [];
    for (const item of clipboardItems) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (!imageType) continue;
      blobs.push(await item.getType(imageType));
    }
    await addImageBlobs(blobs);
  } catch (_) { setStatus('无法读取剪贴板图片，请用 Ctrl+V 粘贴'); }
});
document.addEventListener('paste', event => {
  if (event.clipboardData?.files?.length) addImageBlobs(event.clipboardData.files);
});
list.addEventListener('dragover', event => event.preventDefault());
list.addEventListener('drop', event => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) addImageBlobs(event.dataTransfer.files);
});
search.addEventListener('input', render);
typeFilter.addEventListener('change', render);
chrome.storage.local.get([STORAGE_KEY], result => {
  items = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].map(normalizeImportedItem).filter(Boolean) : [];
  render();
});
chrome.storage.local.get(collectorSettingKeys, applyCollectorSettings);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    items = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue.map(normalizeImportedItem).filter(Boolean) : [];
    render();
  }
  if (area === 'local' && collectorSettingKeys.some(key => changes[key])) {
    chrome.storage.local.get(collectorSettingKeys, applyCollectorSettings);
  }
});
