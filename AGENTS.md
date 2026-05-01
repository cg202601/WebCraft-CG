# WebCraft Maintenance Rules

This repository is a Chrome MV3 extension. Before changing it, follow these rules. They exist because previous fixes broke encoding, popup UI, translation panels, and screen recording.

## Core Rule

Treat the extension as a set of connected runtime flows, not as isolated files.

- Popup actions usually call `content.js` or `background.js`.
- `content.js` contains several independent IIFEs. Functions inside an IIFE are not visible to earlier message listeners unless they are explicitly exposed on `window`.
- Background APIs such as `chrome.tabCapture`, `chrome.downloads`, and `chrome.debugger` must return useful errors to the caller.
- UI strings must remain readable after reload in Chrome and Arc.

## Encoding Rules

- Do not use PowerShell `Set-Content`, `Out-File`, or ad-hoc shell rewriting for files containing Chinese text.
- Prefer `apply_patch` for targeted edits.
- If a mechanical rewrite is unavoidable, use Node.js with `fs.readFileSync(file, 'utf8')` and `fs.writeFileSync(file, text, 'utf8')`.
- After any edit touching Chinese text, scan for mojibake and replacement characters:

```powershell
@'
const fs = require('fs');
const files = ['content.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'manifest.json'];
const bad = /\uFFFD|\u951f|\u7f08|\u5a34|\u934b|\u93c6|\u9241|\u9242|\u8133|\u9983/;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (bad.test(line)) console.log(`${file}:${index + 1}: ${line}`);
  });
}
'@ | node -
```

- PowerShell console output may display UTF-8 Chinese incorrectly. When unsure, inspect with Node:

```powershell
node -e "const fs=require('fs'); console.log(fs.readFileSync('content.js','utf8').slice(0,500))"
```

## Runtime Flow Checks

After touching a flow, test the whole flow:

- Screenshot: `popup.js` -> `background.js captureVisible` -> `content.js processImage`.
- Long screenshot: `popup.js` -> `content.js startFullCapture` -> `background.js captureFullPage` -> `content.js processFullPageImage`.
- Region recording: `popup.js startRegionSelector` -> `content.js window.showRecordingRegionSelector` -> `background.js startScreenRecording` -> `chrome.tabCapture.getMediaStreamId` -> `content.js window.handleInitRegionRecording`.
- YouTube recording: YouTube side button -> video `captureStream()` -> `downloadRecording`.
- Translation: right-side handle -> floating panel -> `translateText`; selected text -> translation popup.
- Collector canvas: action bar -> canvas storage -> filters/export.

## Content Script Scope Rules

- Do not call IIFE-local functions from global message listeners by bare name.
- If a message listener needs a function defined later inside an IIFE, expose and call it through `window`, for example:

```js
window.showRecordingRegionSelector = showRecordingRegionSelector;
window.handleInitRegionRecording = handleInitRegionRecording;
```

and then:

```js
if (typeof window.showRecordingRegionSelector === 'function') {
  window.showRecordingRegionSelector(name, tool);
}
```

- Watch for corrupted comments swallowing declarations. This is valid JavaScript but breaks runtime:

```js
let mediaRecorder = null; // bad comment    let recordedChunks = [];
```

Each declaration must be on its own line.

## Required Checks Before Commit

Run these after every meaningful change:

```powershell
node --check content.js
node --check background.js
node --check popup.js
node --check options.js
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

Check HTML structure:

```powershell
@'
const fs=require('fs');
for (const f of ['popup.html','options.html']) {
  const s=fs.readFileSync(f,'utf8');
  const ids=[...s.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const dup=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
  console.log(f, 'buttons', (s.match(/<button\b/g)||[]).length, (s.match(/<\/button>/g)||[]).length, 'duplicateIds', dup.join(',') || 'none');
}
'@ | node -
```

Then manually verify at least these four flows in the browser:

- Screenshot
- Region recording
- YouTube recording
- Translation

## Release Rules

- Any packaged change must bump `manifest.json`.
- Add an entry to the changelog in `options.html`.
- Use organization trusted release flow:
  - push `main` to `origin`
  - push `main` to `org`
  - tag version as `vX.Y.Z`
  - push tag to `org`
  - confirm GitHub Actions success
- Do not submit local zip files as official review artifacts. Use the GitHub Actions release asset.

## Debugging Rules

- When the browser reports an error line, inspect the exact line and nearby code with Node or `Get-Content`, not by guessing.
- If `node --check` passes but runtime fails, suspect:
  - function scope across IIFEs
  - corrupted comments swallowing declarations
  - async message channel not returning `true`
  - missing `sendResponse`
  - extension context invalidated after reload
  - browser-specific shortcut scope issues

## Do Not Do

- Do not mass-rewrite `content.js` unless absolutely necessary.
- Do not “fix” encoding by round-tripping through GBK/ANSI unless there is a verified backup and a small test sample proves the conversion.
- Do not mix large feature work with emergency stabilization.
- Do not rely only on syntax checks for this extension. Runtime browser checks are mandatory.
