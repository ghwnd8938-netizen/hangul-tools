'use strict';
// node --test tests/chosung.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../chosung/tool.js');

// 초성별 첫 음절 / 끝 음절 (직접 적은 값 — 아래에서 코드 계산으로도 다시 확인)
const BOUNDS = [
  ['ㄱ', '가', '깋'], ['ㄲ', '까', '낗'], ['ㄴ', '나', '닣'], ['ㄷ', '다', '딯'], ['ㄸ', '따', '띻'],
  ['ㄹ', '라', '맇'], ['ㅁ', '마', '밓'], ['ㅂ', '바', '빟'], ['ㅃ', '빠', '삫'], ['ㅅ', '사', '싷'],
  ['ㅆ', '싸', '앃'], ['ㅇ', '아', '잏'], ['ㅈ', '자', '짛'], ['ㅉ', '짜', '찧'], ['ㅊ', '차', '칳'],
  ['ㅋ', '카', '킿'], ['ㅌ', '타', '팋'], ['ㅍ', '파', '핗'], ['ㅎ', '하', '힣']
];
const ch = (code) => String.fromCharCode(code);
const prev = (s) => ch(s.charCodeAt(0) - 1);
const next = (s) => ch(s.charCodeAt(0) + 1);

// 독립적인 기준: NFD로 분해한 첫 자모(U+1100~U+1112)의 순서 = 초성 번호
function oracleChosung(syl) {
  return C.CHOSUNG[syl.normalize('NFD').charCodeAt(0) - 0x1100];
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('CHOSUNG: 19 compatibility jamo in syllable order', () => {
  assert.strictEqual(C.CHOSUNG, 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ');
  assert.strictEqual(C.CHOSUNG.length, 19);
  assert.deepStrictEqual([...C.CHOSUNG].map((c) => c.codePointAt(0).toString(16)),
    ['3131', '3132', '3134', '3137', '3138', '3139', '3141', '3142', '3143', '3145',
      '3146', '3147', '3148', '3149', '314a', '314b', '314c', '314d', '314e']);
  assert.deepStrictEqual(BOUNDS.map((b) => b[0]).join(''), C.CHOSUNG);
});

test('boundary table matches code arithmetic (first = AC00 + i*588, last = first + 587)', () => {
  BOUNDS.forEach(([, first, last], i) => {
    assert.strictEqual(first.charCodeAt(0), 0xAC00 + i * 588, first);
    assert.strictEqual(last.charCodeAt(0), 0xAC00 + i * 588 + 587, last);
    assert.deepStrictEqual(C.syllableRange(i), [first, last]);
  });
});

test('getChosung: first and last syllable of all 19 initial ranges', () => {
  for (const [jamo, first, last] of BOUNDS) {
    assert.strictEqual(C.getChosung(first), jamo, first);
    assert.strictEqual(C.getChosung(last), jamo, last);
  }
  // 경계 바로 바깥 글자는 이웃 초성
  for (let i = 1; i < BOUNDS.length; i++) {
    assert.strictEqual(C.getChosung(prev(BOUNDS[i][1])), BOUNDS[i - 1][0]);
    assert.strictEqual(C.getChosung(next(BOUNDS[i - 1][2])), BOUNDS[i][0]);
  }
  // U+AC00 직전과 U+D7A3 직후는 음절이 아니므로 그대로
  assert.strictEqual(C.getChosung('\uABFF\uD7A4'), '\uABFF\uD7A4');
});

test('getChosung: all 11,172 syllables agree with the NFD oracle', () => {
  let all = '', expected = '';
  for (let c = 0xAC00; c <= 0xD7A3; c++) {
    all += ch(c);
    expected += oracleChosung(ch(c));
  }
  assert.strictEqual(C.getChosung(all), expected);
  assert.strictEqual(C.getChosung(all).length, 11172);
});

test('getChosung: normal sentences and mixed scripts', () => {
  assert.strictEqual(C.getChosung('홍길동'), 'ㅎㄱㄷ');
  assert.strictEqual(C.getChosung('대한민국 만세'), 'ㄷㅎㅁㄱ ㅁㅅ');
  assert.strictEqual(C.getChosung('홍길동 Hello 123!'), 'ㅎㄱㄷ Hello 123!');
  assert.strictEqual(C.getChosung('까치 따라 빨리 싸움 짜장'), 'ㄲㅊ ㄸㄹ ㅃㄹ ㅆㅇ ㅉㅈ');
  assert.strictEqual(C.getChosung('東京 Москва 서울'), '東京 Москва ㅅㅇ');
  assert.strictEqual(C.getChosung('ㅋㅋ 좋아요ㅠ'), 'ㅋㅋ ㅈㅇㅇㅠ');
  // 문자열이 아닌 입력
  assert.strictEqual(C.getChosung(123), '123');
});

test('getChosung: empty / null / undefined', () => {
  assert.strictEqual(C.getChosung(''), '');
  assert.strictEqual(C.getChosung(null), '');
  assert.strictEqual(C.getChosung(undefined), '');
  assert.strictEqual(C.getChosung('', { keepOther: false }), '');
});

test('getChosung: emoji and surrogate pairs are never split', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.strictEqual(C.getChosung('가😀나'), 'ㄱ😀ㄴ');
  assert.strictEqual(C.getChosung('가😀나', { keepOther: false }), 'ㄱㄴ');
  assert.strictEqual(C.getChosung('우리 ' + family + ' 가족'), 'ㅇㄹ ' + family + ' ㄱㅈ');
  assert.strictEqual(C.getChosung('𠀀한자'), '𠀀ㅎㅈ'); // 보조 평면 한자
  const out = C.getChosung('😀😀가𝕏', { keepOther: false });
  assert.strictEqual(out, 'ㄱ');
  // 어떤 경우에도 짝 없는 서로게이트가 생기지 않음
  const rnd = mulberry32(7);
  const pool = ['가', '😀', 'a', ' ', '\n', '𝕏', '힣', 'ㅋ', family];
  for (let k = 0; k < 300; k++) {
    let s = '';
    for (let j = 0; j < 12; j++) s += pool[Math.floor(rnd() * pool.length)];
    for (const keepOther of [true, false]) {
      const r = C.getChosung(s, { keepOther });
      assert.ok(r.isWellFormed ? r.isWellFormed() : !/[\uD800-\uDFFF]/.test(r.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), JSON.stringify(s));
    }
  }
});

test('getChosung: CRLF, LF and CR are preserved exactly (both modes)', () => {
  assert.strictEqual(C.getChosung('가\r\n나'), 'ㄱ\r\nㄴ');
  assert.strictEqual(C.getChosung('가\n나'), 'ㄱ\nㄴ');
  assert.strictEqual(C.getChosung('가\r나'), 'ㄱ\rㄴ');
  assert.strictEqual(C.getChosung('홍길동 25\r\n김철수 31\r\n', { keepOther: false }), 'ㅎㄱㄷ\r\nㄱㅊㅅ\r\n');
  assert.strictEqual(C.getChosung('가\n\n나', { keepOther: false }), 'ㄱ\n\nㄴ');
});

test('getChosung: keepOther false drops non-Hangul but keeps jamo and line breaks', () => {
  assert.strictEqual(C.getChosung('홍길동(25), 서울', { keepOther: false }), 'ㅎㄱㄷㅅㅇ');
  assert.strictEqual(C.getChosung('ㅋㅋ 좋아요!', { keepOther: false }), 'ㅋㅋㅈㅇㅇ');
  assert.strictEqual(C.getChosung('Hello, World 123', { keepOther: false }), '');
  assert.strictEqual(C.getChosung('\t가\u3000나\u00A0다 ', { keepOther: false }), 'ㄱㄴㄷ');
  // keepOther 생략, true, 다른 값은 모두 기본(유지)
  assert.strictEqual(C.getChosung('가 a', {}), 'ㄱ a');
  assert.strictEqual(C.getChosung('가 a', { keepOther: true }), 'ㄱ a');
});

test('composeHangul / getChosung: decomposed (NFD) Hangul, e.g. macOS file names', () => {
  const nfd = '한글 파일.txt'.normalize('NFD');
  assert.notStrictEqual(nfd, '한글 파일.txt');
  assert.strictEqual(C.composeHangul(nfd), '한글 파일.txt');
  assert.strictEqual(C.getChosung(nfd), 'ㅎㄱ ㅍㅇ.txt');
  // 모든 음절: NFD → 합치면 원래 글자
  for (let c = 0xAC00; c <= 0xD7A3; c++) {
    const s = ch(c);
    if (C.composeHangul(s.normalize('NFD')) !== s) assert.fail('compose failed at U+' + c.toString(16));
  }
  // 받침 없는 완성형 + 종성 자모
  assert.strictEqual(C.composeHangul('가\u11A8'), '각');
  assert.strictEqual(C.composeHangul('각\u11A8'), '각\u11A8'); // 이미 받침 있으면 그대로
  // 짝 없는 자모, 옛한글 자모는 그대로
  assert.strictEqual(C.composeHangul('\u1100x\u1161'), '\u1100x\u1161');
  assert.strictEqual(C.getChosung('\u1113\u1161'), '\u1113\u1161');
  // NFC와 달리 CJK 호환 한자 등 다른 글자는 바꾸지 않음
  assert.strictEqual(C.getChosung('\uF900 가'), '\uF900 ㄱ');
  assert.strictEqual(C.composeHangul('e\u0301\u1100\u1161'), 'e\u0301가');
});

test('getChosung: very long input', () => {
  const unit = '대한민국 Korea 😀\r\n';
  const big = unit.repeat(20000); // 약 34만 코드 단위
  const t0 = Date.now();
  const out = C.getChosung(big);
  assert.ok(Date.now() - t0 < 2000, 'too slow');
  assert.strictEqual(out, 'ㄷㅎㅁㄱ Korea 😀\r\n'.repeat(20000));
  assert.strictEqual(C.getChosung(big, { keepOther: false }), 'ㄷㅎㅁㄱ\r\n'.repeat(20000));
});

// ---------- 정규식 ----------

test('chosungRegexSource: each of the 19 initials → [jamo first-last]', () => {
  for (const [jamo, first, last] of BOUNDS) {
    const src = C.chosungRegexSource(jamo);
    assert.strictEqual(src, '[' + jamo + first + '-' + last + ']');
    const re = new RegExp('^' + src + '$');
    assert.ok(re.test(first), jamo + ' matches ' + first);
    assert.ok(re.test(last), jamo + ' matches ' + last);
    assert.ok(re.test(jamo), jamo + ' matches bare jamo');
    assert.ok(new RegExp(src, 'u').test(last), 'u flag');
  }
  for (let i = 0; i < BOUNDS.length; i++) {
    const re = new RegExp('^' + C.chosungRegexSource(BOUNDS[i][0]) + '$');
    if (i > 0) assert.ok(!re.test(prev(BOUNDS[i][1])), BOUNDS[i][0] + ' must not match ' + prev(BOUNDS[i][1]));
    if (i < 18) assert.ok(!re.test(next(BOUNDS[i][2])), BOUNDS[i][0] + ' must not match ' + next(BOUNDS[i][2]));
    // 다른 초성의 낱자모와는 일치하지 않음
    for (let j = 0; j < BOUNDS.length; j++) if (j !== i) assert.ok(!re.test(BOUNDS[j][0]));
  }
});

test('chosungRegexSource: every syllable matches exactly its own initial', () => {
  const res = BOUNDS.map(([jamo]) => new RegExp('^' + C.chosungRegexSource(jamo) + '$'));
  for (let c = 0xAC00; c <= 0xD7A3; c += 7) {
    const s = ch(c);
    const hits = res.map((re, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
    assert.deepStrictEqual(hits, [C.CHOSUNG.indexOf(oracleChosung(s))], s);
  }
});

test('chosungRegexSource: ㅎㄱㄷ', () => {
  const src = C.chosungRegexSource('ㅎㄱㄷ');
  assert.strictEqual(src, '[ㅎ하-힣][ㄱ가-깋][ㄷ다-딯]');
  const re = new RegExp(src);
  for (const s of ['홍길동', '한글도우미', '김홍길동전', 'ㅎㄱㄷ 모임', '흑기둥', 'ㅎ길ㄷ']) assert.ok(re.test(s), s);
  for (const s of ['홍경래', '홍 길동', '헝가리', '하교 도우미', '', 'ㅎㄲㄷ', '홍낄동']) assert.ok(!re.test(s), s);
});

test('chosungRegexSource: mixed full syllables and initials', () => {
  assert.strictEqual(C.chosungRegexSource('홍ㄱ동'), '홍[ㄱ가-깋]동');
  const re = new RegExp(C.chosungRegexSource('홍ㄱ동'));
  for (const s of ['홍길동', '홍기동', '홍ㄱ동', '나는 홍가동']) assert.ok(re.test(s), s);
  for (const s of ['홍길순', '황길동', '홍낄동', 'ㅎㄱ동']) assert.ok(!re.test(s), s);
  assert.strictEqual(C.chosungRegexSource('ㅅ울'), '[ㅅ사-싷]울');
  assert.strictEqual(C.chosungRegexSource('김ㅊㅅ'), '김[ㅊ차-칳][ㅅ사-싷]');
  assert.strictEqual(C.chosungRegexSource('ㄱa1'), '[ㄱ가-깋]a1');
  assert.ok(new RegExp(C.chosungRegexSource('ㄱa1')).test('강a1'));
  assert.ok(!new RegExp(C.chosungRegexSource('ㄱa1')).test('강A1'));
});

// 겹자음 낱자 → 두 초성 (직접 적은 표; 코드 포인트는 아래에서 따로 확인)
const COMPOUNDS = [
  ['ㄳ', 'ㄱㅅ', 0x3133], ['ㄵ', 'ㄴㅈ', 0x3135], ['ㄶ', 'ㄴㅎ', 0x3136], ['ㄺ', 'ㄹㄱ', 0x313A],
  ['ㄻ', 'ㄹㅁ', 0x313B], ['ㄼ', 'ㄹㅂ', 0x313C], ['ㄽ', 'ㄹㅅ', 0x313D], ['ㄾ', 'ㄹㅌ', 0x313E],
  ['ㄿ', 'ㄹㅍ', 0x313F], ['ㅀ', 'ㄹㅎ', 0x3140], ['ㅄ', 'ㅂㅅ', 0x3144]
];

test('chosungRegexSource: vowels and old jamo stay literal', () => {
  assert.strictEqual(C.chosungRegexSource('ㅏㅠ'), 'ㅏㅠ');
  assert.ok(new RegExp(C.chosungRegexSource('ㅏㅠ')).test('ㅏㅠ'));
  assert.strictEqual(C.chosungRegexSource('\u3165'), '\u3165');
});

// 버그 수정: 한글 입력기는 ㄱ 다음 ㅅ을 치면 ㄳ 한 글자로 합치는 경우가 많아, 예전에는 'ㄱㅅ'을 치려던
// 검색어가 글자 그대로의 ㄳ만 찾아 '감사'를 놓쳤습니다.
test('chosungRegexSource: compound consonant jamo (IME-merged ㄱ+ㅅ → ㄳ) means both initials', () => {
  for (const [jamo, pair, cp] of COMPOUNDS) {
    assert.strictEqual(jamo.codePointAt(0), cp, jamo);
    const expected = '(?:' + jamo + '|' + C.chosungRegexSource(pair) + ')';
    assert.strictEqual(C.chosungRegexSource(jamo), expected, jamo);
    for (const flags of ['', 'u']) {
      const re = new RegExp('^' + C.chosungRegexSource(jamo) + '$', flags);
      assert.ok(re.test(jamo), jamo + ' matches itself');
      assert.ok(re.test(pair), jamo + ' matches ' + pair);
      // 두 초성의 첫/끝 음절 조합
      const i = C.CHOSUNG.indexOf(pair[0]), j = C.CHOSUNG.indexOf(pair[1]);
      for (const a of C.syllableRange(i)) for (const b of C.syllableRange(j)) assert.ok(re.test(a + b), jamo + ' ' + a + b);
      assert.ok(!re.test(C.syllableRange(i)[0]), jamo + ' needs two letters');
      assert.ok(!re.test(pair[1] + pair[0]), jamo + ' order matters');
    }
  }
  assert.deepStrictEqual(C.matchList('ㄳ', ['감사', '각시', 'ㄱㅅ', 'ㄳ', '감자', 'ㅅㄱ', '갑사']), ['감사', '각시', 'ㄱㅅ', 'ㄳ', '갑사']);
  assert.deepStrictEqual(C.matchList('ㄳㅎ', ['감사합니다', '감사', '고맙습니다']), ['감사합니다']);
  assert.deepStrictEqual(C.matchList('ㅄ', ['바사', '바보', 'ㅄ']), ['바사', 'ㅄ']);
  assert.deepStrictEqual(C.matchList('ㄳ', ['감사해요', '각사'], { prefix: true }), ['감사해요', '각사']);
  assert.deepStrictEqual(C.matchList('ㄳ', ['고마워 감사'], { prefix: true }), []);
  assert.deepStrictEqual(C.highlightParts('ㄳ', '고마워 감사해 ㄳ'), [
    { text: '고마워 ', hit: false }, { text: '감사', hit: true }, { text: '해 ', hit: false }, { text: 'ㄳ', hit: true }]);
  // 섞어 쓴 검색어와 슬래시 리터럴
  // eslint-disable-next-line no-new-func
  const lit = new Function('return /' + C.chosungRegexSource('홍ㄳ') + '/u;')();
  assert.ok(lit.test('홍각사') && !lit.test('홍각'));
  // 표에 없는 옛 겹자음 낱자(ㅥ ㅦ ㅧ ㅨ)는 그대로
  assert.strictEqual(C.chosungRegexSource('ㅥㅦㅧㅨ'), 'ㅥㅦㅧㅨ');
});

// 버그 수정: tool.js에 U+2028/U+2029 원문자가 들어 있으면 ES2019 이전 엔진에서 파일 전체가 문법 오류가 납니다.
test('tool.js source contains no raw line/paragraph separator characters', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'chosung', 'tool.js'), 'utf8');
  assert.ok(!src.includes(String.fromCharCode(0x2028)), 'raw U+2028 in tool.js');
  assert.ok(!src.includes(String.fromCharCode(0x2029)), 'raw U+2029 in tool.js');
  // 이스케이프 결과는 그대로
  const ls = String.fromCharCode(0x2028), ps = String.fromCharCode(0x2029);
  assert.strictEqual(C.chosungRegexSource('a' + ls + ps), 'a\\u2028\\u2029');
  assert.ok(new RegExp(C.chosungRegexSource('ㄱ' + ls)).test('가' + ls));
});

