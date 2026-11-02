/*
 * CsvFix - 엑셀 CSV 한글 깨짐 고치기 (pure logic, no DOM)
 * UMD: <script src="tool.js"> -> window.CsvFix, require('./tool.js') -> module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CsvFix = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOM_UTF8 = [0xef, 0xbb, 0xbf];

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    }
    if (Array.isArray(input)) return Uint8Array.from(input);
    throw new TypeError('bytes must be a Uint8Array');
  }

  /* Strict UTF-8 scan (rejects overlongs, surrogates, > U+10FFFF).
   * multibyte = valid 2-4 byte sequences, wide = valid 3-4 byte sequences (Hangul, CJK, emoji...). */
  function scanUtf8(b, start) {
    var i = start || 0, n = b.length, errors = 0, multibyte = 0, wide = 0;
    while (i < n) {
      var c = b[i];
      if (c < 0x80) { i++; continue; }
      var need = 0, lo = 0x80, hi = 0xbf;
      if (c >= 0xc2 && c <= 0xdf) need = 1;
      else if (c === 0xe0) { need = 2; lo = 0xa0; }
      else if ((c >= 0xe1 && c <= 0xec) || c === 0xee || c === 0xef) need = 2;
      else if (c === 0xed) { need = 2; hi = 0x9f; }
      else if (c === 0xf0) { need = 3; lo = 0x90; }
      else if (c >= 0xf1 && c <= 0xf3) need = 3;
      else if (c === 0xf4) { need = 3; hi = 0x8f; }
      else { errors++; i++; continue; }
      var ok = i + need < n;
      if (ok) {
        var t = b[i + 1];
        if (t < lo || t > hi) ok = false;
        for (var k = 2; ok && k <= need; k++) {
          t = b[i + k];
          if (t < 0x80 || t > 0xbf) ok = false;
        }
      }
      if (ok) { multibyte++; if (need >= 2) wide++; i += need + 1; } else { errors++; i++; }
    }
    return { errors: errors, multibyte: multibyte, wide: wide };
  }

  /*
   * True when the two bytes (lead, trail) are a character in windows-949 as browsers decode it
   * (WHATWG index-euc-kr: KS X 1001 + UHC extension). Unassigned cells (user-defined rows C9/FE,
   * gaps in symbol rows A2-AF, C653-C6A0, trails below A1 after lead C7+) are rejected, so
   * "no errors" here means TextDecoder('euc-kr') produces no U+FFFD.
   */
  function cp949PairValid(c, t) {
    if (c < 0x81 || c > 0xfd || c === 0xc9) return false;
    if (c <= 0xc6 && ((t >= 0x41 && t <= 0x5a) || (t >= 0x61 && t <= 0x7a) || (t >= 0x81 && t <= 0xa0))) {
      return c !== 0xc6 || t <= 0x52;
    }
    if (t < 0xa1 || t > 0xfe) return false;
    switch (c) {
      case 0xa2: return t <= 0xe7;
      case 0xa5: return t <= 0xaa || (t >= 0xb0 && t <= 0xb9) || (t >= 0xc1 && t <= 0xd8) || (t >= 0xe1 && t <= 0xf8);
      case 0xa6: return t <= 0xe4;
      case 0xa7: return t <= 0xef;
      case 0xa8: return t <= 0xa4 || t === 0xa6 || (t >= 0xa8 && t <= 0xaf) || t >= 0xb1;
      case 0xaa: return t <= 0xf3;
      case 0xab: return t <= 0xf6;
      case 0xac: return t <= 0xc1 || (t >= 0xd1 && t <= 0xf1);
      case 0xad: case 0xae: case 0xaf: return false;
    }
    return true;
  }

  /* CP949 (windows-949 / UHC) scan against the browser's decoding table. */
  function scanCp949(b, start) {
    var i = start || 0, n = b.length, errors = 0, pairs = 0, hangul = 0;
    while (i < n) {
      var c = b[i];
      if (c < 0x80) { i++; continue; }
      if (i + 1 < n) {
        var t = b[i + 1];
        if (cp949PairValid(c, t)) {
          pairs++;
          // KS X 1001 Hangul block (B0A1-C8FE) or UHC extension Hangul (8141-C652)
          if ((c >= 0xb0 && c <= 0xc8 && t >= 0xa1) || (c <= 0xa0) || (c <= 0xc6 && t < 0xa1)) hangul++;
          i += 2;
          continue;
        }
      }
      errors++;
      i++;
    }
    return { errors: errors, pairs: pairs, hangul: hangul };
  }

  /**
   * detectEncoding(Uint8Array) -> { encoding, hasBom, confidence, asciiOnly }
   * encoding: 'utf-8' | 'euc-kr' (CP949) | 'utf-16le' | 'utf-16be'
   * confidence: 'high' | 'medium' | 'low'
   * Order: BOM (UTF-8 / UTF-16) -> UTF-16 without BOM (00-byte pattern) -> strictly valid UTF-8
   * -> valid CP949 -> whichever has the lower error rate (low confidence).
   */
  /*
   * UTF-16 without a BOM: ASCII characters (digits, commas, newlines) leave a 00 byte on the
   * same side of every code unit. Returns 'utf-16le' | 'utf-16be' | null. Text with almost no
   * ASCII (pure Hangul) cannot be recognised this way.
   */
  function guessUtf16(b) {
    var n = Math.min(b.length, 1 << 20) & ~1;
    if (n < 4) return null;
    var units = n / 2, z0 = 0, z1 = 0, i;
    for (i = 0; i < n; i += 2) {
      if (b[i] === 0) z0++;
      if (b[i + 1] === 0) z1++;
    }
    var le = z1 * 20 >= units && z0 * 4 <= z1;
    var be = z0 * 20 >= units && z1 * 4 <= z0;
    if (le === be) return null;
    // Must also be well-formed UTF-16 (surrogates paired); the last unit may be cut by the sample.
    for (i = 0; i < n; i += 2) {
      var u = le ? (b[i] | (b[i + 1] << 8)) : ((b[i] << 8) | b[i + 1]);
      if (u >= 0xd800 && u <= 0xdbff) {
        if (i + 2 >= n) break;
        var v = le ? (b[i + 2] | (b[i + 3] << 8)) : ((b[i + 2] << 8) | b[i + 3]);
        if (v < 0xdc00 || v > 0xdfff) return null;
        i += 2;
      } else if (u >= 0xdc00 && u <= 0xdfff) {
        return null;
      }
    }
    return le ? 'utf-16le' : 'utf-16be';
  }

  function detectEncoding(input) {
    var b = toBytes(input);
    var n = b.length;
    if (n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
      // A BOM followed by bytes that are not UTF-8 (corrupt file, or a BOM glued onto CP949).
      var ub = scanUtf8(b, 3);
      return { encoding: 'utf-8', hasBom: true, confidence: ub.errors ? 'low' : 'high', asciiOnly: false };
    }
    if (n >= 2 && b[0] === 0xff && b[1] === 0xfe) {
      return { encoding: 'utf-16le', hasBom: true, confidence: 'high', asciiOnly: false };
    }
    if (n >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      return { encoding: 'utf-16be', hasBom: true, confidence: 'high', asciiOnly: false };
    }
    var u16 = guessUtf16(b);
    if (u16) return { encoding: u16, hasBom: false, confidence: 'medium', asciiOnly: false };
    var u = scanUtf8(b, 0);
    if (u.errors === 0) {
      var conf = 'high';
      if (u.multibyte > 0 && u.wide === 0) {
        // Valid UTF-8 but with only 2-byte sequences (Latin accents, Greek, Cyrillic) and no
        // Hangul. Some short CP949 texts (e.g. "치킨" = C4A1 C5B2) look exactly like this.
        var k0 = scanCp949(b, 0);
        if (k0.errors === 0 && k0.pairs > 0 && k0.hangul * 2 >= k0.pairs) conf = 'low';
      }
      return { encoding: 'utf-8', hasBom: false, confidence: conf, asciiOnly: u.multibyte === 0 };
    }
    var k = scanCp949(b, 0);
    if (k.errors === 0) {
      var ratio = k.pairs ? k.hangul / k.pairs : 0;
      return { encoding: 'euc-kr', hasBom: false, confidence: ratio >= 0.5 ? 'high' : 'medium', asciiOnly: false };
    }
    // Neither decodes cleanly: pick the one with the lower error rate.
    var uRate = u.errors / (u.errors + u.multibyte);
    var kRate = k.errors / (k.errors + k.pairs);
    return {
      encoding: uRate <= kRate ? 'utf-8' : 'euc-kr',
      hasBom: false,
      confidence: 'low',
      asciiOnly: false
    };
  }

  function normalizeEncoding(enc) {
    var e = String(enc || '').toLowerCase().replace(/_/g, '-');
    if (e === 'utf-8' || e === 'utf8') return 'utf-8';
    if (e === 'euc-kr' || e === 'cp949' || e === 'windows-949' || e === 'ks-c-5601-1987' || e === 'uhc') return 'euc-kr';
    if (e === 'utf-16le' || e === 'utf-16') return 'utf-16le';
    if (e === 'utf-16be') return 'utf-16be';
    if (e === 'auto' || e === '') return 'auto';
    throw new RangeError('Unsupported encoding: ' + enc);
  }

  /**
   * decode(bytes, encoding) -> string
   * encoding: 'auto' | 'utf-8' | 'euc-kr' | 'cp949' | 'utf-16le' | 'utf-16be'
   * A leading BOM matching the encoding is removed. Invalid bytes become U+FFFD.
   */
  function decode(input, encoding) {
    var b = toBytes(input);
    var enc = normalizeEncoding(encoding);
    if (enc === 'auto') enc = detectEncoding(b).encoding;
    return new TextDecoder(enc).decode(b);
  }

  function encodeUtf8(str) {
    return new TextEncoder().encode(str);
  }

  /** toUtf8Bom(string) -> Uint8Array starting with EF BB BF (never two BOMs). */
  function toUtf8Bom(str) {
    var s = String(str);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    var body = encodeUtf8(s);
    var out = new Uint8Array(body.length + 3);
    out.set(BOM_UTF8, 0);
    out.set(body, 3);
    return out;
  }

  /** toUtf8NoBom(string) -> Uint8Array without a leading BOM. */
  function toUtf8NoBom(str) {
    var s = String(str);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return encodeUtf8(s);
  }

  function detectDelimiter(text) {
    var cands = [',', '\t', ';'];
    var counts = [0, 0, 0];
    var inQ = false;
    for (var i = 0; i < text.length && i < 65536; i++) {
      var ch = text[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (inQ) continue;
      if (ch === '\n' || ch === '\r') break;
      var idx = cands.indexOf(ch);
      if (idx >= 0) counts[idx]++;
    }
    var best = 0;
    for (var j = 1; j < cands.length; j++) if (counts[j] > counts[best]) best = j;
    return counts[best] > 0 ? cands[best] : ',';
  }

  /**
   * parseCsvPreview(text, maxRows = 10, delimiter = auto) -> string[][]
   * RFC 4180 style: quoted fields, "" escapes, delimiters/newlines inside quotes,
   * CRLF, LF or CR row endings. Stops after maxRows rows.
   */
  function parseCsvPreview(text, maxRows, delimiter) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    var limit = maxRows == null ? 10 : maxRows;
    var rows = [];
    if (s.length === 0 || limit <= 0) return rows;
    var d = delimiter || detectDelimiter(s);
    var row = [], field = '', i = 0, n = s.length, inQ = false, fieldStarted = false;
    // Fields are built from slices (not char-by-char concatenation) so a stray quote that swallows
    // the rest of a large file costs one indexOf scan instead of freezing the page.
    while (i < n) {
      var ch = s[i];
      if (ch === '"' && !fieldStarted) {
        fieldStarted = true; i++;
        for (;;) {
          var q = s.indexOf('"', i);
          if (q < 0) { field += s.slice(i); i = n; inQ = true; break; }
          field += s.slice(i, q);
          if (s[q + 1] === '"') { field += '"'; i = q + 2; continue; }
          i = q + 1;
          break;
        }
        continue;
      }
      if (ch === d) { row.push(field); field = ''; fieldStarted = false; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        row.push(field); rows.push(row);
        row = []; field = ''; fieldStarted = false;
        i += (ch === '\r' && s[i + 1] === '\n') ? 2 : 1;
        if (rows.length >= limit) return rows;
        continue;
      }
      // Unquoted run (a quote inside an already started field is literal).
      var k = i + 1;
      while (k < n) {
        var c2 = s[k];
        if (c2 === d || c2 === '\r' || c2 === '\n') break;
        k++;
      }
      field += s.slice(i, k); fieldStarted = true; i = k;
    }
    if (fieldStarted || field !== '' || row.length > 0 || inQ) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /** detectLineEnding(text) -> 'CRLF' | 'LF' | 'CR' | 'mixed' | 'none' */
  function detectLineEnding(text) {
    var s = String(text || '');
    var crlf = 0, lf = 0, cr = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 13) {
        if (s.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++;
      } else if (c === 10) lf++;
    }
    var kinds = (crlf ? 1 : 0) + (lf ? 1 : 0) + (cr ? 1 : 0);
    if (kinds === 0) return 'none';
    if (kinds > 1) return 'mixed';
    return crlf ? 'CRLF' : lf ? 'LF' : 'CR';
  }

  function countChar(text, ch) {
    var s = String(text || ''), c = 0, i = s.indexOf(ch);
    while (i >= 0) { c++; i = s.indexOf(ch, i + 1); }
    return c;
  }

  /** Number of U+FFFD in a decoded string (decode errors plus ones already in the file). */
  function countReplacementChars(text) {
    return countChar(text, '�');
  }

  /** Number of U+0000 characters (a sign of a binary file or a wrong UTF-16 guess). */
  function countNul(text) {
    return countChar(text, '\u0000');
  }

  /**
   * literalReplacementCount(bytes, encoding) -> how many U+FFFD characters are really stored in
   * the file (left over from an earlier broken conversion), as opposed to produced by decoding.
   * CP949 has no U+FFFD, so it is always 0 there.
   */
  function literalReplacementCount(input, encoding) {
    var b = toBytes(input);
    var enc = normalizeEncoding(encoding);
    if (enc === 'auto') enc = detectEncoding(b).encoding;
    var c = 0, i, n = b.length;
    if (enc === 'utf-8') {
      // EF is always a lead byte, so EF BF BD always decodes to exactly one U+FFFD.
      for (i = 0; i + 2 < n; i++) {
        if (b[i] === 0xef && b[i + 1] === 0xbf && b[i + 2] === 0xbd) { c++; i += 2; }
      }
    } else if (enc === 'utf-16le' || enc === 'utf-16be') {
      var hi = enc === 'utf-16le' ? 1 : 0;
      for (i = 0; i + 1 < n; i += 2) {
        if (b[i + hi] === 0xff && b[i + 1 - hi] === 0xfd) c++;
      }
    }
    return c;
  }

  /**
   * sniffBinary(bytes) -> 'zip' (xlsx, docx, zip) | 'ole' (old .xls, .hwp, .doc) | 'pdf' | null.
   * These are not text files, so "fixing" their encoding would only produce garbage.
   */
  function sniffBinary(input) {
    var b = toBytes(input);
    function starts(sig) {
      if (b.length < sig.length) return false;
      for (var i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
      return true;
    }
    if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08])) return 'zip';
    if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
    if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
    return null;
  }

  /**
   * truncate(str, max) -> str cut to at most `max` UTF-16 units plus '…', never splitting a
   * surrogate pair (a split emoji would show up as a fake '�' in the preview).
   */
  function truncate(str, max) {
    var s = String(str == null ? '' : str);
    if (s.length <= max) return s;
    var cut = max;
    var c = s.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut--;
    return s.slice(0, cut) + '…';
  }

  /** encodingLabel(detection | encodingString) -> human-readable Korean label */
  function encodingLabel(det) {
    var d = typeof det === 'string' ? { encoding: det, hasBom: false } : det || {};
    var e = normalizeEncoding(d.encoding);
    if (e === 'utf-8') return d.hasBom ? 'UTF-8 (BOM 있음)' : 'UTF-8 (BOM 없음)';
    if (e === 'euc-kr') return 'CP949 (EUC-KR)';
    if (e === 'utf-16le') return 'UTF-16 LE' + (d.hasBom ? ' (BOM 있음)' : '');
    if (e === 'utf-16be') return 'UTF-16 BE' + (d.hasBom ? ' (BOM 있음)' : '');
    return String(d.encoding);
  }

  /**
   * fixedFileName('주소록.csv') -> '주소록_fixed.csv'
   * .tsv / .txt keep their extension; anything else becomes .csv.
   */
  function fixedFileName(name, suffix) {
    var nm = String(name || '').replace(/^.*[\\/]/, '').replace(/\.+$/, '') || 'file';
    var suf = suffix == null ? '_fixed' : suffix;
    var m = nm.match(/^(.*)\.([^.]+)$/);
    var base = m ? (m[1] || 'file') : nm;
    var ext = m ? m[2].toLowerCase() : '';
    var outExt = ext === 'tsv' || ext === 'txt' ? ext : 'csv';
    return base + suf + '.' + outExt;
  }

  /** True when this environment's TextDecoder('euc-kr') includes the CP949/UHC extension (e.g. 똠 = 8C 63). */
  function supportsCp949Extension() {
    try {
      return new TextDecoder('euc-kr').decode(new Uint8Array([0x8c, 0x63])) === '똠';
    } catch (e) {
      return false;
    }
  }

  return {
    detectEncoding: detectEncoding,
    decode: decode,
    toUtf8Bom: toUtf8Bom,
    toUtf8NoBom: toUtf8NoBom,
    parseCsvPreview: parseCsvPreview,
    detectDelimiter: detectDelimiter,
    detectLineEnding: detectLineEnding,
    countReplacementChars: countReplacementChars,
    countNul: countNul,
    literalReplacementCount: literalReplacementCount,
    sniffBinary: sniffBinary,
    truncate: truncate,
    encodingLabel: encodingLabel,
    fixedFileName: fixedFileName,
    supportsCp949Extension: supportsCp949Extension,
    _scanUtf8: scanUtf8,
    _scanCp949: scanCp949,
    _cp949PairValid: cp949PairValid,
    _guessUtf16: guessUtf16
  };
});
