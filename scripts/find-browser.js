// QA Scout — https://github.com/radyelkasas/qa-scout · by Rady Elkasas (https://radyelkasas.com/) · MIT License
// Prints the Chromium/Chrome executable the driver will use (or explains how to get one).
const fs = require('fs'); const path = require('path'); const os = require('os');
function findBrowser() {
  if (process.env.QA_BROWSER && fs.existsSync(process.env.QA_BROWSER)) return process.env.QA_BROWSER;
  const cache = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright')
    : process.platform === 'win32' ? path.join(os.homedir(), 'AppData/Local/ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright');
  const candidates = [];
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1])) {
      candidates.push(path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      candidates.push(path.join(cache, d, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      candidates.push(path.join(cache, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
      candidates.push(path.join(cache, d, 'chrome-linux/chrome'), path.join(cache, d, 'chrome-win/chrome.exe'));
    }
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium');
  return candidates.find(c => fs.existsSync(c)) || null;
}
module.exports = { findBrowser };
if (require.main === module) {
  const b = findBrowser();
  if (b) console.log('BROWSER ' + b);
  else { console.log('NO_BROWSER — run: npx playwright@1.56.1 install chromium  (or set QA_BROWSER=/path/to/chrome)'); process.exitCode = 2; }
}