test('composeHangul agrees with String.prototype.normalize("NFC") on random Hangul jamo sequences', () => {
  const rnd = mulberry32(2024);
  const pool = [];
  // 현대/옛 초성·중성·종성 자모, 확장 자모, 완성형, 호환 자모, 기타
  for (const [a, b] of [[0x1100, 0x1112], [0x1113, 0x115F], [0x1160, 0x1175], [0x1176, 0x11A7], [0x11A8, 0x11C2],
    [0x11C3, 0x11FF], [0xA960, 0xA97C], [0xD7B0, 0xD7C6], [0xD7CB, 0xD7FB]]) {
    pool.push(ch(a), ch(b), ch((a + b) >> 1));
  }
  pool.push('가', '각', '개', '힣', '하', 'ㄱ', 'ㅏ', 'a', ' ', '😀');
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const n = 1 + Math.floor(rnd() * 7);
    for (let j = 0; j < n; j++) s += pool[Math.floor(rnd() * pool.length)];
    assert.strictEqual(C.composeHangul(s), s.normalize('NFC'), JSON.stringify(s));
  }
});

test('chosungRegexSource: regex metacharacters are escaped', () => {
  const meta = '\\^$.*+?()[]{}|/';
  const src = C.chosungRegexSource(meta);
  assert.strictEqual(src, '\\\\\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/');
  for (const flags of ['', 'u']) {
    const re = new RegExp('^' + src + '$', flags);
    assert.ok(re.test(meta), 'literal match, flags=' + flags);
    assert.ok(!re.test('x' + meta.slice(1)));
  }
  assert.strictEqual(C.chosungRegexSource('a.b*c'), 'a\\.b\\*c');
  assert.ok(!new RegExp(C.chosungRegexSource('a.b')).test('axb'));
  assert.ok(new RegExp(C.chosungRegexSource('ㄱ(1)')).test('가(1)'));
  // '-'는 이스케이프하지 않음 (u 플래그에서 \- 는 문법 오류)
  assert.strictEqual(C.chosungRegexSource('a-b'), 'a-b');
  assert.ok(new RegExp(C.chosungRegexSource('a-b'), 'u').test('a-b'));
  // 슬래시로 감싼 정규식 리터럴로도 그대로 쓸 수 있음
  // eslint-disable-next-line no-new-func
  const lit = new Function('return /' + C.chosungRegexSource('ㅎ/ㄱ\n.') + '/;')();
  assert.ok(lit.test('하/가\n.'));
  assert.ok(!lit.test('하/가\nx'));
});

