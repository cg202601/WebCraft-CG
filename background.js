/**
 * WebCraft 网页工坊 - Background Service Worker
 * 处理截图捕获、快捷键及右键菜单搜图
 * 使用 Chrome Debugger API 实现全页截图
 */

// ==================== 初始化与右键菜单 ====================

// 搜图引擎配置
const ENGINES = {
    'google': {
        title: 'Google Lens',
        url: 'https://lens.google.com/uploadbyurl?url={url}'
    },
    'bing': {
        title: 'Bing Visual Search',
        url: 'https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:{url}'
    },
    'yandex': {
        title: 'Yandex Images',
        url: 'https://yandex.com/images/search?rpt=imageview&url={url}'
    }
};

const SEARCH_ALL_URLS = [
    ENGINES.google,
    ENGINES.bing,
    ENGINES.yandex
];

function isAllowedDownloadUrl(url, allowedProtocols = ['http:', 'https:', 'data:', 'blob:']) {
    try {
        const parsed = new URL(url);
        return allowedProtocols.includes(parsed.protocol);
    } catch (error) {
        return false;
    }
}

function isAllowedCollectorImageUrl(url) {
    if (typeof url !== 'string') return false;
    if (!isAllowedDownloadUrl(url)) return false;
    return !url.startsWith('data:') || /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=+-]+)*,/i.test(url);
}

function sanitizeDownloadFilename(filename, fallback = 'download') {
    const safe = String(filename || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(part => part.replace(/[<>:"|?*\x00-\x1F]/g, '_').trim())
        .filter(Boolean)
        .join('/');
    return (safe || fallback).slice(0, 180);
}

function isYoutubeThumbnailUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' &&
            parsed.hostname === 'img.youtube.com' &&
            /^\/vi(?:_webp)?\/[a-zA-Z0-9_-]{11}\//.test(parsed.pathname);
    } catch (error) {
        return false;
    }
}

const PANEL_WINDOWS = {
    collector: { page: 'collector-frame.html', width: 430, height: 760 },
    translator: { page: 'translator-frame.html', width: 470, height: 600 },
    selection: { page: 'translator-frame.html?mode=selection', width: 470, height: 400 }
};
const panelWindowTasks = new Map();

function openExtensionPanel(kind, sourceTabId, toggle = false) {
    const previous = panelWindowTasks.get(kind) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => openExtensionPanelInternal(kind, sourceTabId, toggle));
    panelWindowTasks.set(kind, task);
    task.finally(() => {
        if (panelWindowTasks.get(kind) === task) panelWindowTasks.delete(kind);
    }).catch(() => {});
    return task;
}

async function openExtensionPanelInternal(kind, sourceTabId, toggle) {
    const panel = PANEL_WINDOWS[kind];
    if (!panel) throw new Error('未知的扩展面板');
    const key = `panelWindow_${kind}`;
    const stored = (await chrome.storage.session.get(key))[key] || {};
    if (Number.isInteger(stored.windowId)) {
        try {
            await chrome.windows.get(stored.windowId);
            if (toggle) {
                await chrome.windows.remove(stored.windowId);
                await chrome.storage.session.remove(key);
                return { success: true, open: false };
            }
            await chrome.windows.update(stored.windowId, { focused: true });
            if (Number.isInteger(sourceTabId)) {
                await chrome.storage.session.set({ [key]: { ...stored, sourceTabId } });
            }
            return { success: true, open: true };
        } catch (_) {
            await chrome.storage.session.remove(key);
        }
    }
    const created = await chrome.windows.create({
        url: chrome.runtime.getURL(panel.page), type: 'popup',
        width: panel.width, height: panel.height, focused: true
    });
    if (!Number.isInteger(created?.id)) throw new Error('无法创建扩展窗口');
    await chrome.storage.session.set({ [key]: { windowId: created.id, sourceTabId } });
    return { success: true, open: true };
}

async function closeExtensionPanel(kind) {
    if (!PANEL_WINDOWS[kind]) throw new Error('未知的扩展面板');
    await panelWindowTasks.get(kind)?.catch(() => {});
    const key = `panelWindow_${kind}`;
    const state = (await chrome.storage.session.get(key))[key];
    if (Number.isInteger(state?.windowId)) {
        try { await chrome.windows.remove(state.windowId); } catch (_) { /* Window was already closed. */ }
    }
    await chrome.storage.session.remove(key);
    return { success: true, open: false };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!['openExtensionPanel', 'closeExtensionPanel', 'showSelectionTranslation', 'collectorAddCurrentPage'].includes(request?.action)) return;
    (async () => {
        if (request.action === 'collectorAddCurrentPage') {
            if (sender.url !== chrome.runtime.getURL('collector-frame.html')) throw new Error('无效的采集请求来源');
            const state = (await chrome.storage.session.get('panelWindow_collector')).panelWindow_collector;
            if (!Number.isInteger(state?.sourceTabId)) throw new Error('原网页已不可用');
            const response = await chrome.tabs.sendMessage(state.sourceTabId, { action: 'addCurrentPageItem' });
            if (!response?.success) throw new Error(response?.error || '保存网页失败');
            return { success: true };
        }
        if (!Number.isInteger(sender.tab?.id)) throw new Error('无法确认来源标签页');
        if (request.action === 'closeExtensionPanel') {
            if (!['collector', 'translator'].includes(request.payload?.kind)) throw new Error('未知的扩展面板');
            return closeExtensionPanel(request.payload.kind);
        }
        if (request.action === 'showSelectionTranslation') {
            const sourceText = String(request.payload?.sourceText || '').slice(0, 30000);
            const translatedText = String(request.payload?.translatedText || '').slice(0, 30000);
            if (!sourceText) throw new Error('缺少待翻译内容');
            await chrome.storage.session.set({ selectionTranslation: {
                sourceText, translatedText, isLoading: request.payload?.isLoading === true
            } });
            return openExtensionPanel('selection', sender.tab.id);
        }
        if (!['collector', 'translator'].includes(request.payload?.kind)) throw new Error('未知的扩展面板');
        return openExtensionPanel(request.payload.kind, sender.tab.id, request.payload.toggle === true);
    })().then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
});

