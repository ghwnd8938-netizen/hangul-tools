'use strict';
// Playwright smoke test: node tests/korean-numbers.smoke.js
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const K = require('../en/korean-numbers/tool.js');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'en', 'korean-numbers', 'index.html')).href;

const failures = [];
function check(cond, label) {
  if (cond) console.log('  ok   ' + label);
  else { console.log('  FAIL ' + label); failures.push(label); }
}

const text = (page, sel) => page.$eval(sel, (e) => e.innerText);
async function visibleText(page, sel) {
  return page.$eval(sel, (e) => (e.offsetParent !== null || e.getClientRects().length > 0) ? e.innerText : '');
}

async function type(page, sel, value) {
  await page.fill(sel, '');
  await page.focus(sel);
  await page.keyboard.type(value);
}

async function noHScroll(page, label) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 360, label + ' (scrollWidth=' + sw + ')');
}

function watch(page, errors, external) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.route('https://static.cloudflareinsights.com/**', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  page.on('request', (r) => { if (!r.url().startsWith('https://static.cloudflareinsights.com/') && !r.url().startsWith('file:')) external.push(r.url()); });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const external = [];
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'light' });
    const page = await context.newPage();
    watch(page, errors, external);
    await page.goto(PAGE);

    check((await page.title()).includes('Korean Numbers Reader'), 'page title');
    check((await page.getAttribute('html', 'lang')) === 'en', 'html lang=en');
    check((await page.getAttribute('header.site a', 'href')) === '../', 'home link is relative ../');
    const footer = await text(page, 'footer.site');
    check(footer.includes('Built and tested by AI (Claude). Found a wrong result? Report it.'), 'footer text');
    check((await page.$eval('#support a', (e) => e.getAttribute('href'))) === 'https://t70572193.gumroad.com/l/dobhl', '#support links to the Gumroad pack');

    // every input has a label, every output is a live region
    const unlabeled = await page.$$eval('input', (ins) => ins.filter((i) => !document.querySelector('label[for="' + i.id + '"]')).map((i) => i.id));
    check(unlabeled.length === 0, 'all inputs labelled ' + JSON.stringify(unlabeled));
    const live = await page.$$eval('.out', (os) => os.every((o) => o.getAttribute('aria-live') === 'polite'));
    check(live, 'outputs are aria-live');

    // ---- initial render ----
    let out = await visibleText(page, '#num-out');
    check(out.includes('삼만 오천') && out.includes('samman ocheon') && out.includes('35,000'), 'initial number result: ' + JSON.stringify(out));

    // ---- number mode ----
    await type(page, '#num-in', '16');
    out = await visibleText(page, '#num-out');
    check(out.includes('십육') && out.includes('simnyuk'), '16 -> 십육 simnyuk');
    check(out.includes('열여섯') && out.includes('yeollyeoseot'), '16 native 열여섯');
    check(out.includes('열여섯 개'), '16 counter example');

    await type(page, '#num-in', '20');
    out = await visibleText(page, '#num-out');
    check(out.includes('이십') && out.includes('스물') && out.includes('스무 살') && out.includes('seumu sal'), '20 -> 스물 / 스무 살');
    check(out.includes('form changes'), '20 marked as changing form');

    await type(page, '#num-in', '21');
    out = await visibleText(page, '#num-out');
    check(out.includes('스물하나') && out.includes('스물한 명'), '21 -> 스물하나 / 스물한 명');

    await page.click('button[data-target="num-in"][data-value="1000000"]');
    out = await visibleText(page, '#num-out');
    check(out.includes('백만') && out.includes('baengman') && /not normally|1 to 99/.test(out), 'example button 1,000,000 -> 백만 baengman + native note');

    await page.click('button[data-target="num-in"][data-value="100000001"]');
    out = await visibleText(page, '#num-out');
    check(out.includes('일억 일') && out.includes('ireok il'), 'example 100,000,001 -> 일억 일');

    await type(page, '#num-in', '１０,０００');
    out = await visibleText(page, '#num-out');
    check(/(^|\n)만(\n|$)/.test(out) && !out.includes('일만'), 'full-width 10,000 -> 만: ' + JSON.stringify(out));

    for (const [bad, re] of [['-5', /Negative/], ['3.5', /decimals/], ['abc', /digits only/], ['12345678901234567', /Too large/]]) {
      await type(page, '#num-in', bad);
      out = await visibleText(page, '#num-out');
      check(re.test(out) && (await page.$('#num-out .msg.err')) !== null, 'number rejects ' + bad + ': ' + JSON.stringify(out));
    }
    await type(page, '#num-in', '9999999999999999');
    await noHScroll(page, 'longest number fits at 360px');

    // keyboard: Tab from the number input reaches the first example button and Enter activates it
    await page.focus('#num-in');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement.getAttribute('data-value'));
    check(focused === '16', 'Tab reaches example buttons (focused ' + focused + ')');
    await page.keyboard.press('Enter');
    check((await page.inputValue('#num-in')) === '16', 'Enter on example button fills input');

    // ---- price mode ----
    out = await visibleText(page, '#price-num-out');
    check(out.includes('삼만 오천 원') && out.includes('samman ocheon won'), 'initial price reading');
    await type(page, '#price-num', '10000');
    out = await visibleText(page, '#price-num-out');
    check(out.includes('만 원') && !out.includes('일만'), '10000 -> 만 원');

    out = await visibleText(page, '#price-ko-out');
    check(out.includes('₩35,000') && out.includes('삼만 오천 원'), 'initial reverse price 3만 5천원');
    const priceCases = [['삼만오천원', '₩35,000'], ['만 원', '₩10,000'], ['십이만 삼천오백 원', '₩123,500'], ['1억 2천만 원', '₩120,000,000']];
    for (const [input, want] of priceCases) {
      await type(page, '#price-ko', input);
      out = await visibleText(page, '#price-ko-out');
      check(out.includes(want), 'reverse price ' + input + ' -> ' + want);
    }
    await type(page, '#price-ko', '9999조 9999억 9999만 9999원');
    out = await visibleText(page, '#price-ko-out');
    check(out.includes('₩9,999,999,999,999,999') && out.includes('구천구백구십구조'), 'largest reverse price');
    await noHScroll(page, 'largest reverse price fits at 360px');
    await page.click('button[data-target="price-ko"][data-value="십이만 삼천오백 원"]');
    check((await visibleText(page, '#price-ko-out')).includes('₩123,500'), 'price example button');
    for (const bad of ['삼오원', '세 개', '3.5만원']) {
      await type(page, '#price-ko', bad);
      out = await visibleText(page, '#price-ko-out');
      check((await page.$('#price-ko-out .msg.err')) !== null && !out.includes('₩'), 'reverse price rejects ' + bad + ': ' + JSON.stringify(out));
    }

    // ---- time mode ----
    out = await visibleText(page, '#time-out');
    check(out.includes('오후 세 시 사십오 분') && out.includes('ohu se si sasibo bun') && out.includes('십오 시 사십오 분'), 'initial time 15:45');
    await page.click('button[data-target="time-in"][data-value="3:30"]');
    out = await visibleText(page, '#time-out');
    check(out.includes('오전 세 시 반') && out.includes('세 시 삼십 분') && out.includes('se si ban'), '3:30 shows 반 and 삼십 분');
    await page.click('button[data-target="time-in"][data-value="0:00"]');
    out = await visibleText(page, '#time-out');
    check(out.includes('오전 열두 시') && out.includes('자정'), '0:00 -> 오전 열두 시 / 자정');
    await page.click('button[data-target="time-in"][data-value="12:00"]');
    out = await visibleText(page, '#time-out');
    check(out.includes('오후 열두 시') && out.includes('정오'), '12:00 -> 오후 열두 시 / 정오');
    await type(page, '#time-in', '12:30');
    out = await visibleText(page, '#time-out');
    check(out.includes('오후 열두 시 반'), '12:30 -> 오후 열두 시 반');
    await type(page, '#time-in', '오후 3시 반');
    out = await visibleText(page, '#time-out');
    check(out.includes('오후 세 시 반'), 'Korean-style time input 오후 3시 반');
    await type(page, '#time-in', '24:00');
    check((await page.$('#time-out .msg.err')) !== null, '24:00 rejected');

    // ---- phone mode ----
    out = await visibleText(page, '#phone-out');
    check(out.includes('공일공 일이삼사 오육칠팔') && out.includes('gong-il-gong'), 'initial phone reading');
    await type(page, '#phone-in', '02-345-6789');
    out = await visibleText(page, '#phone-out');
    check(out.includes('공이 삼사오 육칠팔구'), 'phone 02-345-6789');
    await type(page, '#phone-in', '010-abcd');
    check((await page.$('#phone-out .msg.err')) !== null, 'phone rejects letters');

    // ---- reference table matches the tested logic ----
    const rows = await page.$$eval('#ref-table tr', (trs) => trs.map((tr) => ({ n: +tr.dataset.n, cells: [...tr.cells].map((c) => c.textContent) })));
    const tableOk = rows.length === 11 && rows.every((r) => {
      const nat = K.native(r.n);
      return r.cells[1] === K.sino(r.n) && r.cells[2] === nat.base && r.cells[3] === nat.counter;
    });
    check(tableOk, 'reference table matches tool.js');

    await noHScroll(page, 'no horizontal scroll at 360px (light)');
    check((await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).includes('dark'), 'color-scheme declares light dark');
    await context.close();

    // ---- dark mode ----
    const dark = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'dark' });
    const dpage = await dark.newPage();
    watch(dpage, errors, external);
    await dpage.goto(PAGE);
    const bg = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg === 'rgb(22, 22, 21)', 'dark background applied (' + bg + ')');
    check((await visibleText(dpage, '#num-out')).includes('삼만 오천'), 'dark mode renders results');
    await type(dpage, '#num-in', '9999999999999999');
    await noHScroll(dpage, 'no horizontal scroll at 360px (dark)');
    await dark.close();
  } catch (e) {
    failures.push('exception: ' + (e && e.stack || e));
    console.log(e);
  } finally {
    await browser.close();
  }

  check(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  check(external.length === 0, 'no network requests ' + JSON.stringify(external));

  if (failures.length) {
    console.log('\n' + failures.length + ' FAILED');
    process.exit(1);
  }
  console.log('\nall smoke checks passed');
})();
