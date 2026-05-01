/**
 * WebCraft 网页工坊 - Content Script
 * 网页采集、截图、翻译、YouTube 辅助和录屏功能 */

// ==================== 截图功能 ====================

// Debug check
if (!window.jspdf) {
    console.error("jsPDF usage error: window.jspdf is undefined. Library might not be loaded or page needs refresh.");
}

const { jsPDF } = window.jspdf || {};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let screenshotFilenameTemplate = '截图凭证-{tool}-{name}-{date}';

chrome.storage.local.get(['screenshotFilenameTemplate'], (result) => {
    if (result.screenshotFilenameTemplate) screenshotFilenameTemplate = result.screenshotFilenameTemplate;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.screenshotFilenameTemplate) {
        screenshotFilenameTemplate = changes.screenshotFilenameTemplate.newValue || '截图凭证-{tool}-{name}-{date}';
    }
});

function sanitizeFilenamePart(value, fallback = 'untitled') {
    const text = String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, 120);
}

function isYouTubeHost(hostname = window.location.hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com');
}

function generateFilename(name, ext, tool) {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `ZB${yyyy}${mm}${dd}`;
    const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

    const safeTool = sanitizeFilenamePart(tool, 'Midjourney');
    const safeName = sanitizeFilenamePart(name);
    const template = screenshotFilenameTemplate || '截图凭证-{tool}-{name}-{date}';
    const base = template
        .replaceAll('{tool}', safeTool)
        .replaceAll('{name}', safeName)
        .replaceAll('{date}', dateStr)
        .replaceAll('{time}', timeStr);
    return `${sanitizeFilenamePart(base, `截图凭证-${safeTool}-${safeName}-${dateStr}`)}.${ext}`;
}

function getHeaderDate() {
    const date = new Date();
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function processCanvas(dataUrl, name, tool) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const headerHeight = 60;
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height + headerHeight;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = '#000000';
            ctx.font = 'bold 24px sans-serif';
            if (img.width > 1200) {
                ctx.font = 'bold 32px sans-serif';
            }

            const textPadding = 20;
            const dateText = getHeaderDate();
            const safeTool = tool || 'Midjourney';
            const titleText = `截图凭证-${safeTool}-${name}`;

            ctx.fillText(titleText, textPadding, headerHeight - 15);

            const dateWidth = ctx.measureText(dateText).width;
            ctx.fillText(dateText, canvas.width - dateWidth - textPadding, headerHeight - 15);

            ctx.beginPath();
            ctx.setLineDash([10, 5]);
            ctx.moveTo(0, headerHeight - 5);
            ctx.lineTo(canvas.width, headerHeight - 5);
            ctx.stroke();

            ctx.drawImage(img, 0, headerHeight);

            resolve(canvas);
        };
        img.onerror = () => reject(new Error('截图图片加载失败'));
        img.src = dataUrl;
    });
}

function downloadCanvas(canvas, filename, format) {
    if (!canvas) return;

    if (format === 'pdf') {
        if (!jsPDF) {
            alert("PDF component missing");
            return;
        }
        const orientation = canvas.width > canvas.height ? 'l' : 'p';
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [canvas.width, canvas.height]
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
        pdf.save(filename);
    } else {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
    }
}

/**
 * 检测页面顶部的固定/粘性元素的高度
 * 用于在长截图拼接时去除重复的顶部导航�?
 * 增强版：支持 SPA 应用（如 Gemini）使用内部容器滚动的情况
 */
function findFixedHeaderHeight(scrollContainer = null) {
    const viewportHeight = window.innerHeight;
    // 限制固定头部最大高度为视口�?20%
    const maxAllowedHeight = viewportHeight * 0.2;

    let maxHeaderBottom = 0;
    let foundElements = 0;

    // 方法1: 检查所有具�?fixed/sticky 定位的元�?
    document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        const position = style.position;

        if (position === 'fixed' || position === 'sticky') {
            const rect = el.getBoundingClientRect();
            // 只考虑在视口顶部的元素，且高度合理（不超过视口 20%�?
            if (rect.top >= -5 && rect.top <= 10 &&
                rect.height > 20 &&
                rect.height < viewportHeight * 0.2 &&
                rect.width > viewportHeight * 0.5) { // 确保是宽度较大的导航�?
                foundElements++;
                if (rect.bottom > maxHeaderBottom && rect.bottom < maxAllowedHeight) {
                    maxHeaderBottom = rect.bottom;
                }
            }
        }
    });

    // 方法2: 如果使用内部容器滚动（SPA应用），容器顶部位置即为固定头部高度
    // 因为容器上方的内容在滚动时会保持固定
    if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        // 如果容器不是从顶部开始，说明上方有固定区�?
        if (containerRect.top > 20 && containerRect.top < maxAllowedHeight) {
            console.log('[长截图] 检测到内部容器顶部偏移:', containerRect.top, 'px');
            // 使用容器顶部位置�?fixed 元素底部的较大�?
            maxHeaderBottom = Math.max(maxHeaderBottom, containerRect.top);
            foundElements++;
        }
    }

    // 纭繚杩斿洖鍊煎湪鍚堢悊鑼冨洿鍐?
    const result = Math.min(Math.ceil(maxHeaderBottom), maxAllowedHeight);
    console.log('[长截图] 检测到固定头部:', result, 'px (检测到', foundElements, '个元素)');
    return result;
}

/**
 * 检测页面底部的固定元素的高�?
 * 用于处理 Gemini 等页面底部有固定输入区域的情�?
 */
function findFixedFooterHeight(scrollContainer = null) {
    const viewportHeight = window.innerHeight;
    // 限制固定底部最大高度为视口�?25%
    const maxAllowedHeight = viewportHeight * 0.25;

    let maxFooterHeight = 0;

    // 检查所有具�?fixed/sticky 定位的元�?
    document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        const position = style.position;

        if (position === 'fixed' || position === 'sticky') {
            const rect = el.getBoundingClientRect();
            // 只考虑在视口底部的元素
            const distanceFromBottom = viewportHeight - rect.bottom;
            if (distanceFromBottom >= -5 && distanceFromBottom <= 20 &&
                rect.height > 30 &&
                rect.height < maxAllowedHeight &&
                rect.width > viewportHeight * 0.5) {
                const footerHeight = viewportHeight - rect.top;
                if (footerHeight > maxFooterHeight && footerHeight < maxAllowedHeight) {
                    maxFooterHeight = footerHeight;
                }
            }
        }
    });

    // 如果使用内部容器滚动，检测容器底部偏�?
    if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const bottomOffset = viewportHeight - containerRect.bottom;
        if (bottomOffset > 30 && bottomOffset < maxAllowedHeight) {
            console.log('[长截图] 检测到内部容器底部偏移:', bottomOffset, 'px');
            maxFooterHeight = Math.max(maxFooterHeight, bottomOffset);
        }
    }

    const result = Math.min(Math.ceil(maxFooterHeight), maxAllowedHeight);
    console.log('[长截图] 检测到固定底部:', result, 'px');
    return result;
}

// 全局变量用于控制手动截图
let captureStopRequested = false;
let captureControlPanel = null;

/**
 * 鍒涘缓鎮诞鎺у埗闈㈡澘
 */
