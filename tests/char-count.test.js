'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CC = require('../char-count/tool.js');

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // 👨‍👩‍👧 (5 code points, 18 UTF-8 bytes)
const FLAG_KR = '\u{1F1F0}\u{1F1F7}';                     // 🇰🇷
const THUMBS_SKIN = '\u{1F44D}\u{1F3FD}';                 // 👍🏽
const KEYCAP_1 = '1️⃣';                          // 1️⃣
const HEART = '❤️';                              // ❤️
const NFD_HAN = '한';                      // 한 (조합형 자모)

function bothSegmenters(fn) {
  fn({});
  fn({ segmenter: false });
}

test('exports', () => {
  assert.strictEqual(typeof CC.count, 'function');
  assert.strictEqual(typeof CC.tidy, 'function');
  assert.strictEqual(typeof CC.limitStatus, 'function');
  assert.strictEqual(CC.nativeSegmenter, true, 'Node 22 has Intl.Segmenter');
});

test('empty, null and undefined input', () => {
  const zero = { withSpaces: 0, withoutSpaces: 0, words: 0, lines: 0, utf8Bytes: 0, eucKrBytes: 0 };
  assert.deepStrictEqual(CC.count(''), zero);
  assert.deepStrictEqual(CC.count(null), zero);
  assert.deepStrictEqual(CC.count(undefined), zero);
  assert.deepStrictEqual(CC.count('', { newline: 2 }), zero);
});

test('plain Korean', () => {
  assert.deepStrictEqual(CC.count('안녕하세요'), {
    withSpaces: 5, withoutSpaces: 5, words: 1, lines: 1, utf8Bytes: 15, eucKrBytes: 10
  });
  assert.deepStrictEqual(CC.count('저는 개발자입니다.'), {
    withSpaces: 10, withoutSpaces: 9, words: 2, lines: 1, utf8Bytes: 26, eucKrBytes: 18
  });
});

test('ASCII only', () => {
  assert.deepStrictEqual(CC.count('Hello, world!'), {
    withSpaces: 13, withoutSpaces: 12, words: 2, lines: 1, utf8Bytes: 13, eucKrBytes: 13
  });
});

test('what counts as 공백: space, tab, newline, NBSP, U+3000 and other Unicode spaces', () => {
  const spaces = [' ', '\t', '\n', '\r\n', '\r', '\u000B', '\u000C', '\u0085', ' ',
    ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
    '　', '﻿'];
  for (const s of spaces) {
    const c = CC.count('가' + s + '나');
    assert.strictEqual(c.withoutSpaces, 2, 'space ' + JSON.stringify(s));
    assert.strictEqual(c.words, 2, 'word split on ' + JSON.stringify(s));
  }
  // not whitespace in Unicode: zero-width space, ZWJ alone, word joiner
  for (const s of ['​', '⁠', 'ㅤ' /* U+3164 Hangul filler */]) {
    const c = CC.count('가' + s + '나');
    assert.strictEqual(c.withoutSpaces, 3, 'not a space ' + JSON.stringify(s));
    assert.strictEqual(c.words, 1);
  }
  // NBSP and full-width space count in 공백 포함
  assert.strictEqual(CC.count('가 나').withSpaces, 3);
  assert.strictEqual(CC.count('가　나').withSpaces, 3);
  assert.strictEqual(CC.count('가\t나').withSpaces, 3);
});

test('isSpaceCode', () => {
  for (const c of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]) {
    assert.strictEqual(CC.isSpaceCode(c), true, c.toString(16));
  }
  for (const c of [0x00, 0x08, 0x0e, 0x21, 0x41, 0xac00, 0x200b, 0x200d, 0x2060, 0x3164, 0xff01]) {
    assert.strictEqual(CC.isSpaceCode(c), false, c.toString(16));
  }
});