chrome.windows?.onRemoved?.addListener(async windowId => {
    for (const kind of Object.keys(PANEL_WINDOWS)) {
        const key = `panelWindow_${kind}`;
        const state = (await chrome.storage.session.get(key))[key];
        if (state?.windowId !== windowId) continue;
        await chrome.storage.session.remove(key);
        if (kind === 'selection') await chrome.storage.session.remove('selectionTranslation');
    }
});

const DEEPL_LANGUAGE_MAP = {
    'zh-CN': 'ZH',
    zh: 'ZH',
    en: 'EN-US',
    ja: 'JA',
    ko: 'KO',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
    ru: 'RU',
    pl: 'PL',
    sv: 'SV',
    hu: 'HU',
    hr: 'HR',
    bg: 'BG',
    it: 'IT',
    pt: 'PT-PT',
    nl: 'NL',
    cs: 'CS',
    da: 'DA',
    fi: 'FI',
    el: 'EL',
    ro: 'RO',
    sk: 'SK',
    sl: 'SL',
    uk: 'UK',
    tr: 'TR',
    ar: 'AR'
};

function getDeepLTargetLang(direction, target) {
    if (target && target !== 'auto') return DEEPL_LANGUAGE_MAP[target] || target.toUpperCase();
    return direction === 'en2zh' ? 'ZH' : 'EN-US';
}

function getDeepLSourceLang(direction) {
    if (direction === 'en2zh') return 'EN';
    if (direction === 'zh2en') return 'ZH';
    return '';
}