function createCaptureControlPanel() {
    // 移除已有的面�?
    removeCaptureControlPanel();

    const panel = document.createElement('div');
    panel.id = 'screenshot-control-panel';
    panel.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 12px;
        padding: 7px 8px;
        background: rgba(24, 24, 24, 0.88);
        color: white;
        border-radius: 999px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 6px 20px rgba(0,0,0,0.32);
        backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: calc(100vw - 24px);
    `;

    // 鐘舵€佹樉绀?
    const statusDiv = document.createElement('div');
    statusDiv.id = 'capture-status';
    statusDiv.style.cssText = 'font-size: 12px; font-weight: 600; white-space: nowrap;';
    statusDiv.textContent = '📸 截图中';
    panel.appendChild(statusDiv);

    // 杩涘害鏄剧ず
    const progressDiv = document.createElement('div');
    progressDiv.id = 'capture-progress';
    progressDiv.style.cssText = 'font-size: 12px; color: #bbb; white-space: nowrap;';
    progressDiv.textContent = '0 张';
    panel.appendChild(progressDiv);

    // 停止按钮
    const stopBtn = document.createElement('button');
    stopBtn.textContent = '停止';
    stopBtn.style.cssText = `
        padding: 5px 12px;
        background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
        color: white;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s;
    `;
    stopBtn.onmouseover = () => stopBtn.style.transform = 'scale(1.02)';
    stopBtn.onmouseout = () => stopBtn.style.transform = 'scale(1)';
    stopBtn.onclick = () => {
        captureStopRequested = true;
        stopBtn.textContent = '停止截图';
        stopBtn.style.background = '#666';
        stopBtn.disabled = true;
    };
    panel.appendChild(stopBtn);

    document.body.appendChild(panel);
    captureControlPanel = panel;

    return panel;
}

/**
 * 鏇存柊鎺у埗闈㈡澘鐘舵€?
 */
function updateCaptureProgress(current, total) {
    const progressDiv = document.getElementById('capture-progress');
    if (progressDiv) {
        if (total) {
            progressDiv.textContent = `${current}/${total} 张`;
        } else {
            progressDiv.textContent = `${current} 张`;
        }
    }
}

/**
 * 绉婚櫎鎺у埗闈㈡澘
 */
function removeCaptureControlPanel() {
    const existing = document.getElementById('screenshot-control-panel');
    if (existing) {
        existing.remove();
    }
    captureControlPanel = null;
}

/**
 * 查找页面中实际的可滚动容�?
 * 用于处理 SPA 应用（如 Gemini）使�?overflow:hidden �?html/body�?
 * 而实际滚动区域在内部容器的情�?
 */
function findScrollableContainer() {
    const viewportHeight = window.innerHeight;

    // 首先检�?window 是否可滚�?
    const windowScrollable = document.documentElement.scrollHeight > viewportHeight ||
        document.body.scrollHeight > viewportHeight;

    if (windowScrollable && window.scrollY !== undefined) {
        // 尝试滚动一下看看是否真的可以滚�?
        const testScroll = window.scrollY;
        window.scrollTo(0, 100);
        const canScroll = window.scrollY > 0 || testScroll > 0;
        window.scrollTo(0, testScroll);

        if (canScroll || document.documentElement.scrollHeight > viewportHeight + 50) {
            console.log('[长截图] 使用 window 滚动');
            return null; // 浣跨敤 window 婊氬姩
        }
    }

    // 查找页面中的可滚动容�?
    // 常见的选择器用�?SPA 应用
    const candidateSelectors = [
        // Gemini 特定选择�?
        'main[class*="scroll"]',
        '[class*="chat-container"]',
        '[class*="message-container"]',
        '[class*="conversation"]',
        // 通用选择�?
        '[style*="overflow: auto"]',
        '[style*="overflow-y: auto"]',
        '[style*="overflow: scroll"]',
        '[style*="overflow-y: scroll"]',
        'main',
        '[role="main"]',
        '.main-content',
        '#main-content',
        '[class*="content"]'
    ];

    // 首先尝试特定选择�?
    for (const selector of candidateSelectors) {
        try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                if (isScrollableElement(el, viewportHeight)) {
                    console.log('[长截图] 找到可滚动容器(通过选择器):', selector, el);
                    return el;
                }
            }
        } catch (e) {
            // 忽略无效选择�?
        }
    }

    // 如果没找到，遍历所有元素查找可滚动的容�?
    const allElements = document.querySelectorAll('*');
    let bestCandidate = null;
    let maxScrollHeight = 0;

    for (const el of allElements) {
        if (isScrollableElement(el, viewportHeight)) {
            const scrollHeight = el.scrollHeight;
            // 选择滚动高度最大的容器
            if (scrollHeight > maxScrollHeight && scrollHeight > viewportHeight + 100) {
                maxScrollHeight = scrollHeight;
                bestCandidate = el;
            }
        }
    }

    if (bestCandidate) {
        console.log('[长截图] 找到可滚动容器(通过遍历):', bestCandidate.tagName, bestCandidate.className);
        return bestCandidate;
    }

    console.log('[长截图] 未找到特殊滚动容器，使用 window');
    return null;
}

/**
 * 检查元素是否为可滚动元�?
 */
function isScrollableElement(el, viewportHeight) {
    if (!el || el === document.body || el === document.documentElement) return false;

    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;

    // 检查是否设置了滚动相关样式
    const hasScrollStyle = overflowY === 'auto' || overflowY === 'scroll' ||
        overflowX === 'auto' || overflowX === 'scroll';

    // 检查是否有足够的滚动内�?
    const hasScrollableContent = el.scrollHeight > el.clientHeight + 50;

    // 检查元素是否足够大（至少占视口�?50%�?
    const rect = el.getBoundingClientRect();
    const isLargeEnough = rect.height > viewportHeight * 0.5;

    return hasScrollStyle && hasScrollableContent && isLargeEnough;
}

async function doFullPageCapture(name, format, tool, options = {}) {
    const { manualMode = false, startFromCurrent = false } = options;

    console.log('[长截图] 开始执行长截图...', { manualMode, startFromCurrent });

    // 获取设备像素�?- 关键修复：所有像素计算都需要考虑 DPR
    const dpr = window.devicePixelRatio || 1;
    console.log('[长截图] 设备像素比:', dpr);

    const body = document.body;
    const html = document.documentElement;

    // 绂佺敤骞虫粦婊氬姩
    const originalScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';

    // 查找可滚动容�?
    const scrollContainer = findScrollableContainer();
    const useContainerScroll = scrollContainer !== null;

    if (useContainerScroll) {
        scrollContainer.style.scrollBehavior = 'auto';
    }

    // 淇濆瓨鍘熷婊氬姩浣嶇疆
    const originalScrollTop = useContainerScroll ? scrollContainer.scrollTop : window.scrollY;

    // 滚动函数（支持容器和 window�?
    function scrollTo(position) {
        if (useContainerScroll) {
            scrollContainer.scrollTop = position;
        } else {
            window.scrollTo(0, position);
        }
    }

    // 获取当前滚动位置
    function getCurrentScroll() {
        return useContainerScroll ? scrollContainer.scrollTop : window.scrollY;
    }

    // 获取最大可滚动距离
    function getMaxScroll() {
        if (useContainerScroll) {
            return scrollContainer.scrollHeight - scrollContainer.clientHeight;
        } else {
            return Math.max(
                document.documentElement.scrollHeight - window.innerHeight,
                document.body.scrollHeight - window.innerHeight,
                0
            );
        }
    }

    // 获取视口高度 (CSS 像素)
    function getViewportHeight() {
        return useContainerScroll ? scrollContainer.clientHeight : window.innerHeight;
    }

    const viewportHeightCSS = getViewportHeight();
    // 实际像素视口高度（用于图片裁剪）
    const viewportHeightPx = Math.round(viewportHeightCSS * dpr);

    // 视口宽度 - 实际尺寸将从第一张截图获�?
    let actualImageWidth = Math.round(window.innerWidth * dpr);
    let actualImageHeight = viewportHeightPx;

    // 纭畾璧峰浣嶇疆
    let startScrollPosition;

    if (startFromCurrent) {
        // 指定位置模式：从当前位置开�?
        startScrollPosition = getCurrentScroll();
        console.log('[长截图] 从当前位置开始:', startScrollPosition);
    } else {
        // 从头开始模式：回到顶部
        startScrollPosition = 0;
        scrollTo(0);
        await wait(200);
        console.log('[长截图] 从页面顶部开始');
    }

    // 检测固定头部高度（传入滚动容器以支�?SPA 应用�? CSS 像素
    const fixedHeaderHeightCSS = findFixedHeaderHeight(scrollContainer);
    console.log('[长截图] 固定头部高度:', fixedHeaderHeightCSS, 'px (CSS)');

    // 检测固定底部高度（�?Gemini 的输入区域）- CSS 像素
    const fixedFooterHeightCSS = findFixedFooterHeight(scrollContainer);
    console.log('[长截图] 固定底部高度:', fixedFooterHeightCSS, 'px (CSS)');

    // 计算每次滚动的步长（CSS 像素�?
    // 关键修复：使用更保守的重叠区域，确保不会遗漏内容
    const safetyOverlapCSS = Math.max(30, Math.round(viewportHeightCSS * 0.05));
    const scrollStepCSS = viewportHeightCSS - fixedHeaderHeightCSS - fixedFooterHeightCSS - safetyOverlapCSS;
    console.log('[长截图] 滚动步长:', scrollStepCSS, 'px (安全重叠:', safetyOverlapCSS, 'px)');

    // 确保滚动步长合理（至少为视口�?40%�?
    if (scrollStepCSS < viewportHeightCSS * 0.4) {
        console.warn('[长截图] 滚动步长过小，可能检测到的固定区域不正确');
    }

    // 重置停止标志
    captureStopRequested = false;

    // 鏄剧ず鎺у埗闈㈡澘
    createCaptureControlPanel();

    // 触发懒加�?
    function triggerLazyLoad() {
        window.dispatchEvent(new Event('scroll'));
        if (useContainerScroll) {
            scrollContainer.dispatchEvent(new Event('scroll'));
        }
        document.querySelectorAll('img[data-src], img[loading="lazy"]').forEach(img => {
            if (img.dataset.src) img.src = img.dataset.src;
        });
    }

    const captures = [];
    let currentScrollCSS = startScrollPosition;
    let captureIndex = 0;
    let prevScrollPositionCSS = startScrollPosition;

    // 开始截图循�?
    try {
        while (true) {
            // 检查停止条�?
            if (captureStopRequested) {
                console.log('[长截图] 用户请求停止');
                break;
            }

            // 检查是否到达底�?
            const maxScrollCSS = getMaxScroll();
            const actualScrollCSS = getCurrentScroll();

            if (currentScrollCSS > maxScrollCSS + viewportHeightCSS * 2) {
                console.log('[长截图] 超出最大滚动距离');
                break;
            }

            captureIndex++;
            updateCaptureProgress(captureIndex, null);
            console.log(`[长截图] 截取第 ${captureIndex} 张，位置: ${currentScrollCSS}`);

            // 滚动到目标位�?
            scrollTo(currentScrollCSS);
            triggerLazyLoad();
            // 等待足够的时间让页面渲染完成
            await wait(500);

            // 再等待一下确保渲染完�?
            await wait(150);

            // 记录实际滚动位置（可能与请求位置不同�?
            const realScrollCSS = getCurrentScroll();

            // 只隐藏我们的控制面板
            if (captureControlPanel) {
                captureControlPanel.style.display = 'none';
            }

            // 截取当前画面，带重试
            let dataUrl = null;
            for (let retry = 0; retry < 5 && !dataUrl; retry++) {
                try {
                    dataUrl = await chrome.runtime.sendMessage({ action: 'captureTab' });
                    if (!dataUrl && retry < 4) {
                        console.warn(`[长截图] 截图返回空，重试 ${retry + 1}/5`);
                        await wait(300 + retry * 100);
                    }
                } catch (e) {
                    console.warn(`[长截图] 截图出错，重试 ${retry + 1}/5:`, e.message);
                    await wait(300 + retry * 100);
                }
            }

            // 鎭㈠鎺у埗闈㈡澘鏄剧ず
            if (captureControlPanel) {
                captureControlPanel.style.display = 'flex';
            }

            if (!dataUrl) {
                console.error('[长截图] 多次重试后仍然失败');
                throw new Error('截图失败 - 请刷新页面重试');
            }

            // 从第一张截图获取实际尺�?
            if (captureIndex === 1) {
                const tempImg = new Image();
                await new Promise((resolve) => {
                    tempImg.onload = () => {
                        actualImageWidth = tempImg.width;
                        actualImageHeight = tempImg.height;
                        console.log('[长截图] 实际截图尺寸:', actualImageWidth, 'x', actualImageHeight, '(DPR:', dpr, ')');
                        resolve();
                    };
                    tempImg.onerror = () => resolve();
                    tempImg.src = dataUrl;
                });
            }

            // 关键修复：记录精确的滚动位置差值用于拼接计�?
            const scrollDeltaCSS = captureIndex === 1 ? 0 : (realScrollCSS - prevScrollPositionCSS);

            captures.push({
                src: dataUrl,
                scrollPositionCSS: realScrollCSS,
                scrollDeltaCSS: scrollDeltaCSS,
                isFirst: captureIndex === 1,
                isLast: false // 绋嶅悗鏇存柊
            });

            prevScrollPositionCSS = realScrollCSS;

            // 移动到下一个位�?
            currentScrollCSS += scrollStepCSS;

            // 检查是否已到底�?
            const newActualScrollCSS = getCurrentScroll();
            if (newActualScrollCSS >= maxScrollCSS - 5) {
                console.log('[长截图] 已到达页面底部，结束截图');
                break;
            }
        }

        // 标记最后一�?
        if (captures.length > 0) {
            captures[captures.length - 1].isLast = true;
        }

        // 绉婚櫎鎺у埗闈㈡澘
        removeCaptureControlPanel();

        if (captures.length === 0) {
            alert('没有截取到任何内容');
            return;
        }

        console.log(`[长截图] 截取完成，共 ${captures.length} 张，开始拼接...`);

        // 鎭㈠婊氬姩浣嶇疆
        scrollTo(originalScrollTop);
        document.documentElement.style.scrollBehavior = originalScrollBehavior;

        // ===== 拼接图片 - 关键修复：使用实际像素进行所有计�?=====

        // 固定区域的实际像素高�?
        const fixedHeaderHeightPx = Math.round(fixedHeaderHeightCSS * dpr);
        const fixedFooterHeightPx = Math.round(fixedFooterHeightCSS * dpr);
        const safetyOverlapPx = Math.round(safetyOverlapCSS * dpr);

        // 计算每张图片贡献的实际高度（像素�?
        let totalStitchHeightPx = 0;

        for (let i = 0; i < captures.length; i++) {
            const cap = captures[i];

            if (cap.isFirst) {
                // 第一张：整个视口减去底部固定区域
                cap.sourceYPx = 0;
                cap.sourceHeightPx = actualImageHeight - fixedFooterHeightPx;
                cap.effectiveHeightPx = cap.sourceHeightPx;
            } else {
                // 后续图片：基于实际滚动距离计�?
                // 从顶部裁剪掉固定头部 + 安全重叠区域
                cap.sourceYPx = fixedHeaderHeightPx + safetyOverlapPx;

                // 使用实际滚动的距离作为贡献高�?
                const scrollDeltaPx = Math.round(cap.scrollDeltaCSS * dpr);
                cap.effectiveHeightPx = scrollDeltaPx;

                // 源区域高�?= 滚动距离（因为我们只需要新滚入的内容）
                cap.sourceHeightPx = scrollDeltaPx;
            }

            totalStitchHeightPx += cap.effectiveHeightPx;
            console.log(`[长截图] 图片 ${i + 1}: sourceY=${cap.sourceYPx}, sourceH=${cap.sourceHeightPx}, effectiveH=${cap.effectiveHeightPx}`);
        }

        console.log('[长截图] 拼接总高度:', totalStitchHeightPx, 'px');

        // 限制最大高度防止内存溢�?
        const maxCanvasHeight = 32000;
        const scale = totalStitchHeightPx > maxCanvasHeight ? maxCanvasHeight / totalStitchHeightPx : 1;
        const finalWidth = Math.floor(actualImageWidth * scale);
        const finalHeight = Math.floor(totalStitchHeightPx * scale);

        console.log('[长截图] 最终尺寸:', finalWidth, 'x', finalHeight, '缩放:', scale);

        let stitchCanvas;
        let ctx;
        try {
            stitchCanvas = document.createElement('canvas');
            stitchCanvas.width = finalWidth;
            stitchCanvas.height = finalHeight;
            ctx = stitchCanvas.getContext('2d', { willReadFrequently: false });

            if (!ctx) {
                throw new Error('无法创建 canvas 上下文');
            }

            // 填充白色背景防止透明区域
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, finalWidth, finalHeight);
        } catch (memErr) {
            console.error('[长截图] Canvas 创建失败:', memErr);
            throw new Error('图片太大，内存不足。请尝试截取更短的页面。');
        }

        // 按顺序加载并绘制图片
        let drawY = 0;
        for (let i = 0; i < captures.length; i++) {
            const cap = captures[i];

            try {
                await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        try {
                            const sourceY = cap.sourceYPx;
                            const sourceHeight = Math.min(cap.sourceHeightPx, img.height - sourceY);
                            const drawHeight = Math.floor(cap.effectiveHeightPx * scale);

                            // 确保不会绘制超出图片边界
                            if (sourceHeight > 0 && drawHeight > 0) {
                                ctx.drawImage(
                                    img,
                                    0, sourceY, actualImageWidth, sourceHeight,
                                    0, drawY, finalWidth, drawHeight
                                );
                                drawY += drawHeight;
                            }

                            // 绔嬪嵆娓呯悊浠ラ噴鏀惧唴瀛?
                            img.src = '';
                            resolve();
                        } catch (drawErr) {
                            reject(drawErr);
                        }
                    };
                    img.onerror = () => reject(new Error(`图片 ${i + 1} 加载失败`));
                    img.src = cap.src;
                });

                // 清理已使用的图片数据释放内存
                cap.src = null;

            } catch (imgErr) {
                console.error(`[长截图] 处理第${i + 1} 张图片失败`, imgErr);
                // 继续处理其他图片
            }
        }

        // 清理 captures 数组释放内存
        captures.length = 0;

        console.log('[长截图] 拼接完成，生成最终图片...');

        const stitchedData = stitchCanvas.toDataURL('image/png');
        const finalCanvas = await processCanvas(stitchedData, name, tool);
        const filename = generateFilename(name, format, tool);
        downloadCanvas(finalCanvas, filename, format);

        console.log('[长截图] 完成');

        // 成功提示
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            padding: 12px 20px; background: rgba(76,175,80,0.95);
            color: white; border-radius: 8px; z-index: 2147483647;
            font-family: -apple-system, sans-serif; font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        toast.textContent = '✅ 长截图完成！';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);

    } catch (err) {
        console.error('[长截图] 失败:', err);
        removeCaptureControlPanel();
        scrollTo(originalScrollTop);
        document.documentElement.style.scrollBehavior = originalScrollBehavior;
        alert('长截图失败: ' + (err.message || '请重试'));
    }
}

// ==================== 翻译功能 ====================

(function initTranslator() {
    'use strict';

    // 閰嶇疆
    const SPACE_COUNT_THRESHOLD = 3;  // 需要连续按下的空格次数
    const SPACE_TIMEOUT = 500;        // 空格检测超时时�?ms)

    // 状态变�?
    let spaceCount = 0;
    let lastSpaceTime = 0;
    let isTranslating = false;
    const handledKeyEvents = new WeakSet();

    // 璁剧疆缂撳瓨
    let isEnabled = true;
    let shortcutType = 'triple_space';
    let targetLang = 'auto';
    let translateSelectionOnly = true;
    const FLOATING_TRANSLATOR_PANEL_ID = 'webcraft-floating-translator-panel';
    const FLOATING_TRANSLATOR_HANDLE_ID = 'webcraft-floating-translator-handle';

    chrome.storage.local.get(['translateEnabled', 'translateShortcut', 'translateTargetLang', 'translateSelectionOnly'], (res) => {
        if (res.translateEnabled !== undefined) isEnabled = res.translateEnabled;
        if (res.translateShortcut) shortcutType = res.translateShortcut;
        if (res.translateTargetLang) targetLang = res.translateTargetLang;
        if (res.translateSelectionOnly !== undefined) translateSelectionOnly = res.translateSelectionOnly;
    });

    // 鐩戝惉璁剧疆鍙樻洿娑堟伅
    chrome.runtime.onMessage.addListener((req) => {
        if (req.action === 'updateTranslateSettings') {
            if (req.payload.enabled !== undefined) isEnabled = req.payload.enabled;
            if (req.payload.shortcut !== undefined) shortcutType = req.payload.shortcut;
            if (req.payload.targetLang !== undefined) targetLang = req.payload.targetLang || 'auto';
            if (req.payload.selectionOnly !== undefined) translateSelectionOnly = req.payload.selectionOnly;
        }
    });

    // 中文字符正则表达�?
    const CHINESE_REGEX = /[\u4e00-\u9fa5]+/;
    const CHINESE_MATCH_REGEX = /[\u4e00-\u9fa5]+/g;
    // 英文字符正则表达�?(至少包含连续的英文单�?
    const ENGLISH_REGEX = /[a-zA-Z]{2,}/;
    const ENGLISH_MATCH_REGEX = /[a-zA-Z]{2,}/g;

    /**
     * 检查文本是否包含中�?
     */
    function containsChinese(text) {
        return CHINESE_REGEX.test(text);
    }

    /**
     * 检查文本是否主要是英文
     */
    function isMainlyEnglish(text) {
        const chineseMatches = text.match(CHINESE_MATCH_REGEX) || [];
        const englishMatches = text.match(ENGLISH_MATCH_REGEX) || [];
        const chineseLength = chineseMatches.join('').length;
        const englishLength = englishMatches.join('').length;
        // 如果英文字符多于中文字符，认为是英文
        return englishLength > chineseLength && englishLength >= 2;
    }

    /**
     * 获取当前翻译设置
     */
    async function getSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['translateEngine', 'translateTargetLang', 'translateHistoryEnabled'], (result) => {
                resolve({
                    mode: result.translateEngine || 'google',
                    targetLang: result.translateTargetLang || targetLang || 'auto',
                    historyEnabled: result.translateHistoryEnabled !== false
                });
            });
        });
    }

    /**
     * 使用 Google 翻译 API（快速模式）
     * @param {string} text - 要翻译的文本
     * @param {string} direction - 翻译方向: 'zh2en' �?'en2zh'
     */
    async function translateWithGoogle(text, direction = 'zh2en', target = 'auto') {
        const sl = target === 'auto' ? (direction === 'zh2en' ? 'zh-CN' : 'en') : 'auto';
        const tl = target === 'auto' ? (direction === 'zh2en' ? 'en' : 'zh-CN') : target;
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            // 解析翻译结果
            let translatedText = '';
            if (data && data[0]) {
                for (const item of data[0]) {
                    if (item[0]) {
                        translatedText += item[0];
                    }
                }
            }
            return translatedText || text;
        } catch (error) {
            console.error('Google 翻译失败:', error);
            throw error;
        }
    }

    /**
     * 主翻译函�?
     * @param {string} text - 要翻译的文本
     * @param {string} direction - 翻译方向: 'zh2en' �?'en2zh'
     */
    async function translateWithDeepL(text, direction = 'zh2en', target = 'auto') {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'translateWithDeepL',
                payload: { text, direction, target }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.success) {
                    reject(new Error(response?.error || 'DeepL 翻译失败'));
                    return;
                }
                resolve(response.translatedText);
            });
        });
    }

    async function translateText(text, direction = 'zh2en') {
        const settings = await getSettings();
        const target = settings.targetLang || 'auto';
        if (settings.mode === 'deepl') {
            try {
                return await translateWithDeepL(text, direction, target);
            } catch (error) {
                console.warn('DeepL 翻译失败，已自动切换 Google:', error);
                return await translateWithGoogle(text, direction, target);
            }
        }
        return await translateWithGoogle(text, direction, target);
    }

    /**
     * 获取输入框中的文�?- 增强�?
     */
    function getInputText(element) {
        // 鏍囧噯 input/textarea
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            return element.value || '';
        }

        // contenteditable 元素
        if (element.isContentEditable || element.contentEditable === 'true') {
            // 浼樺厛浣跨敤 innerText 淇濈暀鎹㈣
            return element.innerText || element.textContent || '';
        }

        // 检查是否有 value 属性（某些自定义组件）
        if ('value' in element) {
            return element.value || '';
        }

        // 回退�?textContent
        return element.textContent || '';
    }

    /**
     * 设置输入框中的文�?- 增强�?(支持 Teams 等复杂编辑器)
     */
    function setInputText(element, text) {
        element.focus();

        // ===== Teams CKEditor 特殊处理 =====
        // Teams 使用 CKEditor，需要特殊的 innerHTML 方式
        if (element.getAttribute('data-tid') === 'ckeditor' ||
            (element.className && element.className.includes('ck-editor__editable'))) {
            setCKEditorText(element, text);
            return;
        }

        // 鏍囧噯 input/textarea
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            // 淇濈暀鎾ら攢鍘嗗彶
            const value = element.value;
            element.value = text; // 鐩存帴璁剧疆鍊?
            // 某些框架如果不触�?input 事件可能不会更新状�?
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            return;
        }

        // contenteditable 元素 (Teams, Notion, etc.)
        if (element.isContentEditable || element.contentEditable === 'true') {
            // 策略 A: 尝试使用 execCommand (最兼容富文本编辑器)
            try {
                // 全�?
                document.execCommand('selectAll', false, null);
                // 插入文本 (这通常会触发编辑器的内部逻辑)
                if (document.execCommand('insertText', false, text)) {
                    return;
                }
            } catch (e) {
                console.warn('execCommand failed, falling back to innerText', e);
            }

            // 策略 B: 直接操作 innerText (备用)
            element.textContent = text;

            // 触发事件
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));

            return;
        }

        // 灏濊瘯璁剧疆 value 灞炴€?
        if ('value' in element) {
            element.value = text;
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
    }

    function getSelectedTextInfo(element) {
        if (!translateSelectionOnly) return null;

        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            if (typeof start === 'number' && typeof end === 'number' && end > start) {
                return {
                    type: 'field',
                    start,
                    end,
                    text: element.value.slice(start, end)
                };
            }
            return null;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
        const range = selection.getRangeAt(0);
        if (!element.contains(range.commonAncestorContainer)) return null;
        return {
            type: 'range',
            range: range.cloneRange(),
            text: selection.toString()
        };
    }

    function setTranslatedText(element, text, selectionInfo = null) {
        if (!selectionInfo) {
            setInputText(element, text);
            return;
        }

        if (selectionInfo.type === 'field') {
            const value = element.value;
            element.value = value.slice(0, selectionInfo.start) + text + value.slice(selectionInfo.end);
            const cursor = selectionInfo.start + text.length;
            element.setSelectionRange(cursor, cursor);
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            return;
        }

        if (selectionInfo.type === 'range') {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(selectionInfo.range);
            if (!document.execCommand('insertText', false, text)) {
                selectionInfo.range.deleteContents();
                selectionInfo.range.insertNode(document.createTextNode(text));
            }
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
    }

    function saveTranslationHistory(source, result, direction) {
        chrome.storage.local.get(['translationHistory', 'translateHistoryEnabled'], (stored) => {
            if (stored.translateHistoryEnabled === false) return;
            const history = Array.isArray(stored.translationHistory) ? stored.translationHistory : [];
            history.unshift({
                source,
                result,
                direction,
                time: Date.now()
            });
            chrome.storage.local.set({ translationHistory: history.slice(0, 50) });
        });
    }

    /**
     * 专门处理 CKEditor (Teams 使用的编辑器)
     */
    function setCKEditorText(element, text) {
        // CKEditor 使用 <p> 标签包裹内容；用 textContent 避免翻译结果被当�?HTML 执行�?        element.textContent = '';
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        element.appendChild(paragraph);

        // 触发 CKEditor 的事�?        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // 灏嗗厜鏍囩Щ鍒版湯灏?
        try {
            const range = document.createRange();
            const sel = window.getSelection();
            const lastChild = element.lastElementChild || element;
            range.selectNodeContents(lastChild);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) {
            // 忽略光标错误
        }
    }

    /**
     * 处理翻译逻辑
     */
    async function handleTranslation(element) {
        if (isTranslating) return;

        const selectionInfo = getSelectedTextInfo(element);
        let text = selectionInfo?.text || getInputText(element);

        // 移除末尾的空格（可能�?个或3个）
        text = selectionInfo ? text.trim() : text.replace(/\s{2,}$/, '').trim();

        if (!text) {
            return;
        }

        const settings = await getSettings();
        // 判断翻译方向：如果主要是英文则翻译成中文，否则翻译成英文
        const direction = settings.targetLang !== 'auto'
            ? `auto2${settings.targetLang}`
            : isMainlyEnglish(text) ? 'en2zh' : 'zh2en';

        // 如果是中译英，需要有中文；如果是英译中，需要有英文
        if (settings.targetLang === 'auto' && direction === 'zh2en' && !containsChinese(text)) {
            return;
        }
        if (settings.targetLang === 'auto' && direction === 'en2zh' && !ENGLISH_REGEX.test(text)) {
            return;
        }

        isTranslating = true;
        const directionText = settings.targetLang === 'auto' ? (direction === 'zh2en' ? 'zh->en' : 'en->zh') : `to ${settings.targetLang}`;
        const modeText = `${directionText}...`;

        try {
            const originalText = text;
            if (!selectionInfo) setInputText(element, text + ` (${modeText})`);

            // 翻译文本
            const translatedText = await translateText(text, direction);

            // 设置翻译结果
            setTranslatedText(element, translatedText, selectionInfo);
            saveTranslationHistory(originalText, translatedText, direction);

            console.log(`[${settings.mode}] ${directionText} 完成`);
        } catch (error) {
            console.error('翻译过程出错:', error);
            // 恢复原文
            if (!selectionInfo) setInputText(element, text);

        } finally {
            isTranslating = false;
        }
    }

    function getTranslationDirection(text, settings) {
        return settings.targetLang !== 'auto'
            ? `auto2${settings.targetLang}`
            : isMainlyEnglish(text) ? 'en2zh' : 'zh2en';
    }

    function getPageSelectionInfo() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

        const text = selection.toString().trim();
        if (!text) return null;

        const range = selection.getRangeAt(0).cloneRange();
        const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;

        if (container && isInputElement(container)) return null;

        const rect = range.getBoundingClientRect();
        return { text, rect };
    }

    function getTranslationPopupPosition(rect) {
        const margin = 14;
        const width = Math.min(460, window.innerWidth - margin * 2);
        const height = Math.min(360, window.innerHeight - margin * 2);
        const anchorLeft = rect?.left ?? (window.innerWidth - width) / 2;
        const anchorTop = rect?.top ?? margin;
        const anchorBottom = rect?.bottom ?? (anchorTop + 24);
        const centerLeft = anchorLeft + ((rect?.width || width) / 2) - width / 2;
        const left = Math.min(Math.max(margin, centerLeft), window.innerWidth - width - margin);
        const spaceAbove = anchorTop - margin;
        const spaceBelow = window.innerHeight - anchorBottom - margin;
        let top;

        if (spaceAbove >= Math.min(height, 220) || spaceAbove > spaceBelow) {
            top = Math.max(margin, anchorTop - height - 10);
        } else {
            top = Math.min(anchorBottom + 10, window.innerHeight - height - margin);
        }

        return {
            left: Math.round(left),
            top: Math.round(Math.max(margin, top)),
            width: Math.round(width),
            maxHeight: Math.round(height)
        };
    }

    function makeTranslationPopupDraggable(popup, handle) {
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            dragging = true;
            offsetX = event.clientX - popup.getBoundingClientRect().left;
            offsetY = event.clientY - popup.getBoundingClientRect().top;
            handle.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });

        handle.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            const rect = popup.getBoundingClientRect();
            const margin = 8;
            const left = Math.min(Math.max(margin, event.clientX - offsetX), window.innerWidth - rect.width - margin);
            const top = Math.min(Math.max(margin, event.clientY - offsetY), window.innerHeight - rect.height - margin);
            popup.style.left = `${left}px`;
            popup.style.top = `${top}px`;
        });

        const stopDragging = (event) => {
            if (!dragging) return;
            dragging = false;
            handle.releasePointerCapture?.(event.pointerId);
        };
        handle.addEventListener('pointerup', stopDragging);
        handle.addEventListener('pointercancel', stopDragging);
    }

    function showPageTranslationPopup(sourceText, translatedText, rect, isLoading = false) {
        document.getElementById('translator-selection-popup')?.remove();

        const popup = document.createElement('div');
        popup.id = 'translator-selection-popup';
        const position = getTranslationPopupPosition(rect);
        popup.style.cssText = `
            position: fixed;
            left: ${position.left}px;
            top: ${position.top}px;
            width: ${position.width}px;
            max-height: ${position.maxHeight}px;
            z-index: 2147483647;
            background: rgba(17, 19, 24, 0.96);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 14px;
            box-shadow: 0 16px 46px rgba(0,0,0,0.38);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            overflow: hidden;
            resize: both;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.1);cursor:move;user-select:none;';

        const title = document.createElement('strong');
        title.textContent = isLoading ? '翻译中...' : '翻译结果';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        closeBtn.style.cssText = 'border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer;line-height:1;';
        closeBtn.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            popup.remove();
        });

        const body = document.createElement('div');
        body.style.cssText = `
            max-height: ${Math.max(180, position.maxHeight - 45)}px;
            overflow: auto;
            padding: 12px;
        `;

        const result = document.createElement('div');
        result.textContent = translatedText;
        result.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:15px;';

        const source = document.createElement('div');
        source.textContent = sourceText;
        source.style.cssText = 'margin-top:10px;color:rgba(255,255,255,0.58);font-size:12px;white-space:pre-wrap;word-break:break-word;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px;';

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '复制译文';
        copyBtn.style.cssText = 'margin-top:10px;border:0;border-radius:7px;background:#5b50d8;color:#fff;padding:6px 10px;cursor:pointer;font-size:12px;';
        copyBtn.onclick = async () => {
            await navigator.clipboard?.writeText(translatedText);
            copyBtn.textContent = '已复制';
            setTimeout(() => { copyBtn.textContent = '复制译文'; }, 1200);
        };

        header.appendChild(title);
        header.appendChild(closeBtn);
        popup.appendChild(header);
        body.appendChild(result);
        if (!isLoading) body.appendChild(copyBtn);
        body.appendChild(source);
        popup.appendChild(body);
        document.body.appendChild(popup);
        makeTranslationPopupDraggable(popup, header);
    }

    function ensureFloatingTranslatorHandle() {
        let handle = document.getElementById(FLOATING_TRANSLATOR_HANDLE_ID);
        if (handle) return handle;

        handle = document.createElement('button');
        handle.id = FLOATING_TRANSLATOR_HANDLE_ID;
        handle.type = 'button';
        handle.title = '打开浮动翻译';
        handle.textContent = '翻译';
        handle.style.cssText = `
            position: fixed;
            right: 0;
            top: calc(42% + 48px);
            transform: translateY(-50%);
            z-index: 2147483644;
            border: 1px solid rgba(255,255,255,0.14);
            border-right: 0;
            border-radius: 10px 0 0 10px;
            padding: 10px 8px;
            background: rgba(17,19,24,0.94);
            color: #fff;
            box-shadow: 0 10px 26px rgba(0,0,0,0.28);
            cursor: pointer;
            font: 700 12px/1.1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            writing-mode: vertical-rl;
            letter-spacing: 0;
        `;
        handle.addEventListener('click', () => toggleFloatingTranslatorPanel(true));
        document.body.appendChild(handle);
        return handle;
    }

    function createFloatingTranslatorControl(tag, text, value) {
        const option = document.createElement(tag);
        option.textContent = text;
        if (value !== undefined) option.value = value;
        return option;
    }

    function setFloatingTranslatorStatus(panel, text, type = '') {
        const status = panel.querySelector('[data-role="translator-status"]');
        status.textContent = text;
        status.style.color = type === 'error' ? '#fca5a5' : type === 'success' ? '#86efac' : 'rgba(255,255,255,0.68)';
    }

    function setFloatingTranslatorResult(panel, text) {
        const result = panel.querySelector('[data-role="translator-result"]');
        const copyBtn = panel.querySelector('[data-role="translator-copy"]');
        result.textContent = text || '';
        result.style.display = text ? 'block' : 'none';
        copyBtn.style.display = text ? 'inline-flex' : 'none';
    }

    async function translateFloatingPanelText(panel) {
        const input = panel.querySelector('[data-role="translator-input"]');
        const engineSelect = panel.querySelector('[data-role="translator-engine"]');
        const targetSelect = panel.querySelector('[data-role="translator-target"]');
        const translateBtn = panel.querySelector('[data-role="translator-run"]');
        const text = input.value.trim();

        if (!text) {
            setFloatingTranslatorStatus(panel, '请输入或粘贴要翻译的文字', 'error');
            input.focus();
            return;
        }

        translateBtn.disabled = true;
        setFloatingTranslatorStatus(panel, '正在翻译...');
        try {
            await new Promise(resolve => {
                chrome.storage.local.set({
                    translateEngine: engineSelect.value,
                    translateTargetLang: targetSelect.value
                }, resolve);
            });
            targetLang = targetSelect.value || 'auto';
            const direction = getTranslationDirection(text, {
                targetLang: targetSelect.value || 'auto'
            });
            const translatedText = await translateText(text, direction);
            setFloatingTranslatorResult(panel, translatedText);
            setFloatingTranslatorStatus(panel, '翻译完成', 'success');
        } catch (error) {
            console.error('浮动翻译失败', error);
            setFloatingTranslatorStatus(panel, error.message || '翻译失败', 'error');
        } finally {
            translateBtn.disabled = false;
        }
    }

    function ensureFloatingTranslatorPanel() {
        let panel = document.getElementById(FLOATING_TRANSLATOR_PANEL_ID);
        if (panel) return panel;

        panel = document.createElement('section');
        panel.id = FLOATING_TRANSLATOR_PANEL_ID;
        panel.style.cssText = `
            position: fixed;
            right: 68px;
            top: 84px;
            width: min(430px, calc(100vw - 28px));
            max-height: calc(100vh - 110px);
            display: none;
            flex-direction: column;
            overflow: hidden;
            z-index: 2147483647;
            background: rgba(17,19,24,0.97);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 14px;
            box-shadow: 0 18px 50px rgba(0,0,0,0.38);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,0.1);cursor:move;user-select:none;';

        const title = document.createElement('strong');
        title.textContent = '浮动翻译';
        title.style.cssText = 'font-size:14px;';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        closeBtn.style.cssText = 'border:0;background:transparent;color:#fff;font-size:20px;line-height:1;cursor:pointer;';
        closeBtn.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        closeBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            hideFloatingTranslatorPanel();
        });

        const body = document.createElement('div');
        body.style.cssText = 'padding:12px;overflow:auto;';

        const controls = document.createElement('div');
        controls.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;';

        const engineSelect = document.createElement('select');
        engineSelect.dataset.role = 'translator-engine';
        engineSelect.style.cssText = 'min-width:0;border:1px solid rgba(255,255,255,0.16);border-radius:8px;background:#252833;color:#fff;padding:8px;font:inherit;font-size:12px;';
        engineSelect.appendChild(createFloatingTranslatorControl('option', 'Google', 'google'));
        engineSelect.appendChild(createFloatingTranslatorControl('option', 'DeepL', 'deepl'));

        const targetSelect = document.createElement('select');
        targetSelect.dataset.role = 'translator-target';
        targetSelect.style.cssText = engineSelect.style.cssText;
        [
            ['自动中英互译', 'auto'],
            ['中文', 'zh-CN'],
            ['英语', 'en'],
            ['日语', 'ja'],
            ['韩语', 'ko'],
            ['法语', 'fr'],
            ['德语', 'de'],
            ['西班牙语', 'es'],
            ['俄语', 'ru']
        ].forEach(([label, value]) => targetSelect.appendChild(createFloatingTranslatorControl('option', label, value)));

        const input = document.createElement('textarea');
        input.dataset.role = 'translator-input';
        input.placeholder = '粘贴或输入要翻译的文字';
        input.rows = 5;
        input.style.cssText = `
            width:100%;
            min-height:118px;
            resize:vertical;
            box-sizing:border-box;
            border:1px solid rgba(255,255,255,0.16);
            border-radius:10px;
            background:#0f1117;
            color:#fff;
            padding:10px;
            outline:none;
            font:13px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        const actions = document.createElement('div');
        actions.style.cssText = 'display:grid;grid-template-columns:0.8fr 1.2fr 0.8fr;gap:8px;margin-top:8px;';

        const makeBtn = (text, primary = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.style.cssText = `
                border:0;
                border-radius:8px;
                padding:8px 10px;
                background:${primary ? '#5b50d8' : 'rgba(255,255,255,0.12)'};
                color:#fff;
                cursor:pointer;
                font:700 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            `;
            return button;
        };

        const pasteBtn = makeBtn('粘贴');
        const translateBtn = makeBtn('翻译', true);
        translateBtn.dataset.role = 'translator-run';
        const clearBtn = makeBtn('清空');
        const copyBtn = makeBtn('复制译文');
        copyBtn.dataset.role = 'translator-copy';
        copyBtn.style.display = 'none';
        copyBtn.style.marginTop = '8px';

        const result = document.createElement('div');
        result.dataset.role = 'translator-result';
        result.style.cssText = `
            display:none;
            margin-top:10px;
            max-height:220px;
            overflow:auto;
            border:1px solid rgba(255,255,255,0.12);
            border-radius:10px;
            background:rgba(255,255,255,0.06);
            padding:10px;
            white-space:pre-wrap;
            word-break:break-word;
            font-size:14px;
            line-height:1.58;
        `;

        const status = document.createElement('div');
        status.dataset.role = 'translator-status';
        status.style.cssText = 'min-height:18px;margin-top:8px;color:rgba(255,255,255,0.68);font-size:12px;text-align:center;';

        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                input.value = text || '';
                input.focus();
                if (text) setFloatingTranslatorStatus(panel, '已粘贴');
            } catch (error) {
                setFloatingTranslatorStatus(panel, '无法读取剪贴板', 'error');
            }
        });

        translateBtn.addEventListener('click', () => translateFloatingPanelText(panel));
        clearBtn.addEventListener('click', () => {
            input.value = '';
            setFloatingTranslatorResult(panel, '');
            setFloatingTranslatorStatus(panel, '');
            input.focus();
        });
        copyBtn.addEventListener('click', async () => {
            const text = result.textContent || '';
            if (!text) return;
            await navigator.clipboard.writeText(text);
            setFloatingTranslatorStatus(panel, '译文已复制', 'success');
        });
        input.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                translateFloatingPanelText(panel);
            }
        });
        engineSelect.addEventListener('change', () => {
            chrome.storage.local.set({ translateEngine: engineSelect.value });
        });
        targetSelect.addEventListener('change', () => {
            targetLang = targetSelect.value || 'auto';
            chrome.storage.local.set({ translateTargetLang: targetSelect.value });
        });

        header.appendChild(title);
        header.appendChild(closeBtn);
        controls.appendChild(engineSelect);
        controls.appendChild(targetSelect);
        actions.appendChild(pasteBtn);
        actions.appendChild(translateBtn);
        actions.appendChild(clearBtn);
        body.appendChild(controls);
        body.appendChild(input);
        body.appendChild(actions);
        body.appendChild(result);
        body.appendChild(copyBtn);
        body.appendChild(status);
        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);
        makeTranslationPopupDraggable(panel, header);
        return panel;
    }

    function hideFloatingTranslatorPanel() {
        const panel = document.getElementById(FLOATING_TRANSLATOR_PANEL_ID);
        if (panel) panel.style.display = 'none';
    }

    async function showFloatingTranslatorPanel(tryPaste = false) {
        const panel = ensureFloatingTranslatorPanel();
        const input = panel.querySelector('[data-role="translator-input"]');
        const engineSelect = panel.querySelector('[data-role="translator-engine"]');
        const targetSelect = panel.querySelector('[data-role="translator-target"]');

        chrome.storage.local.get(['translateEngine', 'translateTargetLang'], (settings) => {
            engineSelect.value = settings.translateEngine || 'google';
            targetSelect.value = settings.translateTargetLang || targetLang || 'auto';
        });

        panel.style.display = 'flex';
        panel.style.right = panel.style.right || '68px';
        panel.style.top = panel.style.top || '84px';

        if (tryPaste) {
            try {
                const text = await navigator.clipboard?.readText();
                if (text && !input.value.trim()) {
                    input.value = text;
                    setFloatingTranslatorStatus(panel, '已粘贴剪贴板文字');
                }
            } catch (error) {
                setFloatingTranslatorStatus(panel, '可以手动粘贴或输入文字');
            }
        }

        setTimeout(() => input?.focus(), 0);
    }

    function toggleFloatingTranslatorPanel(tryPaste = false) {
        const panel = ensureFloatingTranslatorPanel();
        if (panel.style.display === 'flex') {
            hideFloatingTranslatorPanel();
        } else {
            showFloatingTranslatorPanel(tryPaste);
        }
    }

    async function handlePageSelectionTranslation(selectionInfo) {
        if (isTranslating) return;

        const text = selectionInfo.text.trim();
        if (!text) return;

        isTranslating = true;
        const settings = await getSettings();
        const direction = getTranslationDirection(text, settings);

        try {
            showPageTranslationPopup(text, '正在翻译...', selectionInfo.rect, true);
            const translatedText = await translateText(text, direction);
            showPageTranslationPopup(text, translatedText, selectionInfo.rect);
            saveTranslationHistory(text, translatedText, direction);
        } catch (error) {
            console.error('网页选中文本翻译失败:', error);
            showPageTranslationPopup(text, '翻译失败，请稍后重试', selectionInfo.rect);
        } finally {
            isTranslating = false;
        }
    }

    function shouldTriggerTranslationShortcut(event, protectSpace = false) {
        let triggerTranslation = false;
        const currentTime = Date.now();

        if (shortcutType === 'triple_space') {
            if (event.key === ' ' || event.code === 'Space') {
                if (protectSpace) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                if (currentTime - lastSpaceTime > SPACE_TIMEOUT) {
                    spaceCount = 1;
                } else {
                    spaceCount++;
                }
                lastSpaceTime = currentTime;

                if (spaceCount >= SPACE_COUNT_THRESHOLD) {
                    event.preventDefault();
                    event.stopPropagation();
                    spaceCount = 0;
                    triggerTranslation = true;
                }
            } else {
                spaceCount = 0;
            }
        } else {
            const key = event.key.toLowerCase();
            if (shortcutType === 'ctrl_q') {
                if (event.ctrlKey && key === 'q') triggerTranslation = true;
            } else if (shortcutType === 'alt_q') {
                if (event.altKey && key === 'q') triggerTranslation = true;
            } else if (shortcutType === 'ctrl_e') {
                if (event.ctrlKey && key === 'e') triggerTranslation = true;
            }

            if (triggerTranslation) {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        return triggerTranslation;
    }

    /**
     * 检查元素是否为可输入元�?- 增强�?     */
    function isInputElement(element) {
        if (!element) return false;

        // ===== Teams / CKEditor 特殊检�?=====
        // Teams 使用 CKEditor，关键属性是 data-tid="ckeditor"
        if (element.getAttribute('data-tid') === 'ckeditor') return true;

        // CKEditor 类名检�?
        const className = element.className || '';
        if (typeof className === 'string' && className.includes('ck-editor__editable')) return true;

        // 检查是否在 CKEditor 内部 (如果焦点�?<p> 子元素上)
        if (element.closest && element.closest('[data-tid="ckeditor"]')) return true;

        // Teams 其他容器检�?
        if (element.getAttribute('data-tid') === 'chat-pane-compose-message') return true;

        const tagName = element.tagName?.toLowerCase();

        // 鏍囧噯 textarea
        if (tagName === 'textarea') return true;

        // 标准 input（文本类型）
        if (tagName === 'input') {
            const type = (element.type || '').toLowerCase();
            // 允许更多类型
            const textTypes = ['text', 'search', 'email', 'url', 'tel', 'password', ''];
            return textTypes.includes(type);
        }

        // contenteditable 元素
        if (element.isContentEditable) return true;
        if (element.contentEditable === 'true') return true;
        if (element.getAttribute && element.getAttribute('contenteditable') === 'true') return true;

        // 检�?role 属�?
        const role = element.getAttribute && element.getAttribute('role');
        if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;

        // 检查某些常见的类名模式 (使用已有�?className 变量)
        if (typeof className === 'string') {
            const inputPatterns = [
                'input', 'textarea', 'editor', 'textbox',
                'prompt', 'search-box', 'chat-input', 'message-input'
            ];
            const lowerClass = className.toLowerCase();
            for (const pattern of inputPatterns) {
                if (lowerClass.includes(pattern)) {
                    if (element.isContentEditable || 'value' in element) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * 获取实际的可编辑元素
     */
    function getEditableElement(element) {
        // 如果当前元素就是输入元素，直接返�?
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            return element;
        }

        // Teams CKEditor 特殊处理：找�?data-tid="ckeditor" 的元�?
        if (element.closest) {
            const ckeditor = element.closest('[data-tid="ckeditor"]');
            if (ckeditor) return ckeditor;
        }

        // 如果�?contenteditable，可能需要向上查�?
        if (element.isContentEditable) {
            // 鎵惧埌鏈€杩戠殑 contenteditable 鏍瑰厓绱?
            let current = element;
            while (current.parentElement && current.parentElement.isContentEditable) {
                current = current.parentElement;
            }
            return current;
        }

        return element;
    }

    /**
     * 键盘事件处理�?     */
    function handleKeyDown(event) {
        if (handledKeyEvents.has(event)) return;
        handledKeyEvents.add(event);

        if (!isEnabled) return;
        if (event.isComposing || event.repeat) return;

        let element = event.target;

        if (isInputElement(element)) {
            element = getEditableElement(element);
            const hasSelectedText = !!getSelectedTextInfo(element);
            if (shouldTriggerTranslationShortcut(event, hasSelectedText)) {
                handleTranslation(element);
            }
            return;
        }

        const pageSelection = getPageSelectionInfo();
        if (pageSelection && shouldTriggerTranslationShortcut(event, true)) {
            handlePageSelectionTranslation(pageSelection);
        } else if (!pageSelection && shortcutType === 'triple_space' && event.key !== ' ' && event.code !== 'Space') {
            spaceCount = 0;
        }
    }

    // 注册事件监听器（使用捕获阶段以确保最先处理）
    document.addEventListener('keydown', handleKeyDown, true);

    // 额外注册�?window 以捕获可能冒泡不�?document 的事�?
    window.addEventListener('keydown', handleKeyDown, true);

    // 为动态加载的 iframe 也注入监听器
    function injectToIframes() {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc && !iframeDoc._translatorInjected) {
                    iframeDoc.addEventListener('keydown', handleKeyDown, true);
                    iframeDoc._translatorInjected = true;
                }
            } catch (e) {
                // 跨域 iframe 无法访问，忽�?
            }
        });
    }

    // 鍒濆娉ㄥ叆
    injectToIframes();

    // 监听 DOM 变化，为新的 iframe 注入
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                injectToIframes();
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    window.__toolboxTranslateSelection = () => {
        const selectionInfo = getPageSelectionInfo();
        if (selectionInfo) handlePageSelectionTranslation(selectionInfo);
    };
    window.__toolboxToggleFloatingTranslator = () => toggleFloatingTranslatorPanel(true);
    ensureFloatingTranslatorHandle();

    console.log('翻译助手已加载 - 在任意输入框按三次空格触发翻译（中英双向）');
})();