test('newline option: 1 (default), 2, 0', () => {
  const t = '가\n나';
  assert.strictEqual(CC.count(t).withSpaces, 3);
  assert.strictEqual(CC.count(t, { newline: 1 }).withSpaces, 3);
  assert.strictEqual(CC.count(t, { newline: 2 }).withSpaces, 4);
  assert.strictEqual(CC.count(t, { newline: 0 }).withSpaces, 2);
  for (const nl of [0, 1, 2]) {
    const c = CC.count(t, { newline: nl });
    assert.strictEqual(c.withoutSpaces, 2, 'newline never counts without spaces');
    assert.strictEqual(c.lines, 2);
    assert.strictEqual(c.words, 2);
    assert.strictEqual(c.utf8Bytes, 6 + nl);
    assert.strictEqual(c.eucKrBytes, 4 + nl);
  }
  // string values and invalid values
  assert.strictEqual(CC.count(t, { newline: '2' }).withSpaces, 4);
  assert.strictEqual(CC.count(t, { newline: '0' }).withSpaces, 2);
  assert.strictEqual(CC.count(t, { newline: 3 }).withSpaces, 3);
  assert.strictEqual(CC.count(t, { newline: 'x' }).withSpaces, 3);
  assert.strictEqual(CC.count(t, { newline: null }).withSpaces, 3);
});

test('CRLF, CR and LF are one line break each', () => {
  for (const nl of [0, 1, 2]) {
    const lf = CC.count('가\n나\n\n다', { newline: nl });
    assert.deepStrictEqual(CC.count('가\r\n나\r\n\r\n다', { newline: nl }), lf);
    assert.deepStrictEqual(CC.count('가\r나\r\r다', { newline: nl }), lf);
    assert.deepStrictEqual(CC.count('가\r\n나\n\r다', { newline: nl }), lf);
  }
  assert.deepStrictEqual(CC.count('a\r\nb'), CC.count('a\nb'));
  assert.strictEqual(CC.count('a\r\nb', { newline: 2 }).withSpaces, 4);
});

test('lines', () => {
  assert.strictEqual(CC.count('a').lines, 1);
  assert.strictEqual(CC.count('a\n').lines, 2);
  assert.strictEqual(CC.count('\n').lines, 2);
  assert.strictEqual(CC.count('\n\n').lines, 3);
  assert.strictEqual(CC.count('   ').lines, 1);
  assert.strictEqual(CC.count('   ').words, 0);
  assert.strictEqual(CC.count('   ').withoutSpaces, 0);
  assert.strictEqual(CC.count('   ').withSpaces, 3);
});

test('words', () => {
  assert.strictEqual(CC.count('  앞뒤  공백  ').words, 2);
  assert.strictEqual(CC.count('하나\t둘\n셋　넷 다섯').words, 5);
  assert.strictEqual(CC.count('Hello,世界!안녕').words, 1);
  assert.strictEqual(CC.count('😀 😀  😀').words, 3);
  assert.strictEqual(CC.count('- 항목').words, 2);
});

test('emoji and surrogate pairs count as one character', () => {
  bothSegmenters((o) => {
    const one = (s, utf8, euc, label) => {
      const c = CC.count(s, o);
      assert.strictEqual(c.withSpaces, 1, label + ' withSpaces ' + JSON.stringify(o));
      assert.strictEqual(c.withoutSpaces, 1, label + ' withoutSpaces');
      assert.strictEqual(c.words, 1);
      assert.strictEqual(c.utf8Bytes, utf8, label + ' utf8');
      assert.strictEqual(c.eucKrBytes, euc, label + ' euc');
    };
    // 한글 2바이트 방식은 UTF-16 코드 단위마다 (ASCII 1, 그 외 2): 서로게이트 쌍 = 4
    one('\u{1F600}', 4, 4, 'grinning');
    one(FAMILY, 18, 16, 'family');
    one(FLAG_KR, 8, 8, 'flag');
    one(THUMBS_SKIN, 8, 8, 'skin tone');
    one(KEYCAP_1, 7, 5, 'keycap');
    one(HEART, 6, 4, 'heart+VS16');
    one('𠀀', 4, 4, 'CJK ext B');
  });
  // two flags = two characters
  assert.strictEqual(CC.count(FLAG_KR + '\u{1F1EF}\u{1F1F5}').withSpaces, 2);
  assert.strictEqual(CC.count(FLAG_KR + '\u{1F1EF}\u{1F1F5}', { segmenter: false }).withSpaces, 2);
});

test('combining sequences and decomposed Hangul count as one', () => {
  bothSegmenters((o) => {
    assert.strictEqual(CC.count('é', o).withSpaces, 1);
    assert.strictEqual(CC.count('Café', o).withSpaces, 4);
    assert.strictEqual(CC.count(NFD_HAN, o).withSpaces, 1);
    assert.strictEqual(CC.count(NFD_HAN + '글', o).withSpaces, 2); // 한글
    assert.strictEqual(CC.count('가', o).withSpaces, 1); // 가 (L+V)
  });
  // bytes are per code point
  assert.strictEqual(CC.count(NFD_HAN).utf8Bytes, 9);
  assert.strictEqual(CC.count(NFD_HAN).eucKrBytes, 6);
  assert.strictEqual(CC.count('é').eucKrBytes, 3);
});