test('chosungRegexSource: line terminators are escaped', () => {
  assert.strictEqual(C.chosungRegexSource('a\nb\r\u2028\u2029'), 'a\\nb\\r\\u2028\\u2029');
  assert.ok(new RegExp(C.chosungRegexSource('ㄱ\r\nㄴ')).test('가\r\n나'));
});

test('chosungRegexSource: emoji / surrogate pairs in the query', () => {
  const src = C.chosungRegexSource('ㄱ😀');
  assert.strictEqual(src, '[ㄱ가-깋]😀');
  for (const flags of ['', 'u']) {
    const re = new RegExp(src, flags);
    assert.ok(re.test('각😀'));
    assert.ok(!re.test('각😁'));
  }
});

test('chosungRegexSource: empty query, prefix option, NFD query', () => {
  assert.strictEqual(C.chosungRegexSource(''), '');
  assert.strictEqual(C.chosungRegexSource(null), '');
  assert.strictEqual(C.chosungRegexSource('', { prefix: true }), '^');
  assert.strictEqual(C.chosungRegexSource('ㅎㄱ', { prefix: true }), '^[ㅎ하-힣][ㄱ가-깋]');
  assert.strictEqual(C.chosungRegexSource('홍ㄱ'.normalize('NFD')), '홍[ㄱ가-깋]');
});