// ==================== 网页采集画布 v1 ====================

(function initWebCollectorCanvas() {
    'use strict';

    const STORAGE_KEY = 'webCollectorItems';
    const PANEL_ID = 'web-collector-canvas-panel';
    const ACTION_BAR_ID = 'web-collector-action-bar';
    const HANDLE_ID = 'web-collector-canvas-handle';
    let selectionSnapshot = null;
    let collectorFilter = '';
    let collectorTypeFilter = 'all';
    let lastCollectorToggleAt = 0;
    let collectorOpenOnAdd = true;
    let collectorPageSaveEnabled = true;
    let collectorVisibleTypes = {
        text: true,
        image: true,
        page: true,
        link: true
    };

    function applyCollectorSettings(result = {}) {
        collectorOpenOnAdd = result.collectorOpenOnAdd !== false;
        collectorPageSaveEnabled = result.collectorPageSaveEnabled !== false;
        collectorVisibleTypes = {
            text: result.collectorShowTextFilter !== false,
            image: result.collectorShowImageFilter !== false,
            page: result.collectorShowPageFilter !== false,
            link: result.collectorShowLinkFilter !== false
        };
        if (collectorTypeFilter !== 'all' && !collectorVisibleTypes[collectorTypeFilter]) {
            collectorTypeFilter = 'all';
        }
    }

    chrome.storage.local.get([
        'collectorOpenOnAdd',
        'collectorPageSaveEnabled',
        'collectorShowTextFilter',
        'collectorShowImageFilter',
        'collectorShowPageFilter',
        'collectorShowLinkFilter'
    ], applyCollectorSettings);

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        const collectorKeys = [
            'collectorOpenOnAdd',
            'collectorPageSaveEnabled',
            'collectorShowTextFilter',
            'collectorShowImageFilter',
            'collectorShowPageFilter',
            'collectorShowLinkFilter'
        ];
        if (collectorKeys.some(key => changes[key])) {
            chrome.storage.local.get(collectorKeys, (result) => {
                applyCollectorSettings(result);
                renderPanel();
            });
        }
    });

    function isInsideCollectorUi(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        return !!element?.closest?.(`#${PANEL_ID}, #${ACTION_BAR_ID}, #${HANDLE_ID}, #translator-selection-popup, #webcraft-floating-translator-panel, #webcraft-floating-translator-handle`);
    }

    function isEditableElement(element) {
        if (!element) return false;
        const tag = element.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (element.isContentEditable || element.closest?.('[contenteditable="true"]')) return true;
        const role = element.getAttribute?.('role');
        return role === 'textbox' || role === 'combobox' || role === 'searchbox';
    }

    function getSelectionInfo() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

        const text = selection.toString().trim();
        if (!text) return null;

        const range = selection.getRangeAt(0).cloneRange();
        const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;

        if (!container || isInsideCollectorUi(container) || isEditableElement(container)) return null;

        const rect = range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return null;

        return { text, rect };
    }

    function getItems(callback) {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            callback(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
        });
    }

    function saveItems(items, callback) {
        chrome.storage.local.set({ [STORAGE_KEY]: items }, () => {
            updateHandleCount(items.length);
            if (callback) callback();
        });
    }

    function addCollectorItem(item) {
        getItems((items) => {
            items.unshift({
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                title: document.title || '',
                url: location.href,
                createdAt: new Date().toISOString(),
                ...item
            });
            saveItems(items.slice(0, 200), () => {
                renderPanel();
                if (collectorOpenOnAdd) showPanel();
                showActionFeedback('已加入画布');
            });
        });
    }

    function addTextItem(text) {
        addCollectorItem({
            type: 'text',
            text
        });
    }

    function addImageItem(imageInfo) {
        addCollectorItem({
            type: 'image',
            src: imageInfo.src,
            alt: imageInfo.alt,
            text: imageInfo.alt || imageInfo.src
        });
    }

    function addImageDataItem(dataUrl, name = 'pasted-image') {
        addCollectorItem({
            type: 'image',
            src: dataUrl,
            alt: name,
            text: name,
            localImage: true
        });
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
    }

    function isSafeCollectorUrl(url, allowedProtocols = ['http:', 'https:', 'data:', 'blob:']) {
        try {
            const parsed = new URL(url, location.href);
            return allowedProtocols.includes(parsed.protocol);
        } catch (error) {
            return false;
        }
    }

    function openSafeCollectorUrl(url) {
        if (!isSafeCollectorUrl(url, ['http:', 'https:', 'data:', 'blob:'])) {
            showActionFeedback('链接协议不安全');
            return;
        }
        window.open(url, '_blank', 'noopener');
    }

    async function addImageFiles(files) {
        const imageFiles = Array.from(files || []).filter(file => file.type?.startsWith('image/'));
        if (!imageFiles.length) {
            showActionFeedback('没有图片');
            return;
        }

        for (const file of imageFiles.slice(0, 20)) {
            const dataUrl = await readFileAsDataUrl(file);
            addImageDataItem(dataUrl, file.name || 'pasted-image');
        }
        if (collectorOpenOnAdd) showPanel();
    }

    async function addClipboardImages() {
        if (!navigator.clipboard?.read) {
            showActionFeedback('请用 Ctrl+V 粘贴');
            return;
        }

        try {
            const items = await navigator.clipboard.read();
            const imageFiles = [];
            for (const item of items) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (!imageType) continue;
                const blob = await item.getType(imageType);
                const ext = imageType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
                imageFiles.push(new File([blob], `clipboard-image-${Date.now()}.${ext}`, { type: imageType }));
            }

            if (!imageFiles.length) {
                showActionFeedback('剪贴板没有图片');
                return;
            }

            await addImageFiles(imageFiles);
        } catch (error) {
            console.warn('读取剪贴板图片失败', error);
            showActionFeedback('请用 Ctrl+V 粘贴');
        }
    }

    function addLinkItem(linkInfo) {
        addCollectorItem({
            type: 'link',
            href: linkInfo.href,
            text: linkInfo.text || linkInfo.href
        });
    }

    function getPageDescription() {
        return document.querySelector('meta[name="description"]')?.content ||
            document.querySelector('meta[property="og:description"]')?.content ||
            '';
    }

    function getPageFavicon() {
        const icon = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
        if (!icon?.href) return '';
        return isSafeCollectorUrl(icon.href, ['http:', 'https:', 'data:']) ? icon.href : '';
    }

    function addCurrentPageItem(extraText = '') {
        if (!collectorPageSaveEnabled) {
            showActionFeedback('网页收藏已关闭');
            return;
        }
        addCollectorItem({
            type: 'page',
            href: location.href,
            text: document.title || location.href,
            excerpt: extraText || getPageDescription(),
            favicon: getPageFavicon(),
            domain: location.hostname
        });
    }

    function removeItem(id) {
        getItems((items) => {
            saveItems(items.filter(item => item.id !== id), renderPanel);
        });
    }

    function updateItem(id, patch, callback) {
        getItems((items) => {
            const nextItems = items.map(item => item.id === id ? { ...item, ...patch } : item);
            saveItems(nextItems, callback || renderPanel);
        });
    }

    function togglePinned(item) {
        updateItem(item.id, { pinned: !item.pinned });
    }

    function dedupeItems() {
        getItems((items) => {
            const seen = new Set();
            const nextItems = items.filter(item => {
                const key = `${item.type}|${getItemText(item)}|${item.url || ''}`.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            if (nextItems.length === items.length) {
                showActionFeedback('没有重复内容');
                return;
            }
            saveItems(nextItems, () => {
                renderPanel();
                showActionFeedback(`已去重 ${items.length - nextItems.length} 条`);
            });
        });
    }

    function normalizeImportedItem(item) {
        if (!item || typeof item !== 'object') return null;
        const type = ['text', 'image', 'link', 'page'].includes(item.type) ? item.type : 'text';
        const now = new Date().toISOString();
        const normalized = {
            id: String(item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
            type,
            title: String(item.title || ''),
            url: String(item.url || location.href),
            createdAt: item.createdAt && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : now,
            text: String(item.text || ''),
            note: String(item.note || ''),
            pinned: item.pinned === true
        };
        if (type === 'image') {
            normalized.src = String(item.src || '');
            normalized.alt = String(item.alt || '');
            normalized.text = normalized.text || normalized.alt || normalized.src;
            if (!normalized.src || !isSafeCollectorUrl(normalized.src)) return null;
        } else if (type === 'link' || type === 'page') {
            normalized.href = String(item.href || item.url || '');
            normalized.text = normalized.text || normalized.href;
            if (!normalized.href || !isSafeCollectorUrl(normalized.href, ['http:', 'https:'])) return null;
            if (type === 'page') {
                normalized.excerpt = String(item.excerpt || '');
                normalized.favicon = isSafeCollectorUrl(item.favicon || '', ['http:', 'https:', 'data:']) ? String(item.favicon) : '';
                normalized.domain = String(item.domain || '');
            }
        } else if (!normalized.text) {
            return null;
        }
        return normalized;
    }

    function mergeUniqueItems(existingItems, incomingItems) {
        const seen = new Set();
        const merged = [...incomingItems, ...existingItems].filter(item => {
            const key = `${item.type}|${getItemText(item)}|${item.url || ''}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return merged.slice(0, 200);
    }

    function importJson() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(String(reader.result || '[]'));
                    const sourceItems = Array.isArray(parsed) ? parsed : parsed.items;
                    if (!Array.isArray(sourceItems)) throw new Error('Invalid collector JSON');

                    const incomingItems = sourceItems.map(normalizeImportedItem).filter(Boolean);
                    if (!incomingItems.length) {
                        showActionFeedback('没有可导入内容');
                        return;
                    }

                    getItems((items) => {
                        const merged = mergeUniqueItems(items, incomingItems);
                        saveItems(merged, () => {
                            renderPanel();
                            showPanel();
                            showActionFeedback(`已导入 ${merged.length - items.length} 条`);
                        });
                    });
                } catch (error) {
                    console.warn('采集画布导入失败:', error);
                    showActionFeedback('导入失败');
                }
            };
            reader.readAsText(file, 'utf-8');
        });
        input.click();
    }

    function clearItems() {
        saveItems([], renderPanel);
    }

    function escapeMarkdown(text) {
        return String(text || '').replace(/\r\n/g, '\n').trim();
    }

    function getItemText(item) {
        if (item.type === 'image') return item.src || item.alt || '';
        if (item.type === 'link' || item.type === 'page') return item.href || item.text || '';
        return item.text || '';
    }

    function getCollectorItemType(item) {
        return ['text', 'image', 'page', 'link'].includes(item.type) ? item.type : 'text';
    }

    function getCollectorTypeLabel(type) {
        return {
            all: '全部',
            image: '图片',
            text: '文字',
            page: '网页',
            link: '链接'
        }[type] || '内容';
    }

    function getVisibleCollectorTypeOptions() {
        return ['image', 'text', 'page', 'link'].filter(type => collectorVisibleTypes[type]);
    }

    function getItemSearchText(item) {
        return [
            item.type,
            item.title,
            item.url,
            item.text,
            item.excerpt,
            item.domain,
            item.alt,
            item.src,
            item.href,
            item.note
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function getOrderedItems(items) {
        return items.slice().sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }

    function buildMarkdown(items) {
        const lines = ['# 网页采集画布', ''];
        getOrderedItems(items).forEach((item, index) => {
            const time = new Date(item.createdAt).toLocaleString();
            const pinnedPrefix = item.pinned ? '鈽?' : '';
            lines.push(`## ${index + 1}. ${pinnedPrefix}${escapeMarkdown(item.title) || '未命名页面'}`);
            lines.push('');
            lines.push(`- 来源: ${item.url || location.href}`);
            lines.push(`- 时间: ${time}`);
            if (item.note) lines.push(`- 备注: ${escapeMarkdown(item.note)}`);
            lines.push('');
            if (item.type === 'image') {
                lines.push(`![${escapeMarkdown(item.alt) || 'image'}](${item.src})`);
            } else if (item.type === 'page') {
                lines.push(`[${escapeMarkdown(item.text) || item.href}](${item.href})`);
                if (item.excerpt) {
                    lines.push('');
                    lines.push(`> ${escapeMarkdown(item.excerpt)}`);
                }
            } else if (item.type === 'link') {
                lines.push(`[${escapeMarkdown(item.text) || item.href}](${item.href})`);
            } else {
                lines.push('```text');
                lines.push(escapeMarkdown(item.text));
                lines.push('```');
            }
            lines.push('');
        });
        return lines.join('\n');
    }

    function downloadTextFile(filename, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportMarkdown() {
        getItems((items) => {
            if (!items.length) {
                showActionFeedback('画布是空的');
                return;
            }

            downloadTextFile(
                `网页采集画布-${new Date().toISOString().slice(0, 10)}.md`,
                buildMarkdown(items),
                'text/markdown;charset=utf-8'
            );
        });
    }

    function exportJson() {
        getItems((items) => {
            if (!items.length) {
                showActionFeedback('画布是空的');
                return;
            }

            downloadTextFile(
                `网页采集画布-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(items, null, 2),
                'application/json;charset=utf-8'
            );
        });
    }

    function getCollectorImageExtension(item, index) {
        const src = item.src || '';
        const mimeMatch = src.match(/^data:image\/([a-zA-Z0-9.+-]+);/);
        if (mimeMatch) {
            const ext = mimeMatch[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
            return ext || 'png';
        }
        try {
            const path = new URL(src).pathname;
            const extMatch = path.match(/\.([a-zA-Z0-9]{2,5})$/);
            if (extMatch) return extMatch[1].toLowerCase();
        } catch (error) {
            console.warn('图片扩展名解析失败', error);
        }
        return index ? 'jpg' : 'png';
    }

    function buildCollectorImageFilename(item, index) {
        const rawName = item.alt || item.text || item.title || `reference-${index}`;
        const safeName = typeof sanitizeFilenamePart === 'function'
            ? sanitizeFilenamePart(rawName, `reference-${index}`)
            : String(rawName || `reference-${index}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
        return `采集画布图片/${String(index).padStart(3, '0')}-${safeName}.${getCollectorImageExtension(item, index)}`;
    }

    function downloadCollectorImage(item, index) {
        const filename = buildCollectorImageFilename(item, index);
        chrome.runtime.sendMessage({
            action: 'downloadCollectorImage',
            payload: {
                url: item.src,
                filename
            }
        }, (response) => {
            if (!response?.success) {
                console.warn('采集图片下载失败:', response?.error || item.src);
            }
        });
    }

    function exportAllImages() {
        getItems((items) => {
            const imageItems = getOrderedItems(items).filter(item => item.type === 'image' && item.src);
            if (!imageItems.length) {
                showActionFeedback('没有图片');
                return;
            }

            imageItems.forEach((item, index) => downloadCollectorImage(item, index + 1));
            showActionFeedback(`已开始下载 ${imageItems.length} 张`);
        });
    }

    async function copyAllMarkdown() {
        getItems(async (items) => {
            if (!items.length) {
                showActionFeedback('画布是空的');
                return;
            }

            await navigator.clipboard?.writeText(buildMarkdown(items));
            showActionFeedback('已复制全部');
        });
    }

    function ensureHandle() {
        let handle = document.getElementById(HANDLE_ID);
        if (handle) return handle;

        handle = document.createElement('button');
        handle.id = HANDLE_ID;
        handle.type = 'button';
        handle.title = '打开采集画布';
        handle.style.cssText = `
            position: fixed;
            right: 0;
            top: 42%;
            transform: translateY(-50%);
            z-index: 2147483645;
            border: 1px solid rgba(255,255,255,0.14);
            border-right: 0;
            border-radius: 10px 0 0 10px;
            background: rgba(17, 19, 24, 0.72);
            color: white;
            padding: 8px 6px;
            cursor: pointer;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 12px;
            writing-mode: vertical-rl;
            letter-spacing: 1px;
            box-shadow: -4px 4px 14px rgba(0,0,0,0.22);
            backdrop-filter: blur(8px);
            opacity: 0.55;
            transition: opacity 0.18s, transform 0.18s, background 0.18s;
        `;
        handle.addEventListener('mouseenter', () => {
            handle.style.opacity = '1';
            handle.style.background = 'rgba(17, 19, 24, 0.92)';
            handle.style.transform = 'translateY(-50%) translateX(-2px)';
        });
        handle.addEventListener('mouseleave', () => {
            handle.style.opacity = '0.55';
            handle.style.background = 'rgba(17, 19, 24, 0.72)';
            handle.style.transform = 'translateY(-50%)';
        });
        handle.addEventListener('click', togglePanel);
        document.body.appendChild(handle);
        updateHandleCount();
        return handle;
    }

    function updateHandleCount(count = null) {
        const handle = document.getElementById(HANDLE_ID);
        if (!handle) return;

        if (count === null) {
            getItems(items => updateHandleCount(items.length));
            return;
        }

        handle.textContent = count > 0 ? `画布 ${count}` : '画布';
    }

    function ensurePanel() {
        let panel = document.getElementById(PANEL_ID);
        if (panel) return panel;

        panel = document.createElement('aside');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed;
            top: 0;
            right: 0;
            width: min(360px, calc(100vw - 24px));
            height: 100vh;
            background: #111318;
            color: #f8fafc;
            z-index: 2147483646;
            box-shadow: -10px 0 30px rgba(0,0,0,0.35);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            transform: translateX(102%);
            transition: transform 0.22s ease;
            display: flex;
            flex-direction: column;
            border-left: 1px solid rgba(255,255,255,0.12);
        `;

        document.body.appendChild(panel);
        renderPanel();
        return panel;
    }

    function showPanel() {
        const panel = ensurePanel();
        requestAnimationFrame(() => {
            panel.style.transform = 'translateX(0)';
        });
    }

    function hidePanel() {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.style.transform = 'translateX(102%)';
    }

    function togglePanel() {
        const panel = ensurePanel();
        if (panel.style.transform === 'translateX(0px)' || panel.style.transform === 'translateX(0)') {
            hidePanel();
        } else {
            showPanel();
        }
    }

    function togglePanelFromShortcut() {
        const now = Date.now();
        if (now - lastCollectorToggleAt < 350) return;
        lastCollectorToggleAt = now;
        togglePanel();
    }

    function createButton(text, title, onClick, variant = 'default') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = title || text;
        button.style.cssText = `
            border: 0;
            border-radius: 7px;
            padding: 6px 9px;
            background: ${variant === 'primary' ? '#5b50d8' : 'rgba(255,255,255,0.12)'};
            color: #fff;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            font-family: inherit;
        `;
        button.addEventListener('click', onClick);
        return button;
    }

    function renderPanel() {
        const panel = ensurePanel();
        getItems((items) => {
            panel.textContent = '';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px;border-bottom:1px solid rgba(255,255,255,0.1);';

            const title = document.createElement('div');
            const titleStrong = document.createElement('strong');
            titleStrong.textContent = '采集画布';
            titleStrong.style.fontSize = '15px';
            const titleMeta = document.createElement('div');
            titleMeta.textContent = `${items.length} 条内容`;
            titleMeta.style.cssText = 'font-size:12px;color:#94a3b8;margin-top:2px;';
            title.appendChild(titleStrong);
            title.appendChild(titleMeta);

            const close = createButton('×', '关闭', hidePanel);
            close.style.fontSize = '18px';
            close.style.padding = '4px 9px';

            header.appendChild(title);
            header.appendChild(close);

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.08);flex-wrap:wrap;';
            if (collectorPageSaveEnabled) {
                actions.appendChild(createButton('存网页', '把当前页面加入采集画布', () => addCurrentPageItem(), 'primary'));
            }
            actions.appendChild(createButton('导出图片', '下载画布里的所有图片', exportAllImages, 'primary'));
            actions.appendChild(createButton('导出 MD', '导出 Markdown', exportMarkdown, 'primary'));
            actions.appendChild(createButton('复制全部', '复制全部为 Markdown', copyAllMarkdown));
            actions.appendChild(createButton('导出 JSON', '导出原始采集数据', exportJson));
            actions.appendChild(createButton('导入 JSON', '导入采集画布 JSON', importJson));
            actions.appendChild(createButton('去重', '移除重复采集项', dedupeItems));
            actions.appendChild(createButton('清空', '清空画布', clearItems));

            const searchWrap = document.createElement('div');
            searchWrap.style.cssText = 'padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.08);';
            const search = document.createElement('input');
            search.type = 'search';
            search.placeholder = '搜索文字、链接、来源...';
            search.value = collectorFilter;
            search.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:rgba(255,255,255,0.08);color:#fff;padding:8px 10px;font-size:13px;outline:none;';
            searchWrap.appendChild(search);

            const typeFilters = document.createElement('div');
            typeFilters.style.cssText = 'display:flex;gap:6px;margin-top:8px;overflow:auto;padding-bottom:1px;';
            const counts = items.reduce((acc, item) => {
                const type = getCollectorItemType(item);
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {});
            const availableTypes = getVisibleCollectorTypeOptions();
            ['all', ...availableTypes].forEach(type => {
                const button = createButton(
                    `${getCollectorTypeLabel(type)} ${type === 'all' ? items.length : (counts[type] || 0)}`,
                    `只看${getCollectorTypeLabel(type)}`,
                    () => {
                        collectorTypeFilter = type;
                        renderPanel();
                    },
                    collectorTypeFilter === type ? 'primary' : 'default'
                );
                button.style.padding = '5px 8px';
                typeFilters.appendChild(button);
            });
            if (availableTypes.length) searchWrap.appendChild(typeFilters);

            const dropZone = document.createElement('div');
            dropZone.tabIndex = 0;
            dropZone.textContent = '点击粘贴剪贴板图片，或拖放图片到这里';
            dropZone.style.cssText = 'margin-top:8px;border:1px dashed rgba(255,255,255,0.18);border-radius:8px;color:#cbd5e1;background:rgba(255,255,255,0.045);padding:9px 10px;text-align:center;font-size:12px;outline:none;';
            dropZone.addEventListener('click', addClipboardImages);
            dropZone.addEventListener('dragover', (event) => {
                event.preventDefault();
                dropZone.style.borderColor = 'rgba(168,181,255,0.72)';
                dropZone.style.background = 'rgba(91,80,216,0.18)';
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.style.borderColor = 'rgba(255,255,255,0.18)';
                dropZone.style.background = 'rgba(255,255,255,0.045)';
            });
            dropZone.addEventListener('drop', async (event) => {
                event.preventDefault();
                dropZone.style.borderColor = 'rgba(255,255,255,0.18)';
                dropZone.style.background = 'rgba(255,255,255,0.045)';
                await addImageFiles(event.dataTransfer?.files);
            });
            dropZone.addEventListener('paste', async (event) => {
                await addImageFiles(event.clipboardData?.files);
            });
            searchWrap.appendChild(dropZone);

            const list = document.createElement('div');
            list.style.cssText = 'flex:1;overflow:auto;padding:12px 14px;display:grid;gap:10px;align-content:start;';

            const emptyFiltered = document.createElement('div');
            emptyFiltered.textContent = '没有匹配内容';
            emptyFiltered.style.cssText = 'display:none;color:#94a3b8;font-size:13px;line-height:1.6;padding:20px 4px;';

            const applyPanelFilter = () => {
                collectorFilter = search.value.trim().toLowerCase();
                let visibleCount = 0;
                list.querySelectorAll('[data-collector-search]').forEach(card => {
                    const matchedSearch = !collectorFilter || card.dataset.collectorSearch.includes(collectorFilter);
                    const matchedType = collectorTypeFilter === 'all' || card.dataset.collectorType === collectorTypeFilter;
                    const matched = matchedSearch && matchedType;
                    card.style.display = matched ? '' : 'none';
                    if (matched) visibleCount += 1;
                });
                emptyFiltered.style.display = items.length && visibleCount === 0 ? 'block' : 'none';
                titleMeta.textContent = collectorFilter || collectorTypeFilter !== 'all'
                    ? `${visibleCount}/${items.length} 条内容`
                    : `${items.length} 条内容`;
            };
            search.addEventListener('input', applyPanelFilter);

            if (!items.length) {
                const empty = document.createElement('div');
                empty.textContent = '选中文字、图片或链接，点“采集”加入这里。';
                empty.style.cssText = 'color:#94a3b8;font-size:13px;line-height:1.6;padding:20px 4px;';
                list.appendChild(empty);
            } else {
                getOrderedItems(items).forEach(item => {
                    const itemType = getCollectorItemType(item);
                    const card = document.createElement('article');
                    card.style.cssText = `background:${item.pinned ? 'rgba(91,80,216,0.16)' : 'rgba(255,255,255,0.07)'};border:1px solid ${item.pinned ? 'rgba(168,181,255,0.35)' : 'rgba(255,255,255,0.08)'};border-radius:9px;padding:10px;`;
                    card.dataset.collectorSearch = getItemSearchText(item);
                    card.dataset.collectorType = itemType;

                    const typeLabel = document.createElement('div');
                    typeLabel.textContent = `${item.pinned ? '置顶 · ' : ''}${getCollectorTypeLabel(itemType)}`;
                    typeLabel.style.cssText = 'display:inline-flex;margin-bottom:7px;padding:2px 6px;border-radius:999px;background:rgba(91,80,216,0.35);font-size:11px;color:#d9ddff;';

                    let contentNode;
                    if (item.type === 'image') {
                        contentNode = document.createElement('div');
                        const img = document.createElement('img');
                        img.src = item.src;
                        img.alt = item.alt || '';
                        img.style.cssText = 'width:100%;max-height:160px;object-fit:contain;border-radius:7px;background:rgba(255,255,255,0.06);';
                        const caption = document.createElement('div');
                        caption.textContent = item.alt || item.src;
                        caption.style.cssText = 'font-size:12px;color:#cbd5e1;margin-top:7px;word-break:break-word;';
                        contentNode.appendChild(img);
                        contentNode.appendChild(caption);
                    } else if (item.type === 'page') {
                        contentNode = document.createElement('div');
                        const pageLink = document.createElement('a');
                        pageLink.href = isSafeCollectorUrl(item.href, ['http:', 'https:']) ? item.href : '#';
                        pageLink.target = '_blank';
                        pageLink.rel = 'noopener noreferrer';
                        pageLink.style.cssText = 'display:flex;align-items:center;gap:8px;color:#f8fafc;font-size:13px;font-weight:700;line-height:1.45;word-break:break-word;text-decoration:none;';
                        if (item.favicon) {
                            const favicon = document.createElement('img');
                            favicon.src = item.favicon;
                            favicon.alt = '';
                            favicon.style.cssText = 'width:18px;height:18px;border-radius:4px;object-fit:cover;flex:0 0 auto;background:rgba(255,255,255,0.08);';
                            pageLink.appendChild(favicon);
                        }
                        const pageTitle = document.createElement('span');
                        pageTitle.textContent = item.text || item.href;
                        pageLink.appendChild(pageTitle);
                        const domain = document.createElement('div');
                        domain.textContent = item.domain || '';
                        domain.style.cssText = 'font-size:12px;color:#a8b5ff;margin-top:5px;word-break:break-word;';
                        const excerpt = document.createElement('div');
                        excerpt.textContent = item.excerpt || '';
                        excerpt.style.cssText = `display:${item.excerpt ? 'block' : 'none'};font-size:12px;color:#cbd5e1;line-height:1.5;margin-top:7px;white-space:pre-wrap;word-break:break-word;max-height:86px;overflow:auto;`;
                        contentNode.appendChild(pageLink);
                        contentNode.appendChild(domain);
                        contentNode.appendChild(excerpt);
                    } else if (item.type === 'link') {
                        contentNode = document.createElement('a');
                        contentNode.href = isSafeCollectorUrl(item.href, ['http:', 'https:']) ? item.href : '#';
                        contentNode.target = '_blank';
                        contentNode.rel = 'noopener noreferrer';
                        contentNode.textContent = item.text || item.href;
                        contentNode.style.cssText = 'display:block;color:#a8b5ff;font-size:13px;line-height:1.55;word-break:break-word;text-decoration:none;';
                    } else {
                        contentNode = document.createElement('div');
                        contentNode.textContent = item.text;
                        contentNode.style.cssText = 'font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;';
                    }

                    const meta = document.createElement('div');
                    meta.textContent = `${item.title || '未命名页面'} · ${new Date(item.createdAt).toLocaleString()}`;
                    meta.style.cssText = 'color:#94a3b8;font-size:11px;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

                    const note = document.createElement('textarea');
                    note.placeholder = '备注...';
                    note.value = item.note || '';
                    note.rows = 2;
                    note.style.cssText = 'width:100%;box-sizing:border-box;margin-top:8px;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.06);color:#fff;padding:7px 8px;font-size:12px;line-height:1.4;resize:vertical;outline:none;font-family:inherit;';
                    let noteTimer = null;
                    note.addEventListener('input', () => {
                        clearTimeout(noteTimer);
                        noteTimer = setTimeout(() => {
                            updateItem(item.id, { note: note.value.trim() }, () => {
                                getItems(items => updateHandleCount(items.length));
                            });
                        }, 500);
                    });

                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;';
                    row.appendChild(createButton(item.pinned ? '取消置顶' : '置顶', item.pinned ? '取消置顶' : '置顶此条', () => togglePinned(item), item.pinned ? 'primary' : 'default'));
                    row.appendChild(createButton('复制', '复制内容', async () => {
                        await navigator.clipboard?.writeText(getItemText(item));
                    }));
                    row.appendChild(createButton('来源', '打开来源页面', () => openSafeCollectorUrl(item.url || location.href)));
                    row.appendChild(createButton('删除', '删除此条', () => removeItem(item.id)));

                    card.appendChild(typeLabel);
                    card.appendChild(contentNode);
                    card.appendChild(meta);
                    card.appendChild(note);
                    card.appendChild(row);
                    list.appendChild(card);
                });
            }

            panel.appendChild(header);
            panel.appendChild(actions);
            panel.appendChild(searchWrap);
            panel.appendChild(list);
            list.appendChild(emptyFiltered);
            applyPanelFilter();
        });
    }

    function removeActionBar() {
        const old = document.getElementById(ACTION_BAR_ID);
        if (old) old.remove();
    }

    function getImageInfo(element) {
        if (!element || element.tagName?.toLowerCase() !== 'img') return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 60) return null;
        const src = element.currentSrc || element.src;
        if (!src || src.startsWith('data:')) return null;
        return {
            src,
            alt: element.alt || element.title || '',
            rect
        };
    }

    function getLinkInfo(element) {
        const link = element?.closest?.('a[href]');
        if (!link || isInsideCollectorUi(link)) return null;
        if (link.closest?.('button, [role="button"], nav, [role="tablist"], [role="menu"], [role="toolbar"]')) return null;
        const href = link.href;
        if (!href || !isSafeCollectorUrl(href, ['http:', 'https:'])) return null;
        const rect = link.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return null;
        if (rect.width < 40 || rect.height < 16) return null;
        const text = (link.textContent || link.getAttribute('aria-label') || link.title || href).trim();
        return { href, text, rect };
    }

    function showActionFeedback(text) {
        const bar = document.getElementById(ACTION_BAR_ID);
        if (!bar) return;
        const oldText = bar.dataset.originalText;
        bar.textContent = text;
        setTimeout(() => {
            if (document.body.contains(bar)) {
                bar.remove();
            }
        }, oldText ? 900 : 700);
    }

    function showActionBar(selectionInfo) {
        removeActionBar();
        selectionSnapshot = selectionInfo;

        const bar = document.createElement('div');
        bar.id = ACTION_BAR_ID;
        bar.dataset.originalText = selectionInfo.text;
        const left = Math.min(Math.max(12, selectionInfo.rect.left), window.innerWidth - 210);
        const top = selectionInfo.rect.top > 118
            ? Math.max(12, selectionInfo.rect.top - 106)
            : Math.min(window.innerHeight - 106, selectionInfo.rect.bottom + 10);
        bar.style.cssText = `
            position: fixed;
            left: ${left}px;
            top: ${top}px;
            width: 198px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            padding: 8px;
            background: rgba(17, 19, 24, 0.96);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 12px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.28);
            backdrop-filter: blur(10px);
            z-index: 2147483646;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        [
            {
                icon: '+',
                text: '采集',
                title: '采集选中文字',
                primary: true,
                handler: () => addTextItem(selectionSnapshot?.text || selectionInfo.text)
            },
            {
                icon: 'A',
                text: '翻译',
                title: '翻译选中文字',
                handler: () => window.__toolboxTranslateSelection?.()
            },
            {
                icon: 'W',
                text: '存网页',
                title: '保存当前网页，并带上选中文本',
                handler: () => addCurrentPageItem(selectionSnapshot?.text || selectionInfo.text)
            },
            {
                icon: 'C',
                text: '复制',
                title: '复制选中文字',
                handler: async () => {
                    await navigator.clipboard?.writeText(selectionSnapshot?.text || selectionInfo.text);
                    showActionFeedback('已复制');
                }
            },
            {
                icon: '□',
                text: '画布',
                title: '打开采集画布',
                handler: togglePanel
            }
        ].forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.title = action.title;
            button.style.cssText = `
                min-width: 0;
                height: 36px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                border:1px solid ${action.primary ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)'};
                border-radius: 8px;
                background:${action.primary ? '#5b50d8' : 'rgba(17,19,24,0.96)'};
                color:#fff;
                cursor:pointer;
                font-size:12px;
                font-weight:700;
                font-family:inherit;
                white-space: nowrap;
                transition:background 0.14s ease, transform 0.14s ease;
            `;
            const icon = document.createElement('span');
            icon.textContent = action.icon;
            icon.style.cssText = 'display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;border-radius:5px;background:rgba(255,255,255,0.13);font-size:11px;line-height:1;';
            const label = document.createElement('span');
            label.textContent = action.text;
            button.appendChild(icon);
            button.appendChild(label);
            button.addEventListener('mouseenter', () => {
                button.style.background = action.primary ? '#6a5cf0' : 'rgba(255,255,255,0.14)';
                button.style.transform = 'translateY(-1px)';
            });
            button.addEventListener('mouseleave', () => {
                button.style.background = action.primary ? '#5b50d8' : 'rgba(17,19,24,0.96)';
                button.style.transform = 'translateY(0)';
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                action.handler();
            });
            bar.appendChild(button);
        });

        document.body.appendChild(bar);
    }

    function showMediaActionBar(info, type) {
        removeActionBar();

        const bar = document.createElement('div');
        bar.id = ACTION_BAR_ID;
        const left = Math.min(Math.max(12, info.rect.left), window.innerWidth - 270);
        const top = Math.max(12, info.rect.top + 8);
        bar.style.cssText = `
            position: fixed;
            left: ${left}px;
            top: ${top}px;
            display: flex;
            gap: 6px;
            align-items: center;
            padding: 6px;
            background: rgba(17, 19, 24, 0.96);
            color: white;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.28);
            z-index: 2147483646;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        if (type === 'image') {
            bar.appendChild(createButton('采集图片', '加入采集画布', () => addImageItem(info), 'primary'));
            bar.appendChild(createButton('复制图链', '复制图片链接', async () => {
                await navigator.clipboard?.writeText(info.src);
                showActionFeedback('已复制');
            }));
            bar.appendChild(createButton('打开', '打开图片', () => openSafeCollectorUrl(info.src)));
        } else {
            bar.appendChild(createButton('采集链接', '加入采集画布', () => addLinkItem(info), 'primary'));
            bar.appendChild(createButton('复制链接', '复制链接地址', async () => {
                await navigator.clipboard?.writeText(info.href);
                showActionFeedback('已复制');
            }));
            bar.appendChild(createButton('打开', '打开链接', () => openSafeCollectorUrl(info.href)));
        }
        bar.appendChild(createButton('画布', '打开采集画布', togglePanel));

        document.body.appendChild(bar);
    }

    function scheduleSelectionCheck() {
        setTimeout(() => {
            const info = getSelectionInfo();
            if (info) {
                showActionBar(info);
            } else {
                removeActionBar();
            }
        }, 60);
    }

    document.addEventListener('mouseup', (event) => {
        if (isInsideCollectorUi(event.target)) return;
        scheduleSelectionCheck();
    }, true);

    document.addEventListener('mouseover', (event) => {
        if (isInsideCollectorUi(event.target) || isEditableElement(event.target)) return;
        if (!event.altKey) return;

        const imageInfo = getImageInfo(event.target);
        if (imageInfo) {
            showMediaActionBar(imageInfo, 'image');
            return;
        }

        const linkInfo = getLinkInfo(event.target);
        if (linkInfo) {
            showMediaActionBar(linkInfo, 'link');
        }
    }, true);

    document.addEventListener('keyup', (event) => {
        if (event.key === 'Escape') {
            removeActionBar();
            return;
        }
        scheduleSelectionCheck();
    }, true);

    document.addEventListener('keydown', (event) => {
        const isCollectorShortcut = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'q';
        if (!isCollectorShortcut) return;
        if (isEditableElement(event.target) || isInsideCollectorUi(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        togglePanelFromShortcut();
    }, true);

    document.addEventListener('mousedown', (event) => {
        if (!isInsideCollectorUi(event.target)) removeActionBar();
    }, true);

    ensureHandle();
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[STORAGE_KEY]) {
            const items = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
            updateHandleCount(items.length);
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action !== 'toggleCollectorCanvas') return;
        togglePanelFromShortcut();
        sendResponse?.({ success: true });
    });

    console.log('网页采集画布已加载');
})();