test('lone surrogates do not crash and count as one character', () => {
  for (const s of ['\uD83D', '\uDE00', 'a\uD83Db']) {
    const c = CC.count(s);
    assert.strictEqual(c.withSpaces, s.length);
    assert.strictEqual(c.utf8Bytes, s.length === 1 ? 3 : 5); // U+FFFD = 3 bytes
    assert.strictEqual(c.eucKrBytes, s.length === 1 ? 2 : 4);
  }
  // reversed pair (low then high) is two lone surrogates, not one character
  assert.strictEqual(CC.count('\uDE00\uD83D').utf8Bytes, 6);
  assert.strictEqual(CC.count('\uD83D', { segmenter: false }).withSpaces, 1);
});

test('mixed scripts and full-width characters', () => {
  const c = CC.count('Hello 世界 안녕 ｈｉ！');
  // H e l l o _ 世 界 _ 안 녕 _ ｈ ｉ ！ = 15
  assert.strictEqual(c.withSpaces, 15);
  assert.strictEqual(c.withoutSpaces, 12);
  assert.strictEqual(c.words, 4);
  assert.strictEqual(c.utf8Bytes, 5 + 1 + 6 + 1 + 6 + 1 + 9);
  assert.strictEqual(c.eucKrBytes, 5 + 1 + 4 + 1 + 4 + 1 + 6);
  // Latin-1 / Greek (2-byte UTF-8) and Hangul compatibility jamo
  assert.strictEqual(CC.count('é').utf8Bytes, 2);
  assert.strictEqual(CC.count('é').eucKrBytes, 2);
  assert.strictEqual(CC.count('ㅋㅋ').eucKrBytes, 4);
  assert.strictEqual(CC.count('ㅋㅋ').utf8Bytes, 6);
});

test('UTF-8 byte count matches Buffer.byteLength', () => {
  const samples = ['안녕하세요 👋\n반갑습니다 ' + FAMILY, 'Hello 世界 ｈｉ', FLAG_KR + KEYCAP_1 + HEART,
    'Café naïve Ελληνικά русский العربية', NFD_HAN + ' 한'];
  for (const s of samples) {
    assert.strictEqual(CC.count(s).utf8Bytes, Buffer.byteLength(s, 'utf8'), s);
  }
});

test('fallback segmenter agrees with Intl.Segmenter on common text', () => {
  const samples = ['안녕하세요', 'Hello world', FAMILY + FLAG_KR + THUMBS_SKIN + KEYCAP_1 + HEART,
    '👩🏽‍💻 개발자', 'é ä', NFD_HAN + '글', '가\t나　다 라',
    '\u{1F1F0}\u{1F1F7}\u{1F1EF}\u{1F1F5}\u{1F1FA}', 'กำลัง', '🏳️‍🌈 무지개', '\ńx', '😀‍가'];
  for (const s of samples) {
    assert.deepStrictEqual(CC.graphemes(s, { segmenter: false }), CC.graphemes(s), JSON.stringify(s));
    assert.deepStrictEqual(CC.count(s, { segmenter: false }), CC.count(s), JSON.stringify(s));
  }
});

test('the smoke-test sample', () => {
  const t = '안녕하세요 👋\n반갑습니다 ' + FAMILY + '\n\nabc def';
  // euc: 안녕하세요 10 + sp 1 + 👋 4 + nl + 반갑습니다 10 + sp 1 + family 16 + nl nl + 'abc def' 7
  assert.deepStrictEqual(CC.count(t), {
    withSpaces: 24, withoutSpaces: 18, words: 6, lines: 4, utf8Bytes: 64, eucKrBytes: 52
  });
  assert.deepStrictEqual(CC.count(t, { newline: 2 }), {
    withSpaces: 27, withoutSpaces: 18, words: 6, lines: 4, utf8Bytes: 67, eucKrBytes: 55
  });
  assert.deepStrictEqual(CC.count(t, { newline: 0 }), {
    withSpaces: 21, withoutSpaces: 18, words: 6, lines: 4, utf8Bytes: 61, eucKrBytes: 49
  });
});