async function translateWithDeepL(text, direction, target) {
    const settings = await new Promise((resolve) => {
        chrome.storage.local.get(['deeplApiKey', 'deeplApiEndpoint'], resolve);
    });
    const authKey = String(settings.deeplApiKey || '').trim();
    if (!authKey) throw new Error('请先在设置页填写 DeepL API Key');

    const endpoint = settings.deeplApiEndpoint || 'auto';
    const hosts = endpoint === 'pro'
        ? ['https://api.deepl.com', 'https://api-free.deepl.com']
        : endpoint === 'free'
            ? ['https://api-free.deepl.com', 'https://api.deepl.com']
            : authKey.endsWith(':fx')
                ? ['https://api-free.deepl.com', 'https://api.deepl.com']
                : ['https://api.deepl.com', 'https://api-free.deepl.com'];
    const body = new URLSearchParams();
    body.set('text', text);
    body.set('target_lang', getDeepLTargetLang(direction, target));
    const sourceLang = getDeepLSourceLang(direction);
    if (sourceLang) body.set('source_lang', sourceLang);

    let lastError = null;
    for (const host of hosts) {
        const response = await fetch(`${host}/v2/translate`, {
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${authKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        });

        if (response.ok) {
            const data = await response.json();
            const translated = data?.translations?.[0]?.text;
            if (!translated) throw new Error('DeepL 未返回翻译结果');
            return translated;
        }

        let detail = '';
        try {
            const data = await response.json();
            detail = data.message || data.error || '';
        } catch (error) {
            detail = await response.text().catch(() => '');
        }

        lastError = new Error(`DeepL 翻译失败 (${response.status})${detail ? `: ${detail}` : ''}`);
        if (response.status !== 403 || !/wrong endpoint/i.test(detail)) {
            throw lastError;
        }
    }

    throw lastError || new Error('DeepL 翻译失败');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'translateWithDeepL') return;

    const payload = request.payload || {};
    const text = String(payload.text || '').trim();
    if (!text) {
        sendResponse({ success: false, error: '没有可翻译的文本' });
        return;
    }

    translateWithDeepL(text, payload.direction || 'zh2en', payload.target || 'auto')
        .then((translatedText) => sendResponse({ success: true, translatedText }))
        .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.remove(['geminiApiKey', 'translateMode']);

    // 清除旧菜单
    chrome.contextMenus.removeAll();

    // 创建父级菜单
    chrome.contextMenus.create({
        id: "search_by_image_root",
        title: "🔍 以图搜图 (Search by Image)",
        contexts: ["image"]
    });

    // 1. 搜所有
    chrome.contextMenus.create({
        parentId: "search_by_image_root",
        id: "sbi_all",
        title: "🚀 搜索所有网站 (Google, Bing, Yandex)",
        contexts: ["image"]
    });

    chrome.contextMenus.create({
        parentId: "search_by_image_root",
        id: "separator_1",
        type: "separator",
        contexts: ["image"]
    });

    // 2. 单个引擎
    chrome.contextMenus.create({
        parentId: "search_by_image_root",
        id: "sbi_google",
        title: "Google Lens",
        contexts: ["image"]
    });

    chrome.contextMenus.create({
        parentId: "search_by_image_root",
        id: "sbi_bing",
        title: "Bing Visual Search",
        contexts: ["image"]
    });

    chrome.contextMenus.create({
        parentId: "search_by_image_root",
        id: "sbi_yandex",
        title: "Yandex Images",
        contexts: ["image"]
    });
});

// 处理菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.parentMenuItemId === "search_by_image_root") {
        const imageUrl = info.srcUrl;

        if (imageUrl.startsWith('data:')) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => alert('暂时不支持直接搜索 Base64/Data URI 图片。请确保图片是网络链接。')
            });
            return;
        }

        const encodedUrl = encodeURIComponent(imageUrl);

        // 核心引擎 URL 生成
        const urls = {
            google: ENGINES.google.url.replace('{url}', encodedUrl),
            bing: ENGINES.bing.url.replace('{url}', encodedUrl),
            yandex: ENGINES.yandex.url.replace('{url}', encodedUrl)
        };

        if (info.menuItemId === "sbi_all") {
            // 打开核心引擎
            SEARCH_ALL_URLS.forEach(engine => {
                const url = engine.url.replace('{url}', encodedUrl);
                chrome.tabs.create({ url: url, active: false });
            });
        } else {
            let targetUrl = "";
            let engineConfig = null;

            switch (info.menuItemId) {
                case "sbi_google":
                    engineConfig = ENGINES.google;
                    break;
                case "sbi_bing":
                    engineConfig = ENGINES.bing;
                    break;
                case "sbi_yandex":
                    engineConfig = ENGINES.yandex;
                    break;
            }

            if (engineConfig) {
                targetUrl = engineConfig.url.replace('{url}', encodedUrl);
                chrome.tabs.create({ url: targetUrl });
            }
        }
    }
});


// ==================== 普通截图（可视区域）====================

// ==================== Auto capture loop ====================

function getSenderTab(sender, callback) {
    if (sender?.tab?.id) {
        callback(sender.tab);
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        callback(tabs[0] || null);
    });
}