// ==================== 网页临时清理工具 v1 ====================
(function initPageCleaner() {
    'use strict';

    const CLEANER_BAR_ID = 'web-page-cleaner-action-bar';
    const CLEANER_STYLE_ID = 'web-page-cleaner-style';
    const hiddenRecords = [];
    let currentTarget = null;

    function ensureCleanerStyle() {
        if (document.getElementById(CLEANER_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = CLEANER_STYLE_ID;
        style.textContent = `
            .web-page-cleaner-hidden-by-tool {
                display: none !important;
            }
            .web-page-cleaner-preview-by-tool {
                outline: 2px solid #ff4d4f !important;
                outline-offset: 2px !important;
                cursor: crosshair !important;
            }
        `;
        document.head.appendChild(style);
    }

    function isCleanerUi(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        return !!element?.closest?.(`#${CLEANER_BAR_ID}, #web-collector-canvas-panel, #web-collector-action-bar, #translator-selection-popup, #webcraft-floating-translator-panel, #webcraft-floating-translator-handle`);
    }

    function isEditableCleanerTarget(element) {
        if (!element) return false;
        const tag = element.tagName?.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' ||
            element.isContentEditable || !!element.closest?.('[contenteditable="true"]');
    }

    function getCleanableElement(element) {
        if (!element || isCleanerUi(element) || isEditableCleanerTarget(element)) return null;
        const candidate = element.closest?.('aside, dialog, section, article, header, footer, nav, [role="dialog"], [role="banner"], [role="complementary"], [role="navigation"], [class*="ad"], [id*="ad"]') || element;
        if (!candidate || candidate === document.documentElement || candidate === document.body) return null;
        const rect = candidate.getBoundingClientRect();
        if (rect.width < 12 || rect.height < 12) return null;
        return candidate;
    }

    function removeCleanerBar() {
        document.getElementById(CLEANER_BAR_ID)?.remove();
        if (currentTarget) {
            currentTarget.classList.remove('web-page-cleaner-preview-by-tool');
            currentTarget = null;
        }
    }

    function hideElement(element) {
        if (!element) return;
        element.classList.remove('web-page-cleaner-preview-by-tool');
        element.classList.add('web-page-cleaner-hidden-by-tool');
        hiddenRecords.push(element);
        removeCleanerBar();
    }

    function undoHide() {
        const element = hiddenRecords.pop();
        if (element?.isConnected) {
            element.classList.remove('web-page-cleaner-hidden-by-tool');
        }
        removeCleanerBar();
    }

    function clearHidden() {
        hiddenRecords.splice(0).forEach(element => {
            if (element?.isConnected) element.classList.remove('web-page-cleaner-hidden-by-tool');
        });
        removeCleanerBar();
    }

    function createCleanerButton(text, title, onClick, primary = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = title || text;
        button.style.cssText = `
            border:0;
            border-radius:7px;
            padding:6px 9px;
            background:${primary ? '#ef4444' : 'rgba(255,255,255,0.12)'};
            color:#fff;
            cursor:pointer;
            font-size:12px;
            font-weight:600;
            white-space:nowrap;
            font-family:inherit;
        `;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        });
        return button;
    }

    function showCleanerBar(target, x, y) {
        ensureCleanerStyle();
        removeCleanerBar();

        currentTarget = target;
        currentTarget.classList.add('web-page-cleaner-preview-by-tool');

        const bar = document.createElement('div');
        bar.id = CLEANER_BAR_ID;
        bar.style.cssText = `
            position:fixed;
            left:${Math.min(Math.max(12, x), window.innerWidth - 260)}px;
            top:${Math.min(Math.max(12, y), window.innerHeight - 52)}px;
            display:flex;
            gap:6px;
            align-items:center;
            padding:6px;
            background:rgba(17,19,24,0.96);
            color:white;
            border:1px solid rgba(255,255,255,0.14);
            border-radius:10px;
            box-shadow:0 8px 24px rgba(0,0,0,0.28);
            z-index:2147483646;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        `;

        bar.appendChild(createCleanerButton('隐藏', '临时隐藏这个网页元素', () => hideElement(target), true));
        bar.appendChild(createCleanerButton('撤销', '恢复上一个隐藏元素', undoHide));
        bar.appendChild(createCleanerButton('清空', '恢复本页所有临时隐藏元素', clearHidden));
        bar.appendChild(createCleanerButton('×', '关闭', removeCleanerBar));
        document.body.appendChild(bar);
    }

    document.addEventListener('contextmenu', (event) => {
        if (!event.altKey) return;
        const target = getCleanableElement(event.target);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        showCleanerBar(target, event.clientX, event.clientY);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') removeCleanerBar();
    }, true);

    document.addEventListener('mousedown', (event) => {
        if (!isCleanerUi(event.target)) removeCleanerBar();
    }, true);

    console.log('网页临时清理工具已加载');
})();