test('chosungRegexSource: random queries agree with a brute-force matcher', () => {
  const rnd = mulberry32(42);
  const qPool = ['ㄱ', 'ㄲ', 'ㅎ', 'ㅇ', '가', '각', '힣', '아', 'a', '.', ' ', '😀', 'ㅏ', 'ㄳ', 'ㅄ'];
  const lPool = ['가', '깋', '까', '각', '하', '힣', '아', '앃', 'ㄱ', 'ㅎ', 'ㅇ', 'a', 'b', '.', ' ', '😀', 'ㅏ',
    'ㄳ', 'ㅄ', 'ㅅ', '사', '싷', 'ㅂ', '바'];
  const pairOf = Object.fromEntries(COMPOUNDS.map(([j, p]) => [j, p]));
  const isSyl = (c) => c.length === 1 && c >= '가' && c <= '힣';
  const one = (q, l) => l !== undefined && (C.CHOSUNG.includes(q) && q.length === 1 ? (l === q || (isSyl(l) && oracleChosung(l) === q)) : l === q);
  // 검색어 k번째부터가 줄의 p번째 글자에서 시작해 일치하는가 (겹자음은 낱자 1개 또는 초성 2개)
  function from(qs, k, ls, p) {
    if (k === qs.length) return true;
    const q = qs[k];
    if (pairOf[q]) {
      if (ls[p] === q && from(qs, k + 1, ls, p + 1)) return true;
      return one(pairOf[q][0], ls[p]) && one(pairOf[q][1], ls[p + 1]) && from(qs, k + 1, ls, p + 2);
    }
    return one(q, ls[p]) && from(qs, k + 1, ls, p + 1);
  }
  function brute(qs, ls, prefix) {
    const starts = prefix ? [0] : [...Array(ls.length + 1).keys()];
    return starts.some((p) => from(qs, 0, ls, p));
  }
  for (let k = 0; k < 3000; k++) {
    const qs = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => qPool[Math.floor(rnd() * qPool.length)]);
    const ls = Array.from({ length: Math.floor(rnd() * 7) }, () => lPool[Math.floor(rnd() * lPool.length)]);
    const prefix = rnd() < 0.3;
    const got = new RegExp(C.chosungRegexSource(qs.join(''), { prefix })).test(ls.join(''));
    assert.strictEqual(got, brute(qs, ls, prefix), JSON.stringify({ q: qs.join(''), l: ls.join(''), prefix }));
  }
});