test('very long input is exact and fast', () => {
  const unit = '가나다 abc 😀\n'; // 10 graphemes incl. newline
  const n = 50000;
  const t = unit.repeat(n);
  const t0 = Date.now();
  const c = CC.count(t);
  const ms = Date.now() - t0;
  assert.deepStrictEqual(c, {
    withSpaces: 10 * n,
    withoutSpaces: 7 * n,
    words: 3 * n,
    lines: n + 1,
    utf8Bytes: (9 + 1 + 3 + 1 + 4 + 1) * n,
    eucKrBytes: (6 + 1 + 3 + 1 + 4 + 1) * n
  });
  assert.ok(ms < 3000, 'took ' + ms + 'ms');
  // ASCII fast path
  const a = 'word '.repeat(200000);
  assert.strictEqual(CC.count(a).withSpaces, 1000000);
  assert.strictEqual(CC.count(a).words, 200000);
  // fallback path on long input
  assert.strictEqual(CC.count(unit.repeat(5000), { segmenter: false }).withSpaces, 50000);
});

test('tidy: trailing spaces removed, inner spacing and indentation kept', () => {
  assert.strictEqual(CC.tidy('가나다   \n라마  바\t\n'), '가나다\n라마  바');
  assert.strictEqual(CC.tidy('문장 　 \t'), '문장');
  assert.strictEqual(CC.tidy('  들여쓰기 유지  '), '  들여쓰기 유지');
  assert.strictEqual(CC.tidy('a  b'), 'a  b');
});

test('tidy: blank lines', () => {
  // one blank line between paragraphs is kept
  assert.strictEqual(CC.tidy('첫 문단\n\n둘째 문단'), '첫 문단\n\n둘째 문단');
  // several blank lines (also whitespace-only ones) collapse to one
  assert.strictEqual(CC.tidy('첫 문단\n\n\n둘째'), '첫 문단\n\n둘째');
  assert.strictEqual(CC.tidy('첫 문단\n\n\n\n\n둘째'), '첫 문단\n\n둘째');
  assert.strictEqual(CC.tidy('첫 문단\n  \n　\n\t\n둘째'), '첫 문단\n\n둘째');
  // leading and trailing blank lines removed
  assert.strictEqual(CC.tidy('\n\n  \n본문\n\n\n'), '본문');
  // single line breaks untouched
  assert.strictEqual(CC.tidy('한 줄\n두 줄\n세 줄'), '한 줄\n두 줄\n세 줄');
});

test('tidy: CRLF normalised, edge cases, idempotent', () => {
  assert.strictEqual(CC.tidy('가 \r\n\r\n\r\n\r\n나\r\n'), '가\n\n나');
  assert.strictEqual(CC.tidy('가\r나'), '가\n나');
  assert.strictEqual(CC.tidy(''), '');
  assert.strictEqual(CC.tidy(null), '');
  assert.strictEqual(CC.tidy(undefined), '');
  assert.strictEqual(CC.tidy('   \n\t\n　'), '');
  assert.strictEqual(CC.tidy('이모지 ' + FAMILY + '  \n\n\n끝'), '이모지 ' + FAMILY + '\n\n끝');
  const messy = '  제목  \n\n\n\n본문 1   \r\n본문 2\t\n\n\n';
  const once = CC.tidy(messy);
  assert.strictEqual(once, '  제목\n\n본문 1\n본문 2');
  assert.strictEqual(CC.tidy(once), once);
});

test('tidy: long pathological input stays linear', () => {
  const t0 = Date.now();
  const s = ' '.repeat(200000) + 'x' + ' '.repeat(200000);
  assert.strictEqual(CC.tidy(s), ' '.repeat(200000) + 'x');
  const blanks = 'a' + '\n'.repeat(200000) + 'b';
  assert.strictEqual(CC.tidy(blanks), 'a\n\nb');
  assert.ok(Date.now() - t0 < 2000);
});