// ==================== 娑堟伅鐩戝惉 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 使用立即执行的异步函数处理消�?
    (async () => {
        try {
            if (request.action === 'processImage') {
                const { image, name, format, tool } = request.payload;
                if (!image || typeof image !== 'string') {
                    throw new Error('没有收到截图数据');
                }
                const filename = generateFilename(name, format, tool);
                try {
                    const canvas = await processCanvas(image, name, tool);
                    downloadCanvas(canvas, filename, format);
                } catch (err) {
                    console.warn('[截图] 添加页眉失败，改为保存原始截图:', err);
                    const link = document.createElement('a');
                    link.href = image;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                }
                sendResponse({ success: true });
                return;
            }

            // 新的全页截图处理 - 使用 Debugger API（一劳永逸方案）
            if (request.action === 'processFullPageImage') {
                console.log('[全页截图] 收到截图数据，开始处理...');
                const { image, name, format, tool } = request.payload;

                // 显示成功提示
                const toast = document.createElement('div');
                toast.style.cssText = `
                    position: fixed; bottom: 20px; right: 20px;
                    padding: 12px 20px; background: rgba(33, 150, 243, 0.95);
                    color: white; border-radius: 8px; z-index: 2147483647;
                    font-family: -apple-system, sans-serif; font-size: 14px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                `;
                toast.textContent = '📸 正在处理截图...';
                document.body.appendChild(toast);

                try {
                    const canvas = await processCanvas(image, name, tool);
                    const filename = generateFilename(name, format, tool);
                    downloadCanvas(canvas, filename, format);

                    toast.style.background = 'rgba(76,175,80,0.95)';
                    toast.textContent = '✅ 全页截图完成！';
                    setTimeout(() => toast.remove(), 2000);
                    console.log('[全页截图] 处理完成');
                } catch (err) {
                    toast.style.background = 'rgba(244,67,54,0.95)';
                    toast.textContent = '⚠️ 页眉处理失败，正在保存原图';
                    setTimeout(() => toast.remove(), 3000);
                    console.warn('[全页截图] 添加页眉失败，改为保存原始截图:', err);
                    const filename = generateFilename(name, format, tool);
                    const link = document.createElement('a');
                    link.href = image;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                }

                sendResponse({ success: true });
            }

            if (request.action === 'startFullCapture') {
                const { name, format, tool, manualMode, startFromCurrent } = request.payload;
                console.log('[全页截图] 收到截图请求...', { name, format, tool, manualMode, startFromCurrent });

                if (startFromCurrent || manualMode) {
                    sendResponse({ success: true, started: true });
                    await wait(300);
                    await doFullPageCapture(name, format, tool, { manualMode, startFromCurrent });
                    return;
                }

                // 显示加载提示
                const toast = document.createElement('div');
                toast.id = 'fullpage-capture-toast';
                toast.style.cssText = `
                    position: fixed; bottom: 20px; right: 20px;
                    padding: 12px 20px; background: rgba(33, 33, 33, 0.95);
                    color: white; border-radius: 8px; z-index: 2147483647;
                    font-family: -apple-system, sans-serif; font-size: 14px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                `;
                toast.textContent = '📸 正在截取整个页面...';
                document.body.appendChild(toast);

                // 先发送响应，不阻�?popup 关闭
                sendResponse({ success: true, started: true });

                // 等待 popup 关闭
                await wait(300);

                // ===== 关键优化：计算真实的页面高度（针�?SPA/100vh 容器�?====
                // 对于宽度，严格使用视口宽度，防止页面偏移（很多网�?scrollWidth 会略大约视口�?
                let captureWidth = window.innerWidth;
                let totalHeight = document.documentElement.scrollHeight;

                // 尝试查找内部滚动容器
                try {
                    const scrollContainer = findScrollableContainer();
                    if (scrollContainer) {
                        console.log('[全页截图] 检测到内部滚动容器:', scrollContainer);
                        totalHeight = Math.max(totalHeight, scrollContainer.scrollHeight);
                        // 注意：这里不要去�?scrollContainer.scrollWidth，保持视口宽�?
                    }
                } catch (e) {
                    console.warn('[全页截图] 查找滚动容器失败:', e);
                }

                // 确保高度至少为视口高�?
                totalHeight = Math.max(totalHeight, window.innerHeight);

                // ===== 额外优化：增加底部缓�?=====
                // Gemini 等网站底部有固定定位元素，增�?300px 缓冲确保内容不被遮挡，同时也给底部留�?
                totalHeight += 300;

                console.log(`[全页截图] 计算出的目标尺寸: ${captureWidth}x${totalHeight}`);

                // ===== 关键修复：Flow 网站布局防抖�?=====
                // 在截图前强制锁定 body 和应用根节点的宽度，防止因为视口变化导致响应式布局（如 Grid/Flex）坍塌成单列
                const originalBodyWidth = document.body.style.width;
                const originalBodyMaxWidth = document.body.style.maxWidth;
                const originalRootStyles = [];

                // 尝试锁定常见容器
                try {
                    document.body.style.width = `${captureWidth}px`;
                    document.body.style.maxWidth = 'none'; // 移除最大宽度限制，防止挤压

                    // 针对常见�?App 根节�?(�?#app, #root, #__next) 也进行锁�?
                    ['#app', '#root', '#__next', 'main'].forEach(selector => {
                        const el = document.querySelector(selector);
                        if (el) {
                            originalRootStyles.push({ el, width: el.style.width, maxWidth: el.style.maxWidth });
                            el.style.width = `${captureWidth}px`;
                            el.style.maxWidth = 'none';
                        }
                    });
                } catch (e) {
                    console.warn('[全页截图] 锁定布局宽度失败:', e);
                }

                // 调用 background.js �?Debugger API 截图
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'captureFullPage',
                        payload: {
                            name,
                            format,
                            tool,
                            // 传递计算出的尺寸，覆盖自动检�?
                            overrideMetrics: {
                                width: Math.ceil(captureWidth),
                                height: Math.ceil(totalHeight),
                                dpr: window.devicePixelRatio || 1
                            }
                        }
                    });

                    if (!response.success) {
                        throw new Error(response.error || '截图失败');
                    }
                    // 截图处理会在 processFullPageImage 中完�?
                } catch (err) {
                    console.error('[全页截图] 失败:', err);
                    const existingToast = document.getElementById('fullpage-capture-toast');
                    if (existingToast) {
                        existingToast.style.background = 'rgba(244,67,54,0.95)';
                        existingToast.textContent = '❌ 截图失败: ' + (err.message || '请重试');
                        setTimeout(() => existingToast.remove(), 3000);
                    }
                } finally {
                    // ===== 恢复布局样式 =====
                    // 发送消息是异步的，但通常很快。为了保险，我们在短暂延迟后恢复样式
                    // 或者更理想的是，background 截图是耗时的，我们应该保持锁定直到截图完成�?
                    // 由于 sendMessage �?await 的，直到 background 返回响应（截图完成），我们才恢复样式
                    // 这样正好保护了整个截图过程！
                    setTimeout(() => {
                        document.body.style.width = originalBodyWidth;
                        document.body.style.maxWidth = originalBodyMaxWidth;
                        originalRootStyles.forEach(({ el, width, maxWidth }) => {
                            el.style.width = width;
                            el.style.maxWidth = maxWidth;
                        });
                        console.log('[全页截图] 布局样式已恢复');
                    }, 100);
                }
            }

            // 屏幕区域录制 - 接收 tabCapture �?ID，初始化录制
            if (request.action === 'initRegionRecording') {
                const { streamId } = request.payload || {};
                if (typeof window.handleInitRegionRecording === 'function') {
                    window.handleInitRegionRecording(streamId, request.payload || {});
                    sendResponse({ success: true });
                } else {
                    console.error('[屏幕录制] 录制模块未加载');
                    sendResponse({ success: false, error: '录制模块未加载' });
                }
            }

            // 屏幕区域录制 - 显示区域选择器（通过 popup 触发�?
            if (request.action === 'startRegionSelector') {
                if (typeof window.showRecordingRegionSelector === 'function') {
                    const name = request.payload?.name || '未命名';
                    const tool = request.payload?.tool || 'Midjourney生成';
                    window.showRecordingRegionSelector(name, tool);
                    sendResponse({ success: true });
                } else {
                    console.error('[屏幕录制] 录制模块未加载');
                    sendResponse({ success: false, error: '录制模块未加载' });
                }
            }

            if (request.action === 'updateHideYoutubeTranslate') {
                // YouTube 翻译隐藏功能已在其他地方处理
            }
        } catch (e) {
            console.error("Content Script Error", e);
            if (request.action === 'startRegionSelector' || request.action === 'initRegionRecording') {
                if (typeof window.showRecordingToast === 'function') {
                    window.showRecordingToast("录屏启动失败：" + (e.message || "请刷新页面重试"), 'error');
                } else {
                    alert("录屏启动失败：" + (e.message || "请刷新页面重试。"));
                }
            } else {
                alert("截图处理出错：" + (e.message || "请刷新页面重试。"));
            }
            sendResponse({ success: false, error: e.message });
        }
    })();

    // 返回 true 表示会异步发送响�?
    return true;
});

console.log('WebCraft 网页工坊内容脚本已加载');

// ==================== YouTube 缩略图悬停下�?====================