// ---------- matchList / highlightParts ----------

const SAMPLE = ['홍길동', '홍경래', '한글도우미', '김홍길동전', '하교 도우미', 'ㅎㄱㄷ 모임', 'Hello 홍길동!'];

test('matchList: filters lines, keeps order, returns originals', () => {
  assert.deepStrictEqual(C.matchList('ㅎㄱㄷ', SAMPLE), ['홍길동', '한글도우미', '김홍길동전', 'ㅎㄱㄷ 모임', 'Hello 홍길동!']);
  assert.deepStrictEqual(C.matchList('ㅎㄱㄷ', SAMPLE, { prefix: true }), ['홍길동', '한글도우미', 'ㅎㄱㄷ 모임']);
  assert.deepStrictEqual(C.matchList('홍ㄱ', SAMPLE), ['홍길동', '홍경래', '김홍길동전', 'Hello 홍길동!']);
  assert.deepStrictEqual(C.matchList('홍ㄱㄹ', SAMPLE), ['홍경래']);
  assert.deepStrictEqual(C.matchList('ㄷㅇ', SAMPLE), ['한글도우미', '하교 도우미']);
  assert.deepStrictEqual(C.matchList('ㅋ', SAMPLE), []);
  assert.deepStrictEqual(C.matchList('ㄱ', []), []);
});

test('matchList: string input with CRLF / LF / CR', () => {
  assert.deepStrictEqual(C.matchList('ㅎㄱㄷ', SAMPLE.join('\r\n')), C.matchList('ㅎㄱㄷ', SAMPLE));
  assert.deepStrictEqual(C.matchList('ㅎㄱㄷ', SAMPLE.join('\n')), C.matchList('ㅎㄱㄷ', SAMPLE));
  assert.deepStrictEqual(C.matchList('ㅎㄱㄷ', SAMPLE.join('\r')), C.matchList('ㅎㄱㄷ', SAMPLE));
  assert.deepStrictEqual(C.matchList('ㄱ', ''), []);
  assert.deepStrictEqual(C.matchList('ㄱ', null), []);
});

test('matchList: empty query matches every line; non-string items are stringified', () => {
  assert.deepStrictEqual(C.matchList('', ['a', '', '가']), ['a', '', '가']);
  assert.deepStrictEqual(C.matchList('1', [1, 21, 3, null]), ['1', '21']);
});

test('matchList: NFD lines match and come back unchanged; metachar queries are literal', () => {
  const nfd = '홍길동.txt'.normalize('NFD');
  assert.deepStrictEqual(C.matchList('ㅎㄱㄷ', [nfd, 'x']), [nfd]);
  assert.deepStrictEqual(C.matchList('.txt', ['a.txt', 'atxt', 'a_txt']), ['a.txt']);
  assert.deepStrictEqual(C.matchList('(주)', ['(주)한국', '주식회사']), ['(주)한국']);
  assert.deepStrictEqual(C.matchList('ㅇㄴ😀', ['안녕😀', '안녕😁', '😀', '아😀']), ['안녕😀']);
});

test('matchList: large list', () => {
  const lines = [];
  for (let i = 0; i < 50000; i++) lines.push(i % 10 === 0 ? '홍길동' + i : '김철수' + i);
  const t0 = Date.now();
  const got = C.matchList('ㅎㄱㄷ', lines);
  assert.ok(Date.now() - t0 < 2000, 'too slow');
  assert.strictEqual(got.length, 5000);
});