test('limitStatus', () => {
  const c = CC.count('가'.repeat(450) + ' '.repeat(50)); // with 500, without 450, euc 950, utf8 1400
  let s = CC.limitStatus(c, 1000, 'with');
  assert.deepStrictEqual(s, { used: 500, limit: 1000, remaining: 500, over: 0, percent: 50, level: 'ok', unit: '자' });
  s = CC.limitStatus(c, 550, 'with');
  assert.strictEqual(s.level, 'warn'); // 500/550 = 90.9%
  assert.strictEqual(s.percent, 90);
  s = CC.limitStatus(c, 500, 'with');
  assert.strictEqual(s.level, 'warn');
  assert.strictEqual(s.remaining, 0);
  assert.strictEqual(s.percent, 100);
  s = CC.limitStatus(c, 499, 'with');
  assert.strictEqual(s.level, 'err');
  assert.strictEqual(s.over, 1);
  assert.strictEqual(s.remaining, -1);
  assert.strictEqual(s.percent, 101, 'over the limit never shows 100%');
  s = CC.limitStatus(c, 501, 'with');
  assert.strictEqual(s.percent, 99, 'under the limit never shows 100%');
  assert.strictEqual(CC.limitStatus(c, 500, 'without').used, 450);
  assert.strictEqual(CC.limitStatus(c, 500, 'without').level, 'warn');
  assert.strictEqual(CC.limitStatus(c, 1000, 'euckr').used, 950);
  assert.strictEqual(CC.limitStatus(c, 1000, 'euckr').unit, '바이트');
  assert.strictEqual(CC.limitStatus(c, 1000, 'utf8').used, 1400);
  assert.strictEqual(CC.limitStatus(c, 1000, 'utf8').level, 'err');
  assert.strictEqual(CC.limitStatus(c, 1000, 'bogus').used, 500, 'unknown mode = 공백 포함');
  assert.strictEqual(CC.limitStatus(c, '1000', 'with').limit, 1000);
  assert.strictEqual(CC.limitStatus(c, 1000.9, 'with').limit, 1000);
  for (const bad of ['', null, undefined, 0, -5, 'abc', NaN, Infinity, 0.5]) {
    assert.strictEqual(CC.limitStatus(c, bad, 'with'), null, String(bad));
  }
  assert.strictEqual(CC.limitStatus(CC.count(''), 10, 'with').level, 'ok');
  assert.strictEqual(CC.limitStatus(CC.count(''), 10, 'with').percent, 0);
});

/* ---------- QA additions ---------- */

// Reference implementations written independently of tool.js
function refEucKr(s, nl) {
  // the usual JS byte counter on Korean sites: per UTF-16 code unit, > 127 -> 2 bytes
  s = s.replace(/\r\n?/g, '\n');
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) b += nl; else b += c > 127 ? 2 : 1;
  }
  return b;
}
const segRef = new Intl.Segmenter('ko', { granularity: 'grapheme' });
function refGraphemes(s) { return Array.from(segRef.segment(s.replace(/\r\n?/g, '\n')), (x) => x.segment); }
const WS = /^[\p{White_Space}﻿]+$/u;

test('QA: 공백 set is exactly Unicode White_Space plus U+FEFF (all BMP code points)', () => {
  const ws = /^\p{White_Space}$/u;
  for (let c = 0; c < 0x10000; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const expected = ws.test(String.fromCharCode(c)) || c === 0xfeff;
    if (CC.isSpaceCode(c) !== expected) assert.fail('U+' + c.toString(16) + ' expected ' + expected);
  }
});

test('QA bug: 한글 2바이트 counts per UTF-16 code unit (emoji = 4 bytes, not 2)', () => {
  assert.strictEqual(CC.count('👋').eucKrBytes, 4);
  assert.strictEqual(CC.count('가👋a').eucKrBytes, 2 + 4 + 1);
  assert.strictEqual(CC.count(FAMILY).eucKrBytes, 16);       // 3 pairs + 2 ZWJ = 8 units
  assert.strictEqual(CC.count('🏳️‍🌈').eucKrBytes, 4 + 2 + 2 + 4);
  // never smaller than the per-code-unit counter
  for (const s of [FAMILY, FLAG_KR, THUMBS_SKIN, '𠀀𠀁', '😀 가 a\n😀']) {
    for (const nl of [0, 1, 2]) assert.strictEqual(CC.count(s, { newline: nl }).eucKrBytes, refEucKr(s, nl), JSON.stringify(s));
  }
});