(function initYouTubeThumbnailDownloader() {
    'use strict';

    // 鍙湪 YouTube 椤甸潰杩愯
    if (!isYouTubeHost()) {
        return;
    }

    // 娉ㄥ叆鏍峰紡
    const style = document.createElement('style');
    style.textContent = `
        .yt-thumbnail-download-btn {
            position: fixed;
            top: 8px;
            right: 8px;
            width: 32px;
            height: 32px;
            background: rgba(0, 0, 0, 0.75);
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s, background 0.2s;
            z-index: 1000;
            font-size: 16px;
            color: white;
        }
        .yt-thumbnail-download-btn:hover {
            background: rgba(255, 0, 0, 0.9);
            transform: scale(1.1);
        }
        
        /* 缩略图容器悬停显�?*/
        .yt-thumbnail-container:hover .yt-thumbnail-download-btn,
        ytd-thumbnail:hover .yt-thumbnail-download-btn,
        ytd-playlist-thumbnail:hover .yt-thumbnail-download-btn,
        a#thumbnail:hover .yt-thumbnail-download-btn,
        ytd-compact-video-renderer:hover .yt-thumbnail-download-btn,
        ytd-compact-radio-renderer:hover .yt-thumbnail-download-btn,
        ytd-compact-playlist-renderer:hover .yt-thumbnail-download-btn,
        ytd-compact-lockup-view-model:hover .yt-thumbnail-download-btn,
        yt-lockup-view-model:hover .yt-thumbnail-download-btn,
        #movie_player:hover .yt-thumbnail-download-btn {
            opacity: 1;
        }
        .yt-thumbnail-download-btn.is-floating-visible {
            opacity: 1;
        }
        /* 正在视频播放页的按钮位置调整 */
        #movie_player .yt-thumbnail-download-btn {
            top: 20px;
            right: 20px;
            width: 40px;
            height: 40px;
            font-size: 20px;
            background: rgba(0, 0, 0, 0.5);
            z-index: 60; /* 确保在播放器控制层之�?*/
        }
        #movie_player .yt-thumbnail-download-btn:hover {
            background: rgba(255, 0, 0, 0.9);
        }

        .yt-webcraft-player-tools {
            position: absolute;
            top: 50%;
            right: -22px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 7px 6px;
            border-radius: 18px 0 0 18px;
            background: rgba(18, 18, 22, 0.52);
            border: 1px solid rgba(255,255,255,0.18);
            border-right: 0;
            box-shadow: 0 8px 22px rgba(0,0,0,0.28);
            backdrop-filter: blur(10px);
            z-index: 61;
            opacity: 0.72;
            transform: translateY(-50%);
            transition: opacity 0.16s ease, right 0.16s ease, background 0.16s ease;
            pointer-events: auto;
        }
        #movie_player:hover .yt-webcraft-player-tools,
        .html5-video-player:hover .yt-webcraft-player-tools,
        .yt-webcraft-player-tools:focus-within {
            opacity: 1;
            right: 0;
            background: rgba(18, 18, 22, 0.72);
        }
        .yt-webcraft-player-btn {
            position: relative;
            border: 0;
            border-radius: 999px;
            background: rgba(255,255,255,0.14);
            color: #fff;
            cursor: pointer;
            font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            height: 30px;
            width: 30px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
        }
        .yt-webcraft-player-btn:hover {
            background: rgba(102, 86, 220, 0.9);
        }
        .yt-webcraft-player-btn::after {
            content: attr(data-label);
            position: absolute;
            right: 38px;
            top: 50%;
            transform: translateY(-50%);
            min-width: max-content;
            padding: 6px 9px;
            border-radius: 8px;
            background: rgba(15,15,18,0.92);
            color: #fff;
            font-size: 12px;
            font-weight: 600;
            opacity: 0;
            pointer-events: none;
            box-shadow: 0 6px 18px rgba(0,0,0,0.24);
            transition: opacity 0.14s ease;
        }
        .yt-webcraft-player-btn:hover::after,
        .yt-webcraft-player-btn:focus-visible::after {
            opacity: 1;
        }
        .yt-webcraft-player-btn.is-busy {
            opacity: 0.72;
            cursor: progress;
        }

        .yt-thumbnail-download-btn.downloading {
            pointer-events: none;
        }
        .yt-thumbnail-download-btn.downloading::after {
            content: '';
            width: 14px;
            height: 14px;
            border: 2px solid #fff;
            border-top-color: transparent;
            border-radius: 50%;
            animation: yt-spin 0.8s linear infinite;
        }
        @keyframes yt-spin {
            to { transform: rotate(360deg); }
        }
        ytd-compact-video-renderer.yt-recommendation-hidden-by-tool,
        ytd-compact-radio-renderer.yt-recommendation-hidden-by-tool,
        ytd-compact-playlist-renderer.yt-recommendation-hidden-by-tool,
        ytd-compact-lockup-view-model.yt-recommendation-hidden-by-tool,
        yt-lockup-view-model.yt-recommendation-hidden-by-tool,
        ytd-reel-shelf-renderer.yt-recommendation-hidden-by-tool {
            display: none !important;
        }
        #secondary.yt-recommendations-filtering-by-tool #chips,
        #secondary.yt-recommendations-filtering-by-tool ytd-feed-filter-chip-bar-renderer,
        #secondary.yt-recommendations-filtering-by-tool yt-chip-cloud-renderer {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    let recommendationsMode = 'enabled';
    let recommendationsWhitelist = [];
    let youtubeToolsEnabled = true;
    let youtubeThumbnailFilenameTemplate = '{channel}-{title}-{date}';
    let youtubeHideShorts = false;
    let youtubeHideLive = false;
    let youtubeHideAds = false;
    let youtubeBlacklist = [];
    const VIDEO_RENDERER_SELECTOR = [
        'ytd-rich-item-renderer',
        'ytd-compact-video-renderer',
        'ytd-compact-radio-renderer',
        'ytd-compact-playlist-renderer',
        'ytd-grid-video-renderer',
        'ytd-playlist-video-renderer',
        'ytd-video-renderer',
        'ytd-reel-item-renderer',
        'ytd-compact-lockup-view-model',
        'yt-lockup-view-model'
    ].join(', ');
    const THUMBNAIL_HOST_SELECTOR = 'a#thumbnail, #thumbnail, ytd-thumbnail, ytd-playlist-thumbnail';
    const RECOMMENDATION_RENDERER_SELECTOR = [
        '#secondary ytd-compact-video-renderer',
        '#secondary ytd-compact-radio-renderer',
        '#secondary ytd-compact-playlist-renderer',
        '#secondary ytd-compact-lockup-view-model',
        '#secondary yt-lockup-view-model',
        '#secondary ytd-reel-shelf-renderer',
        '#related ytd-compact-video-renderer',
        '#related ytd-compact-radio-renderer',
        '#related ytd-compact-playlist-renderer',
        '#related ytd-compact-lockup-view-model',
        '#related yt-lockup-view-model',
        '#related ytd-reel-shelf-renderer'
    ].join(', ');

    function parseWhitelist(value) {
        return String(value || '')
            .split(/[\n,，；;]+/)
            .map(item => item.trim().toLowerCase())
            .filter(Boolean);
    }

    function parseYoutubeList(value) {
        return String(value || '')
            .split(/[\n,，；;]+/)
            .map(item => item.trim().toLowerCase())
            .filter(Boolean);
    }

    chrome.storage.local.get([
        'youtubeRecommendationsMode',
        'youtubeRecommendationsWhitelist',
        'youtubeToolsEnabled',
        'youtubeThumbnailFilenameTemplate',
        'youtubeHideShorts',
        'youtubeHideLive',
        'youtubeHideAds',
        'youtubeBlacklist'
    ], (result) => {
        recommendationsMode = result.youtubeRecommendationsMode || 'enabled';
        recommendationsWhitelist = parseWhitelist(result.youtubeRecommendationsWhitelist);
        youtubeToolsEnabled = result.youtubeToolsEnabled !== false;
        youtubeThumbnailFilenameTemplate = result.youtubeThumbnailFilenameTemplate || '{channel}-{title}-{date}';
        youtubeHideShorts = result.youtubeHideShorts === true;
        youtubeHideLive = result.youtubeHideLive === true;
        youtubeHideAds = result.youtubeHideAds === true;
        youtubeBlacklist = parseYoutubeList(result.youtubeBlacklist);
        applyRecommendationFilter();
        ensureYoutubePlayerTools();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.youtubeRecommendationsMode) {
            recommendationsMode = changes.youtubeRecommendationsMode.newValue || 'enabled';
        }
        if (changes.youtubeRecommendationsWhitelist) {
            recommendationsWhitelist = parseWhitelist(changes.youtubeRecommendationsWhitelist.newValue);
        }
        if (changes.youtubeToolsEnabled) {
            youtubeToolsEnabled = changes.youtubeToolsEnabled.newValue !== false;
            if (!youtubeToolsEnabled) {
                document.querySelectorAll('.yt-thumbnail-download-btn').forEach(btn => btn.remove());
                document.querySelectorAll('.yt-webcraft-player-tools').forEach(panel => panel.remove());
                document.querySelectorAll('[data-yt-download-processed]').forEach(el => el.removeAttribute('data-yt-download-processed'));
            }
        }
        if (changes.youtubeThumbnailFilenameTemplate) youtubeThumbnailFilenameTemplate = changes.youtubeThumbnailFilenameTemplate.newValue || '{channel}-{title}-{date}';
        if (changes.youtubeHideShorts) youtubeHideShorts = changes.youtubeHideShorts.newValue === true;
        if (changes.youtubeHideLive) youtubeHideLive = changes.youtubeHideLive.newValue === true;
        if (changes.youtubeHideAds) youtubeHideAds = changes.youtubeHideAds.newValue === true;
        if (changes.youtubeBlacklist) youtubeBlacklist = parseYoutubeList(changes.youtubeBlacklist.newValue);
        if (changes.youtubeRecommendationsMode || changes.youtubeRecommendationsWhitelist || changes.youtubeToolsEnabled ||
            changes.youtubeHideShorts || changes.youtubeHideLive || changes.youtubeHideAds || changes.youtubeBlacklist) {
            applyRecommendationFilter();
        }
    });

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action !== 'updateYoutubeRecommendationsSettings') return;
        if (request.payload.enabled !== undefined) youtubeToolsEnabled = request.payload.enabled !== false;
        if (request.payload.mode !== undefined) recommendationsMode = request.payload.mode || 'enabled';
        if (request.payload.whitelist !== undefined) recommendationsWhitelist = parseWhitelist(request.payload.whitelist);
        if (request.payload.youtubeThumbnailFilenameTemplate !== undefined) youtubeThumbnailFilenameTemplate = request.payload.youtubeThumbnailFilenameTemplate || '{channel}-{title}-{date}';
        if (request.payload.youtubeHideShorts !== undefined) youtubeHideShorts = request.payload.youtubeHideShorts === true;
        if (request.payload.youtubeHideLive !== undefined) youtubeHideLive = request.payload.youtubeHideLive === true;
        if (request.payload.youtubeHideAds !== undefined) youtubeHideAds = request.payload.youtubeHideAds === true;
        if (request.payload.youtubeBlacklist !== undefined) youtubeBlacklist = parseYoutubeList(request.payload.youtubeBlacklist);
        if (!youtubeToolsEnabled) {
            document.querySelectorAll('.yt-thumbnail-download-btn').forEach(btn => btn.remove());
            document.querySelectorAll('.yt-webcraft-player-tools').forEach(panel => panel.remove());
            document.querySelectorAll('[data-yt-download-processed]').forEach(el => el.removeAttribute('data-yt-download-processed'));
        }
        applyRecommendationFilter();
    });

    /**
     * �?URL 或元素提取视�?ID
     */
    function extractVideoIdFromElement(element) {
        // 1. 如果是播放器本身
        if (element.id === 'movie_player') {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get('v');
        }

        // 2. 灏濊瘯浠庣埗绾ч摼鎺ヨ幏鍙?(Search results, Sidebar, Home)
        const link = element.closest('a[href]') ||
            element.querySelector?.('a[href*="/watch"], a[href*="/shorts"]');
        if (link) {
            const href = link.href;

            // 标准视频链接
            const watchMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
            if (watchMatch) return watchMatch[1];

            // Shorts 閾炬帴
            const shortsMatch = href.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
            if (shortsMatch) return shortsMatch[1];
        }

        // 3. 灏濊瘯浠?img src 鑾峰彇
        const img = element.querySelector('img');
        if (img && img.src) {
            const imgMatch = img.src.match(/\/vi\/([a-zA-Z0-9_-]{11})\//);
            if (imgMatch) return imgMatch[1];
            const imgMatch2 = img.src.match(/\/vi_webp\/([a-zA-Z0-9_-]{11})\//);
            if (imgMatch2) return imgMatch2[1];
        }

        return null;
    }

    /**
     * 尝试获取视频标题
     */
    function getVideoTitle(element, isPlayer) {
        // 1. 如果是播放器界面，直接取网页标题
        if (isPlayer) {
            // 大部分情�?document.title �?"Title - YouTube"
            return document.title.replace(' - YouTube', '');
        }

        // 2. 如果是缩略图，尝试寻找附近的标题元素

        // 尝试�?#video-title (�?Grid/List 视图中常�?
        // 需要向上找 renderer 然后向下�?title
        const renderer = element.closest(VIDEO_RENDERER_SELECTOR) ||
            (element.matches?.(VIDEO_RENDERER_SELECTOR) ? element : null);
        if (renderer) {
            const titleEl = renderer.querySelector('#video-title');
            if (titleEl) {
                return titleEl.title || titleEl.textContent;
            }
            // Shorts
            const shortsTitle = renderer.querySelector('#video-title-text');
            if (shortsTitle) return shortsTitle.textContent;
        }

        // 灏濊瘯瀵绘壘 aria-label
        const ariaLabel = element.getAttribute('aria-label') || element.querySelector('a#thumbnail')?.getAttribute('aria-label');
        if (ariaLabel) {
            // aria-label 通常包含 "Title by Author ViewCount Time"
            return ariaLabel.split(' by ')[0]; // 粗略提取
        }

        return 'youtube_video';
    }

    /**
     * 创建下载按钮
     */
    function createDownloadButton(videoId, isPlayer = false, element = null) {
        const btn = document.createElement('button');
        btn.className = 'yt-thumbnail-download-btn';
        btn.innerHTML = '猬囷笍';
        btn.title = '下载最高清缩略图';
        btn.dataset.videoId = videoId;

        // 如果是播放器上的按钮，添加特定的类或样式
        if (isPlayer) {
            btn.title = '下载当前视频缩略图';
        }

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (btn.classList.contains('downloading')) return;

            btn.classList.add('downloading');
            btn.innerHTML = '';

            // 鑾峰彇鏍囬
            let title = 'video';
            let channel = '未知频道';
            if (isPlayer) {
                title = document.title.replace(' - YouTube', '');
                channel = document.querySelector('ytd-video-owner-renderer ytd-channel-name a, #owner #channel-name a')?.textContent?.trim() || channel;
            } else if (element) {
                const extracted = getVideoTitle(element, false);
                if (extracted && extracted !== 'youtube_video') {
                    title = extracted;
                } else {
                    // 再次尝试�?document title (如果是单视频�?或�?fallback
                    title = `video_${videoId}`;
                }
                channel = getRecommendationChannelName(element) || channel;
            }

            // 鍙笅杞芥渶楂樻竻 maxresdefault
            const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
            const filename = buildYoutubeFilename({ title, channel, videoId });

            try {
                chrome.runtime.sendMessage({
                    action: 'downloadThumbnail',
                    payload: { url: thumbnailUrl, filename }
                }, (response) => {
                    if (response && response.success) {
                        btn.innerHTML = '✓';
                    } else {
                        // 失败时不降级，直接显示错�?
                        btn.innerHTML = '✕';
                        console.warn('最高清缩略图下载失败，404 Not Found 或其他错误');
                    }

                    setTimeout(() => {
                        btn.innerHTML = '猬囷笍';
                        btn.classList.remove('downloading');
                    }, 2000);
                });
            } catch (error) {
                console.error('下载失败:', error);
                btn.innerHTML = '✕';
                setTimeout(() => {
                    btn.innerHTML = '猬囷笍';
                    btn.classList.remove('downloading');
                }, 2000);
            }
        });

        return btn;
    }

    function getRecommendationChannelName(renderer) {
        const channelEl = renderer.querySelector(
            'ytd-channel-name a, #channel-name a, #byline a, .ytd-channel-name a, a[href^="/@"], a[href^="/channel/"], a[href^="/c/"]'
        );
        if (channelEl) return channelEl.textContent.trim();

        const metadataText = Array.from(renderer.querySelectorAll('yt-formatted-string, span'))
            .map(el => el.textContent.trim())
            .filter(Boolean)
            .join(' ');

        return metadataText;
    }

    function getTodayForFilename() {
        const date = new Date();
        return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    }

    function buildYoutubeFilename({ title, channel, videoId }) {
        const template = youtubeThumbnailFilenameTemplate || '{channel}-{title}-{date}';
        const base = template
            .replaceAll('{channel}', sanitizeFilenamePart(channel, '未知频道'))
            .replaceAll('{title}', sanitizeFilenamePart(title, `video_${videoId}`))
            .replaceAll('{date}', getTodayForFilename())
            .replaceAll('{id}', sanitizeFilenamePart(videoId, 'video'));
        return `${sanitizeFilenamePart(base, `video_${videoId}`)}.jpg`;
    }

    function buildYoutubeCaptureFilename({ title, channel, videoId, ext }) {
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const base = [
            sanitizeFilenamePart(channel, 'youtube'),
            sanitizeFilenamePart(title, `video_${videoId}`),
            getTodayForFilename(),
            time
        ].filter(Boolean).join('-');
        return `${sanitizeFilenamePart(base, `youtube_${videoId || 'video'}_${time}`)}.${ext}`;
    }

    function getCurrentYoutubeMeta() {
        const videoId = new URLSearchParams(window.location.search).get('v') || 'video';
        const title = document.querySelector('h1 yt-formatted-string, h1.title, #title h1')?.textContent?.trim() ||
            document.title.replace(' - YouTube', '').trim() ||
            `video_${videoId}`;
        const channel = document.querySelector('ytd-video-owner-renderer ytd-channel-name a, #owner #channel-name a, ytd-watch-metadata #channel-name a')?.textContent?.trim() ||
            'YouTube';
        return { videoId, title, channel };
    }

    function getYoutubeVideoElement() {
        const videos = Array.from(document.querySelectorAll('#movie_player video.html5-main-video, .html5-video-player video.html5-main-video, video.html5-main-video, video'));
        const visibleVideos = videos
            .map(video => ({ video, rect: video.getBoundingClientRect() }))
            .filter(item => item.rect.width >= 120 && item.rect.height >= 80 && item.video.readyState >= 1)
            .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
        return visibleVideos[0]?.video || videos.find(video => video.readyState >= 1) || videos[0] || null;
    }

    function getVisibleVideoRect() {
        const video = getYoutubeVideoElement();
        const rect = (video || document.querySelector('#movie_player, .html5-video-player'))?.getBoundingClientRect();
        if (!rect || rect.width < 50 || rect.height < 50) return null;
        const x = Math.max(0, rect.left);
        const y = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const w = Math.round(right - x);
        const h = Math.round(bottom - y);
        if (w < 50 || h < 50) return null;
        return { x: Math.round(x), y: Math.round(y), w, h };
    }

    async function downloadDataUrl(url, filename) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'downloadCollectorImage',
                payload: { url, filename }
            }, (response) => {
                resolve(response || { success: false, error: chrome.runtime.lastError?.message });
            });
        });
    }

    async function captureYoutubeFrameByVideo(filename) {
        const video = getYoutubeVideoElement();
        if (!video || !video.videoWidth || !video.videoHeight) throw new Error('No video frame');

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        return downloadDataUrl(canvas.toDataURL('image/png'), filename);
    }

    async function captureYoutubeFrameByVisibleCrop(filename, toolsPanel) {
        const rect = getVisibleVideoRect();
        if (!rect) throw new Error('No player rect');

        if (toolsPanel) toolsPanel.style.visibility = 'hidden';
        await wait(120);
        const dataUrl = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'captureTab' }, (response) => resolve(response));
        });
        if (toolsPanel) toolsPanel.style.visibility = '';
        if (!dataUrl) throw new Error('Capture tab failed');

        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Screenshot load failed'));
            image.src = dataUrl;
        });
        const scaleX = img.width / window.innerWidth;
        const scaleY = img.height / window.innerHeight;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.w * scaleX);
        canvas.height = Math.round(rect.h * scaleY);
        canvas.getContext('2d').drawImage(
            img,
            Math.round(rect.x * scaleX),
            Math.round(rect.y * scaleY),
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height
        );
        return downloadDataUrl(canvas.toDataURL('image/png'), filename);
    }

    async function captureYoutubeFrame(toolsPanel) {
        const meta = getCurrentYoutubeMeta();
        const filename = buildYoutubeCaptureFilename({ ...meta, ext: 'png' });
        try {
            const direct = await captureYoutubeFrameByVideo(filename);
            if (direct?.success) return direct;
            throw new Error(direct?.error || 'Direct frame capture failed');
        } catch (error) {
            console.warn('[YouTube] Direct frame capture failed, fallback to visible crop:', error);
            return captureYoutubeFrameByVisibleCrop(filename, toolsPanel);
        }
    }

    function startYoutubeVideoRecording(toolsPanel) {
        if (startYoutubeElementRecording(toolsPanel)) return;

        alert('当前 YouTube 视频暂时无法直接录制，请先播放视频后再点一次“录”。');
    }

    function startYoutubeElementRecording(toolsPanel) {
        const video = getYoutubeVideoElement();
        const captureStream = video?.captureStream || video?.mozCaptureStream;
        if (!video || !captureStream || !window.MediaRecorder) return false;

        try {
            const stream = captureStream.call(video);
            if (!stream || !stream.getVideoTracks().length) return false;

            const mimeOptions = ['video/webm; codecs=vp9', 'video/webm; codecs=vp8', 'video/webm'];
            const mimeType = mimeOptions.find(type => MediaRecorder.isTypeSupported(type)) || '';
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            const chunks = [];
            const startedAt = Date.now();
            const meta = getCurrentYoutubeMeta();
            let timerId = null;

            if (toolsPanel) toolsPanel.style.visibility = 'hidden';

            const playerHost = document.querySelector('#movie_player, .html5-video-player');
            const panel = document.createElement('div');
            panel.id = 'yt-webcraft-recording-panel';
            if (playerHost && window.getComputedStyle(playerHost).position === 'static') {
                playerHost.style.position = 'relative';
            }
            panel.style.cssText = `
                position: absolute;
                right: 18px;
                bottom: 58px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 7px 9px;
                border-radius: 999px;
                background: rgba(18,18,22,0.9);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.16);
                box-shadow: 0 8px 24px rgba(0,0,0,0.32);
                z-index: 2147483646;
                font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            `;

            const dot = document.createElement('span');
            dot.textContent = '●';
            dot.style.cssText = 'color:#ff4d4f;font-size:13px;';

            const timer = document.createElement('span');
            timer.textContent = '00:00';
            timer.style.cssText = 'min-width:38px;color:#ff9a9a;font-variant-numeric:tabular-nums;';

            const pauseBtn = document.createElement('button');
            pauseBtn.textContent = '暂停';
            pauseBtn.style.cssText = 'border:0;border-radius:999px;padding:6px 10px;background:rgba(255,255,255,0.14);color:#fff;cursor:pointer;font:inherit;';

            const stopBtn = document.createElement('button');
            stopBtn.textContent = '停止';
            stopBtn.style.cssText = 'border:0;border-radius:999px;padding:6px 10px;background:#e53935;color:#fff;cursor:pointer;font:inherit;';

            panel.appendChild(dot);
            panel.appendChild(timer);
            panel.appendChild(pauseBtn);
            panel.appendChild(stopBtn);
            (playerHost || document.body).appendChild(panel);

            timerId = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startedAt) / 1000);
                timer.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
            }, 500);

            recorder.ondataavailable = (event) => {
                if (event.data?.size) chunks.push(event.data);
            };

            recorder.onstop = () => {
                clearInterval(timerId);
                panel.remove();
                if (toolsPanel) toolsPanel.style.visibility = '';

                if (!chunks.length) {
                    alert('录制数据为空，无法保存');
                    return;
                }

                const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
                const url = URL.createObjectURL(blob);
                const filename = buildYoutubeCaptureFilename({ ...meta, ext: 'webm' });
                const fallbackDownload = () => {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                };

                try {
                    if (!chrome.runtime?.id) {
                        fallbackDownload();
                        return;
                    }

                    chrome.runtime.sendMessage({
                        action: 'downloadRecording',
                        payload: { url, filename }
                    }, (response) => {
                        if (chrome.runtime.lastError || !response?.success) {
                            fallbackDownload();
                            return;
                        }
                        setTimeout(() => URL.revokeObjectURL(url), 10000);
                    });
                } catch (error) {
                    fallbackDownload();
                }
            };

            pauseBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (recorder.state === 'recording') {
                    recorder.pause();
                    pauseBtn.textContent = '继续';
                    dot.style.opacity = '0.35';
                } else if (recorder.state === 'paused') {
                    recorder.resume();
                    pauseBtn.textContent = '暂停';
                    dot.style.opacity = '1';
                }
            };

            stopBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (recorder.state !== 'inactive') recorder.stop();
            };

            recorder.start(250);
            return true;
        } catch (error) {
            console.warn('[YouTube] video.captureStream recording failed:', error);
            if (toolsPanel) toolsPanel.style.visibility = '';
            return false;
        }
    }

    function ensureYoutubePlayerTools() {
        if (!youtubeToolsEnabled || window.location.pathname !== '/watch') {
            document.querySelectorAll('.yt-webcraft-player-tools').forEach(panel => panel.remove());
            return;
        }

        const player = document.querySelector('#movie_player, .html5-video-player');
        if (!player) return;
        const currentVideoId = new URLSearchParams(window.location.search).get('v') || '';
        let panel = player.querySelector('.yt-webcraft-player-tools');
        if (panel && panel.dataset.videoId === currentVideoId) return;
        if (panel) panel.remove();

        const computedStyle = window.getComputedStyle(player);
        if (computedStyle.position === 'static') player.style.position = 'relative';

        panel = document.createElement('div');
        panel.className = 'yt-webcraft-player-tools';
        panel.dataset.videoId = currentVideoId;

        const frameBtn = document.createElement('button');
        frameBtn.className = 'yt-webcraft-player-btn';
        frameBtn.type = 'button';
        frameBtn.textContent = '帧';
        frameBtn.dataset.label = '截取单帧';
        frameBtn.title = '截取当前 YouTube 单帧';
        frameBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (frameBtn.classList.contains('is-busy')) return;
            frameBtn.classList.add('is-busy');
            const oldText = frameBtn.textContent;
            frameBtn.textContent = '帧';
            try {
                const result = await captureYoutubeFrame(panel);
                frameBtn.textContent = result?.success ? '已保存' : '失败';
                if (!result?.success) console.warn('[YouTube] frame capture failed:', result?.error);
            } catch (error) {
                console.error('[YouTube] frame capture failed:', error);
                frameBtn.textContent = '帧';
            }
            setTimeout(() => {
                frameBtn.textContent = oldText;
                frameBtn.classList.remove('is-busy');
            }, 1200);
        });

        const videoBtn = document.createElement('button');
        videoBtn.className = 'yt-webcraft-player-btn';
        videoBtn.type = 'button';
        videoBtn.textContent = '录';
        videoBtn.dataset.label = '截取视频';
        videoBtn.title = '录制当前 YouTube 播放器区域视频';
        videoBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            startYoutubeVideoRecording(panel);
        });

        panel.appendChild(frameBtn);
        panel.appendChild(videoBtn);
        player.appendChild(panel);
    }

    function isShortsRenderer(renderer) {
        return !!renderer.querySelector?.('a[href*="/shorts/"]') ||
            renderer.matches?.('ytd-reel-item-renderer, ytd-reel-shelf-renderer');
    }

    function isLiveRenderer(renderer) {
        const text = (renderer.innerText || '').toLowerCase();
        return text.includes('正在直播') || text.includes('直播中') || text.includes('live now') || text.includes('premiere');
    }

    function isBlacklistedRenderer(renderer) {
        if (!youtubeBlacklist.length) return false;
        const title = getVideoTitle(renderer, false).toLowerCase();
        const channel = getRecommendationChannelName(renderer).toLowerCase();
        const text = `${title} ${channel} ${(renderer.innerText || '').toLowerCase()}`;
        return youtubeBlacklist.some(item => text.includes(item));
    }

    function applyYoutubeContentHiding() {
        const candidates = document.querySelectorAll(VIDEO_RENDERER_SELECTOR);
        candidates.forEach(renderer => {
            const shouldHide = (youtubeHideShorts && isShortsRenderer(renderer)) ||
                (youtubeHideLive && isLiveRenderer(renderer)) ||
                isBlacklistedRenderer(renderer);
            setElementHiddenReason(renderer, 'Extra', shouldHide);
        });

        document.querySelectorAll([
            'ytd-ad-slot-renderer',
            'ytd-promoted-video-renderer',
            'ytd-display-ad-renderer',
            'ytd-companion-slot-renderer',
            'ytd-player-legacy-desktop-watch-ads-renderer',
            'ytd-in-feed-ad-layout-renderer',
            'ytd-banner-promo-renderer',
            '#player-ads',
            '#masthead-ad'
        ].join(', ')).forEach(element => {
            setElementHiddenReason(element, 'Ad', youtubeHideAds);
        });
    }

    function setElementHiddenByTool(element, shouldHide) {
        element.classList.toggle('yt-recommendation-hidden-by-tool', shouldHide);
        if (shouldHide) {
            element.hidden = true;
            element.setAttribute('aria-hidden', 'true');
            element.style.setProperty('display', 'none', 'important');
        } else {
            element.hidden = false;
            element.removeAttribute('aria-hidden');
            element.style.removeProperty('display');
        }
    }

    function setElementHiddenReason(element, reason, shouldHide) {
        const key = `ytHidden${reason}`;
        if (shouldHide) {
            element.dataset[key] = 'true';
        } else {
            delete element.dataset[key];
        }

        const hidden = element.dataset.ytHiddenRecommendation === 'true' ||
            element.dataset.ytHiddenExtra === 'true' ||
            element.dataset.ytHiddenAd === 'true';
        setElementHiddenByTool(element, hidden);
    }

    function findThumbnailButtonHost(container, fallback) {
        const scope = container || fallback;
        const images = Array.from(scope.querySelectorAll?.('img') || []);
        const visualImage = images.find(img => {
            const rect = img.getBoundingClientRect();
            return rect.width >= 80 && rect.height >= 45;
        }) || null;

        if (visualImage) {
            const rendererHost = visualImage.closest(VIDEO_RENDERER_SELECTOR);
            const host = rendererHost || visualImage.closest('a[href], ytd-thumbnail, ytd-playlist-thumbnail, #thumbnail');
            return {
                buttonHost: host || visualImage.parentElement || fallback,
                visualImage
            };
        }

        return {
            buttonHost: scope.querySelector?.(THUMBNAIL_HOST_SELECTOR) || fallback,
            visualImage: null
        };
    }

    function positionDownloadButton(btn, buttonHost, visualImage) {
        btn.style.removeProperty('left');
        btn.style.removeProperty('right');

        const target = visualImage || buttonHost;
        if (!target) return;

        const rect = target.getBoundingClientRect();
        btn.style.left = `${Math.max(8, Math.min(window.innerWidth - 40, rect.right - 40))}px`;
        btn.style.top = `${Math.max(8, Math.min(window.innerHeight - 40, rect.top + 8))}px`;
    }

    function bindFloatingDownloadButton(btn, hoverHost, buttonHost, visualImage) {
        let hideTimer = null;
        const update = () => positionDownloadButton(btn, buttonHost, visualImage);
        const show = () => {
            clearTimeout(hideTimer);
            update();
            btn.classList.add('is-floating-visible');
        };
        const hide = () => {
            hideTimer = setTimeout(() => btn.classList.remove('is-floating-visible'), 120);
        };

        hoverHost.addEventListener('mouseenter', show);
        hoverHost.addEventListener('mousemove', update);
        hoverHost.addEventListener('mouseleave', hide);
        btn.addEventListener('mouseenter', show);
        btn.addEventListener('mouseleave', hide);
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        update();
    }

    function applyRecommendationFilter() {
        if (!isYouTubeHost()) return;
        const effectiveMode = youtubeToolsEnabled ? recommendationsMode : 'enabled';

        const secondary = document.querySelector('#secondary');
        if (secondary) {
            secondary.classList.toggle('yt-recommendations-filtering-by-tool', effectiveMode !== 'enabled');
        }

        document.querySelectorAll(
            '#secondary #chips, #secondary ytd-feed-filter-chip-bar-renderer, #secondary yt-chip-cloud-renderer'
        ).forEach(element => {
            setElementHiddenByTool(element, effectiveMode !== 'enabled');
        });

        document.querySelectorAll('#secondary #related, #secondary ytd-watch-next-secondary-results-renderer')
            .forEach(element => {
                setElementHiddenByTool(element, effectiveMode === 'hidden');
            });

        const renderers = document.querySelectorAll(RECOMMENDATION_RENDERER_SELECTOR);

        renderers.forEach(renderer => {
            let shouldHide = false;
            if (effectiveMode === 'hidden') {
                shouldHide = true;
            } else if (effectiveMode === 'whitelist') {
                const channelName = getRecommendationChannelName(renderer).toLowerCase();
                shouldHide = recommendationsWhitelist.length === 0 ||
                    !recommendationsWhitelist.some(item => channelName.includes(item));
            }

            setElementHiddenReason(renderer, 'Recommendation', shouldHide);
        });

        applyYoutubeContentHiding();
    }

    /**
     * 处理缩略�?播放器元�?
     */
    function processElement(element) {
        // 检查是否已处理
        const renderer = element.matches?.(VIDEO_RENDERER_SELECTOR)
            ? element
            : element.closest?.(VIDEO_RENDERER_SELECTOR);
        const processedElement = renderer || element;
        if (processedElement.dataset.ytDownloadProcessed) return;

        const videoId = extractVideoIdFromElement(processedElement);
        if (!videoId) return;

        processedElement.dataset.ytDownloadProcessed = 'true';
        const { buttonHost, visualImage } = findThumbnailButtonHost(renderer || element, element);
        if (document.querySelector(`.yt-thumbnail-download-btn[data-video-id="${videoId}"]`)) return;

        // 确保容器有相对定�?        const computedStyle = window.getComputedStyle(buttonHost);
        if (computedStyle.position === 'static') {
            const tagName = buttonHost.tagName?.toLowerCase();
            if (element.id === 'movie_player' || !['ytd-thumbnail', 'ytd-playlist-thumbnail', 'a'].includes(tagName)) {
                // Floating buttons are appended to body, so avoid changing YouTube's native thumbnail layout.'
            }
        }

        // 添加标记�?(用于hover效果)
        if (false && !buttonHost.classList.contains('yt-thumbnail-container')) {
            buttonHost.classList.add('yt-thumbnail-container');
        }
        // Do not add layout-affecting classes to YouTube thumbnail hosts.

        // 创建并添加下载按�?        const isPlayer = element.id === 'movie_player';
        // 传�?element 引用以便点击时获取最新标�?        const btn = createDownloadButton(videoId, isPlayer, renderer || element);
        positionDownloadButton(btn, buttonHost, visualImage);
        document.body.appendChild(btn);
        bindFloatingDownloadButton(btn, renderer || buttonHost, buttonHost, visualImage);
    }

    /**
     * 扫描并处理页面上的缩略图
     */
    function scanThumbnails() {
        if (!youtubeToolsEnabled) {
            applyRecommendationFilter();
            return;
        }

        // 1. 常规缩略�?(Home, Search, Channel, Playlist)
        // ytd-thumbnail: 主缩略图容器 (Grid, List)
        // ytd-playlist-thumbnail: 播放列表缩略�?

        // 2. 鍙充晶鎺ㄨ崘/渚ц竟鏍?(Important for User Request)
        // 它们通常�?ytd-compact-video-renderer �?

        const selectors = [
            // 右侧推荐/侧边栏先处理整条卡片，避免按钮挂到不可见的内部节�?            '#secondary ytd-compact-video-renderer:not([data-yt-download-processed])',
            '#secondary ytd-compact-radio-renderer:not([data-yt-download-processed])',
            '#secondary ytd-compact-playlist-renderer:not([data-yt-download-processed])',
            '#secondary ytd-compact-lockup-view-model:not([data-yt-download-processed])',
            '#secondary yt-lockup-view-model:not([data-yt-download-processed])',
            '#related ytd-compact-video-renderer:not([data-yt-download-processed])',
            '#related ytd-compact-radio-renderer:not([data-yt-download-processed])',
            '#related ytd-compact-playlist-renderer:not([data-yt-download-processed])',
            '#related ytd-compact-lockup-view-model:not([data-yt-download-processed])',
            '#related yt-lockup-view-model:not([data-yt-download-processed])',
            // 主页、搜索结�?            'ytd-thumbnail:not([data-yt-download-processed])',
            // 鎾斁鍒楄〃
            'ytd-playlist-thumbnail:not([data-yt-download-processed])',
            // Shorts (鏈夋椂鍊欐槸 ytd-reel-item-renderer)
            'ytd-reel-item-renderer:not([data-yt-download-processed])',
            // 侧边�?推荐视频 (最关键)
            'ytd-compact-video-renderer ytd-thumbnail:not([data-yt-download-processed])',
            'ytd-compact-video-renderer:not([data-yt-download-processed])',
            // 旧版/通用 fallback
            'a#thumbnail:not([data-yt-download-processed])'
        ];

        const thumbnails = document.querySelectorAll(selectors.join(', '));

        thumbnails.forEach(thumbnail => {
            // 跳过已经处理�?
            if (thumbnail.dataset.ytDownloadProcessed) return;

            // 过滤掉太小的图标 (头像�?，保留侧边栏缩略�?
            // 侧边栏缩略图通常宽度 > 10px
            const isRenderer = thumbnail.matches?.(VIDEO_RENDERER_SELECTOR);
            if (!isRenderer && thumbnail.offsetWidth > 10 && thumbnail.offsetWidth < 120 && thumbnail.offsetHeight < 60) {
                // 可能是头像或者微型图标，忽略，但要小心侧边栏 compact 模式
                // ytd-compact-video-renderer 的缩略图通常�?168x94
                return; // Added return here to skip processing small elements
            }

            // 额外检查：如果�?Shorts 的某�?UI，结构可能不�?            processElement(thumbnail);
        });

        applyRecommendationFilter();
        ensureYoutubePlayerTools();

        // 2. 当前播放视频的播放器
        // 只有�?Watch 页面才处�?
        if (window.location.pathname === '/watch') {
            const player = document.querySelector('#movie_player:not([data-yt-download-processed])');
            if (player) {
                // 确保不要在广告播放时处理，或者更�?ID
                processElement(player);
            } else {
                // 如果播放器已经处理过，但 URL 变了 (SPA跳转)，需要更�?ID
                const processedPlayer = document.querySelector('#movie_player[data-yt-download-processed]');
                if (processedPlayer) {
                    const currentVideoId = new URLSearchParams(window.location.search).get('v');
                    const btn = processedPlayer.querySelector('.yt-thumbnail-download-btn');
                    if (btn && btn.dataset.videoId !== currentVideoId) {
                        // 视频 ID 变了，移除旧按钮，重置状�?
                        btn.remove();
                        processedPlayer.querySelector('.yt-webcraft-player-tools')?.remove();
                        processedPlayer.removeAttribute('data-yt-download-processed');
                        // 下次扫描会重新添�?
                    }
                }
            }
        }
    }

    // 鍒濇鎵弿
    setTimeout(scanThumbnails, 1000);

    // 鐩戝惉 DOM 鍙樺寲
    const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldScan = true;
                break;
            }
        }
        if (shouldScan) {
            // 闃叉姈
            clearTimeout(observer._scanTimeout);
            observer._scanTimeout = setTimeout(scanThumbnails, 500);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 监听 URL 变化 (处理 SPA 页面跳转)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            // URL 变化后，强制重新扫描，特别是针对播放�?
            setTimeout(scanThumbnails, 1000);
        }
    }).observe(document, { subtree: true, childList: true });

    console.log('YouTube 缩略图下载功能已加载（增强版）');
})();

// ==================== 隐藏 YouTube 翻译按钮功能 ====================

(function initHideYoutubeTranslate() {
    'use strict';

    // 鍙湪 YouTube 椤甸潰杩愯
    if (!isYouTubeHost()) {
        return;
    }

    // 用于隐藏"翻译成中�?按钮的样�?
    const styleId = 'yt-hide-translate-style';

    /**
     * 创建或更新隐藏翻译按钮的样式
     */
    function updateHideTranslateStyle(shouldHide) {
        let styleElement = document.getElementById(styleId);

        if (shouldHide) {
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                document.head.appendChild(styleElement);
            }
            // 隐藏评论�?翻译成中�?按钮
            // 这个按钮通常�?ytd-comment-renderer 内的翻译按钮
            styleElement.textContent = `
                /* 隐藏评论翻译按钮 */
                ytd-comment-renderer #translate-button,
                ytd-comment-renderer .translate-button,
                ytd-comment-view-model #translate-button,
                ytd-comment-view-model .translate-button,
                #content-text + ytd-expander #translate-button,
                #comment-content #translate-button,
                ytd-comment-renderer tp-yt-paper-button[aria-label*="翻译"],
                ytd-comment-view-model tp-yt-paper-button[aria-label*="翻译"],
                /* 隐藏评论下方的翻译文字链接 */
                #content-text + #translate-button,
                ytd-comment-renderer [id="translate-button"],
                ytd-comment-view-model [id="translate-button"],
                /* 更精确的选择�?- 翻译按钮容器 */
                #comment-content > #translate-button,
                #expander > #translate-button,
                ytd-comment-renderer #published-time-text + #translate-button,
                /* 新版 YouTube 评论翻译按钮 */
                ytd-comment-renderer yt-formatted-string[id="translate-button"],
                ytd-comment-view-model yt-formatted-string[id="translate-button"],
                ytd-comment-renderer #body #translate-button,
                ytd-comment-view-model #body #translate-button {
                    display: none !important;
                    visibility: hidden !important;
                    height: 0 !important;
                    overflow: hidden !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }
            `;
            console.log('YouTube 评论翻译按钮已隐藏');
        } else {
            // 移除样式以显示翻译按�?
            if (styleElement) {
                styleElement.remove();
            }
            console.log('YouTube 评论翻译按钮已显示');
        }
    }

    // 加载初始设置
    chrome.storage.local.get(['hideYoutubeTranslate'], (result) => {
        if (result.hideYoutubeTranslate) {
            updateHideTranslateStyle(true);
        }
    });

    // 鐩戝惉璁剧疆鍙樺寲
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.hideYoutubeTranslate) {
            updateHideTranslateStyle(changes.hideYoutubeTranslate.newValue);
        }
    });

    console.log('YouTube 翻译按钮隐藏功能已加载');
})();

// ==================== 屏幕区域录制功能 ====================

(function initScreenRecorder() {
    'use strict';

    console.log('[屏幕录制] 模块加载中...');

    // ===== screen recorder state =====
    let regionRect = null;
    let tabStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecording = false;
    let isPaused = false;
    let recordingStartTime = 0;
    let timerInterval = null;
    let cropAnimFrameId = null;    // requestAnimationFrame ID
    let controlPanel = null;
    let recordingBorder = null;
    let recordingSizeBytes = 0;
    let recordingName = '\u672a\u547d\u540d';
    let recordingTool = 'Midjourney\u751f\u6210';
    let recordingModuleEnabled = true;
    let recordingShowBorder = true;
    let recordingMaxMinutes = 30;
    let recordingMaxSizeMB = 500;
    let recordingHotkeyHandler = null;
    const LAST_REGION_KEY = 'screenRecorderLastRegion';

    chrome.storage.local.get(['recordingModuleEnabled', 'recordingShowBorder', 'recordingMaxMinutes', 'recordingMaxSizeMB'], (result) => {
        recordingModuleEnabled = result.recordingModuleEnabled !== false;
        recordingShowBorder = result.recordingShowBorder !== false;
        recordingMaxMinutes = Number(result.recordingMaxMinutes) || 30;
        recordingMaxSizeMB = Number(result.recordingMaxSizeMB) || 500;
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.recordingModuleEnabled) recordingModuleEnabled = changes.recordingModuleEnabled.newValue !== false;
        if (changes.recordingShowBorder) recordingShowBorder = changes.recordingShowBorder.newValue !== false;
        if (changes.recordingMaxMinutes) recordingMaxMinutes = Number(changes.recordingMaxMinutes.newValue) || 30;
        if (changes.recordingMaxSizeMB) recordingMaxSizeMB = Number(changes.recordingMaxSizeMB.newValue) || 500;
    });

    function saveLastRegion(rect) {
        chrome.storage.local.set({
            [LAST_REGION_KEY]: {
                xRatio: rect.x / window.innerWidth,
                yRatio: rect.y / window.innerHeight,
                wRatio: rect.w / window.innerWidth,
                hRatio: rect.h / window.innerHeight
            }
        });
    }

    function restoreLastRegion(saved) {
        if (!saved) return null;

        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const x = Math.round((saved.xRatio || 0) * viewportW);
        const y = Math.round((saved.yRatio || 0) * viewportH);
        const w = Math.round((saved.wRatio || 0) * viewportW);
        const h = Math.round((saved.hRatio || 0) * viewportH);

        if (w < 50 || h < 50) return null;

        const clampedX = Math.max(0, Math.min(x, viewportW - 50));
        const clampedY = Math.max(0, Math.min(y, viewportH - 50));
        const clampedW = Math.min(w, viewportW - clampedX);
        const clampedH = Math.min(h, viewportH - clampedY);

        if (clampedW < 50 || clampedH < 50) return null;

        return {
            x: clampedX,
            y: clampedY,
            w: clampedW,
            h: clampedH
        };
    }

    function renderSelectedRegion(rect, selectionBox, sizeLabel) {
        selectionBox.style.left = rect.x + 'px';
        selectionBox.style.top = rect.y + 'px';
        selectionBox.style.width = rect.w + 'px';
        selectionBox.style.height = rect.h + 'px';
        selectionBox.style.display = 'block';

        sizeLabel.style.display = 'block';
        sizeLabel.style.left = Math.min(rect.x + rect.w + 8, window.innerWidth - 120) + 'px';
        sizeLabel.style.top = Math.max(rect.y - 4, 8) + 'px';
        sizeLabel.textContent = `${rect.w} × ${rect.h} px`;
    }

    // ===== 区域选择�?=====
    function installRecordingHotkeys() {
        removeRecordingHotkeys();
        recordingHotkeyHandler = (event) => {
            if (!isRecording && !isPaused) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                stopRecording();
            } else if (event.altKey && event.key.toLowerCase() === 'p') {
                event.preventDefault();
                event.stopPropagation();
                toggleRecordingPause();
            }
        };
        document.addEventListener('keydown', recordingHotkeyHandler, true);
        window.addEventListener('keydown', recordingHotkeyHandler, true);
    }

    function removeRecordingHotkeys() {
        if (!recordingHotkeyHandler) return;
        document.removeEventListener('keydown', recordingHotkeyHandler, true);
        window.removeEventListener('keydown', recordingHotkeyHandler, true);
        recordingHotkeyHandler = null;
    }

    function toggleRecordingPause() {
        if (!mediaRecorder) return;
        if (isPaused && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            isPaused = false;
            isRecording = true;
        } else if (mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            isPaused = true;
            isRecording = false;
        }
    }

    function showRecordingRegionSelector(name, tool, useLastRegion = true) {
        if (!recordingModuleEnabled) {
            showRecordingToast('录屏模块已在设置页关闭', 'error');
            return;
        }

        recordingName = name || '未命名';
        recordingTool = tool || 'Midjourney生成';
        console.log(`[屏幕录制] 显示区域选择器，名称: ${recordingName}, 工具: ${recordingTool}`);

        // 移除已有的选择�?
        const existing = document.getElementById('screen-recorder-overlay');
        if (existing) existing.remove();

        // 注入动画样式（只注入一次）
        if (!document.getElementById('screen-recorder-styles')) {
            const style = document.createElement('style');
            style.id = 'screen-recorder-styles';
            style.textContent = `
                @keyframes sr-fade-in { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
                @keyframes sr-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
                @keyframes sr-compact-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
                body.webcraft-recording-clean-ui #web-collector-canvas-handle,
                body.webcraft-recording-clean-ui #webcraft-floating-translator-handle,
                body.webcraft-recording-clean-ui .yt-webcraft-player-tools,
                body.webcraft-recording-clean-ui .yt-thumbnail-download-btn,
                body.webcraft-recording-clean-ui #screen-recorder-control-panel,
                body.webcraft-recording-clean-ui #screen-recorder-active-border,
                body.webcraft-recording-clean-ui .screen-recorder-toast {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        // 创建覆盖�?
        const overlay = document.createElement('div');
        overlay.id = 'screen-recorder-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.4);
            z-index: 2147483640;
            cursor: crosshair;
            user-select: none;
        `;

        // 选区�?
        const selectionBox = document.createElement('div');
        selectionBox.id = 'screen-recorder-selection';
        selectionBox.style.cssText = `
            position: fixed;
            border: 2px dashed #ff4444;
            background: rgba(255, 68, 68, 0.08);
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);
            display: none;
            z-index: 2147483641;
            pointer-events: none;
        `;

        // 灏哄鏍囨敞
        const sizeLabel = document.createElement('div');
        sizeLabel.id = 'screen-recorder-size-label';
        sizeLabel.style.cssText = `
            position: fixed;
            background: rgba(255, 68, 68, 0.9);
            color: white;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            font-family: monospace;
            z-index: 2147483642;
            display: none;
            pointer-events: none;
            white-space: nowrap;
        `;

        // 鎻愮ず鏂囧瓧
        const hint = document.createElement('div');
        hint.style.cssText = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 20px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            text-shadow: 0 2px 8px rgba(0,0,0,0.5);
            pointer-events: none;
            z-index: 2147483642;
            text-align: center;
            line-height: 1.6;
        `;
        hint.innerHTML = '🎯 拖拽选择录制区域<br><span style="font-size:14px;opacity:0.7">按 Esc 取消</span>';

        overlay.appendChild(hint);
        document.body.appendChild(overlay);
        document.body.appendChild(selectionBox);
        document.body.appendChild(sizeLabel);

        if (useLastRegion) {
            chrome.storage.local.get([LAST_REGION_KEY], (result) => {
                const restored = restoreLastRegion(result[LAST_REGION_KEY]);
                if (!restored || !document.body.contains(overlay)) return;

                regionRect = restored;
                hint.innerHTML = '已加载上次录制区域<br><span style="font-size:14px;opacity:0.7">直接开始，或拖拽重新选择</span>';
                overlay.style.background = 'transparent';
                renderSelectedRegion(regionRect, selectionBox, sizeLabel);
                showConfirmButtons(overlay, selectionBox, sizeLabel);
            });
        }

        let startX, startY, isDragging = false;

        // 鼠标按下 - 开始选区
        overlay.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const existingBar = document.getElementById('screen-recorder-confirm-bar');
            if (existingBar) existingBar.remove();
            startX = e.clientX;
            startY = e.clientY;
            isDragging = true;
            regionRect = null;
            hint.style.display = 'none';
            selectionBox.style.display = 'block';
            // 覆盖层使用透明背景，通过选区�?box-shadow 实现暗色遮罩
            overlay.style.background = 'transparent';
        });

        // 鼠标移动 - 更新选区
        const onMouseMove = (e) => {
            if (!isDragging) return;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const w = Math.abs(e.clientX - startX);
            const h = Math.abs(e.clientY - startY);

            selectionBox.style.left = x + 'px';
            selectionBox.style.top = y + 'px';
            selectionBox.style.width = w + 'px';
            selectionBox.style.height = h + 'px';

            sizeLabel.style.display = 'block';
            sizeLabel.style.left = (x + w + 8) + 'px';
            sizeLabel.style.top = (y - 4) + 'px';
            sizeLabel.textContent = `${w} × ${h} px`;
        };

        // 鼠标松开 - 完成选区
        const onMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const w = Math.abs(e.clientX - startX);
            const h = Math.abs(e.clientY - startY);

            // 选区太小则忽�?
            if (w < 50 || h < 50) {
                showRecordingToast('选区太小，请重新选择（至少 50×50 像素）', 'error');
                cleanupSelector();
                return;
            }

            regionRect = { x, y, w, h };
            saveLastRegion(regionRect);
            showConfirmButtons(overlay, selectionBox, sizeLabel);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Esc 鍙栨秷
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                cleanupSelector();
                document.removeEventListener('keydown', onEsc);
            }
        };
        document.addEventListener('keydown', onEsc);
    }

    function showConfirmButtons(overlay, selectionBox, sizeLabel) {
        const existingBar = document.getElementById('screen-recorder-confirm-bar');
        if (existingBar) existingBar.remove();

        const btnBar = document.createElement('div');
        btnBar.id = 'screen-recorder-confirm-bar';
        btnBar.style.cssText = `
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 12px;
            z-index: 2147483643;
            animation: sr-fade-in 0.3s ease;
        `;

        const makeBtnStyle = (bg) => `
            padding: 10px 24px;
            border: none;
            border-radius: 8px;
            color: white;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            background: ${bg};
            box-shadow: 0 4px 14px rgba(0,0,0,0.3);
            transition: transform 0.15s, box-shadow 0.15s;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;

        // 开始录制按�?
        const btnStart = document.createElement('button');
        btnStart.textContent = '🔴 开始录制';
        btnStart.style.cssText = makeBtnStyle('linear-gradient(135deg, #ff4444, #cc0000)');
        btnStart.onmouseenter = () => { btnStart.style.transform = 'scale(1.05)'; };
        btnStart.onmouseleave = () => { btnStart.style.transform = 'scale(1)'; };
        btnStart.onclick = () => {
            btnBar.remove();
            overlay.remove();
            selectionBox.style.display = 'none';
            sizeLabel.style.display = 'none';
            // 请求 background 获取 tabCapture �?
            chrome.runtime.sendMessage({ action: 'startScreenRecording' }, (resp) => {
                if (!resp || !resp.success) {
                    showRecordingToast('启动录制失败: ' + (resp?.error || '未知错误'), 'error');
                    cleanupSelector();
                }
            });
        };

        // 重选按�?
        const btnReselect = document.createElement('button');
        btnReselect.textContent = '↻ 重新选区';
        btnReselect.style.cssText = makeBtnStyle('rgba(255,255,255,0.2)');
        btnReselect.style.backdropFilter = 'blur(8px)';
        btnReselect.onmouseenter = () => { btnReselect.style.transform = 'scale(1.05)'; };
        btnReselect.onmouseleave = () => { btnReselect.style.transform = 'scale(1)'; };
        btnReselect.onclick = () => {
            btnBar.remove();
            cleanupSelector();
            showRecordingRegionSelector(recordingName, recordingTool, false);
        };

        // 鍙栨秷鎸夐挳
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '取消';
        btnCancel.style.cssText = makeBtnStyle('rgba(255,255,255,0.15)');
        btnCancel.style.backdropFilter = 'blur(8px)';
        btnCancel.onmouseenter = () => { btnCancel.style.transform = 'scale(1.05)'; };
        btnCancel.onmouseleave = () => { btnCancel.style.transform = 'scale(1)'; };
        btnCancel.onclick = () => {
            btnBar.remove();
            cleanupSelector();
        };

        btnBar.appendChild(btnStart);
        btnBar.appendChild(btnReselect);
        btnBar.appendChild(btnCancel);
        document.body.appendChild(btnBar);
    }

    // 清理区域选择�?
    function cleanupSelector() {
        ['screen-recorder-overlay', 'screen-recorder-selection',
            'screen-recorder-size-label', 'screen-recorder-confirm-bar'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
    }

    // ===== 录制核心 =====

    // 初始化录制（接收 tabCapture �?ID 后调用）
    async function handleInitRegionRecording(streamId, options = {}) {
        console.log('[屏幕录制] 初始化录制，streamId:', streamId);

        if (options.regionRect) {
            regionRect = {
                x: Math.max(0, Math.round(Number(options.regionRect.x) || 0)),
                y: Math.max(0, Math.round(Number(options.regionRect.y) || 0)),
                w: Math.max(50, Math.round(Number(options.regionRect.w) || 0)),
                h: Math.max(50, Math.round(Number(options.regionRect.h) || 0))
            };
            recordingName = options.name || recordingName || '\u672a\u547d\u540d';
            recordingTool = options.tool || recordingTool || 'YouTube';
            saveLastRegion(regionRect);
        }

        if (!regionRect) {
            showRecordingToast('没有选择录制区域', 'error');
            return;
        }

        try {
            // 通过 streamId 获取标签页的媒体�?
            const streamSource = options.streamSource || 'tab';
            tabStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: streamSource,
                        chromeMediaSourceId: streamId
                    }
                }
            });

            console.log('[屏幕录制] 媒体流获取成功');

            // 创建 Canvas 用于裁剪区域
            const videoTrack = tabStream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            const sourceWidth = settings.width;
            const sourceHeight = settings.height;
            const dpr = window.devicePixelRatio || 1;

            console.log(`[屏幕录制] 视频源: ${sourceWidth}x${sourceHeight}, DPR: ${dpr}`);
            console.log(`[屏幕录制] 裁剪区域: ${regionRect.x},${regionRect.y} ${regionRect.w}x${regionRect.h}`);

            // 创建隐藏�?video 元素来接�?tabCapture �?
            const sourceVideo = document.createElement('video');
            sourceVideo.srcObject = tabStream;
            sourceVideo.muted = true;
            sourceVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;';
            document.body.appendChild(sourceVideo);
            await sourceVideo.play();

            // Canvas 用于裁剪 - 尺寸必须基于视频源的实际缩放比，而非 DPR
            // 否则�?sourceWidth/innerWidth != DPR 时，画面宽高比会失真
            const scaleX = sourceWidth / window.innerWidth;
            const scaleY = sourceHeight / window.innerHeight;

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = Math.round(regionRect.w * scaleX);
            cropCanvas.height = Math.round(regionRect.h * scaleY);
            const cropCtx = cropCanvas.getContext('2d');

            console.log(`[屏幕录制] 缩放比: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}, canvas=${cropCanvas.width}x${cropCanvas.height}`);

            // 帧裁剪循�?- 持续�?tabCapture 视频流按选区裁剪画到 canvas �?
            function cropFrame() {
                if (!isRecording && !isPaused) return;

                const sx = Math.round(regionRect.x * scaleX);
                const sy = Math.round(regionRect.y * scaleY);
                const sw = Math.round(regionRect.w * scaleX);
                const sh = Math.round(regionRect.h * scaleY);

                cropCtx.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);
                cropAnimFrameId = requestAnimationFrame(cropFrame);
            }

            // �?Canvas 获取裁剪后的流（30 FPS�?
            const croppedStream = cropCanvas.captureStream(30);

            // 配置 MediaRecorder（编码自动降级）
            recordedChunks = [];
            recordingSizeBytes = 0;
            const mimeOptions = ['video/webm; codecs=vp9', 'video/webm; codecs=vp8', 'video/webm'];
            let selectedMime = '';
            for (const mime of mimeOptions) {
                if (MediaRecorder.isTypeSupported(mime)) {
                    selectedMime = mime;
                    break;
                }
            }

            const recorderOptions = selectedMime ? { mimeType: selectedMime } : {};
            mediaRecorder = new MediaRecorder(croppedStream, recorderOptions);
            console.log(`[屏幕录制] 编码格式: ${selectedMime || '默认'}`);

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                    recordingSizeBytes += e.data.size;
                    const maxBytes = recordingMaxSizeMB * 1024 * 1024;
                    if (recordingSizeBytes >= maxBytes) {
                        showRecordingToast(`已达到 ${recordingMaxSizeMB}MB 保护上限，自动停止`);
                        stopRecording();
                    }
                }
            };

            mediaRecorder.onstop = () => {
                console.log('[屏幕录制] MediaRecorder 已停止');
                // 停止帧裁�?
                if (cropAnimFrameId) cancelAnimationFrame(cropAnimFrameId);
                // 清理源视频和�?
                sourceVideo.pause();
                sourceVideo.remove();
                if (tabStream) {
                    tabStream.getTracks().forEach(t => t.stop());
                    tabStream = null;
                }
                // 导出视频
                exportRecording();
            };

            // 开始录制
            isRecording = true;
            isPaused = false;
            document.body.classList.add('webcraft-recording-clean-ui');
            installRecordingHotkeys();
            mediaRecorder.start(100);
            cropAnimFrameId = requestAnimationFrame(cropFrame);
            recordingStartTime = Date.now();

            // 鏄剧ず鎺у埗闈㈡澘
            showRecordingControlPanel();
            showRecordingBorder();
            showRecordingToast('🔴 开始录制 - 你可以滚动页面了');

            console.log('[屏幕录制] 录制已开始');

        } catch (err) {
            console.error('[屏幕录制] 初始化失败', err);
            showRecordingToast('录制初始化失败: ' + err.message, 'error');
            cleanupRecording();
        }
    }

    // ===== 录制控制面板 =====

    function showRecordingControlPanel() {
        if (controlPanel) controlPanel.remove();

        controlPanel = document.createElement('div');
        controlPanel.id = 'screen-recorder-control-panel';
        const placeAbove = regionRect && regionRect.y > 64;
        const placeBelow = regionRect && regionRect.y + regionRect.h < window.innerHeight - 64;
        const top = placeAbove
            ? Math.max(8, regionRect.y - 52)
            : placeBelow
                ? Math.min(window.innerHeight - 52, regionRect.y + regionRect.h + 10)
                : window.innerHeight - 58;
        const left = regionRect
            ? Math.min(window.innerWidth - 210, Math.max(8, regionRect.x + regionRect.w - 210))
            : window.innerWidth - 220;
        controlPanel.style.cssText = `
            position: fixed;
            top: ${top}px;
            left: ${left}px;
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 5px 7px;
            background: rgba(18, 18, 18, 0.88);
            backdrop-filter: blur(12px);
            border-radius: 999px;
            border: 1px solid rgba(255, 68, 68, 0.4);
            box-shadow: 0 6px 20px rgba(0,0,0,0.35);
            z-index: 2147483645;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: white;
            user-select: none;
            animation: sr-compact-in 0.2s ease;
        `;

        // 绾㈣壊闂儊鎸囩ず鍣?
        const indicator = document.createElement('div');
        indicator.id = 'sr-recording-indicator';
        indicator.style.cssText = `
            width: 8px; height: 8px;
            background: #ff4444;
            border-radius: 50%;
            animation: sr-pulse 1s ease-in-out infinite;
            flex-shrink: 0;
        `;

        // 录制状态文�?
        const statusText = document.createElement('span');
        statusText.id = 'sr-status-text';
        statusText.textContent = '录制中';
            statusText.style.cssText = 'font-size: 11px; font-weight: 600;';

        // 璁℃椂鍣?
        const timer = document.createElement('span');
        timer.id = 'sr-timer';
        timer.textContent = '00:00';
        timer.style.cssText = `
            font-size: 11px;
            font-weight: 600;
            font-family: 'SF Mono', monospace;
            color: #ff8888;
            min-width: 40px;
            text-align: center;
        `;

        // 开始计�?
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const sec = (elapsed % 60).toString().padStart(2, '0');
            timer.textContent = `${min}:${sec}`;
            if (recordingMaxMinutes > 0 && elapsed >= recordingMaxMinutes * 60) {
                showRecordingToast(`已达到 ${recordingMaxMinutes} 分钟上限，自动停止`);
                stopRecording();
            }
        }, 500);

        // 按钮样式生成�?
        const btnStyle = (bg) => `
            border: none;
            border-radius: 999px;
            color: white;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            padding: 4px 8px;
            background: ${bg};
            transition: opacity 0.2s;
            font-family: inherit;
        `;

        // 鏆傚仠/鎭㈠鎸夐挳
        const btnPause = document.createElement('button');
        btnPause.textContent = '暂停';
        btnPause.style.cssText = btnStyle('rgba(255,255,255,0.15)');
        btnPause.onmouseenter = () => { btnPause.style.opacity = '0.8'; };
        btnPause.onmouseleave = () => { btnPause.style.opacity = '1'; };
        btnPause.onclick = () => {
            if (!mediaRecorder) return;
            if (isPaused) {
                mediaRecorder.resume();
                isPaused = false;
                isRecording = true;
                btnPause.textContent = '暂停';
                statusText.textContent = '录制中';
                indicator.style.animation = 'sr-pulse 1s ease-in-out infinite';
                indicator.style.opacity = '1';
            } else {
                mediaRecorder.pause();
                isPaused = true;
                isRecording = false;
                btnPause.textContent = '继续';
                statusText.textContent = '已暂停';
                indicator.style.animation = 'none';
                indicator.style.opacity = '0.4';
            }
        };

        // 鍋滄鎸夐挳
        const btnStop = document.createElement('button');
        btnStop.textContent = '停止';
        btnStop.style.cssText = btnStyle('linear-gradient(135deg, #ff4444, #cc0000)');
        btnStop.onmouseenter = () => { btnStop.style.opacity = '0.85'; };
        btnStop.onmouseleave = () => { btnStop.style.opacity = '1'; };
        btnStop.onclick = () => {
            stopRecording();
        };

        // 缁勮闈㈡澘
        controlPanel.appendChild(indicator);
        controlPanel.appendChild(statusText);
        controlPanel.appendChild(timer);
        controlPanel.appendChild(btnPause);
        controlPanel.appendChild(btnStop);
        document.body.appendChild(controlPanel);
    }

    function showRecordingBorder() {
        if (!recordingShowBorder || !regionRect) return;
        if (recordingBorder) recordingBorder.remove();

        recordingBorder = document.createElement('div');
        recordingBorder.id = 'screen-recorder-active-border';
        recordingBorder.style.cssText = `
            position: fixed;
            left: ${regionRect.x}px;
            top: ${regionRect.y}px;
            width: ${regionRect.w}px;
            height: ${regionRect.h}px;
            border: 0;
            outline: 2px solid rgba(255, 68, 68, 0.95);
            outline-offset: 0;
            box-shadow: 0 0 12px rgba(255,68,68,0.35);
            pointer-events: none;
            z-index: 2147483644;
        `;
        document.body.appendChild(recordingBorder);
    }

    function removeRecordingBorder() {
        if (recordingBorder) {
            recordingBorder.remove();
            recordingBorder = null;
        }
    }

    // ===== 停止录制 =====

    function stopRecording() {
        console.log('[屏幕录制] 停止录制...');

        isRecording = false;
        isPaused = false;

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        if (controlPanel) {
            controlPanel.remove();
            controlPanel = null;
        }
        removeRecordingBorder();
        document.body.classList.remove('webcraft-recording-clean-ui');
        removeRecordingHotkeys();

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop(); // 触发 onstop �?exportRecording
        }

        cleanupSelector();
    }

    // ===== 导出录制 =====

    function exportRecording() {
        console.log('[屏幕录制] 导出视频...', recordedChunks.length, '个数据块');

        if (recordedChunks.length === 0) {
            showRecordingToast('录制数据为空，无法导出', 'error');
            return;
        }

        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const blobUrl = URL.createObjectURL(blob);

        // 生成文件�?- 与截图命名规则一�? 截图凭证-{工具}-{名称}-ZB{日期}.webm
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `ZB${yyyy}${mm}${dd}`;
        const safeTool = sanitizeFilenamePart(recordingTool, 'Midjourney生成');
        const safeName = sanitizeFilenamePart(recordingName);
        const filename = `截图凭证-${safeTool}-${safeName}-${dateStr}.webm`;

        console.log(`[屏幕录制] 文件: ${filename}, 大小: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

        // 通过 background.js 下载（saveAs: true 让用户选择保存位置�?
        chrome.runtime.sendMessage({
            action: 'downloadRecording',
            payload: { url: blobUrl, filename }
        }, (resp) => {
            if (resp && resp.success) {
                showRecordingToast(`✅ 视频已保存 (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
            } else {
                // 降级方案：直接用 a 标签下载
                console.warn('[屏幕录制] 通过 background 下载失败，尝试直接下载');
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                a.remove();
                showRecordingToast(`✅ 视频已保存 (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
            }
            // 延迟释放 blobUrl，确保下载完�?
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        });

        recordedChunks = [];
    }

    // ===== 娓呯悊鎵€鏈夎祫婧?=====

    function cleanupRecording() {
        isRecording = false;
        isPaused = false;
        if (cropAnimFrameId) cancelAnimationFrame(cropAnimFrameId);
        if (timerInterval) clearInterval(timerInterval);
        if (controlPanel) { controlPanel.remove(); controlPanel = null; }
        removeRecordingBorder();
        document.body.classList.remove('webcraft-recording-clean-ui');
        removeRecordingHotkeys();
        if (tabStream) { tabStream.getTracks().forEach(t => t.stop()); tabStream = null; }
        mediaRecorder = null;
        recordedChunks = [];
        recordingSizeBytes = 0;
        cleanupSelector();
    }

    // ===== 鎻愮ず Toast =====

    function showRecordingToast(msg, type = 'info') {
        const div = document.createElement('div');
        div.className = 'screen-recorder-toast';
        div.textContent = msg;
        div.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? 'rgba(255, 50, 50, 0.92)' : 'rgba(30, 30, 30, 0.92)'};
            color: white;
            padding: 10px 24px;
            border-radius: 10px;
            z-index: 2147483647;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-weight: 500;
            font-size: 14px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            backdrop-filter: blur(8px);
        `;
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.transition = 'opacity 0.5s';
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
        }, 3000);
    }

    // ===== 暴露入口函数给消息监听器（通过 window 对象�?=====
    window.showRecordingRegionSelector = showRecordingRegionSelector;
    window.handleInitRegionRecording = handleInitRegionRecording;
    window.showRecordingToast = showRecordingToast;

    console.log('[屏幕录制] 模块加载中...');
})();