test('highlightParts: splits into hit / non-hit parts', () => {
  assert.deepStrictEqual(C.highlightParts('ㅎㄱㄷ', 'Hello 홍길동!'), [
    { text: 'Hello ', hit: false }, { text: '홍길동', hit: true }, { text: '!', hit: false }]);
  assert.deepStrictEqual(C.highlightParts('ㄱ', '가나가'), [
    { text: '가', hit: true }, { text: '나', hit: false }, { text: '가', hit: true }]);
  assert.strictEqual(C.highlightParts('ㅎㄱㄷ', '홍경래'), null);
  assert.deepStrictEqual(C.highlightParts('ㄱ', '가가', { prefix: true }), [
    { text: '가', hit: true }, { text: '가', hit: false }]);
  assert.strictEqual(C.highlightParts('ㄴ', '가나', { prefix: true }), null);
  assert.deepStrictEqual(C.highlightParts('', '아무 줄'), [{ text: '아무 줄', hit: false }]);
  assert.deepStrictEqual(C.highlightParts('', '아무 줄', { prefix: true }), [{ text: '아무 줄', hit: false }]);
  // NFD 줄은 합친 형태로 나뉘고, 이어 붙이면 합친 줄과 같음
  const parts = C.highlightParts('ㄱㄷ', '홍길동'.normalize('NFD'));
  assert.deepStrictEqual(parts, [{ text: '홍', hit: false }, { text: '길동', hit: true }]);
  // 이모지 앞뒤가 깨지지 않음
  assert.strictEqual(C.highlightParts('ㄱ', '😀가😀').map((p) => p.text).join(''), '😀가😀');
});

// ---------- 스프레드시트 수식: 작은 해석기로 수식 문자열 자체를 실행 ----------

class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
const isErr = (v) => v instanceof FErr;

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (c === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new Error('unterminated string');
        if (src[i] === '"') {
          if (src[i + 1] === '"') { s += '"'; i += 2; continue; }
          i++; break;
        }
        s += src[i++];
      }
      toks.push({ t: 'str', v: s });
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(>=|<=|<>|[=<>+\-*/&(),])/.exec(src.slice(i));
    if (op) { toks.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new Error('bad char ' + c);
  }
  return toks;
}

const PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4 };

function parse(formula) {
  assert.ok(formula.startsWith('='), 'formula starts with =');
  const toks = tokenize(formula.slice(1));
  let p = 0;
  const peek = () => toks[p];
  const expect = (v) => {
    const t = toks[p++];
    if (!t || t.v !== v) throw new Error('expected ' + v + ' at token ' + (p - 1));
  };
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '-') return { k: 'neg', e: primary() };
    if (t.t === 'op' && t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.t === 'id') {
      if (peek() && peek().v === '(') {
        p++;
        const args = [];
        if (peek().v !== ')') {
          for (;;) {
            args.push(expr(0));
            if (peek().v === ',') { p++; continue; }
            break;
          }
        }
        expect(')');
        return { k: 'call', name: t.v.toUpperCase(), args };
      }
      return { k: 'name', v: t.v };
    }
    throw new Error('unexpected token ' + t.v);
  }
  function expr(minPrec) {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < minPrec) break;
      p++;
      const right = expr(PREC[t.v] + 1);
      left = { k: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  }
  const ast = expr(0);
  if (p !== toks.length) throw new Error('trailing tokens at ' + p);
  return ast;
}

// Excel 이름 규칙: c, r(대소문자 무관), 셀 주소·R1C1처럼 보이는 이름, TRUE/FALSE는 쓸 수 없음
function assertValidLetName(name) {
  assert.ok(/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name), 'LET name chars: ' + name);
  assert.ok(!/^[rc]$/i.test(name), 'LET name must not be r/c: ' + name);
  assert.ok(!/^[A-Za-z]{1,3}\d+$/.test(name), 'LET name looks like A1 ref: ' + name);
  assert.ok(!/^r\d*c\d*$/i.test(name) && !/^[rc]\d+$/i.test(name), 'LET name looks like R1C1: ' + name);
  assert.ok(!/^(true|false)$/i.test(name), 'LET name is boolean: ' + name);
}