test('QA: randomized differential test against independent references', () => {
  // deterministic PRNG
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pool = ['a', 'Z', '1', ' ', '\t', '\n', '\r\n', '\r', ' ', '　', '​', '﻿', ' ',
    '가', '힣', 'ㅋ', 'ᄒ', 'ᅡ', 'ᆫ', '́', '‍', '️', '世', 'ｈ', '！', 'é',
    '😀', '👍', '\u{1F3FD}', '\u{1F1F0}', '\u{1F1F7}', '𠀀', '\uD83D', '\uDE00', 'ก', 'ำ', '\u0085'];
  for (let k = 0; k < 600; k++) {
    let s = '';
    const len = rnd(40);
    for (let i = 0; i < len; i++) s += pool[rnd(pool.length)];
    const nl = rnd(3);
    const c = CC.count(s, { newline: nl });
    const g = refGraphemes(s);
    const newlines = g.filter((x) => x === '\n').length;
    const L = JSON.stringify(s) + ' nl=' + nl;
    assert.strictEqual(c.withSpaces, g.length - newlines + newlines * nl, 'withSpaces ' + L);
    assert.strictEqual(c.withoutSpaces, g.filter((x) => !WS.test(x)).length, 'withoutSpaces ' + L);
    assert.strictEqual(c.lines, s === '' ? 0 : newlines + 1, 'lines ' + L);
    const norm = s.replace(/\r\n?/g, '\n');
    // each LF is 1 byte in UTF-8; replace its weight (do not delete it: that would glue lone surrogates)
    assert.strictEqual(c.utf8Bytes, Buffer.byteLength(norm, 'utf8') - newlines + newlines * nl, 'utf8 ' + L);
    assert.strictEqual(c.eucKrBytes, refEucKr(s, nl), 'euc ' + L);
    const words = norm.split(/[\s﻿]+/u).filter(Boolean).length; // JS \s == White_Space + FEFF - NEL
    if (!norm.includes('\u0085')) assert.strictEqual(c.words, words, 'words ' + L);
  }
});

test('QA bug: limit accepts "1,000", "500자", full-width digits; rejects junk', () => {
  assert.strictEqual(CC.parseLimit('1,000'), 1000);
  assert.strictEqual(CC.parseLimit(' 1 000 '), 1000);
  assert.strictEqual(CC.parseLimit('500자'), 500);
  assert.strictEqual(CC.parseLimit('500 글자'), 500);
  assert.strictEqual(CC.parseLimit('1000바이트'), 1000);
  assert.strictEqual(CC.parseLimit('1000 bytes'), 1000);
  assert.strictEqual(CC.parseLimit('1000B'), 1000);
  assert.strictEqual(CC.parseLimit('１，０００'), 1000);
  assert.strictEqual(CC.parseLimit('99.9'), 99);
  assert.strictEqual(CC.parseLimit(1000), 1000);
  for (const bad of ['', '   ', 'abc', '-5', '0', '0.5', '1e3', '5자자', '자', '1.2.3', null, undefined, NaN, Infinity, -1, {}, []]) {
    assert.strictEqual(CC.parseLimit(bad), null, 'bad ' + String(bad));
  }
  const c = CC.count('가'.repeat(950));
  assert.strictEqual(CC.limitStatus(c, '1,000', 'with').remaining, 50);
  assert.strictEqual(CC.limitStatus(c, '1,000바이트', 'euckr').over, 900);
  assert.strictEqual(CC.limitStatus(c, '1,0x0', 'with'), null);
});

test('QA: warn threshold is inclusive at exactly 90% (page says "90% 이상")', () => {
  const c = CC.count('a'.repeat(90));
  assert.strictEqual(CC.limitStatus(c, 100, 'with').level, 'warn');
  assert.strictEqual(CC.limitStatus(CC.count('a'.repeat(89)), 100, 'with').level, 'ok');
});

test('QA: tidy never increases any count and never touches non-blank content', () => {
  let seed = 999;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pool = ['가', 'a', ' ', '\t', '　', ' ', '\n', '\r\n', '😀', '́', '​'];
  for (let k = 0; k < 400; k++) {
    let s = '';
    for (let i = rnd(30); i > 0; i--) s += pool[rnd(pool.length)];
    const t = CC.tidy(s);
    for (const nl of [0, 1, 2]) {
      const a = CC.count(s, { newline: nl }), b = CC.count(t, { newline: nl });
      for (const k2 of Object.keys(a)) assert.ok(b[k2] <= a[k2], k2 + ' grew for ' + JSON.stringify(s));
      assert.strictEqual(b.withoutSpaces, a.withoutSpaces, 'non-space chars changed for ' + JSON.stringify(s));
      assert.strictEqual(b.words, a.words);
    }
    assert.strictEqual(CC.tidy(t), t, 'idempotent');
    assert.ok(!/[ \t　 ]\n/.test(t) && !/\n\n\n/.test(t) && !t.includes('\r'), JSON.stringify(t));
  }
});
