'use strict';
// Playwright smoke test for en/korean-csv-fix/index.html (English page reusing csv-fix/tool.js), opened via file://
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const PAGE_FILE = path.join(__dirname, '..', 'en', 'korean-csv-fix', 'index.html');
const PAGE_URL = pathToFileURL(PAGE_FILE).href;

// "이름,나이\r\n홍길동,30\r\n" encoded as CP949 (EUC-KR), same fixture as csv-fix.smoke.js.
const TEXT = '이름,나이\r\n홍길동,30\r\n';
const CP949 = Buffer.from('c0ccb8a72cb3aac0cc0d0ac8abb1e6b5bf2c33300d0a', 'hex');

const cellsOf = (page) => page.$$eval('#preview tr', (trs) => trs.map((tr) => [...tr.children].slice(1).map((c) => c.textContent)));

(async () => {
  assert.strictEqual(new TextDecoder('euc-kr', { fatal: true }).decode(CP949), TEXT, 'CP949 fixture bytes are wrong');

  // Static checks on the source: shared logic is loaded, not copied; no external URLs except the issue link.
  const src = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.ok(src.includes('<script src="../../csv-fix/tool.js"></script>'), 'must load the shared tool.js');
  assert.ok(!/function scanCp949|function detectEncoding/.test(src), 'logic must not be copied into the page');
  const urls = (src.match(/(?:src|href)="[^"]*"/g) || []).filter((u) => /https?:|\/\//.test(u));
  assert.deepStrictEqual(urls, ['href="https://github.com/ghwnd8938-netizen/hangul-tools/issues"'], 'unexpected absolute URLs: ' + urls);

  const browser = await chromium.launch();
  const errors = [];
  const external = [];
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    page.on('request', (r) => { if (!/^(file|blob|data):/.test(r.url())) external.push(r.url()); });
  };
  const widths = [];
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, acceptDownloads: true, colorScheme: 'light' });
    const page = await context.newPage();
    watch(page, 'light');

    await page.goto(PAGE_URL);
    assert.strictEqual(await page.title(), 'Fix Garbled Korean Characters in CSV Files (Hangul encoding fixer)');
    assert.strictEqual(await page.getAttribute('html', 'lang'), 'en');
    assert.strictEqual(await page.getAttribute('header.site a.home', 'href'), '../');
    assert.strictEqual((await page.textContent('header.site a.home')).trim(), '← All tools');
    const footer = await page.$$eval('footer.site p', (ps) => ps.map((p) => p.innerHTML.trim()));
    assert.deepStrictEqual(footer, [
      'Built and tested by AI (Claude). Found a wrong result? <a href="https://github.com/ghwnd8938-netizen/hangul-tools/issues">Report it</a>.',
      '<span id="support"></span>'
    ]);
    assert.ok(await page.evaluate(() => typeof window.CsvFix === 'object'), 'window.CsvFix missing (shared tool.js not loaded)');
    assert.strictEqual(await page.isDisabled('#dl-bom'), true, 'download should be disabled before a file is chosen');
    widths.push(await page.evaluate(() => document.documentElement.scrollWidth));

    // The garbled examples on the page must be what the decoders really produce.
    const ex = await page.evaluate(() => {
      const strip = (s) => s.replace(/[\u0080-\u009f]/g, ''); // C1 controls are invisible
      const enc = (s) => new TextEncoder().encode(s);
      const cp949 = { '이름': [0xc0, 0xcc, 0xb8, 0xa7], '홍길동': [0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf] };
      const w1252 = new TextDecoder('windows-1252');
      return {
        shown: [...document.querySelectorAll('.examples tbody code')].map((c) => c.textContent),
        expect: [
          w1252.decode(new Uint8Array(cp949['이름'])),
          w1252.decode(new Uint8Array(cp949['홍길동'])),
          strip(w1252.decode(enc('이름'))),
          strip(w1252.decode(enc('홍길동'))),
          new TextDecoder('utf-8').decode(new Uint8Array(cp949['이름'])),
          new TextDecoder('euc-kr').decode(enc('이름')).replace(/^�/, '?')
        ],
        cp949ok: new TextDecoder('euc-kr').decode(new Uint8Array(cp949['홍길동'])) === '홍길동'
      };
    });
    assert.ok(ex.cp949ok);
    assert.deepStrictEqual(ex.shown, ex.expect, 'garbled examples on the page do not match real decoding');

    // 1) CP949 file via the file input
    await page.setInputFiles('#file', { name: 'test.csv', mimeType: 'text/csv', buffer: CP949 });
    await page.waitForSelector('#result:not([hidden])');
    assert.strictEqual(await page.textContent('#out-enc'), 'CP949 (EUC-KR)');
    assert.strictEqual(await page.textContent('#out-eol'), 'CRLF (Windows)');
    assert.strictEqual(await page.textContent('#out-size'), CP949.length + ' B');
    const st1 = await page.textContent('#status');
    assert.ok(st1.includes('CP949 (EUC-KR) file, the legacy Korean encoding'), 'English CP949 message missing: ' + st1);
    assert.ok(!/[가-힣]/.test(st1), 'status text should be English: ' + st1);
    assert.deepStrictEqual(await cellsOf(page), [['이름', '나이'], ['홍길동', '30']], 'preview table mismatch');
    assert.strictEqual(await page.isDisabled('#dl-bom'), false);
    widths.push(await page.evaluate(() => document.documentElement.scrollWidth));

    // 2) Download with BOM
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-bom')]);
    assert.strictEqual(dl.suggestedFilename(), 'test_fixed.csv');
    let bytes = fs.readFileSync(await dl.path());
    assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'download must start with UTF-8 BOM');
    assert.strictEqual(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3)), TEXT, 'downloaded text differs');

    // 3) Download without BOM
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-nobom')]);
    assert.strictEqual(dl.suggestedFilename(), 'test_utf8.csv');
    bytes = fs.readFileSync(await dl.path());
    assert.deepStrictEqual(bytes, Buffer.from(TEXT, 'utf8'));

    // 4) Manual override: English labels and messages; back to auto restores
    await page.selectOption('#enc', 'utf-8');
    assert.strictEqual(await page.textContent('#out-enc'), 'UTF-8 (no BOM) · manual');
    let st = await page.textContent('#status');
    assert.ok(st.includes('Auto-detection found CP949 (EUC-KR).'), st);
    assert.ok(/\d+ spots? cannot be read with this encoding/.test(st) && st.includes('�'), 'expected replacement-char warning: ' + st);
    await page.selectOption('#enc', 'auto');
    assert.strictEqual(await page.textContent('#out-enc'), 'CP949 (EUC-KR)');
    assert.ok((await page.textContent('#preview')).includes('홍길동'));

    // 5) UTF-8 without BOM via drag & drop (quotes, embedded newline, emoji, LF)
    const loadInPage = async (name, bytesArr) => {
      await page.evaluate(({ name, bytesArr }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytesArr)], name, { type: 'text/csv' }));
        document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, { name, bytesArr });
      await page.waitForFunction((n) => document.getElementById('out-name').textContent === n, name);
    };
    const csv = '이름,메모\n홍길동,"서울, 강남 ""본사""\n2층"\n김😀,끝\n';
    await loadInPage('drop.csv', [...Buffer.from(csv, 'utf8')]);
    assert.strictEqual(await page.textContent('#out-enc'), 'UTF-8 (no BOM)');
    assert.strictEqual(await page.textContent('#out-eol'), 'LF (Mac/Linux)');
    assert.ok((await page.textContent('#status')).includes('UTF-8 without a BOM'));
    assert.deepStrictEqual(await cellsOf(page), [['이름', '메모'], ['홍길동', '서울, 강남 "본사"\n2층'], ['김😀', '끝']]);
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-bom')]);
    bytes = fs.readFileSync(await dl.path());
    assert.deepStrictEqual(bytes, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]), 'LF content must be preserved exactly');

    // 6) Already UTF-8 with BOM; ASCII only; literal U+FFFD; UTF-16 LE without BOM
    await loadInPage('bom.csv', [0xef, 0xbb, 0xbf, ...Buffer.from(TEXT, 'utf8')]);
    assert.strictEqual(await page.textContent('#out-enc'), 'UTF-8 with BOM');
    assert.ok((await page.textContent('#status')).includes('already in the format Excel opens directly'));
    await loadInPage('ascii.csv', [...Buffer.from('a,b\n1,2\n', 'ascii')]);
    assert.ok((await page.textContent('#status')).includes('only basic English letters'));
    await loadInPage('broken.csv', [...Buffer.from('이름,메모\n홍길동,��\n', 'utf8')]);
    st = await page.textContent('#status');
    assert.ok(st.includes('already contains 2 broken characters (�)'), st);
    assert.ok(!st.includes('cannot be read'), st);
    const u16text = 'name,이름\r\nhong,홍길동\r\n';
    await loadInPage('u16.csv', [...Buffer.from(u16text, 'utf16le')]);
    assert.strictEqual(await page.textContent('#out-enc'), 'UTF-16 LE');
    assert.deepStrictEqual(await cellsOf(page), [['name', '이름'], ['hong', '홍길동']]);

    // 7) .xlsx dropped by mistake: English error, downloads and select disabled
    await loadInPage('book.xlsx', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21, 0x00, 0x9a, 0xbc, 0xc0, 0xcc]);
    st = await page.textContent('#status');
    assert.ok(st.includes('This looks like an Excel workbook (.xlsx)'), 'xlsx should be rejected, got: ' + st);
    assert.strictEqual(await page.textContent('#out-enc'), 'Not a text file');
    assert.strictEqual(await page.textContent('#preview'), '(no preview)');
    assert.strictEqual(await page.isDisabled('#dl-bom'), true);
    assert.strictEqual(await page.isDisabled('#dl-nobom'), true);
    assert.strictEqual(await page.isDisabled('#enc'), true);

    // 8) Wide CP949 content must not make the page scroll horizontally; controls come back after xlsx
    const wide = Buffer.concat([Buffer.from('8c632cc1640d0a', 'hex'), Buffer.from('x'.repeat(300) + ',' + 'y'.repeat(300) + '\r\n', 'ascii')]);
    await loadInPage('wide.csv', [...wide]);
    assert.strictEqual(await page.isDisabled('#enc'), false);
    assert.ok((await page.textContent('#preview')).includes('똠'), 'UHC syllable not decoded');
    widths.push(await page.evaluate(() => document.documentElement.scrollWidth));

    // 9) Keyboard reachability
    await page.focus('body');
    const focusable = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      focusable.push(await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
    }
    for (const id of ['file', 'enc', 'dl-bom', 'dl-nobom']) {
      assert.ok(focusable.includes(id), id + ' not reachable by keyboard: ' + focusable.join(','));
    }
    await context.close();

    // 10) Dark mode at 360px
    const dark = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'dark' });
    const dpage = await dark.newPage();
    watch(dpage, 'dark');
    await dpage.goto(PAGE_URL);
    widths.push(await dpage.evaluate(() => document.documentElement.scrollWidth));
    await dpage.setInputFiles('#file', { name: 'test.csv', mimeType: 'text/csv', buffer: CP949 });
    await dpage.waitForSelector('#result:not([hidden])');
    const darkInfo = await dpage.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      th: getComputedStyle(document.querySelector('#preview thead th')).backgroundColor,
      sw: document.documentElement.scrollWidth
    }));
    assert.strictEqual(darkInfo.bg, 'rgb(22, 22, 21)', 'dark background not applied: ' + darkInfo.bg);
    assert.strictEqual(darkInfo.fg, 'rgb(236, 236, 230)', 'dark text color not applied: ' + darkInfo.fg);
    assert.ok(darkInfo.scheme.includes('dark'), 'color-scheme should allow dark: ' + darkInfo.scheme);
    assert.strictEqual(darkInfo.th, 'rgb(42, 42, 39)');
    widths.push(darkInfo.sw);
    await dark.close();

    for (const w of widths) assert.ok(w <= 360, 'horizontal overflow at 360px: scrollWidth=' + widths.join('/'));
    assert.deepStrictEqual(external, [], 'external requests made: ' + external.join(', '));
    assert.deepStrictEqual(errors, [], 'console errors: ' + errors.join(' | '));
    console.log('en-korean-csv-fix smoke: OK (title/footer/shared tool.js + garbled examples verified + CP949 detect/preview'
      + ' + BOM/no-BOM download + override + drop + BOM/ASCII/U+FFFD/UTF-16 messages + xlsx rejected + keyboard'
      + ' + light/dark; scrollWidth ' + widths.join('/') + ' <= 360; no network, no console errors)');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('en-korean-csv-fix smoke: FAIL\n', e && e.stack ? e.stack : e);
  process.exit(1);
});