function evaluate(formula, cfg) {
  const strings = cfg.strings; // 'utf16'(Excel 방식: 코드 단위) | 'codepoint'
  const lone = cfg.lone; // 짝 없는 서로게이트에 대한 UNICODE: 'error' | 'code'
  const toText = (v) => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
  const toNum = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
    return new FErr('#VALUE!');
  };
  const truthy = (v) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : new FErr('#VALUE!'));
  function lift(fn) {
    return (...args) => {
      const arr = args.find(Array.isArray);
      if (!arr) {
        const e = args.find(isErr);
        return e || fn(...args);
      }
      for (const a of args) if (Array.isArray(a) && a.length !== arr.length) return new FErr('#N/A');
      return arr.map((_, i) => lift(fn)(...args.map((a) => (Array.isArray(a) ? a[i] : a))));
    };
  }
  const len = (s) => (strings === 'utf16' ? s.length : Array.from(s).length);
  const mid = (s, start, n) => (strings === 'utf16' ? s.substr(start - 1, n) : Array.from(s).slice(start - 1, start - 1 + n).join(''));
  const FN = {
    LEN: { n: [1, 1], f: lift((s) => len(toText(s))) },
    MID: {
      n: [3, 3],
      f: lift((s, a, b) => {
        a = toNum(a); b = toNum(b);
        if (isErr(a)) return a; if (isErr(b)) return b;
        if (a < 1 || b < 0) return new FErr('#VALUE!');
        return mid(toText(s), Math.trunc(a), Math.trunc(b));
      })
    },
    UNICODE: {
      n: [1, 1],
      f: lift((s) => {
        s = toText(s);
        if (s === '') return new FErr('#VALUE!');
        if (strings === 'codepoint') return s.codePointAt(0);
        const c = s.charCodeAt(0);
        if (c >= 0xD800 && c <= 0xDBFF && s.length > 1 && s.charCodeAt(1) >= 0xDC00 && s.charCodeAt(1) <= 0xDFFF) return s.codePointAt(0);
        if (c >= 0xD800 && c <= 0xDFFF) return lone === 'error' ? new FErr('#VALUE!') : c;
        return c;
      })
    },
    INT: { n: [1, 1], f: lift((x) => { x = toNum(x); return isErr(x) ? x : Math.floor(x); }) },
    SEQUENCE: {
      n: [1, 1],
      f: (n) => {
        if (Array.isArray(n)) return new FErr('#VALUE!');
        n = toNum(n);
        if (isErr(n)) return n;
        n = Math.trunc(n);
        if (n < 1) return new FErr('#CALC!');
        return Array.from({ length: n }, (_, i) => i + 1);
      }
    },
    TEXTJOIN: {
      n: [3, 255],
      f: (d, ignore, ...vals) => {
        if (isErr(d)) return d;
        const flat = vals.flat();
        const e = flat.find(isErr);
        if (e) return e;
        const ig = truthy(ignore);
        if (isErr(ig)) return ig;
        return flat.map(toText).filter((s) => !ig || s !== '').join(toText(d));
      }
    }
  };
  const BIN = {
    '*': (a, b) => { a = toNum(a); b = toNum(b); return isErr(a) ? a : isErr(b) ? b : a * b; },
    '/': (a, b) => { a = toNum(a); b = toNum(b); return isErr(a) ? a : isErr(b) ? b : b === 0 ? new FErr('#DIV/0!') : a / b; },
    '+': (a, b) => { a = toNum(a); b = toNum(b); return isErr(a) ? a : isErr(b) ? b : a + b; },
    '-': (a, b) => { a = toNum(a); b = toNum(b); return isErr(a) ? a : isErr(b) ? b : a - b; },
    '&': (a, b) => toText(a) + toText(b)
  };
  function compare(op, a, b) {
    let r;
    if (typeof a === 'number' && typeof b === 'number') r = a < b ? -1 : a > b ? 1 : 0;
    else if (typeof a === 'string' && typeof b === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); r = x < y ? -1 : x > y ? 1 : 0; } else r = typeof a === 'string' ? 1 : -1; // 문자열 > 숫자
    return { '=': r === 0, '<>': r !== 0, '<': r < 0, '>': r > 0, '<=': r <= 0, '>=': r >= 0 }[op];
  }
  function ev(node, env) {
    switch (node.k) {
      case 'num': case 'str': return node.v;
      case 'neg': { const v = ev(node.e, env); return lift((x) => { x = toNum(x); return isErr(x) ? x : -x; })(v); }
      case 'name': {
        if (/^true$/i.test(node.v)) return true;
        if (/^false$/i.test(node.v)) return false;
        if (Object.prototype.hasOwnProperty.call(env, node.v.toLowerCase())) return env[node.v.toLowerCase()];
        if (/^[A-Z]{1,3}\d+$/.test(node.v)) return Object.prototype.hasOwnProperty.call(cfg.cells, node.v) ? cfg.cells[node.v] : '';
        return new FErr('#NAME?');
      }
      case 'bin': {
        const l = ev(node.l, env), r = ev(node.r, env);
        if (node.op in BIN) return lift(BIN[node.op])(l, r);
        return lift((a, b) => compare(node.op, a, b))(l, r);
      }
      case 'call': {
        const a = node.args;
        if (node.name === 'IF') {
          assert.ok(a.length >= 2 && a.length <= 3, 'IF arity');
          const cond = ev(a[0], env);
          // 배열 조건: 원소마다 고른 쪽 값만 씀 (고르지 않은 쪽의 오류는 무시 — Excel/시트 동작)
          const at = (v, i) => (Array.isArray(v) ? v[i] : v);
          if (!Array.isArray(cond)) {
            if (isErr(cond)) return cond;
            const b = truthy(cond);
            if (isErr(b)) return b;
            return b ? ev(a[1], env) : a.length > 2 ? ev(a[2], env) : false;
          }
          const t = ev(a[1], env), f = a.length > 2 ? ev(a[2], env) : false;
          for (const v of [t, f]) if (Array.isArray(v) && v.length !== cond.length) return new FErr('#N/A');
          return cond.map((c, i) => {
            if (isErr(c)) return c;
            const b = truthy(c);
            return isErr(b) ? b : b ? at(t, i) : at(f, i);
          });
        }
        if (node.name === 'IFERROR') {
          assert.strictEqual(a.length, 2, 'IFERROR arity');
          const v = ev(a[0], env);
          const alt = ev(a[1], env);
          if (Array.isArray(v)) return v.map((x, i) => (isErr(x) ? (Array.isArray(alt) ? alt[i] : alt) : x));
          return isErr(v) ? alt : v;
        }
        if (node.name === 'LET') {
          assert.ok(a.length >= 3 && a.length % 2 === 1, 'LET arity');
          const local = Object.assign({}, env);
          for (let i = 0; i < a.length - 1; i += 2) {
            assert.strictEqual(a[i].k, 'name', 'LET name');
            assertValidLetName(a[i].v);
            local[a[i].v.toLowerCase()] = ev(a[i + 1], local);
          }
          return ev(a[a.length - 1], local);
        }
        if (node.name === 'ARRAYFORMULA') {
          if (cfg.dialect !== 'sheets') return new FErr('#NAME?');
          assert.strictEqual(a.length, 1);
          return ev(a[0], env);
        }
        const fn = FN[node.name];
        if (!fn) return new FErr('#NAME?');
        assert.ok(a.length >= fn.n[0] && a.length <= fn.n[1], node.name + ' arity ' + a.length);
        return fn.f(...a.map((x) => ev(x, env)));
      }
      default: throw new Error('bad node');
    }
  }
  const out = ev(parse(formula), {});
  return out;
}

const CONFIGS = [];
for (const strings of ['utf16', 'codepoint']) for (const lone of ['error', 'code']) CONFIGS.push({ strings, lone });