function dispatchArrowKeyWithDebugger(tabId, direction) {
    const key = direction === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const keyCode = direction === 'left' ? 37 : 39;
    const debuggee = { tabId };

    return new Promise((resolve) => {
        chrome.debugger.attach(debuggee, '1.3', () => {
            if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            const baseEvent = {
                key,
                code: key,
                windowsVirtualKeyCode: keyCode,
                nativeVirtualKeyCode: keyCode
            };

            chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
                ...baseEvent,
                type: 'keyDown'
            }, () => {
                if (chrome.runtime.lastError) {
                    const message = chrome.runtime.lastError.message;
                    chrome.debugger.detach(debuggee, () => resolve({ success: false, error: message }));
                    return;
                }

                chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
                    ...baseEvent,
                    type: 'keyUp'
                }, () => {
                    const message = chrome.runtime.lastError?.message || '';
                    chrome.debugger.detach(debuggee, () => {
                        resolve(message ? { success: false, error: message } : { success: true });
                    });
                });
            });
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'autoCaptureStep') return;

    chrome.storage.local.get(['screenshotModuleEnabled'], (settings) => {
        if (settings.screenshotModuleEnabled === false) {
            sendResponse({ success: false, error: '\u622a\u56fe\u6a21\u5757\u5df2\u5173\u95ed' });
            return;
        }

        getSenderTab(sender, (tab) => {
            if (!tab?.id || !tab.active || !Number.isInteger(tab.windowId)) {
                sendResponse({ success: false, error: '自动截图来源标签页已不在前台' });
                return;
            }

            const windowId = tab.windowId;
            chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }

                chrome.tabs.query({ active: true, windowId }, (activeTabs) => {
                    if (chrome.runtime.lastError || activeTabs[0]?.id !== tab.id) {
                        sendResponse({ success: false, error: '自动截图期间标签页已切换，请重试' });
                        return;
                    }

                    const { name, format, tool, direction } = request.payload || {};
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'processImage',
                        payload: { image: dataUrl, name, format, tool, isFullPage: false }
                    }, async (response) => {
                        if (chrome.runtime.lastError) {
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                            return;
                        }

                        const keyResult = await dispatchArrowKeyWithDebugger(tab.id, direction === 'left' ? 'left' : 'right');
                        if (!keyResult.success) {
                            sendResponse({ success: false, error: keyResult.error || '\u65b9\u5411\u952e\u53d1\u9001\u5931\u8d25', captured: true });
                            return;
                        }

                        sendResponse(response || { success: true });
                    });
                });
            });
        });
    });

    return true;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureVisible') {
        chrome.storage.local.get(['screenshotModuleEnabled'], (settings) => {
            if (settings.screenshotModuleEnabled === false) {
                sendResponse({ success: false, error: '截图模块已关闭' });
                return;
            }
            getSenderTab(sender, (tab) => {
                if (!tab?.id || !Number.isInteger(tab.windowId)) {
                    sendResponse({ success: false, error: '没有找到截图标签页' });
                    return;
                }
                // 截取当前可视区域
                chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error("Capture Error:", chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }

                    chrome.tabs.query({ active: true, windowId: tab.windowId }, (activeTabs) => {
                        if (chrome.runtime.lastError || activeTabs[0]?.id !== tab.id) {
                            sendResponse({ success: false, error: '截图期间标签页已切换，请重试' });
                            return;
                        }

                        const { name, format, tool } = request.payload;

                        // 发送到同一标签页的 content script 处理
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'processImage',
                            payload: { image: dataUrl, name, format, tool }
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                return;
                            }
                            sendResponse(response || { success: true });
                        });
                    });
                });
            });
        });
        return true;
    } else if (request.action === 'captureTab') {
        // 简单的可视区域截图
        if (!sender.tab?.active || !Number.isInteger(sender.tab.windowId)) {
            sendResponse(null);
            return;
        }
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) return sendResponse(null);
            chrome.tabs.query({ active: true, windowId: sender.tab.windowId }, (activeTabs) => {
                sendResponse(chrome.runtime.lastError || activeTabs[0]?.id !== sender.tab.id ? null : dataUrl);
            });
        });
        return true;
    }
});

// ==================== 全页截图（使用 Debugger API）====================

/**
 * 使用 Chrome Debugger API 截取整个页面
 * 包含智能降级策略，防止 GPU 崩溃或消息过大
 * @param {number} tabId
 * @param {object} overrideMetrics - {width, height, dpr}
 */
