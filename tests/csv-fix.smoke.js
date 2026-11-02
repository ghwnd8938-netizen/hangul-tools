'use strict';
// Playwright smoke test for csv-fix/index.html (opened via file://)
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'csv-fix', 'index.html')).href;

// "이름,나이\r\n홍길동,30\r\n" encoded as CP949 (EUC-KR), hardcoded and verified below.
const TEXT = '이름,나이\r\n홍길동,30\r\n';
const CP949 = Buffer.from('c0ccb8a72cb3aac0cc0d0ac8abb1e6b5bf2c33300d0a', 'hex');

async function readDownload(dl) {
  const p = await dl.path();
  return fs.readFileSync(p);
}

(async () => {
  // Sanity check of the hardcoded bytes.
  assert.strictEqual(new TextDecoder('euc-kr', { fatal: true }).decode(CP949), TEXT, 'CP949 fixture bytes are wrong');

  const browser = await chromium.launch();
  const errors = [];
  const external = [];
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.route('https://static.cloudflareinsights.com/**', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    page.on('request', (r) => { if (!r.url().startsWith('https://static.cloudflareinsights.com/') && !/^(file|blob|data):/.test(r.url())) external.push(r.url()); });

    await page.goto(PAGE_URL);
    assert.strictEqual(await page.title(), '엑셀 CSV 한글 깨짐 고치기 - 무료 온라인 도구');
    assert.ok(await page.evaluate(() => typeof window.CsvFix === 'object'), 'window.CsvFix missing');
    assert.strictEqual(await page.isDisabled('#dl-bom'), true, 'download should be disabled before a file is chosen');

    // 1) CP949 file via the file input (ASCII file name: headless Chromium under a C locale
    //    replaces non-ASCII download names with "download"; Korean names are unit-tested in fixedFileName)
    await page.setInputFiles('#file', { name: 'test.csv', mimeType: 'text/csv', buffer: CP949 });
    await page.waitForSelector('#result:not([hidden])');
    const encLabel = await page.textContent('#out-enc');
    assert.ok(encLabel.includes('CP949'), 'detected label should mention CP949, got: ' + encLabel);
    assert.strictEqual((await page.textContent('#out-eol')).startsWith('CRLF'), true);
    const cells = await page.$$eval('#preview tr', (trs) => trs.map((tr) => [...tr.children].slice(1).map((c) => c.textContent)));
    assert.deepStrictEqual(cells, [['이름', '나이'], ['홍길동', '30']], 'preview table mismatch');
    assert.strictEqual(await page.isDisabled('#dl-bom'), false);

    // Width check with content rendered
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 360, 'horizontal overflow at 360px: scrollWidth=' + sw);

    // 2) Download with BOM
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-bom')]);
    assert.strictEqual(dl.suggestedFilename(), 'test_fixed.csv');
    let bytes = await readDownload(dl);
    assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'download must start with UTF-8 BOM');
    assert.strictEqual(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3)), TEXT, 'downloaded text differs');

    // 3) Download without BOM
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-nobom')]);
    assert.strictEqual(dl.suggestedFilename(), 'test_utf8.csv');
    bytes = await readDownload(dl);
    assert.notStrictEqual(bytes[0], 0xef, 'no-BOM download must not start with BOM');
    assert.deepStrictEqual(bytes, Buffer.from(TEXT, 'utf8'));

    // 4) Manual override to UTF-8 shows a warning, back to auto restores
    await page.selectOption('#enc', 'utf-8');
    assert.ok((await page.textContent('#out-enc')).includes('UTF-8'));
    assert.ok((await page.textContent('#status')).includes('�'), 'expected a replacement-char warning');
    await page.selectOption('#enc', 'auto');
    assert.ok((await page.textContent('#out-enc')).includes('CP949'));
    assert.ok((await page.textContent('#preview')).includes('홍길동'));

    // 5) CP949 extension syllables (똠, 햏) decode in the browser; wide row must not overflow the page
    const ext = Buffer.concat([
      Buffer.from('8c632cc1640d0a', 'hex'), // 똠,햏\r\n
      Buffer.from('x'.repeat(300) + ',' + 'y'.repeat(300) + '\r\n', 'ascii')
    ]);
    await page.setInputFiles('#file', { name: 'ext.csv', mimeType: 'text/csv', buffer: ext });
    await page.waitForFunction(() => document.getElementById('out-name').textContent === 'ext.csv');
    assert.ok((await page.textContent('#out-enc')).includes('CP949'));
    assert.ok((await page.textContent('#preview')).includes('똠'), 'UHC syllable 똠 not decoded');
    assert.ok((await page.textContent('#preview')).includes('햏'), 'UHC syllable 햏 not decoded');
    const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw2 <= 360, 'horizontal overflow with wide CSV: scrollWidth=' + sw2);

    // 6) UTF-8 (no BOM) file via drag & drop, with quotes / embedded newline / emoji, LF endings
    const csv = '이름,메모\n홍길동,"서울, 강남 ""본사""\n2층"\n김😀,끝\n';
    await page.evaluate((content) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], 'drop.csv', { type: 'text/csv' }));
      document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, csv);
    await page.waitForFunction(() => document.getElementById('out-name').textContent === 'drop.csv');
    assert.strictEqual(await page.textContent('#out-enc'), 'UTF-8 (BOM 없음)');
    assert.ok((await page.textContent('#out-eol')).startsWith('LF'));
    const cells2 = await page.$$eval('#preview tr', (trs) => trs.map((tr) => [...tr.children].slice(1).map((c) => c.textContent)));
    assert.deepStrictEqual(cells2, [['이름', '메모'], ['홍길동', '서울, 강남 "본사"\n2층'], ['김😀', '끝']]);
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-bom')]);
    bytes = await readDownload(dl);
    assert.deepStrictEqual(bytes, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]), 'LF content must be preserved exactly');

    // ---- QA regression checks -------------------------------------------------------------
    const statusText = () => page.textContent('#status');
    const loadInPage = async (name, bytesArr) => {
      await page.evaluate(({ name, bytesArr }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytesArr)], name, { type: 'text/csv' }));
        document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, { name, bytesArr });
      await page.waitForFunction((n) => document.getElementById('out-name').textContent === n, name);
    };

    // Q1) The CP949 validator matches the browser's own decoder for every 2-byte combination.
    const mismatches = await page.evaluate(() => {
      const td = new TextDecoder('euc-kr');
      const bad = [];
      for (let c = 0x80; c <= 0xff; c++) {
        for (let t = 0; t <= 0xff; t++) {
          const s = td.decode(new Uint8Array([c, t]));
          const browserOk = s.indexOf('�') < 0;
          const ours = window.CsvFix._scanCp949(new Uint8Array([c, t])).errors === 0;
          if (browserOk !== ours) bad.push(c.toString(16) + t.toString(16));
        }
      }
      return bad;
    });
    assert.deepStrictEqual(mismatches, [], 'CP949 validator disagrees with Chromium: ' + mismatches.slice(0, 20).join(','));

    // Q2) A manual override shows what auto-detection found.
    await page.setInputFiles('#file', { name: 'test.csv', mimeType: 'text/csv', buffer: CP949 });
    await page.waitForFunction(() => document.getElementById('out-name').textContent === 'test.csv');
    await page.selectOption('#enc', 'utf-8');
    assert.ok((await statusText()).includes('자동 감지 결과는 CP949'), 'override should name the detected encoding');
    await page.selectOption('#enc', 'auto');

    // Q3) .xlsx dropped by mistake: clear error, no download of garbage, select disabled.
    await loadInPage('book.xlsx', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21, 0x00, 0x9a, 0xbc, 0xc0, 0xcc]);
    assert.ok((await statusText()).includes('엑셀 통합 문서(.xlsx)'), 'xlsx should be rejected, got: ' + (await statusText()));
    assert.strictEqual(await page.isDisabled('#dl-bom'), true, 'download must be disabled for xlsx');
    assert.strictEqual(await page.isDisabled('#dl-nobom'), true);
    assert.strictEqual(await page.isDisabled('#enc'), true);
    assert.strictEqual(await page.textContent('#out-enc'), '텍스트 아님');

    // Q4) UTF-16 LE without BOM (was reported as "ASCII only" / CP949 garbage); controls re-enabled.
    const u16text = 'name,이름\r\nhong,홍길동\r\n';
    await loadInPage('u16.csv', [...Buffer.from(u16text, 'utf16le')]);
    assert.strictEqual(await page.textContent('#out-enc'), 'UTF-16 LE');
    assert.strictEqual(await page.isDisabled('#enc'), false);
    const cellsU16 = await page.$$eval('#preview tr', (trs) => trs.map((tr) => [...tr.children].slice(1).map((c) => c.textContent)));
    assert.deepStrictEqual(cellsU16, [['name', '이름'], ['hong', '홍길동']]);
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-bom')]);
    bytes = await readDownload(dl);
    assert.deepStrictEqual(bytes, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(u16text, 'utf8')]), 'UTF-16 -> UTF-8 BOM conversion wrong');

    // Q5) A UTF-8 file that already contains U+FFFD: say so, do not blame the encoding.
    await loadInPage('broken.csv', [...Buffer.from('이름,메모\n홍길동,��\n', 'utf8')]);
    let st = await statusText();
    assert.ok(st.includes('이미 깨진 글자(�)가 2개'), 'literal U+FFFD message missing: ' + st);
    assert.ok(!st.includes('읽을 수 없는'), 'literal U+FFFD wrongly reported as a decode error: ' + st);

    // Q6) UTF-8 BOM + non-UTF-8 content must not be called "already fine".
    await loadInPage('bomcp.csv', [0xef, 0xbb, 0xbf, ...CP949]);
    st = await statusText();
    assert.ok(!st.includes('이미 엑셀에서 바로 열리는'), 'BOM+garbage reported as fine: ' + st);
    assert.ok(st.includes('UTF-8 규칙에 맞지 않습니다'), st);

    // Q7) An emoji at the 80-char preview cut must not turn into a fake '�'.
    await loadInPage('emoji.csv', [...Buffer.from('메모\n' + 'a'.repeat(79) + '😀' + 'b'.repeat(20) + '\n', 'utf8')]);
    const cut = await page.$$eval('#preview tbody td:not(.num)', (tds) => tds.map((td) => td.textContent));
    assert.strictEqual(cut[0], 'a'.repeat(79) + '…');
    assert.ok(!(await statusText()).includes('�'), 'no replacement warning expected for a clean UTF-8 file');

    // Q8) Large file with an unterminated quote must not freeze the page (old parser: ~8 s for 54 MB).
    const t0 = Date.now();
    await page.evaluate(() => {
      const big = '"abc,def\n' + '홍길동,30,서울시 강남구\r\n'.repeat(1600000); // ~54 MB as UTF-8
      const dt = new DataTransfer();
      dt.items.add(new File([big], 'big.csv', { type: 'text/csv' }));
      document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.getElementById('out-name').textContent === 'big.csv', null, { timeout: 15000 });
    const bigMs = Date.now() - t0;
    assert.ok(bigMs < 4000, 'big file took ' + bigMs + ' ms');
    assert.strictEqual(await page.$$eval('#preview tbody tr', (trs) => trs.length), 0); // one header row only
    const swBig = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(swBig <= 360, 'overflow with big file: ' + swBig);

    // reload a normal file for the keyboard check below
    await loadInPage('drop2.csv', [...Buffer.from(csv, 'utf8')]);

    // 7) Keyboard: the file input and buttons are reachable with Tab
    await page.focus('body');
    const focusable = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      focusable.push(await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
    }
    for (const id of ['file', 'enc', 'dl-bom', 'dl-nobom']) {
      assert.ok(focusable.includes(id), id + ' not reachable by keyboard: ' + focusable.join(','));
    }

    const sw3 = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw3 <= 360, 'horizontal overflow at end: scrollWidth=' + sw3);

    // Q9) Dark mode: page follows prefers-color-scheme (stylesheet tokens + native controls).
    const dark = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'dark' });
    const dpage = await dark.newPage();
    dpage.on('console', (m) => { if (m.type() === 'error') errors.push('dark console: ' + m.text()); });
    dpage.on('pageerror', (e) => errors.push('dark pageerror: ' + e.message));
    await dpage.route('https://static.cloudflareinsights.com/**', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    dpage.on('request', (r) => { if (!r.url().startsWith('https://static.cloudflareinsights.com/') && !/^(file|blob|data):/.test(r.url())) external.push(r.url()); });
    await dpage.goto(PAGE_URL);
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
    assert.ok(darkInfo.scheme.includes('dark'), 'color-scheme should allow dark native controls: ' + darkInfo.scheme);
    assert.strictEqual(darkInfo.th, 'rgb(42, 42, 39)');
    assert.ok(darkInfo.sw <= 360, 'dark mode overflow: ' + darkInfo.sw);
    await dark.close();

    assert.deepStrictEqual(external, [], 'external requests made: ' + external.join(', '));
    assert.deepStrictEqual(errors, [], 'console errors: ' + errors.join(' | '));
    console.log('csv-fix smoke: OK (CP949 detect + preview + BOM/no-BOM download + override + UHC + drop + keyboard'
      + ' + CP949 table vs Chromium + xlsx rejected + UTF-16 no-BOM + literal U+FFFD + BOM/garbage + emoji cut'
      + ' + big file ' + bigMs + 'ms + dark mode; scrollWidth ' + [sw, sw2, swBig, sw3, darkInfo.sw].join('/') + ' <= 360)');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('csv-fix smoke: FAIL\n', e && e.stack ? e.stack : e);
  process.exit(1);
});
