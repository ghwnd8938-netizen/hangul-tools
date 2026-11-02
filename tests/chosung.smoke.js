'use strict';
// Playwright smoke test: node tests/chosung.smoke.js
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const C = require('../chosung/tool.js');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'chosung', 'index.html')).href;

const failures = [];
function check(cond, label) {
  if (cond) console.log('  ok   ' + label);
  else { console.log('  FAIL ' + label); failures.push(label); }
}

async function clipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

// 복사 버튼을 누르고 성공 메시지와 실제 클립보드 내용을 확인
async function checkCopy(page, button, msgId, expected, label) {
  await page.evaluate((id) => { document.getElementById(id).textContent = ''; return navigator.clipboard.writeText('(비움)'); }, msgId);
  await page.click(button);
  await page.waitForFunction((id) => /했습니다|못했습니다|없습니다|입력하세요/.test(document.getElementById(id).textContent), msgId);
  const msg = await page.textContent('#' + msgId);
  const clip = await clipboard(page);
  check(/했습니다/.test(msg) && !/못했습니다/.test(msg) && clip === expected,
    label + ' (msg=' + JSON.stringify(msg) + ', clipboard=' + JSON.stringify(clip.slice(0, 60)) + ')');
}

async function resultItems(page) {
  return page.$$eval('#results li', (lis) => lis
    .filter((li) => getComputedStyle(li).display !== 'none')
    .map((li) => ({ cls: li.className, text: li.textContent, marks: [...li.querySelectorAll('mark')].map((m) => m.textContent) })));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const external = [];
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });

    await page.goto(PAGE);
    check((await page.title()).includes('초성 추출'), 'page title');
    check((await page.getAttribute('html', 'lang')) === 'ko', 'html lang=ko');

    // ---- 1. 초성 추출 ----
    const src = page.locator('#src');
    await src.click();
    await page.keyboard.type('홍길동 Hello 😀');
    await page.keyboard.press('Enter');
    await page.keyboard.type('대한민국 만세!');
    let out = await page.inputValue('#out');
    check(out === 'ㅎㄱㄷ Hello 😀\nㄷㅎㅁㄱ ㅁㅅ!', 'live chosung result: ' + JSON.stringify(out));

    // 체크박스를 키보드(Space)로 켜기
    await page.focus('#drop');
    await page.keyboard.press('Space');
    check(await page.isChecked('#drop'), 'drop checkbox toggled by keyboard');
    out = await page.inputValue('#out');
    check(out === 'ㅎㄱㄷ\nㄷㅎㅁㄱㅁㅅ', 'drop non-Hangul keeps line break: ' + JSON.stringify(out));
    await page.click('label[for=drop]');
    check(!(await page.isChecked('#drop')), 'drop checkbox toggled by clicking its label');
    check((await page.inputValue('#out')).startsWith('ㅎㄱㄷ Hello'), 'non-Hangul back after unchecking');

    // 맥에서 복사한 것 같은 NFD 글
    await src.fill('한글 파일'.normalize('NFD'));
    check((await page.inputValue('#out')) === 'ㅎㄱ ㅍㅇ', 'NFD text converted');

    await checkCopy(page, '#copy-out', 'msg1', 'ㅎㄱ ㅍㅇ', 'copy result puts the chosung text on the clipboard');

    // 수식 표시
    check((await page.textContent('#f-excel')) === C.EXCEL_FORMULA, 'Excel formula shown (same as tested)');
    check((await page.textContent('#f-sheets')) === C.SHEETS_FORMULA, 'Sheets formula shown (same as tested)');
    await checkCopy(page, '#copy-excel', 'msg-f', C.EXCEL_FORMULA, 'copy Excel formula');
    await checkCopy(page, '#copy-sheets', 'msg-f', C.SHEETS_FORMULA, 'copy Sheets formula');
    check((await page.locator('pre[aria-labelledby]').count()) === 0, 'no aria-labelledby on generic <pre> elements');

    // ---- 2. 초성 검색 정규식 (기본값 ㅎㄱㄷ + 예시 목록) ----
    check((await page.textContent('#re-src')) === '/[ㅎ하-힣][ㄱ가-깋][ㄷ다-딯]/', 'default regex shown');
    let count = await page.textContent('#count');
    check(count.includes('7줄 중 5줄 일치'), 'default count: ' + count);
    let items = await resultItems(page);
    const hits = items.filter((i) => i.cls === 'hit');
    check(hits.length === 5 && items.length === 7, 'hit/miss rows rendered (' + hits.length + '/' + items.length + ')');
    check(JSON.stringify(hits.map((h) => h.marks.join('|'))) === JSON.stringify(['홍길동', '한글도', '홍길동', 'ㅎㄱㄷ', '홍길동']),
      'highlighted parts: ' + JSON.stringify(hits.map((h) => h.marks)));
    check(items.find((i) => i.text.includes('홍경래')).cls === 'miss', '홍경래 is not a match');

    // 혼합 검색어
    await page.fill('#q', '홍ㄱ');
    check((await page.textContent('#re-src')) === '/홍[ㄱ가-깋]/', 'mixed query regex');
    count = await page.textContent('#count');
    check(count.includes('7줄 중 4줄 일치'), 'mixed query count: ' + count);

    // 처음부터 일치
    await page.fill('#q', 'ㅎㄱㄷ');
    await page.check('#prefix');
    check((await page.textContent('#re-src')) === '/^[ㅎ하-힣][ㄱ가-깋][ㄷ다-딯]/', 'prefix regex');
    check((await page.textContent('#count')).includes('7줄 중 3줄 일치'), 'prefix count');
    await page.uncheck('#prefix');

    // 일치하는 줄만 보기
    await page.check('#only');
    items = await resultItems(page);
    check(items.length === 5 && items.every((i) => i.cls === 'hit'), 'filter shows only matching rows');

    // 특수 문자 이스케이프 + 직접 넣은 목록 (CRLF)
    await page.fill('#q', '(주)ㅎ');
    check((await page.textContent('#re-src')) === '/\\(주\\)[ㅎ하-힣]/', 'metacharacters escaped: ' + (await page.textContent('#re-src')));
    await page.fill('#words', '(주)한국\r\n주식회사 한국\r\n(주)Korea\r\n');
    check((await page.textContent('#count')).includes('3줄 중 1줄 일치'), 'custom list count: ' + (await page.textContent('#count')));
    items = await resultItems(page);
    check(items.length === 1 && items[0].text.includes('(주)한국') && items[0].marks[0] === '(주)한', 'custom list match');

    await checkCopy(page, '#copy-matches', 'msg3', '(주)한국', 'copy matching lines');
    await checkCopy(page, '#copy-re', 'msg2', '\\(주\\)[ㅎ하-힣]', 'copy regex (inside of the slashes)');

    // 겹자음: 입력기가 ㄱ+ㅅ을 ㄳ으로 합친 검색어
    await page.fill('#words', '감사합니다\n각시탈\n감자\nㄳ');
    await page.fill('#q', 'ㄳ');
    check((await page.textContent('#re-src')) === '/(?:ㄳ|[ㄱ가-깋][ㅅ사-싷])/', 'compound jamo regex: ' + (await page.textContent('#re-src')));
    check((await page.textContent('#count')).includes('4줄 중 3줄 일치'), 'compound jamo count: ' + (await page.textContent('#count')));
    items = await resultItems(page);
    check(JSON.stringify(items.map((i) => i.marks.join('|'))) === JSON.stringify(['감사', '각시', 'ㄳ']), 'compound jamo highlights: ' + JSON.stringify(items.map((i) => i.marks)));

    // 빈 검색어 (처음부터 옵션이 켜져 있어도 ^만 있는 정규식을 보여 주거나 복사하지 않음)
    await page.check('#prefix');
    await page.uncheck('#only');
    await page.fill('#q', '');
    check((await page.textContent('#re-src')).includes('검색어를 입력'), 'empty query placeholder even with ^ option');
    check((await page.textContent('#re-usage')) === '', 'no usage line for empty query');
    check((await page.textContent('#count')).includes('검색어를 입력하면'), 'empty query count message');
    items = await resultItems(page);
    check(items.length === 4 && items.every((i) => i.cls === 'idle' && i.marks.length === 0), 'empty query: rows listed without match marks (' + items.map((i) => i.cls).join(',') + ')');
    await page.evaluate(() => navigator.clipboard.writeText('(비움)'));
    await page.click('#copy-re');
    await page.waitForFunction(() => document.getElementById('msg2').textContent.length > 0);
    check((await page.textContent('#msg2')).includes('먼저 입력') && (await clipboard(page)) === '(비움)', 'copy regex refused for empty query');
    await page.uncheck('#prefix');

    // 목록 지우기 (키보드)
    await page.focus('#clear-words');
    await page.keyboard.press('Enter');
    check((await page.inputValue('#words')) === '', 'clear list via keyboard');
    check((await page.textContent('#count')).includes('한 줄에 하나씩'), 'empty list message');

    // 긴 입력이 가로 스크롤을 만들지 않는지
    await src.fill('가'.repeat(3000) + 'x'.repeat(3000));
    await page.fill('#q', 'ㄱ'.repeat(40));
    await page.fill('#words', 'a'.repeat(500) + '\n' + '가'.repeat(500));
    await page.waitForTimeout(50);

    // Layout at 360px
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= 360, 'no horizontal scroll at 360px (scrollWidth=' + sw + ')');

    // Footer and relative links
    check((await page.locator('footer.site a').getAttribute('href')) === 'https://github.com/ghwnd8938-netizen/hangul-tools/issues', 'footer issue link');
    check((await page.locator('#support').count()) === 1 && (await page.textContent('#support')) === '', 'support placeholder present and empty');
    check((await page.locator('header.site a').getAttribute('href')) === '../', 'home link is relative');
    check((await page.locator('link[rel=stylesheet]').getAttribute('href')) === '../assets/style.css', 'stylesheet is relative');
    check((await page.locator('.privacy').count()) >= 1, 'privacy line present');

    // 다크 모드에서도 같은 레이아웃
    const dark = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'dark' });
    const dpage = await dark.newPage();
    dpage.on('console', (m) => { if (m.type() === 'error') errors.push('dark console: ' + m.text()); });
    dpage.on('pageerror', (e) => errors.push('dark pageerror: ' + e.message));
    await dpage.goto(PAGE);
    await dpage.fill('#src', '홍길동 '.repeat(200));
    const bg = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg === 'rgb(22, 22, 21)', 'dark mode background applied (' + bg + ')');
    const dsw = await dpage.evaluate(() => document.documentElement.scrollWidth);
    check(dsw <= 360, 'dark mode: no horizontal scroll at 360px (scrollWidth=' + dsw + ')');
    await dark.close();
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
