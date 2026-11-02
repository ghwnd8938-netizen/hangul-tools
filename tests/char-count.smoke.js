'use strict';
// Playwright smoke test: node tests/char-count.smoke.js
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'char-count', 'index.html')).href;
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';

const failures = [];
function check(cond, label) {
  if (cond) console.log('  ok   ' + label);
  else { console.log('  FAIL ' + label); failures.push(label); }
}

async function readStats(page) {
  return page.evaluate(() => {
    const n = (id) => Number(document.getElementById(id).textContent.replace(/,/g, ''));
    return {
      withSpaces: n('c-with'), withoutSpaces: n('c-without'), words: n('c-words'),
      lines: n('c-lines'), eucKrBytes: n('c-euckr'), utf8Bytes: n('c-utf8')
    };
  });
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const external = [];
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });

    await page.goto(PAGE);
    check((await page.title()).includes('자소서 글자수'), 'page title');
    check(same(await readStats(page), { withSpaces: 0, withoutSpaces: 0, words: 0, lines: 0, eucKrBytes: 0, utf8Bytes: 0 }),
      'all counters start at 0');
    check(await page.locator('#btn-undo').isHidden(), 'undo button hidden initially');

    // Type Korean text with emoji and newlines (Enter key presses)
    const ta = page.locator('#text');
    await ta.click();
    await page.keyboard.type('안녕하세요 👋');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('반갑습니다 ' + FAMILY);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('abc def');

    // 한글 2바이트: 👋 = 4, 👨‍👩‍👧 = 16 (UTF-16 code units x 2)
    const expected1 = { withSpaces: 24, withoutSpaces: 18, words: 6, lines: 4, eucKrBytes: 52, utf8Bytes: 64 };
    const s1 = await readStats(page);
    check(same(s1, expected1), 'live counts after typing: ' + JSON.stringify(s1));

    // Newline counted as 2 characters
    await page.selectOption('#newline', '2');
    const s2 = await readStats(page);
    check(same(s2, { withSpaces: 27, withoutSpaces: 18, words: 6, lines: 4, eucKrBytes: 55, utf8Bytes: 67 }),
      'newline = 2: ' + JSON.stringify(s2));
    await page.selectOption('#newline', '0');
    check((await readStats(page)).withSpaces === 21, 'newline = 0 gives 21');
    await page.selectOption('#newline', '1');

    // Limit: over / warn / ok, with text and colour class
    check(await page.locator('#limit-box').isHidden(), 'limit box hidden without a limit');
    await page.fill('#limit', '20');
    let lt = page.locator('#limit-text');
    let txt = await lt.textContent();
    check(txt.includes('초과') && txt.includes('4자') && txt.includes('120%'), 'over limit text: ' + txt);
    check((await lt.getAttribute('class')).includes('err'), 'over limit uses .err');
    check((await page.textContent('#limit-alert')) === '제한을 초과했습니다.', 'screen-reader alert on over');
    await page.fill('#limit', '25');
    txt = await lt.textContent();
    check(txt.includes('주의') && txt.includes('남은 1자') && txt.includes('96%'), 'warn text: ' + txt);
    check((await lt.getAttribute('class')).includes('warn'), 'warn uses .warn');
    check((await page.textContent('#limit-alert')).includes('90%'), 'screen-reader alert on warn');
    // limit typed the way people write it (comma) must work, junk must be reported, not ignored
    await page.fill('#limit', '');
    await page.locator('#limit').pressSequentially('1,000');
    txt = await lt.textContent();
    check(txt.includes('여유') && txt.includes('976자') && txt.includes('/ 1,000자'), 'limit "1,000" parsed: ' + txt);
    await page.fill('#limit', '오백');
    txt = await lt.textContent();
    check(await page.locator('#limit-box').isVisible() && txt.includes('알아볼 수 없습니다'), 'unparseable limit is reported: ' + txt);
    check((await page.getAttribute('#limit', 'aria-invalid')) === 'true', 'unparseable limit sets aria-invalid');
    check(await page.locator('#limit-bar').isHidden(), 'no progress bar for unparseable limit');
    const swBad = await page.evaluate(() => document.documentElement.scrollWidth);
    check(swBad <= 360, 'no horizontal scroll with limit hint shown (scrollWidth=' + swBad + ')');
    await page.fill('#limit', '');
    check(await page.locator('#limit-box').isHidden() && (await lt.textContent()) === '', 'empty limit hides box and clears text');
    await page.selectOption('#mode', 'euckr');
    await page.fill('#limit', '1000');
    txt = await lt.textContent();
    check(txt.includes('여유') && txt.includes('948바이트') && txt.includes('5%'), 'byte mode text: ' + txt);
    check((await lt.getAttribute('class')).includes('ok'), 'ok uses .ok');
    check(await page.locator('#limit-bar').isVisible(), 'progress bar visible again');

    // Persistence across reload (localStorage)
    await page.waitForTimeout(400);
    await page.reload();
    const restored = await ta.inputValue();
    check(restored === '안녕하세요 👋\n반갑습니다 ' + FAMILY + '\n\nabc def', 'text restored after reload');
    check(same(await readStats(page), expected1), 'counts restored after reload');
    check((await page.inputValue('#limit')) === '1000' && (await page.inputValue('#mode')) === 'euckr', 'limit settings restored');

    // Tidy: trailing spaces and extra blank lines
    await ta.fill('첫 문단   \n\n\n\n둘째 문단\t\n\n');
    await page.click('#btn-tidy');
    check((await ta.inputValue()) === '첫 문단\n\n둘째 문단', 'tidy result');
    check((await page.textContent('#msg')).includes('정리했습니다'), 'tidy message');
    check(await page.locator('#btn-undo').isVisible(), 'undo button shown');
    await page.click('#btn-undo');
    check((await ta.inputValue()) === '첫 문단   \n\n\n\n둘째 문단\t\n\n', 'undo restores text');
    check(await page.locator('#btn-undo').isHidden(), 'undo button hidden after undo');

    // Tidy with newline counted as 0: must not claim "0자 줄었습니다"
    await page.selectOption('#newline', '0');
    await ta.fill('가\n\n\n\n나');
    await page.click('#btn-tidy');
    let m = await page.textContent('#msg');
    check((await ta.inputValue()) === '가\n\n나' && !m.includes('0자 줄었습니다') && m.includes('그대로'), 'tidy message with newline=0: ' + m);
    await page.click('#btn-undo');
    await page.selectOption('#newline', '1');
    await ta.fill('첫 문단   \n\n\n\n둘째 문단\t\n\n');

    // Copy: the whole text reaches the clipboard API and success is reported
    await page.evaluate(() => {
      window.__copied = null;
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true, value: (t) => { window.__copied = t; return Promise.resolve(); }
      });
    });
    await page.click('#btn-copy');
    await page.waitForFunction(() => document.getElementById('msg').textContent.includes('복사'));
    check((await page.evaluate(() => window.__copied)) === (await ta.inputValue()), 'copy sends the full text to the clipboard');
    check((await page.textContent('#msg')).includes('복사했습니다'), 'copy success message');
    // Clipboard API refused -> execCommand fallback still reports a result
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('denied')) });
      document.getElementById('msg').textContent = '';
    });
    await page.click('#btn-copy');
    await page.waitForFunction(() => document.getElementById('msg').textContent !== '');
    m = await page.textContent('#msg');
    check(m.includes('복사했습니다') || m.includes('직접 선택'), 'copy fallback reports a result: ' + m);

    // Clear, then undo via keyboard
    await page.click('#btn-clear');
    check((await ta.inputValue()) === '', 'clear empties text');
    check((await readStats(page)).withSpaces === 0, 'counts reset after clear');
    await page.focus('#btn-undo');
    await page.keyboard.press('Enter');
    check((await ta.inputValue()).startsWith('첫 문단'), 'undo after clear (keyboard)');

    // Layout at 360px
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= 360, 'no horizontal scroll at 360px (scrollWidth=' + sw + ')');

    // Footer and relative links
    check((await page.locator('footer.site a').getAttribute('href')) === 'https://github.com/ghwnd8938-netizen/hangul-tools/issues', 'footer issue link');
    check((await page.locator('#support').count()) === 1, 'support placeholder present');
    check((await page.locator('header.site a').getAttribute('href')) === '../', 'home link is relative');
    await context.close();

    // Browser without Intl.Segmenter: approximate grouping must give the same numbers here
    const ctx2 = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await ctx2.addInitScript(() => { delete Intl.Segmenter; });
    const p2 = await ctx2.newPage();
    p2.on('console', (m2) => { if (m2.type() === 'error') errors.push('console(fallback): ' + m2.text()); });
    p2.on('pageerror', (e) => errors.push('pageerror(fallback): ' + e.message));
    p2.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });
    await p2.goto(PAGE);
    await p2.fill('#text', '안녕하세요 👋\n반갑습니다 ' + FAMILY + '\n\nabc def');
    const s3 = await readStats(p2);
    check(same(s3, expected1), 'fallback segmenter counts: ' + JSON.stringify(s3));
    check(await p2.locator('#fallback-note').isVisible(), 'fallback note shown without Intl.Segmenter');
    await ctx2.close();

    // Dark mode: stylesheet tokens apply and native controls follow
    const ctx3 = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'dark' });
    const p3 = await ctx3.newPage();
    p3.on('pageerror', (e) => errors.push('pageerror(dark): ' + e.message));
    p3.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });
    await p3.goto(PAGE);
    const dark = await p3.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      ta: getComputedStyle(document.getElementById('text')).color,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      sw: document.documentElement.scrollWidth
    }));
    check(dark.bg === 'rgb(22, 22, 21)' && dark.ta === 'rgb(236, 236, 230)' && dark.scheme.includes('dark') && dark.sw <= 360,
      'dark mode: ' + JSON.stringify(dark));
    await ctx3.close();
  } finally {
    await browser.close();
  }
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  check(external.length === 0, 'no external requests' + (external.length ? ': ' + external.join(', ') : ''));

  if (failures.length) {
    console.log('\nSMOKE FAILED (' + failures.length + ')');
    process.exit(1);
  }
  console.log('\nSMOKE PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
