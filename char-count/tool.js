/*
 * 자소서 글자수 세기 - 순수 계산 로직 (브라우저: window.CharCount, Node: require())
 * 외부 요청 없음. 입력한 글은 이 파일 밖으로 나가지 않습니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CharCount = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * "공백"으로 보는 문자 (모두 BMP 안의 문자라 UTF-16 코드 단위 하나로 판별 가능):
   *   U+0009 탭, U+000A LF, U+000B VT, U+000C FF, U+000D CR, U+0020 스페이스,
   *   U+0085 NEL, U+00A0 NBSP, U+1680, U+2000~U+200A(각종 너비 공백),
   *   U+2028/U+2029(줄/문단 구분자), U+202F(좁은 NBSP), U+205F, U+3000(전각 공백),
   *   U+FEFF(BOM/폭 없는 NBSP).
   * 폭 없는 공백 U+200B, ZWJ U+200D 등은 유니코드상 공백(White_Space)이 아니므로 글자로 셉니다.
   */
  function isSpaceCode(c) {
    if (c <= 0x20) return c === 0x20 || (c >= 0x09 && c <= 0x0d);
    if (c < 0x85) return false;
    return c === 0x85 || c === 0xa0 || c === 0x1680 ||
      (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
      c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
  }

  function isSpaceString(s) {
    if (s.length === 0) return false;
    for (var i = 0; i < s.length; i++) {
      if (!isSpaceCode(s.charCodeAt(i))) return false;
    }
    return true;
  }

  function toText(text) {
    return text == null ? '' : String(text);
  }

  // 줄바꿈 정규화: CRLF, CR, LF 를 모두 한 번의 줄바꿈(LF)으로 봅니다.
  function normalizeNewlines(text) {
    return text.replace(/\r\n?/g, '\n');
  }

  // 줄바꿈 한 번을 몇 자(바이트)로 셀지: 0, 1(기본), 2. 그 밖의 값은 1.
  function newlineWeight(v) {
    if (v === 0 || v === 1 || v === 2) return v;
    if (v === '0' || v === '1' || v === '2') return Number(v);
    return 1;
  }

  /* ---------- 글자(그래핌) 분리 ---------- */

  var nativeSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      nativeSegmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
    }
  } catch (e) {
    nativeSegmenter = null;
  }

  var MARK_RE = null;
  var PICTO_RE = null;
  try {
    MARK_RE = new RegExp('^\\p{M}$', 'u');
    PICTO_RE = new RegExp('^\\p{Extended_Pictographic}$', 'u');
  } catch (e) {
    MARK_RE = null;
    PICTO_RE = null;
  }

  function isMarkFallback(cp) {
    // 유니코드 속성 정규식이 없는 아주 오래된 환경용 최소 범위
    return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
      (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) ||
      (cp >= 0xfe20 && cp <= 0xfe2f) || (cp >= 0x302a && cp <= 0x302f) ||
      cp === 0x3099 || cp === 0x309a;
  }

  // 근사 그래핌 분류 (Intl.Segmenter 가 없을 때만 사용)
  var K_OTHER = 0, K_CONTROL = 1, K_EXTEND = 2, K_ZWJ = 3, K_RI = 4,
    K_L = 5, K_V = 6, K_T = 7, K_LV = 8, K_LVT = 9, K_PICTO = 10;

  function kindOf(cp, ch) {
    if (cp === 0x200d) return K_ZWJ;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0x2028 || cp === 0x2029) return K_CONTROL;
    if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) ||
      (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f) || cp === 0x200c ||
      cp === 0x0e33 || cp === 0x0eb3) return K_EXTEND; // 태국·라오 SARA AM 은 SpacingMark
    if (MARK_RE ? MARK_RE.test(ch) : isMarkFallback(cp)) return K_EXTEND;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return K_RI;
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xa960 && cp <= 0xa97c)) return K_L;
    if ((cp >= 0x1160 && cp <= 0x11a7) || (cp >= 0xd7b0 && cp <= 0xd7c6)) return K_V;
    if ((cp >= 0x11a8 && cp <= 0x11ff) || (cp >= 0xd7cb && cp <= 0xd7fb)) return K_T;
    if (cp >= 0xac00 && cp <= 0xd7a3) return ((cp - 0xac00) % 28 === 0) ? K_LV : K_LVT;
    if (PICTO_RE && PICTO_RE.test(ch)) return K_PICTO;
    return K_OTHER;
  }

  function shouldJoin(prev, cur, riOdd, pictoBeforeZwj) {
    if (prev === K_CONTROL || cur === K_CONTROL) return false;
    if (cur === K_EXTEND || cur === K_ZWJ) return true;
    if (prev === K_L && (cur === K_L || cur === K_V || cur === K_LV || cur === K_LVT)) return true;
    if ((prev === K_LV || prev === K_V) && (cur === K_V || cur === K_T)) return true;
    if ((prev === K_LVT || prev === K_T) && cur === K_T) return true;
    if (prev === K_ZWJ && cur === K_PICTO && pictoBeforeZwj) return true;
    if (prev === K_RI && cur === K_RI && riOdd) return true;
    return false;
  }

  function fallbackGraphemes(text) {
    var out = [];
    var cur = '';
    var prevKind = -1;
    var riCount = 0;          // 현재 클러스터 안의 연속 국기 문자 수
    var clusterHasPicto = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      var ch = text.charAt(i);
      var cp = c;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          cp = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
          ch = text.substr(i, 2);
          i++;
        }
      }
      var kind = kindOf(cp, ch);
      if (cur !== '' && shouldJoin(prevKind, kind, riCount % 2 === 1, clusterHasPicto)) {
        cur += ch;
      } else {
        if (cur !== '') out.push(cur);
        cur = ch;
        riCount = 0;
        clusterHasPicto = false;
      }
      if (kind === K_RI) riCount++;
      if (kind === K_PICTO) clusterHasPicto = true;
      // 확장 문자는 앞 문자의 종류(예: 그림 문자, 한글 자모)를 이어받음
      if (kind !== K_EXTEND) prevKind = kind;
      else if (prevKind === K_CONTROL || prevKind === -1) prevKind = K_OTHER;
    }
    if (cur !== '') out.push(cur);
    return out;
  }

  // 사용자에게 보이는 글자 단위로 나눕니다.
  // options.segmenter === false 이면 Intl.Segmenter 대신 근사 규칙을 씁니다(테스트용).
  function graphemes(text, options) {
    text = toText(text);
    var useNative = nativeSegmenter && !(options && options.segmenter === false);
    if (!useNative) return fallbackGraphemes(text);
    var out = [];
    var it = nativeSegmenter.segment(text)[Symbol.iterator]();
    for (var step = it.next(); !step.done; step = it.next()) out.push(step.value.segment);
    return out;
  }

  function forEachGrapheme(text, fn, useNative) {
    if (useNative) {
      var it = nativeSegmenter.segment(text)[Symbol.iterator]();
      for (var step = it.next(); !step.done; step = it.next()) fn(step.value.segment);
    } else {
      var list = fallbackGraphemes(text);
      for (var i = 0; i < list.length; i++) fn(list[i]);
    }
  }

  /* ---------- 글자수 계산 ---------- */

  function count(text, options) {
    var t = normalizeNewlines(toText(text));
    var nl = newlineWeight(options && options.newline);
    var useNative = !!nativeSegmenter && !(options && options.segmenter === false);

    var visible = 0;        // 줄바꿈을 뺀 글자 수
    var nonSpace = 0;       // 공백이 아닌 글자 수
    var newlines = 0;

    // ASCII 만 있는 글은 코드 단위 하나가 곧 한 글자이므로 빠르게 처리
    var asciiOnly = !/[^\x00-\x7f]/.test(t);
    if (asciiOnly) {
      for (var a = 0; a < t.length; a++) {
        var ac = t.charCodeAt(a);
        if (ac === 0x0a) { newlines++; continue; }
        visible++;
        if (!isSpaceCode(ac)) nonSpace++;
      }
    } else {
      forEachGrapheme(t, function (g) {
        if (g === '\n') { newlines++; return; }
        visible++;
        if (!isSpaceString(g)) nonSpace++;
      }, useNative);
    }

    var utf8 = 0;
    var euc = 0;
    var words = 0;
    var inWord = false;
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (isSpaceCode(c)) {
        inWord = false;
      } else if (!inWord) {
        inWord = true;
        words++;
      }
      if (c === 0x0a) continue; // 줄바꿈은 아래에서 옵션대로 더함
      // 한글 2바이트 방식: UTF-16 코드 단위마다 ASCII 면 1, 아니면 2.
      // (자바스크립트에서 charCodeAt(i) > 127 ? 2 : 1 로 세는 방식과 같아서
      //  이모지처럼 서로게이트 쌍인 문자는 4바이트. EUC-KR 에 없는 문자이므로 넉넉하게 셉니다.)
      if (c < 0x80) {
        utf8 += 1; euc += 1;
      } else if (c < 0x800) {
        utf8 += 2; euc += 2;
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length &&
        t.charCodeAt(i + 1) >= 0xdc00 && t.charCodeAt(i + 1) <= 0xdfff) {
        utf8 += 4; euc += 4; i++;
      } else {
        // 나머지 BMP 문자. 짝 없는 서로게이트는 UTF-8 로 보낼 때 U+FFFD(3바이트)로 바뀝니다.
        utf8 += 3; euc += 2;
      }
    }

    return {
      withSpaces: visible + newlines * nl,
      withoutSpaces: nonSpace,
      words: words,
      lines: t.length === 0 ? 0 : newlines + 1,
      utf8Bytes: utf8 + newlines * nl,
      eucKrBytes: euc + newlines * nl
    };
  }

  /* ---------- 공백·줄바꿈 정리 ---------- */

  // 1) 줄바꿈을 LF 로 통일  2) 각 줄 끝 공백 제거
  // 3) 연속된 빈 줄은 1줄로  4) 글 앞뒤의 빈 줄 제거
  // 줄 앞 들여쓰기와 문장 중간 띄어쓰기는 건드리지 않습니다.
  function tidy(text) {
    var lines = normalizeNewlines(toText(text)).split('\n');
    var out = [];
    var blankRun = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var end = line.length;
      while (end > 0 && isSpaceCode(line.charCodeAt(end - 1))) end--;
      line = line.slice(0, end);
      if (line === '') {
        if (out.length === 0) continue; // 맨 앞 빈 줄
        blankRun++;
        if (blankRun > 1) continue;
      } else {
        blankRun = 0;
      }
      out.push(line);
    }
    while (out.length && out[out.length - 1] === '') out.pop(); // 맨 뒤 빈 줄
    return out.join('\n');
  }

  /* ---------- 제한 대비 상태 ---------- */

  var MODES = {
    with: { key: 'withSpaces', unit: '자' },
    without: { key: 'withoutSpaces', unit: '자' },
    euckr: { key: 'eucKrBytes', unit: '바이트' },
    utf8: { key: 'utf8Bytes', unit: '바이트' }
  };

  // 제한 값 읽기: 숫자, 또는 "1,000" "500자" "1000바이트" "１０００" 같은 글.
  // 1 이상이 아니거나 알아볼 수 없으면 null.
  function parseLimit(limit) {
    var n;
    if (typeof limit === 'number') {
      n = Math.floor(limit);
    } else if (typeof limit === 'string') {
      var s = limit.replace(/[０-９]/g, function (d) {
        return String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30);
      }).replace(/[\s,，]/g, '').replace(/(자|글자|바이트|bytes?|b)$/i, '');
      if (!/^\d+(\.\d+)?$/.test(s)) return null;
      n = Math.floor(Number(s));
    } else {
      return null;
    }
    return isFinite(n) && n > 0 ? n : null;
  }

  // counts: count() 결과, limit: 양의 정수(또는 parseLimit 이 읽을 수 있는 글),
  // mode: 'with' | 'without' | 'euckr' | 'utf8'
  function limitStatus(counts, limit, mode) {
    var n = parseLimit(limit);
    if (n === null) return null;
    var m = MODES[mode] || MODES['with'];
    var used = (counts && counts[m.key]) || 0;
    var percent = used > n ? Math.ceil(used * 100 / n) : Math.floor(used * 100 / n);
    var level = used > n ? 'err' : (used * 10 >= n * 9 ? 'warn' : 'ok');
    return {
      used: used,
      limit: n,
      remaining: n - used,
      over: used > n ? used - n : 0,
      percent: percent,
      level: level,
      unit: m.unit
    };
  }

  return {
    count: count,
    tidy: tidy,
    limitStatus: limitStatus,
    parseLimit: parseLimit,
    graphemes: graphemes,
    isSpaceCode: isSpaceCode,
    nativeSegmenter: !!nativeSegmenter
  };
}));