async function captureFullPageWithDebugger(tabId, overrideMetrics = null) {
    const debuggee = { tabId: tabId };

    try {
        await new Promise((resolve, reject) => {
            chrome.debugger.attach(debuggee, '1.3', () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });

        console.log('[全页截图] 调试器已附加');

        let width, height, dpr;

        // 1. 确定目标尺寸
        if (overrideMetrics && overrideMetrics.width && overrideMetrics.height) {
            width = overrideMetrics.width;
            height = overrideMetrics.height;
            dpr = overrideMetrics.dpr || 1;
            console.log('[全页截图] 使用覆盖尺寸:', width, 'x', height, '@', dpr);
        } else {
            const layoutMetrics = await new Promise((resolve, reject) => {
                chrome.debugger.sendCommand(debuggee, 'Page.getLayoutMetrics', {}, (result) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(result);
                });
            });
            width = Math.ceil(layoutMetrics.contentSize.width);
            height = Math.ceil(layoutMetrics.contentSize.height);
            dpr = 1; // 默认
            console.log('[全页截图] 自动检测尺寸:', width, 'x', height);
        }

        // 2. 智能降级策略 (关键修复)
        // Chrome 对纹理大小有限制 (通常 16384px)，如果高度过大，必须降低 DPR，否则会黑屏或失败
        // 同时也为了防止 base64 字符串过大导致消息传递失败
        const MAX_TEXTURE_SIZE = 16000;
        const SAFE_PIXEL_COUNT = 80000000; // 8000万像素 (约 300MB buffer)

        let targetDpr = dpr;

        // 策略 A: 如果高度超过最大纹理限制，必须降低 DPR 使得 物理高度 < 16384
        if (height * targetDpr > MAX_TEXTURE_SIZE) {
            targetDpr = MAX_TEXTURE_SIZE / height;
            console.warn(`[全页截图] ⚠️ 页面过高 (${height}px)，强制降低 DPR 到 ${targetDpr.toFixed(2)} 以适应纹理限制`);
        }

        // 策略 B: 如果总像素量太大，进一步降低 DPR 防止内存溢出
        const estimatedPixels = width * height * (targetDpr ** 2);
        if (estimatedPixels > SAFE_PIXEL_COUNT) {
            const scaleFactor = Math.sqrt(SAFE_PIXEL_COUNT / estimatedPixels);
            targetDpr = targetDpr * scaleFactor;
            console.warn(`[全页截图] ⚠️ 总像素过大 (${(estimatedPixels / 1e6).toFixed(1)}MP)，强制降低 DPR 到 ${targetDpr.toFixed(2)} 以防止崩溃`);
        }

        // 保证 DPR 有效即可。超长页面优先避免超过纹理限制，否则会黑屏或失败。
        targetDpr = Math.max(0.1, Math.floor(targetDpr * 100) / 100);
        if (height * targetDpr > MAX_TEXTURE_SIZE) {
            targetDpr = Math.max(0.1, Math.floor((MAX_TEXTURE_SIZE / height) * 100) / 100);
        }

        // 3. 设置设备指标
        await new Promise((resolve, reject) => {
            chrome.debugger.sendCommand(debuggee, 'Emulation.setDeviceMetricsOverride', {
                width: width,
                height: height,
                deviceScaleFactor: targetDpr,
                mobile: false // 必须为 false，否则有些响应式网站会变成手机版
            }, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });

        // 4. 等待渲染 (动态等待时间)
        // 如果页面非常长，Flow 等 SPA 需要更多时间来渲染底部内容
        let waitTime = 800;
        if (height > 3000) waitTime = 2000;
        if (height > 8000) waitTime = 4000; // 长图多等一会儿避免黑屏
        if (height > 15000) waitTime = 6000; // 超长图给足时间

        console.log(`[全页截图] 等待渲染 ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));

        // 5. 截图
        const screenshot = await new Promise((resolve, reject) => {
            chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: true,
                fromSurface: true
            }, (result) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(result);
            });
        });

        console.log(`[全页截图] 截图完成，数据长度: ${screenshot.data.length}`);

        // 检查数据是否有效
        if (!screenshot.data || screenshot.data.length === 0) {
            throw new Error('生成的截图数据为空');
        }

        // 6. 清理
        await new Promise((resolve) => {
            chrome.debugger.sendCommand(debuggee, 'Emulation.clearDeviceMetricsOverride', {}, resolve);
        });
        chrome.debugger.detach(debuggee, () => { });

        return 'data:image/png;base64,' + screenshot.data;

    } catch (error) {
        console.error('[全页截图] 错误:', error);
        try { chrome.debugger.detach(debuggee, () => { }); } catch (e) { }
        throw error;
    }
}

// 处理全页截图请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureFullPage') {
        const { name, format, tool, overrideMetrics } = request.payload;

        if (!sender.tab?.id) {
            sendResponse({ success: false, error: '无法确认截图来源标签页' });
            return;
        }

        chrome.storage.local.get(['screenshotModuleEnabled'], async (settings) => {
            if (settings.screenshotModuleEnabled === false) {
                sendResponse({ success: false, error: '截图模块已关闭' });
                return;
            }

            try {
                // 传递 overrideMetrics
                const dataUrl = await captureFullPageWithDebugger(sender.tab.id, overrideMetrics);

                // 发送截图数据到 content script 处理
                chrome.tabs.sendMessage(sender.tab.id, {
                    action: 'processFullPageImage',
                    payload: {
                        image: dataUrl,
                        name,
                        format,
                        tool
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("发送截图失败:", chrome.runtime.lastError);
                    }
                });

                sendResponse({ success: true });
            } catch (error) {
                console.error('[全页截图] 失败:', error);
                sendResponse({ success: false, error: error.message });
            }
        });

        return true; // 保持消息通道开放
    }
});

// ==================== 快捷键处理 ====================

chrome.commands.onCommand.addListener((command) => {
    if (command === 'quick-capture') {
        chrome.storage.local.get(['customName', 'format', 'tool', 'screenshotModuleEnabled'], (result) => {
            if (result.screenshotModuleEnabled === false) return;
            const name = result.customName || 'QuickCapture';
            const format = result.format || 'jpg';
            const tool = result.tool || 'Midjourney生成';

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (chrome.runtime.lastError || !tab?.id || !Number.isInteger(tab.windowId)) return;
                chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
                    if (chrome.runtime.lastError || !dataUrl) return;
                    chrome.tabs.query({ active: true, windowId: tab.windowId }, (activeTabs) => {
                        if (chrome.runtime.lastError || activeTabs[0]?.id !== tab.id) return;
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'processImage',
                            payload: {
                                image: dataUrl,
                                name,
                                format,
                                tool,
                                isFullPage: false
                            }
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("Shortcut Msg Error: ", chrome.runtime.lastError);
                            }
                        });
                    });
                });
            });
        });
    } else if (command === 'toggle-auto-capture') {
        chrome.storage.local.get([
            'customName',
            'format',
            'tool',
            'autoCaptureIntervalSeconds',
            'autoCaptureDirection',
            'screenshotModuleEnabled'
        ], (result) => {
            if (result.screenshotModuleEnabled === false) return;

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab?.id) return;

                chrome.tabs.sendMessage(tab.id, {
                    action: 'toggleAutoCaptureLoop',
                    payload: {
                        name: result.customName || 'AutoCapture',
                        format: result.format || 'jpg',
                        tool: result.tool || 'Midjourney\u751f\u6210',
                        intervalSeconds: result.autoCaptureIntervalSeconds || 6,
                        direction: result.autoCaptureDirection || 'right'
                    }
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('Toggle auto capture failed:', chrome.runtime.lastError.message);
                    }
                });
            });
        });
    } else if (command === 'toggle-collector-canvas') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab?.id) return;
            toggleCollectorCanvasInTab(tab.id);
        });
    } else if (command === 'show-selection-actions') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab?.id) return;
            showCollectorSelectionActionsInTab(tab.id);
        });
    }
});

function toggleCollectorCanvasInTab(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'toggleCollectorCanvas' }, () => {
        if (!chrome.runtime.lastError) return;

        chrome.scripting.executeScript({
            target: { tabId },
            files: ['jspdf.umd.min.js', 'content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Inject collector canvas failed:', chrome.runtime.lastError.message);
                return;
            }

            chrome.tabs.sendMessage(tabId, { action: 'toggleCollectorCanvas' }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('Toggle collector canvas failed:', chrome.runtime.lastError.message);
                }
            });
        });
    });
}

function showCollectorSelectionActionsInTab(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'showCollectorSelectionActions' }, () => {
        if (!chrome.runtime.lastError) return;

        chrome.scripting.executeScript({
            target: { tabId },
            files: ['jspdf.umd.min.js', 'content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Inject selection actions failed:', chrome.runtime.lastError.message);
                return;
            }

            chrome.tabs.sendMessage(tabId, { action: 'showCollectorSelectionActions' }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('Show selection actions failed:', chrome.runtime.lastError.message);
                }
            });
        });
    });
}

// ==================== 屏幕区域录制 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startScreenRecording') {
        // 获取当前活动标签页，通过 tabCapture 获取媒体流 ID
        chrome.storage.local.get(['recordingModuleEnabled'], (settings) => {
            if (settings.recordingModuleEnabled === false) {
                sendResponse({ success: false, error: '录屏模块已关闭' });
                return;
            }

            if (!sender.tab?.active || !sender.tab?.id) {
                sendResponse({ success: false, error: '录屏来源标签页已不在前台' });
                return;
            }

            const tabId = sender.tab.id;

            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId, consumerTabId: tabId }, (streamId) => {
                if (chrome.runtime.lastError) {
                    console.error('[屏幕录制] tabCapture 失败:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }

                // 将 streamId 发送给 content script，由它来创建实际的媒体流
                chrome.tabs.sendMessage(tabId, {
                    action: 'initRegionRecording',
                    payload: { streamId, ...(request.payload || {}) }
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[屏幕录制] 发送 streamId 失败:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse(response || { success: true });
                    }
                });
            });
        });

        return true; // 保持消息通道开放
    }
});

// ==================== 录制视频下载 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadRecording') {
        const { url, filename } = request.payload;

        if (!isAllowedDownloadUrl(url, ['blob:', 'data:'])) {
            sendResponse({ success: false, error: '不允许的录屏下载地址' });
            return;
        }

        chrome.downloads.download({
            url: url,
            filename: sanitizeDownloadFilename(filename, 'recording.webm'),
            saveAs: false // 自动保存，与截图行为一致
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('[屏幕录制] 下载失败:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });

        return true;
    }
});

// ==================== YouTube 缩略图下载 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadThumbnail') {
        const { url, filename } = request.payload;

        if (!isYoutubeThumbnailUrl(url)) {
            sendResponse({ success: false, error: '只允许下载 YouTube 缩略图地址' });
            return true;
        }

        chrome.storage.local.get(['youtubeToolsEnabled'], (settings) => {
            if (settings.youtubeToolsEnabled === false) {
                sendResponse({ success: false, error: 'YouTube 工具已关闭' });
                return;
            }

            downloadWithYoutubeFallback(url, filename)
                .then((result) => sendResponse(result))
                .catch((error) => {
                    console.error('Download Error:', error);
                    sendResponse({ success: false, error: error.message });
                });
        });

        return true;
    }
});

// ==================== 采集画布图片下载 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'downloadCollectorImage') return;

    const { url, filename } = request.payload || {};
    if (!url || !filename) {
        sendResponse({ success: false, error: '缺少图片地址或文件名' });
        return;
    }

    if (!isAllowedCollectorImageUrl(url)) {
        sendResponse({ success: false, error: '不允许的图片下载地址' });
        return;
    }

    chrome.downloads.download({
        url,
        filename: sanitizeDownloadFilename(filename, 'collector-image'),
        saveAs: false
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
            sendResponse({ success: true, downloadId });
        }
    });

    return true;
});

async function resolveYoutubeThumbnailUrl(url) {
    const match = url.match(/^(https:\/\/img\.youtube\.com\/vi\/[a-zA-Z0-9_-]{11}\/)([^/?#]+)(.*)$/);
    if (!match) return url;

    const [, base, fileName, suffix] = match;
    const candidates = fileName === 'maxresdefault.jpg'
        ? ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg', 'mqdefault.jpg', 'default.jpg']
        : [fileName];

    for (const candidate of candidates) {
        const candidateUrl = `${base}${candidate}${suffix || ''}`;
        try {
            const response = await fetch(candidateUrl, { method: 'HEAD', cache: 'no-store' });
            if (response.ok) return candidateUrl;
        } catch (error) {
            console.warn('Thumbnail probe failed:', candidateUrl, error);
        }
    }

    throw new Error('未找到可下载的 YouTube 缩略图');
}

async function downloadWithYoutubeFallback(url, filename) {
    const finalUrl = await resolveYoutubeThumbnailUrl(url);
    return new Promise((resolve) => {
        chrome.downloads.download({
            url: finalUrl,
            filename: sanitizeDownloadFilename(filename, 'youtube-thumbnail.jpg'),
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
                resolve({ success: true, downloadId, url: finalUrl });
            }
        });
    });
}

console.log('WebCraft 网页工坊后台服务已启动 (支持全页截图 + 搜图 + 屏幕录制)');
