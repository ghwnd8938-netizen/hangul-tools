/*
 * 초성 추출 · 초성 검색 정규식 - 순수 로직 (브라우저: window.Chosung, Node: require())
 * 외부 요청 없음. 입력한 글은 이 파일 밖으로 나가지 않습니다.
 *
 * 원리: 현대 한글 음절 11,172자는 U+AC00(가)~U+D7A3(힣)에
 *   코드 = 0xAC00 + (초성 × 21 + 중성) × 28 + 종성
 * 순서로 배열되어 있습니다. 따라서 초성 번호 = floor((코드 - 0xAC00) / 588)이고,
 * 같은 초성으로 시작하는 음절은 588자씩 연속된 범위를 이룹니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Chosung = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var S_BASE = 0xAC00, S_LAST = 0xD7A3;
  var L_BASE = 0x1100, V_BASE = 0x1161, T_BASE = 0x11A7;
  var L_COUNT = 19, V_COUNT = 21, T_COUNT = 28;
  var N_COUNT = V_COUNT * T_COUNT; // 588: 초성 하나에 속한 음절 수

  // 초성 19자 (호환용 자모 U+3131~): ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ
  var CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅ' +
    'ㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

  function toText(t) {
    return t == null ? '' : String(t);
  }

  function isSyllable(c) {
    return c >= S_BASE && c <= S_LAST;
  }

  function isLeadJamo(c) { return c >= L_BASE && c < L_BASE + L_COUNT; }
  function isVowelJamo(c) { return c >= V_BASE && c < V_BASE + V_COUNT; }
  function isTailJamo(c) { return c > T_BASE && c < T_BASE + T_COUNT; }

  /*
   * 첫가끝 자모(U+1100대)로 풀어 쓴 현대 한글(NFD, macOS 파일 이름 등)을 완성형 음절로 합칩니다.
   * String.prototype.normalize('NFC')와 달리 한글이 아닌 글자(예: CJK 호환 한자)는 건드리지 않습니다.
   */
  function composeHangul(text) {
    var s = toText(text);
    if (!/[\u1100-\u11FF]/.test(s)) return s;
    var out = [], i = 0, n = s.length;
    while (i < n) {
      var c = s.charCodeAt(i);
      var next = i + 1 < n ? s.charCodeAt(i + 1) : -1;
      if (isLeadJamo(c) && isVowelJamo(next)) {
        var code = S_BASE + ((c - L_BASE) * V_COUNT + (next - V_BASE)) * T_COUNT;
        i += 2;
        var t = i < n ? s.charCodeAt(i) : -1;
        if (isTailJamo(t)) { code += t - T_BASE; i++; }
        out.push(String.fromCharCode(code));
      } else if (isSyllable(c) && (c - S_BASE) % T_COUNT === 0 && isTailJamo(next)) {
        // 받침 없는 완성형 음절 + 종성 자모 → 받침 있는 음절
        out.push(String.fromCharCode(c + (next - T_BASE)));
        i += 2;
      } else {
        out.push(s.charAt(i));
        i++;
      }
    }
    return out.join('');
  }

  // 한글 자모로 보는 범위 (‘한글이 아닌 글자 빼기’에서 남깁니다)
  function isHangulJamo(c) {
    return (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3131 && c <= 0x318E) ||
      (c >= 0xA960 && c <= 0xA97F) || (c >= 0xD7B0 && c <= 0xD7FF) ||
      (c >= 0xFFA0 && c <= 0xFFDC);
  }

  function chosungIndex(code) {
    return Math.floor((code - S_BASE) / N_COUNT);
  }

  /*
   * getChosung(text, { keepOther }) → string
   *   완성형 한글 음절을 초성(호환용 자모)으로 바꿉니다.
   *   keepOther (기본 true): 한글 음절이 아닌 글자를 그대로 둡니다.
   *   keepOther: false → 한글 음절이 아닌 글자를 지우되, 줄바꿈(CR, LF)과 한글 낱자모(ㅋ, ㅠ 등)는 남깁니다.
   */
  function getChosung(text, options) {
    var keepOther = !(options && options.keepOther === false);
    var s = composeHangul(text);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (isSyllable(c)) {
        out.push(CHOSUNG.charAt(chosungIndex(c)));
      } else if (keepOther || c === 0x0A || c === 0x0D || isHangulJamo(c)) {
        out.push(s.charAt(i));
      }
      // 그 밖의 글자(서로게이트 쌍의 두 반쪽 포함)는 함께 버려지므로 쌍이 깨지지 않습니다.
    }
    return out.join('');
  }

  // 초성 i(0~18)로 시작하는 음절 범위 [첫 글자, 끝 글자]
  function syllableRange(i) {
    var first = S_BASE + i * N_COUNT;
    return [String.fromCharCode(first), String.fromCharCode(first + N_COUNT - 1)];
  }

  function initialClass(i) {
    var r = syllableRange(i);
    return '[' + CHOSUNG.charAt(i) + r[0] + '-' + r[1] + ']';
  }

  // 겹자음 낱자(호환용 자모) → 두 초성. 입력기가 ㄱ+ㅅ을 ㄳ으로 합쳐 버리는 경우를 위해 씁니다.
  var COMPOUND = {
    '\u3133': '\u3131\u3145', // ㄳ = ㄱㅅ
    '\u3135': '\u3134\u3148', // ㄵ = ㄴㅈ
    '\u3136': '\u3134\u314E', // ㄶ = ㄴㅎ
    '\u313A': '\u3139\u3131', // ㄺ = ㄹㄱ
    '\u313B': '\u3139\u3141', // ㄻ = ㄹㅁ
    '\u313C': '\u3139\u3142', // ㄼ = ㄹㅂ
    '\u313D': '\u3139\u3145', // ㄽ = ㄹㅅ
    '\u313E': '\u3139\u314C', // ㄾ = ㄹㅌ
    '\u313F': '\u3139\u314D', // ㄿ = ㄹㅍ
    '\u3140': '\u3139\u314E', // ㅀ = ㄹㅎ
    '\u3144': '\u3142\u3145'  // ㅄ = ㅂㅅ
  };

  // 정규식 특수 문자. u 플래그에서도 유효한 이스케이프만 씁니다('-'는 바깥에서 특수 문자가 아니므로 제외).
  var META = /[\\^$.*+?()[\]{}|\/]/;

  function escapeChar(ch) {
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    // 줄 구분 문자는 소스에 그대로 두면 오래된 브라우저에서 문법 오류가 나므로 이스케이프로 씁니다.
    if (ch === '\u2028') return '\\u2028';
    if (ch === '\u2029') return '\\u2029';
    return META.test(ch) ? '\\' + ch : ch;
  }

  /*
   * chosungRegexSource(query, { prefix }) → string (JavaScript 정규식 소스)
   *   초성 자모 → [초성 + 그 초성으로 시작하는 음절 범위] (예: ㄱ → [ㄱ가-깋])
   *   겹자음 낱자 → 그 낱자 또는 두 초성 (예: ㄳ → (?:ㄳ|[ㄱ가-깋][ㅅ사-싷]))
   *     한글 입력기는 ㄱ 다음에 ㅅ을 치면 ㄳ 한 글자로 합치는 경우가 많기 때문입니다.
   *   완성형 음절 → 그 글자 그대로
   *   그 밖의 글자 → 정규식 특수 문자를 이스케이프한 그대로
   *   prefix: true → 맨 앞에 ^ (문자열 처음부터 일치)
   */
  function chosungRegexSource(query, options) {
    var s = composeHangul(query);
    var parts = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var c = s.charCodeAt(i);
      var idx = (c >= 0x3131 && c <= 0x314E) ? CHOSUNG.indexOf(ch) : -1;
      if (idx >= 0) {
        parts.push(initialClass(idx));
      } else if (COMPOUND.hasOwnProperty(ch)) {
        // 겹자음 낱자(ㄳ 등): 그 글자 자체, 또는 두 초성이 이어진 것
        var pair = COMPOUND[ch];
        parts.push('(?:' + ch + '|' + initialClass(CHOSUNG.indexOf(pair.charAt(0))) +
          initialClass(CHOSUNG.indexOf(pair.charAt(1))) + ')');
      } else {
        parts.push(escapeChar(ch));
      }
    }
    return (options && options.prefix ? '^' : '') + parts.join('');
  }

  function toLines(lines) {
    if (Array.isArray(lines)) return lines;
    var s = toText(lines);
    if (s === '') return [];
    return s.split(/\r\n|\r|\n/);
  }

  /*
   * matchList(query, lines, { prefix }) → string[]
   *   lines(배열 또는 줄바꿈으로 구분된 문자열) 중 정규식에 일치하는 줄을 원래 모습 그대로 돌려줍니다.
   *   풀어 쓴 자모(NFD)로 된 줄도 합친 뒤 검사합니다. 빈 검색어는 모든 줄에 일치합니다.
   */
  function matchList(query, lines, options) {
    var re = new RegExp(chosungRegexSource(query, options));
    var list = toLines(lines);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var line = toText(list[i]);
      if (re.test(composeHangul(line))) out.push(line);
    }
    return out;
  }

  /*
   * highlightParts(query, line, { prefix }) → null | [{ text, hit }]
   *   일치하지 않으면 null. 일치하면 줄(자모 합친 형태)을 일치 부분(hit: true)과 나머지로 나눕니다.
   *   빈 검색어는 일치로 보고 강조 없이 줄 전체를 돌려줍니다.
   */
  function highlightParts(query, line, options) {
    var s = composeHangul(line);
    if (composeHangul(query) === '') return [{ text: s, hit: false }];
    var re = new RegExp(chosungRegexSource(query, options), 'g');
    var parts = [], last = 0, found = false, m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      found = true;
      if (m.index > last) parts.push({ text: s.slice(last, m.index), hit: false });
      parts.push({ text: m[0], hit: true });
      last = m.index + m[0].length;
    }
    if (!found) return null;
    if (last < s.length) parts.push({ text: s.slice(last), hit: false });
    return parts;
  }

  /*
   * 스프레드시트 수식 (A1 셀의 글 → 초성). 계산 규칙은 getChosung과 같습니다(단, 풀어 쓴 자모는 합치지 않음).
   *   Excel: LET·SEQUENCE·TEXTJOIN·UNICODE 필요 → Microsoft 365, Excel 2021 이상, 웹용 Excel
   *   Google 스프레드시트: 같은 수식을 ARRAYFORMULA로 감쌈
   * LET 이름은 Excel 규칙상 c, r이나 셀 주소처럼 보이는 이름을 쓸 수 없어 chars, codes로 했습니다.
   */
  var FORMULA_CORE = 'LET(chars,MID(A1,SEQUENCE(LEN(A1)),1),codes,IFERROR(UNICODE(chars),0),' +
    'TEXTJOIN("",FALSE,IF((codes>=44032)*(codes<=55203),MID("' + CHOSUNG +
    '",INT((codes-44032)/588)+1,1),chars)))';
  var EXCEL_FORMULA = '=IF(A1="","",' + FORMULA_CORE + ')';
  var SHEETS_FORMULA = '=IF(A1="","",ARRAYFORMULA(' + FORMULA_CORE + '))';

  return {
    CHOSUNG: CHOSUNG,
    EXCEL_FORMULA: EXCEL_FORMULA,
    SHEETS_FORMULA: SHEETS_FORMULA,
    composeHangul: composeHangul,
    getChosung: getChosung,
    syllableRange: syllableRange,
    chosungRegexSource: chosungRegexSource,
    matchList: matchList,
    highlightParts: highlightParts
  };
}));