function formulaInputs() {
  const rnd = mulberry32(99);
  const inputs = [
    '', '홍길동', '대한민국 만세', '홍길동 Hello 123!', '가😀나', '😀', '😀😀', 'ㅋㅋ 좋아요ㅠ',
    'Ünïcödé 東京 Москва', '가\r\n나\n다', 'a"b', '\uABFF\uD7A4', '𠀀한자',
    BOUNDS.map((b) => b[1] + b[2]).join(''),
    BOUNDS.map((b) => prev(b[1]) + next(b[2])).join('')
  ];
  let all = '';
  for (let c = 0xAC00; c <= 0xD7A3; c++) all += ch(c);
  inputs.push(all);
  let r = '';
  for (let i = 0; i < 3000; i++) r += ch(0xAC00 + Math.floor(rnd() * 11172)) + (i % 7 === 0 ? ' ' : '');
  inputs.push(r);
  return inputs;
}

test('formula strings: shape, constants and versions', () => {
  assert.strictEqual(C.SHEETS_FORMULA, C.EXCEL_FORMULA.replace('LET(', 'ARRAYFORMULA(LET(') + ')');
  assert.ok(!C.EXCEL_FORMULA.includes('ARRAYFORMULA'));
  for (const f of [C.EXCEL_FORMULA, C.SHEETS_FORMULA]) {
    assert.ok(f.includes('"' + C.CHOSUNG + '"'));
    assert.ok(f.includes('44032') && f.includes('55203') && f.includes('/588'));
    assert.strictEqual((f.match(/A1/g) || []).length, 3, 'A1 appears 3 times');
    assert.doesNotThrow(() => parse(f));
  }
  assert.strictEqual(0xAC00, 44032);
  assert.strictEqual(0xD7A3, 55203);
  assert.strictEqual(21 * 28, 588);
});

test('Excel formula evaluates to getChosung for many inputs (all string/surrogate models)', () => {
  const inputs = formulaInputs();
  for (const cfg of CONFIGS) {
    for (const s of inputs) {
      const got = evaluate(C.EXCEL_FORMULA, Object.assign({ dialect: 'excel', cells: { A1: s } }, cfg));
      assert.strictEqual(got, C.getChosung(s), JSON.stringify(cfg) + ' ' + JSON.stringify(s.slice(0, 40)));
    }
  }
});

test('Google Sheets formula evaluates to getChosung for many inputs', () => {
  const inputs = formulaInputs();
  for (const cfg of CONFIGS) {
    for (const s of inputs) {
      const got = evaluate(C.SHEETS_FORMULA, Object.assign({ dialect: 'sheets', cells: { A1: s } }, cfg));
      assert.strictEqual(got, C.getChosung(s), JSON.stringify(cfg) + ' ' + JSON.stringify(s.slice(0, 40)));
    }
  }
  // ARRAYFORMULA는 Excel에 없음
  assert.ok(isErr(evaluate(C.SHEETS_FORMULA, { dialect: 'excel', cells: { A1: '가' }, strings: 'utf16', lone: 'error' })));
});

test('formula: empty / missing / numeric cell, and the empty-cell guard is needed', () => {
  const base = { dialect: 'excel', strings: 'utf16', lone: 'error' };
  assert.strictEqual(evaluate(C.EXCEL_FORMULA, Object.assign({ cells: {} }, base)), '');
  assert.strictEqual(evaluate(C.EXCEL_FORMULA, Object.assign({ cells: { A1: '' } }, base)), '');
  assert.strictEqual(evaluate(C.EXCEL_FORMULA, Object.assign({ cells: { A1: 2024 } }, base)), '2024');
  // IF(A1="",...) 없이 빈 셀이면 SEQUENCE(0) 오류
  const core = '=' + C.EXCEL_FORMULA.slice('=IF(A1="","",'.length, -1);
  assert.ok(core.startsWith('=LET('));
  const r = evaluate(core, Object.assign({ cells: { A1: '' } }, base));
  assert.ok(isErr(r) && r.code === '#CALC!');
  assert.strictEqual(evaluate(core, Object.assign({ cells: { A1: '홍길동' } }, base)), 'ㅎㄱㄷ');
});

test('formula: decomposed (NFD) text is left unchanged, unlike the page', () => {
  const nfd = '한글'.normalize('NFD');
  const got = evaluate(C.EXCEL_FORMULA, { dialect: 'excel', cells: { A1: nfd }, strings: 'utf16', lone: 'error' });
  assert.strictEqual(got, nfd);
  assert.strictEqual(C.getChosung(nfd), 'ㅎㄱ');
});

test('formula interpreter sanity: LET name rules and operator precedence', () => {
  const base = { dialect: 'excel', cells: { A1: 'x' }, strings: 'utf16', lone: 'error' };
  assert.throws(() => evaluate('=LET(c,1,c+1)', base), /r\/c/);
  assert.throws(() => evaluate('=LET(ab12,1,ab12)', base), /A1 ref/);
  assert.strictEqual(evaluate('=LET(chars,2,codes,chars*3,codes+1)', base), 7);
  assert.strictEqual(evaluate('=1+2*3', base), 7);
  assert.strictEqual(evaluate('=(1+2)*3', base), 9);
  assert.strictEqual(evaluate('=INT((44032+588-44032)/588)+1', base), 2);
  assert.strictEqual(evaluate('=MID("ㄱㄲㄴ",2,1)', base), 'ㄲ');
  assert.strictEqual(evaluate('=TEXTJOIN("-",FALSE,SEQUENCE(3))', base), '1-2-3');
  assert.strictEqual(evaluate('=1>=1', base), true);
  assert.throws(() => evaluate('=MID("a",1)', base), /arity/);
  assert.throws(() => evaluate('=IF(1,2', base));
});
