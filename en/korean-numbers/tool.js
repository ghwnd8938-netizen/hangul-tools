/*
 * Korean Numbers Reader - pure logic (browser: window.KoreanNumbers, Node: require()).
 * No network access, no dependencies. Everything typed stays in the browser.
 *
 * Conventions (see tests/korean-numbers.test.js):
 *  - Sino-Korean numbers are spaced by 만 units (Hangul spelling rule 44):
 *    12,3456,7898 -> 십이억 삼천사백오십육만 칠천팔백구십팔.
 *  - A leading 1 is dropped before 십, 백, 천 (everywhere) and before 만 when 만 is the
 *    highest unit (10000 -> 만, 11000 -> 만 천). It is kept for 억 and 조 (일억, 일조) and
 *    for 만 after a higher unit (1,0001,0000 -> 일억 일만).
 *  - Time: 0:00-11:59 is 오전, 12:00-23:59 is 오후. 0:00 = 오전 열두 시 (자정),
 *    12:00 = 오후 열두 시 (정오).
 *  - Romanization follows the Revised Romanization of Korean applied to the standard
 *    pronunciation of each space-separated word (sound changes across spaces are not shown,
 *    tensing is not written, as RR prescribes).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KoreanNumbers = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_DIGITS = 16; // up to 9999조 9999억 9999만 9999

  var SINO_DIGITS = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  var SMALL_UNITS = ['천', '백', '십', ''];
  var BIG_UNITS = ['', '만', '억', '조'];

  var NATIVE_ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
  var NATIVE_ONES_COUNTER = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
  var NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

  var PHONE_DIGITS = ['공', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

  // ---------------------------------------------------------------- helpers

  function str(v) { return v == null ? '' : String(v); }

  // NFKC turns full-width digits/colons/commas (０１２：，) into ASCII.
  function norm(s) {
    s = str(s);
    if (s.normalize) s = s.normalize('NFKC');
    return s.replace(/[  -​　]/g, ' ').replace(/[‐-―−]/g, '-').trim();
  }

  function stripZeros(d) {
    d = d.replace(/^0+/, '');
    return d === '' ? '0' : d;
  }

  // Remove digit-group separators (comma, space, _ or ') inside a run of digits, but only when
  // they split it into groups of three: "1,234,567" and "35 000" are fine, "1,2,3" is not.
  function joinGroups(s) {
    var bad = null;
    var text = s.replace(/\d+(?:(?:\s*[,_']\s*|\s+)\d+)+/g, function (run) {
      var parts = run.split(/\s*[,_']\s*|\s+/);
      var ok = parts[0].length <= 3;
      for (var i = 1; i < parts.length; i++) if (parts[i].length !== 3) ok = false;
      if (!ok && bad === null) bad = run;
      return parts.join('');
    });
    return { ok: bad === null, text: text, bad: bad };
  }

  function stripCurrency(s) {
    return s.replace(/^(?:[₩￦]|krw)\s*/i, '').replace(/\s*(?:원정?|won|krw)$/i, '');
  }

  function groupThousands(d) {
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---------------------------------------------------------------- Sino-Korean

  // 0..9999 -> Hangul without spaces, 1 dropped before 천/백/십 ('' for 0).
  function sinoGroup(n) {
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    var out = '';
    for (var i = 0; i < 4; i++) {
      var d = +s.charAt(i);
      if (d === 0) continue;
      var unit = SMALL_UNITS[i];
      out += (unit !== '' && d === 1) ? unit : SINO_DIGITS[d] + unit;
    }
    return out;
  }

  // Accepts a non-negative safe integer, a BigInt, or a string of ASCII digits.
  function toDigits(value) {
    if (typeof value === 'bigint') {
      if (value < 0) throw new RangeError('negative');
      return value.toString();
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('not a non-negative safe integer');
      return String(value);
    }
    var s = str(value);
    if (!/^\d+$/.test(s)) throw new RangeError('digits only');
    return stripZeros(s);
  }

  function sino(value) {
    var d = toDigits(value);
    if (d.length > MAX_DIGITS) throw new RangeError('too large');
    if (d === '0') return '영';
    var groups = [];
    for (var end = d.length; end > 0; end -= 4) {
      groups.push(+d.slice(Math.max(0, end - 4), end)); // groups[0] = ones group
    }
    var words = [];
    var higher = false;
    for (var g = groups.length - 1; g >= 0; g--) {
      var v = groups[g];
      if (v === 0) continue;
      var text = sinoGroup(v);
      if (g === 1 && v === 1 && !higher) text = ''; // 만, not 일만, when 만 leads
      words.push(text + BIG_UNITS[g]);
      higher = true;
    }
    return words.join(' ');
  }

  // ---------------------------------------------------------------- native Korean

  function native(n) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 99) return null;
    var t = Math.floor(n / 10), u = n % 10;
    var base = NATIVE_TENS[t] + NATIVE_ONES[u];
    var counter = u === 0 ? (t === 2 ? '스무' : NATIVE_TENS[t]) : NATIVE_TENS[t] + NATIVE_ONES_COUNTER[u];
    return { base: base, counter: counter, changes: base !== counter };
  }

  // ---------------------------------------------------------------- romanization

  var L_LIST = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  var V_LIST = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  var T_LIST = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
    'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var RR_L = { 'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt', 'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅃ': 'pp',
    'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': '', 'ㅈ': 'j', 'ㅉ': 'jj', 'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h' };
  var RR_V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi',
    'yu', 'eu', 'ui', 'i'];
  var RR_T = { '': '', 'ㄱ': 'k', 'ㄴ': 'n', 'ㄷ': 't', 'ㄹ': 'l', 'ㅁ': 'm', 'ㅂ': 'p', 'ㅇ': 'ng' };
  // 7 representative final sounds (standard pronunciation rules 8-11)
  var NEUTRAL = { 'ㄱ': 'ㄱ', 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㄳ': 'ㄱ', 'ㄺ': 'ㄱ', 'ㄴ': 'ㄴ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ',
    'ㄷ': 'ㄷ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ', 'ㄹ': 'ㄹ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ',
    'ㄾ': 'ㄹ', 'ㅀ': 'ㄹ', 'ㅁ': 'ㅁ', 'ㄻ': 'ㅁ', 'ㅂ': 'ㅂ', 'ㅍ': 'ㅂ', 'ㅄ': 'ㅂ', 'ㄿ': 'ㅂ', 'ㅇ': 'ㅇ', '': '' };
  // compound final -> [stays, moves to next syllable before a vowel]
  var SPLIT = { 'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'],
    'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅄ': ['ㅂ', 'ㅅ'] };
  var NASAL = { 'ㄱ': 'ㅇ', 'ㄷ': 'ㄴ', 'ㅂ': 'ㅁ' };

  function isHangulSyllable(ch) {
    var c = ch.charCodeAt(0);
    return c >= 0xAC00 && c <= 0xD7A3;
  }

  function decompose(ch) {
    var i = ch.charCodeAt(0) - 0xAC00;
    return { L: L_LIST.charAt(Math.floor(i / 588)), V: Math.floor((i % 588) / 28), T: T_LIST[i % 28] };
  }

  // Morphemes that start with an inserted ㄴ after a consonant inside a number word
  // (standard pronunciation rule 29): 십육 [심뉵], 백육 [뱅뉵], 천육 [천뉵], 열여섯 [열려섣],
  // 스물일곱 [스물릴곱], 서른여덟 [서른녀덜].
  var N_INSERT = ['육', '여섯', '여덟', '일곱'];

  // One word (no spaces, Hangul only) -> RR of its standard pronunciation.
  function romanizeWord(word) {
    var syl = [];
    for (var i = 0; i < word.length; i++) syl.push(decompose(word.charAt(i)));
    for (var j = 0; j + 1 < syl.length; j++) {
      var a = syl[j], b = syl[j + 1];
      var rest = word.slice(j + 1);
      if (a.T !== '' && b.L === 'ㅇ') {
        for (var k = 0; k < N_INSERT.length; k++) {
          if (rest.indexOf(N_INSERT[k]) === 0) { b.L = 'ㄴ'; break; }
        }
      }
      if (b.L === 'ㅇ') {
        // liaison: the final consonant moves to the empty initial
        if (a.T === '' || a.T === 'ㅇ') continue;
        if (a.T === 'ㅎ') { a.T = ''; continue; }
        if (a.T === 'ㄶ') { a.T = ''; b.L = 'ㄴ'; continue; }
        if (a.T === 'ㅀ') { a.T = ''; b.L = 'ㄹ'; continue; }
        if (SPLIT[a.T]) { b.L = SPLIT[a.T][1]; a.T = SPLIT[a.T][0]; continue; }
        b.L = a.T; a.T = '';
        continue;
      }
      a.T = NEUTRAL[a.T];
      if (b.L === 'ㄹ') {
        if (a.T === 'ㄴ') a.T = 'ㄹ';                       // ㄴ+ㄹ -> [ㄹㄹ]
        else if (a.T !== '' && a.T !== 'ㄹ') b.L = 'ㄴ';   // ㅁ/ㅇ/ㄱ/ㅂ + ㄹ -> ㄴ
      }
      if ((b.L === 'ㄴ' || b.L === 'ㅁ') && NASAL[a.T]) a.T = NASAL[a.T]; // nasalization
      if (a.T === 'ㄹ' && b.L === 'ㄴ') b.L = 'ㄹ';          // ㄹ+ㄴ -> [ㄹㄹ]
    }
    var out = '';
    for (var m = 0; m < syl.length; m++) {
      var s = syl[m];
      s.T = NEUTRAL[s.T];
      var prevT = m > 0 ? syl[m - 1].T : '';
      out += (s.L === 'ㄹ' && prevT === 'ㄹ') ? 'l' : RR_L[s.L];
      out += RR_V[s.V] + RR_T[s.T];
    }
    return out;
  }

  // Romanize a space-separated Korean phrase word by word. Non-Hangul text is kept as is.
  function romanize(text) {
    return str(text).split(/(\s+)/).map(function (w) {
      if (/^\s*$/.test(w)) return w;
      for (var i = 0; i < w.length; i++) if (!isHangulSyllable(w.charAt(i))) return letterByLetter(w);
      return romanizeWord(w);
    }).join('');
  }

  // Syllable-by-syllable transliteration with no sound changes (used when digits are
  // spoken one at a time, e.g. phone numbers).
  function letterByLetter(text, sep) {
    sep = sep == null ? '' : sep;
    return str(text).split(/(\s+)/).map(function (w) {
      if (/^\s*$/.test(w)) return w;
      var parts = [];
      for (var i = 0; i < w.length; i++) {
        var ch = w.charAt(i);
        if (!isHangulSyllable(ch)) { parts.push(ch); continue; }
        var s = decompose(ch);
        parts.push(RR_L[s.L] + RR_V[s.V] + RR_T[NEUTRAL[s.T]]);
      }
      return parts.join(sep);
    }).join('');
  }

  // ---------------------------------------------------------------- number input

  function parseNumber(input) {
    var s = norm(input);
    if (s === '') return { ok: false, empty: true, error: 'Type a whole number, e.g. 35000.' };
    if (/^-\s*\d/.test(s)) {
      return { ok: false, error: 'Negative numbers are not supported. (Korean says 마이너스 before the number: −5 = 마이너스 오.)' };
    }
    if (/\d\s*\.\s*\d/.test(s) || /^\.\d/.test(s)) {
      return { ok: false, error: 'Only whole numbers are supported, no decimals. (If the dot is a thousands separator, use a comma or leave it out.)' };
    }
    var g = joinGroups(stripCurrency(s.replace(/^\+/, '')));
    if (!g.ok) {
      return { ok: false, error: '“' + g.bad + '”: separators must split the digits into groups of three, e.g. 1,234,567.' };
    }
    var compact = g.text;
    if (!/^\d+$/.test(compact)) {
      return { ok: false, error: 'Use digits only, e.g. 35000 or 35,000. To read Korean text like 3만 5천원, use the price box below.' };
    }
    var d = stripZeros(compact);
    if (d.length > MAX_DIGITS) {
      return { ok: false, error: 'Too large: this tool reads numbers up to 9,999,999,999,999,999 (9999조 …).' };
    }
    return { ok: true, digits: d, formatted: groupThousands(d) };
  }

  function readNumber(input) {
    var p = parseNumber(input);
    if (!p.ok) return p;
    var k = sino(p.digits);
    var r = { ok: true, digits: p.digits, formatted: p.formatted, sino: k, sinoRoman: romanize(k), native: null };
    var n = p.digits.length <= 3 ? +p.digits : Infinity;
    if (n >= 1 && n <= 99) {
      var nat = native(n);
      r.native = {
        base: nat.base, baseRoman: romanize(nat.base),
        counter: nat.counter, counterRoman: romanize(nat.counter), changes: nat.changes
      };
    } else if (n === 0) {
      r.nativeNote = 'Native Korean has no word for zero. Use 영 (or 공 when reading digits, e.g. phone numbers).';
    } else {
      r.nativeNote = 'Learn native Korean numbers from 1 to 99. For 100 and above, use Sino-Korean units such as 백 and 천: 백 개 (100 items), 백 명 (100 people). When counting, the last part may still be native.';
    }
    return r;
  }

  // ---------------------------------------------------------------- prices

  function price(value) {
    return sino(value) + ' 원';
  }

  var P_DIGIT = { '영': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9 };
  var P_SMALL = { '십': 10, '백': 100, '천': 1000 };
  var P_BIG = { '만': 1, '억': 2, '조': 3 }; // power of 10000

  function parsePrice(input) {
    var s = norm(input);
    if (s === '') return { ok: false, empty: true, error: 'Type a price in Korean, e.g. 삼만오천원 or 3만 5천원.' };
    var fail = function (msg) {
      if (/[하둘셋넷섯곱덟홉열스물흔른쉰순든한두세네]/.test(s)) {
        msg += ' Prices use Sino-Korean numbers (일, 이, 삼, 사 …), not native ones (한, 두, 세, 네 …).';
      }
      return { ok: false, error: msg };
    };
    if (/^-/.test(s)) return fail('Negative prices are not supported.');
    if (/\d\s*\.\s*\d/.test(s)) return fail('Decimals like 3.5만 are not supported. Write 3만 5천 instead.');
    var g = joinGroups(stripCurrency(s));
    if (!g.ok) {
      return fail('“' + g.bad + '” is not one number: separators must split the digits into groups of three (35,000), and two numbers cannot stand side by side.');
    }
    var t = g.text.replace(/\s+/g, '');
    if (t === '') return fail('No number found.');

    var total = BigInt(0), group = 0, cur = null, curArabic = false, limit = 10000;
    var lastBig = 4, sawUnit = false, groupHasContent = false;
    var i = 0;
    while (i < t.length) {
      var ch = t.charAt(i);
      if (/\d/.test(ch)) {
        var m = /^\d+/.exec(t.slice(i))[0];
        if (cur !== null) return fail('Two numbers in a row near “' + m + '”.');
        var dm = stripZeros(m);
        if (dm.length > MAX_DIGITS) return fail('Number too large.');
        cur = dm.length > 6 ? dm : +dm; curArabic = true;
        i += m.length;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(P_DIGIT, ch)) {
        if (cur !== null) return fail('Two digits in a row near “' + ch + '” (e.g. 삼오 is not a number; write 삼십오).');
        if (ch === '영' && (t.length > 1)) return fail('영 (zero) can only stand alone.');
        cur = P_DIGIT[ch]; curArabic = false;
        i++;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(P_SMALL, ch)) {
        var u = P_SMALL[ch];
        if (u >= limit) return fail('“' + ch + '” is out of order (units must go from big to small, e.g. 천백십).');
        var mult = cur === null ? 1 : cur;
        if (typeof mult !== 'number' || mult < 1 || mult > 9) {
          return fail('Only a single digit 1-9 can come before “' + ch + '” (e.g. 3만 5천, not 35천).');
        }
        group += mult * u; limit = u; cur = null; groupHasContent = true; sawUnit = true;
        i++;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(P_BIG, ch)) {
        var p = P_BIG[ch];
        if (p >= lastBig) return fail('“' + ch + '” is out of order (조 → 억 → 만, each at most once).');
        var gv = group;
        if (cur !== null) {
          if (typeof cur !== 'number' || cur >= limit) return fail('The number before “' + ch + '” must be below 10,000 and fit after the units before it.');
          if (cur === 0) return fail('0 cannot come before “' + ch + '”.');
          gv += cur;
        } else if (!groupHasContent) {
          gv = 1; // bare 만 = 10,000 (also accepts 억, 조 alone)
        }
        total += BigInt(gv) * (BigInt(10000) ** BigInt(p));
        lastBig = p; group = 0; cur = null; limit = 10000; groupHasContent = false; sawUnit = true;
        i++;
        continue;
      }
      return fail('Unexpected “' + ch + '”. Use Korean number words (일 … 구, 십, 백, 천, 만, 억, 조), digits, and 원.');
    }
    if (cur !== null) {
      if (sawUnit && (typeof cur !== 'number' || cur >= limit)) {
        return fail('The last number is too big for its place (e.g. 3만 5000 is fine, 3만 50000 is not).');
      }
      total += BigInt(group) + BigInt(cur);
    } else {
      total += BigInt(group);
    }
    if (total >= BigInt(10) ** BigInt(MAX_DIGITS)) return fail('Number too large.');
    var digits = total.toString();
    return { ok: true, digits: digits, formatted: groupThousands(digits), reading: price(digits), roman: romanize(price(digits)) };
  }

  // ---------------------------------------------------------------- time

  function nativeHour(h12) { return native(h12).counter; }

  function parseTime(input) {
    var s = norm(input).toLowerCase();
    if (s === '') return { ok: false, empty: true, error: 'Type a time, e.g. 15:45 or 3:45 pm.' };
    var ap = null;
    var mAp = /^(.*?)\s*([ap])\.?\s*m\.?$/.exec(s);
    if (mAp) { ap = mAp[2]; s = mAp[1]; }
    var mKo = /^(오전|오후)\s*(.*)$/.exec(s);
    if (mKo) {
      if (ap) return { ok: false, error: 'Use either 오전/오후 or am/pm, not both.' };
      ap = mKo[1] === '오전' ? 'a' : 'p'; s = mKo[2];
    }
    var h, m, mm;
    if ((mm = /^(\d{1,2})\s*시(?:\s*(?:(반)|(\d{1,2})\s*분))?$/.exec(s))) { h = +mm[1]; m = mm[2] ? 30 : mm[3] ? +mm[3] : 0; }
    else if ((mm = /^(\d{1,2})\s*[:h.]\s*(\d{2})$/.exec(s))) { h = +mm[1]; m = +mm[2]; }
    else if ((mm = /^(\d{1,2})(\d{2})$/.exec(s))) { h = +mm[1]; m = +mm[2]; }
    else if (ap && (mm = /^(\d{1,2})$/.exec(s))) { h = +mm[1]; m = 0; }
    else return { ok: false, error: 'Use HH:MM (24-hour, e.g. 15:45), add am/pm (3:45 pm), or write 오후 3시 45분.' };
    if (m > 59) return { ok: false, error: 'Minutes must be 00-59.' };
    if (ap) {
      if (h < 1 || h > 12) return { ok: false, error: 'With am/pm or 오전/오후 the hour must be 1-12.' };
      h = (h % 12) + (ap === 'p' ? 12 : 0);
    } else if (h > 23) {
      return { ok: false, error: 'Hours must be 0-23 (24:00 is written 0:00).' };
    }
    return { ok: true, h: h, m: m };
  }

  function readTime(input) {
    var p = parseTime(input);
    if (!p.ok) return p;
    var h = p.h, m = p.m;
    var h12 = h % 12 === 0 ? 12 : h % 12;
    var period = h < 12 ? '오전' : '오후';
    var hourWords = nativeHour(h12) + ' 시';
    var minWords = m === 0 ? '' : ' ' + sino(m) + ' 분';
    var plain = hourWords + minWords;
    var r = {
      ok: true, h: h, m: m, period: period,
      hhmm: (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m,
      plain: plain,
      withPeriod: period + ' ' + plain,
      half: m === 30 ? hourWords + ' 반' : null,
      halfWithPeriod: m === 30 ? period + ' ' + hourWords + ' 반' : null,
      special: (h === 0 && m === 0) ? '자정' : (h === 12 && m === 0) ? '정오' : null,
      h24: (h === 0 || h >= 13) ? sino(h) + ' 시' + minWords : null
    };
    ['plain', 'withPeriod', 'half', 'halfWithPeriod', 'special', 'h24'].forEach(function (k) {
      r[k + 'Roman'] = r[k] ? romanize(r[k]) : null;
    });
    return r;
  }

  // ---------------------------------------------------------------- phone

  function readPhone(input) {
    var s = norm(input);
    if (s === '') return { ok: false, empty: true, error: 'Type a phone number, e.g. 010-1234-5678.' };
    if (/^\+/.test(s)) {
      return { ok: false, error: 'Leave out the + and the country code (Korean numbers start with 0, e.g. 010-…). “+” itself is read 플러스.' };
    }
    if (/[^\d\s\-.()\/]/.test(s)) return { ok: false, error: 'Use digits with optional dashes or spaces, e.g. 010-1234-5678.' };
    var groups = s.split(/[^\d]+/).filter(Boolean);
    var count = groups.join('').length;
    if (count === 0) return { ok: false, error: 'No digits found.' };
    if (count > 20) return { ok: false, error: 'Too many digits (max 20).' };
    var ko = groups.map(function (g) {
      return g.split('').map(function (c) { return PHONE_DIGITS[+c]; }).join('');
    });
    return {
      ok: true, groups: groups,
      korean: ko.join(' '),
      roman: ko.map(function (w) { return letterByLetter(w, '-'); }).join(' ')
    };
  }

  return {
    MAX_DIGITS: MAX_DIGITS,
    sino: sino,
    native: native,
    price: price,
    romanize: romanize,
    letterByLetter: letterByLetter,
    parseNumber: parseNumber,
    readNumber: readNumber,
    parsePrice: parsePrice,
    parseTime: parseTime,
    readTime: readTime,
    readPhone: readPhone
  };
}));
