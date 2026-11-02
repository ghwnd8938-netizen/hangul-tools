'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../csv-fix/tool.js');

const hex = (h) => Uint8Array.from(Buffer.from(h.replace(/\s+/g, ''), 'hex'));
const utf8 = (s) => new TextEncoder().encode(s);
const concat = (...parts) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// "이름,나이\r\n홍길동,30\r\n" in CP949 (EUC-KR)
const SAMPLE = '이름,나이\r\n홍길동,30\r\n';
const SAMPLE_CP949 = hex('c0ccb8a7 2c b3aac0cc 0d0a c8abb1e6b5bf 2c 3330 0d0a');

test('hardcoded CP949 sample bytes really are CP949 for the sample text', () => {
  assert.strictEqual(new TextDecoder('euc-kr', { fatal: true }).decode(SAMPLE_CP949), SAMPLE);
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(SAMPLE_CP949));
});

test('detectEncoding: empty input', () => {
  const d = C.detectEncoding(new Uint8Array(0));
  assert.strictEqual(d.encoding, 'utf-8');
  assert.strictEqual(d.hasBom, false);
  assert.strictEqual(d.asciiOnly, true);
});

test('detectEncoding: ASCII only', () => {
  const d = C.detectEncoding(utf8('name,age\r\nhong,30\r\n'));
  assert.deepStrictEqual(d, { encoding: 'utf-8', hasBom: false, confidence: 'high', asciiOnly: true });
});

test('detectEncoding: UTF-8 with BOM', () => {
  const d = C.detectEncoding(concat(hex('efbbbf'), utf8(SAMPLE)));
  assert.strictEqual(d.encoding, 'utf-8');
  assert.strictEqual(d.hasBom, true);
  assert.strictEqual(d.confidence, 'high');
});

test('detectEncoding: BOM only (3 bytes)', () => {
  const d = C.detectEncoding(hex('efbbbf'));
  assert.strictEqual(d.encoding, 'utf-8');
  assert.strictEqual(d.hasBom, true);
});

test('detectEncoding: UTF-8 without BOM (Korean)', () => {
  const d = C.detectEncoding(utf8(SAMPLE));
  assert.deepStrictEqual(d, { encoding: 'utf-8', hasBom: false, confidence: 'high', asciiOnly: false });
});

test('detectEncoding: CP949 Korean', () => {
  const d = C.detectEncoding(SAMPLE_CP949);
  assert.strictEqual(d.encoding, 'euc-kr');
  assert.strictEqual(d.hasBom, false);
  assert.strictEqual(d.confidence, 'high');
});

test('detectEncoding: CP949 extension (UHC) syllables such as 똠(8C63) and 햏(C164)', () => {
  // "똠,햏\n" : 8C63 2C C164 0A
  const d = C.detectEncoding(hex('8c63 2c c164 0a'));
  assert.strictEqual(d.encoding, 'euc-kr');
  assert.strictEqual(d.confidence, 'high');
});

test('detectEncoding: CP949 with mostly non-Hangul (symbols) -> euc-kr, medium confidence', () => {
  // "※★" in CP949: A1D8 A1DA
  const d = C.detectEncoding(hex('a1d8 a1da 0d0a'));
  assert.strictEqual(d.encoding, 'euc-kr');
  assert.strictEqual(d.confidence, 'medium');
});

test('detectEncoding: UTF-16 LE / BE with BOM', () => {
  const le = C.detectEncoding(hex('fffe 01ac 2c00'));
  assert.strictEqual(le.encoding, 'utf-16le');
  assert.strictEqual(le.hasBom, true);
  const be = C.detectEncoding(hex('feff ac01 002c'));
  assert.strictEqual(be.encoding, 'utf-16be');
  assert.strictEqual(be.hasBom, true);
});

test('detectEncoding: emoji / surrogate pairs and mixed scripts are valid UTF-8', () => {
  const d = C.detectEncoding(utf8('이름,emoji,日本語\n홍길동,😀👍🏽,テスト\n'));
  assert.strictEqual(d.encoding, 'utf-8');
  assert.strictEqual(d.confidence, 'high');
  assert.strictEqual(d.asciiOnly, false);
});

test('detectEncoding: strict UTF-8 rejects overlong, surrogate and out-of-range sequences', () => {
  assert.strictEqual(C._scanUtf8(hex('c0af')).errors > 0, true); // overlong '/'
  assert.strictEqual(C._scanUtf8(hex('eda080')).errors > 0, true); // UTF-16 surrogate D800
  assert.strictEqual(C._scanUtf8(hex('f4908080')).errors > 0, true); // > U+10FFFF
  assert.strictEqual(C._scanUtf8(hex('e0808f')).errors > 0, true); // overlong 3-byte
  assert.strictEqual(C._scanUtf8(utf8('😀')).errors, 0);
  assert.strictEqual(C._scanUtf8(utf8('😀')).multibyte, 1);
});

test('detectEncoding: UTF-8 truncated in the middle of the last character -> still utf-8 (low)', () => {
  const full = utf8('이름,나이\n홍길동,30\n서울,부산\n대구');
  const cut = full.slice(0, full.length - 1);
  const d = C.detectEncoding(cut);
  assert.strictEqual(d.encoding, 'utf-8');
  assert.strictEqual(d.confidence, 'low');
});

test('detectEncoding: CP949 file with one stray invalid byte -> euc-kr (low)', () => {
  const bytes = concat(SAMPLE_CP949, SAMPLE_CP949, hex('ff'), SAMPLE_CP949);
  const d = C.detectEncoding(bytes);
  assert.strictEqual(d.encoding, 'euc-kr');
  assert.strictEqual(d.confidence, 'low');
});

test('detectEncoding: accepts ArrayBuffer and Buffer, rejects strings', () => {
  assert.strictEqual(C.detectEncoding(SAMPLE_CP949.buffer.slice(0)).encoding, 'euc-kr');
  assert.strictEqual(C.detectEncoding(Buffer.from(SAMPLE, 'utf8')).encoding, 'utf-8');
  assert.throws(() => C.detectEncoding('abc'), TypeError);
});

test('detectEncoding: very long inputs (~5 MB) stay correct', () => {
  const rowCp = hex('c8abb1e6b5bf 2c 3330 2c c0ccb8a7 0d0a');
  const n = 400000;
  const big = new Uint8Array(rowCp.length * n);
  for (let i = 0; i < n; i++) big.set(rowCp, i * rowCp.length);
  const t0 = Date.now();
  assert.strictEqual(C.detectEncoding(big).encoding, 'euc-kr');
  const bigU = utf8('홍길동,30,이름😀\n'.repeat(200000));
  assert.strictEqual(C.detectEncoding(bigU).encoding, 'utf-8');
  assert.ok(Date.now() - t0 < 5000, 'detection should be fast');
});

test('decode: CP949 -> string', () => {
  assert.strictEqual(C.decode(SAMPLE_CP949, 'euc-kr'), SAMPLE);
  assert.strictEqual(C.decode(SAMPLE_CP949, 'cp949'), SAMPLE);
  assert.strictEqual(C.decode(SAMPLE_CP949, 'auto'), SAMPLE);
});

test('decode: UTF-8 BOM is removed, UTF-8 without BOM unchanged', () => {
  assert.strictEqual(C.decode(concat(hex('efbbbf'), utf8(SAMPLE)), 'utf-8'), SAMPLE);
  assert.strictEqual(C.decode(utf8(SAMPLE), 'utf-8'), SAMPLE);
  assert.strictEqual(C.decode(concat(hex('efbbbf'), utf8(SAMPLE)), 'auto'), SAMPLE);
});

test('decode: UTF-16 LE/BE with BOM via auto', () => {
  assert.strictEqual(C.decode(hex('fffe 01ac 2c00 0d000a00'), 'auto'), '각,\r\n');
  assert.strictEqual(C.decode(hex('feff ac01 002c'), 'auto'), '각,');
});

test('decode: empty input', () => {
  assert.strictEqual(C.decode(new Uint8Array(0), 'auto'), '');
  assert.strictEqual(C.decode(new Uint8Array(0), 'euc-kr'), '');
});

test('decode: wrong encoding yields replacement chars (U+FFFD), never throws', () => {
  const s = C.decode(SAMPLE_CP949, 'utf-8');
  assert.ok(C.countReplacementChars(s) > 0);
  assert.strictEqual(C.countReplacementChars(C.decode(SAMPLE_CP949, 'euc-kr')), 0);
});

test('decode: unsupported encoding name throws', () => {
  assert.throws(() => C.decode(utf8('a'), 'shift_jis'), RangeError);
});

test('decode: CP949 extension syllables (only where TextDecoder implements windows-949)', (t) => {
  if (!C.supportsCp949Extension()) {
    t.skip('this runtime\'s TextDecoder("euc-kr") lacks the UHC extension (browsers have it; checked in smoke test)');
    return;
  }
  assert.strictEqual(C.decode(hex('8c63 2c c164'), 'euc-kr'), '똠,햏');
});

test('toUtf8Bom: prefix EF BB BF + exact UTF-8 bytes, CRLF preserved', () => {
  const out = C.toUtf8Bom(SAMPLE);
  assert.deepStrictEqual([...out.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.deepStrictEqual(Buffer.from(out.slice(3)), Buffer.from(SAMPLE, 'utf8'));
  const crlfCount = Buffer.from(out).toString('latin1').split('\r\n').length - 1;
  assert.strictEqual(crlfCount, 2);
});

test('toUtf8Bom: LF-only and CR-only line endings preserved byte for byte', () => {
  const lf = 'a,b\n가,나\n';
  const cr = 'a,b\r가,나\r';
  assert.deepStrictEqual(Buffer.from(C.toUtf8Bom(lf).slice(3)), Buffer.from(lf, 'utf8'));
  assert.deepStrictEqual(Buffer.from(C.toUtf8Bom(cr).slice(3)), Buffer.from(cr, 'utf8'));
});

test('toUtf8Bom: empty string -> BOM only; never doubles an existing BOM', () => {
  assert.deepStrictEqual([...C.toUtf8Bom('')], [0xef, 0xbb, 0xbf]);
  const out = C.toUtf8Bom('\uFEFF가');
  assert.deepStrictEqual([...out], [0xef, 0xbb, 0xbf, 0xea, 0xb0, 0x80]);
});

test('toUtf8Bom: emoji surrogate pairs become 4-byte UTF-8, lone surrogates become U+FFFD', () => {
  assert.deepStrictEqual([...C.toUtf8Bom('😀').slice(3)], [0xf0, 0x9f, 0x98, 0x80]);
  assert.deepStrictEqual([...C.toUtf8Bom('\uD800').slice(3)], [0xef, 0xbf, 0xbd]);
});

test('toUtf8NoBom: no BOM, strips a leading U+FEFF', () => {
  assert.deepStrictEqual(Buffer.from(C.toUtf8NoBom(SAMPLE)), Buffer.from(SAMPLE, 'utf8'));
  assert.deepStrictEqual([...C.toUtf8NoBom('\uFEFFa')], [0x61]);
  assert.strictEqual(C.toUtf8NoBom('').length, 0);
});

test('round trip: CP949 bytes -> detect -> decode -> UTF-8 BOM bytes', () => {
  const det = C.detectEncoding(SAMPLE_CP949);
  const text = C.decode(SAMPLE_CP949, det.encoding);
  const out = C.toUtf8Bom(text);
  assert.deepStrictEqual(Buffer.from(out), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SAMPLE, 'utf8')]));
  // Re-running on the output is stable (already fixed)
  const det2 = C.detectEncoding(out);
  assert.strictEqual(det2.hasBom, true);
  assert.deepStrictEqual(Buffer.from(C.toUtf8Bom(C.decode(out, 'auto'))), Buffer.from(out));
});

test('round trip: very long text keeps exact content', () => {
  const text = ('홍길동,"서울, 강남구","그가 ""안녕"" 했다",😀\r\n').repeat(50000);
  const out = C.toUtf8Bom(text);
  assert.strictEqual(C.decode(out, 'auto'), text);
});

test('parseCsvPreview: simple rows, CRLF', () => {
  assert.deepStrictEqual(C.parseCsvPreview(SAMPLE, 10), [['이름', '나이'], ['홍길동', '30']]);
});

test('parseCsvPreview: LF and CR row endings', () => {
  assert.deepStrictEqual(C.parseCsvPreview('a,b\n1,2\n', 10), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(C.parseCsvPreview('a,b\r1,2', 10), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(C.parseCsvPreview('a,b\r\n1,2\n3,4\r5,6', 10), [['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']]);
});

test('parseCsvPreview: quoted fields with commas, escaped quotes and embedded newlines', () => {
  const csv = '이름,주소,메모\r\n홍길동,"서울, 강남구","그가 ""안녕"" 했다"\r\n김철수,"부산\r\n해운대",""\r\n';
  assert.deepStrictEqual(C.parseCsvPreview(csv, 10), [
    ['이름', '주소', '메모'],
    ['홍길동', '서울, 강남구', '그가 "안녕" 했다'],
    ['김철수', '부산\r\n해운대', '']
  ]);
});

test('parseCsvPreview: empty fields, trailing delimiter, blank lines', () => {
  assert.deepStrictEqual(C.parseCsvPreview('a,,c,\n\nd', 10), [['a', '', 'c', ''], [''], ['d']]);
});

test('parseCsvPreview: empty input and maxRows <= 0', () => {
  assert.deepStrictEqual(C.parseCsvPreview('', 10), []);
  assert.deepStrictEqual(C.parseCsvPreview(null, 10), []);
  assert.deepStrictEqual(C.parseCsvPreview('a,b', 0), []);
});

test('parseCsvPreview: maxRows limit (default 10)', () => {
  const csv = Array.from({ length: 50 }, (_, i) => `r${i},${i}`).join('\n');
  assert.strictEqual(C.parseCsvPreview(csv).length, 10);
  assert.strictEqual(C.parseCsvPreview(csv, 3).length, 3);
  assert.deepStrictEqual(C.parseCsvPreview(csv, 3)[2], ['r2', '2']);
});

test('parseCsvPreview: stops early on very long input', () => {
  const csv = 'a,b,c\n'.repeat(500000);
  const t0 = Date.now();
  const rows = C.parseCsvPreview(csv, 10);
  assert.strictEqual(rows.length, 10);
  assert.ok(Date.now() - t0 < 200);
});

test('parseCsvPreview: tab / semicolon delimiter auto-detected, explicit delimiter honored', () => {
  assert.deepStrictEqual(C.parseCsvPreview('이름\t주소\n홍길동\t서울, 강남\n', 10), [['이름', '주소'], ['홍길동', '서울, 강남']]);
  assert.deepStrictEqual(C.parseCsvPreview('a;b;c\n1;2;3', 10), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepStrictEqual(C.parseCsvPreview('a;b,c', 10, ','), [['a;b', 'c']]);
  assert.strictEqual(C.detectDelimiter('"x,y,z"\tq\n'), '\t');
  assert.strictEqual(C.detectDelimiter('nodelim'), ',');
});

test('parseCsvPreview: unterminated quote keeps the rest as one field', () => {
  assert.deepStrictEqual(C.parseCsvPreview('a,"b,c\nd', 10), [['a', 'b,c\nd']]);
});

test('parseCsvPreview: leading BOM stripped, emoji and mixed scripts intact', () => {
  assert.deepStrictEqual(C.parseCsvPreview('\uFEFF이름,emoji\n홍,😀👍🏽 テスト 中文', 10), [['이름', 'emoji'], ['홍', '😀👍🏽 テスト 中文']]);
});

test('detectLineEnding', () => {
  assert.strictEqual(C.detectLineEnding('a\r\nb\r\n'), 'CRLF');
  assert.strictEqual(C.detectLineEnding('a\nb\n'), 'LF');
  assert.strictEqual(C.detectLineEnding('a\rb'), 'CR');
  assert.strictEqual(C.detectLineEnding('a\r\nb\n'), 'mixed');
  assert.strictEqual(C.detectLineEnding('abc'), 'none');
  assert.strictEqual(C.detectLineEnding(''), 'none');
});

test('encodingLabel', () => {
  assert.strictEqual(C.encodingLabel({ encoding: 'utf-8', hasBom: true }), 'UTF-8 (BOM 있음)');
  assert.strictEqual(C.encodingLabel({ encoding: 'utf-8', hasBom: false }), 'UTF-8 (BOM 없음)');
  assert.strictEqual(C.encodingLabel({ encoding: 'euc-kr', hasBom: false }), 'CP949 (EUC-KR)');
  assert.strictEqual(C.encodingLabel('utf-16le'), 'UTF-16 LE');
  assert.strictEqual(C.encodingLabel({ encoding: 'utf-16be', hasBom: true }), 'UTF-16 BE (BOM 있음)');
});

test('fixedFileName', () => {
  assert.strictEqual(C.fixedFileName('주소록.csv'), '주소록_fixed.csv');
  assert.strictEqual(C.fixedFileName('Data.CSV'), 'Data_fixed.csv');
  assert.strictEqual(C.fixedFileName('a.b.c.csv'), 'a.b.c_fixed.csv');
  assert.strictEqual(C.fixedFileName('list.tsv'), 'list_fixed.tsv');
  assert.strictEqual(C.fixedFileName('export.txt', '_utf8'), 'export_utf8.txt');
  assert.strictEqual(C.fixedFileName('noext'), 'noext_fixed.csv');
  assert.strictEqual(C.fixedFileName('C:\\Users\\me\\명단.csv'), '명단_fixed.csv');
  assert.strictEqual(C.fixedFileName(''), 'file_fixed.csv');
});

// ---------------------------------------------------------------------------
// QA regression tests (bugs found in review)
// ---------------------------------------------------------------------------

test('QA: CP949 validator rejects cells the browser decodes as U+FFFD', () => {
  const V = C._cp949PairValid;
  // valid: KS X 1001 Hangul, UHC extension, hanja, symbols at row ends
  for (const [c, t] of [[0xb0, 0xa1], [0xc8, 0xfe], [0x81, 0x41], [0x8c, 0x63], [0xc6, 0x52], [0xc6, 0xa1], [0xca, 0xa1], [0xfd, 0xfe], [0xa2, 0xe7], [0xac, 0xf1], [0xa8, 0xa6]]) {
    assert.strictEqual(V(c, t), true, c.toString(16) + t.toString(16) + ' should be valid');
  }
  // invalid (verified against Chromium's TextDecoder('euc-kr'))
  for (const [c, t] of [[0xc9, 0xa1], [0xfe, 0xa1], [0xc7, 0x41], [0xfd, 0x81], [0xc6, 0x53], [0xc6, 0xa0], [0xa2, 0xe8], [0xad, 0xa1], [0xac, 0xc2], [0xa8, 0xa5], [0x80, 0xa1], [0xff, 0xa1], [0xb0, 0x5b], [0xb0, 0xff]]) {
    assert.strictEqual(V(c, t), false, c.toString(16) + t.toString(16) + ' should be invalid');
  }
  // the scan reports them as errors, so such bytes can no longer be "CP949, high confidence"
  assert.ok(C._scanCp949(hex('c9a1')).errors > 0);
  assert.ok(C._scanCp949(hex('c741')).errors > 0);
});

test('QA: CP949 validator agrees with Node TextDecoder("euc-kr") on the KS X 1001 area', () => {
  // Node's ICU euc-kr lacks the UHC extension, but A1-FE x A1-FE (KS X 1001) is shared with browsers,
  // except: ICU maps the user-defined rows C9/FE to the Private Use Area (browsers: error) and lacks
  // A2E6 (€) / A2E7 (®), which the WHATWG table (browsers) has. The full table is checked against
  // Chromium in csv-fix.smoke.js.
  const td = new TextDecoder('euc-kr');
  const browserOnly = new Set([0xa2e6, 0xa2e7]);
  let checked = 0;
  for (let c = 0xa1; c <= 0xfe; c++) {
    for (let t = 0xa1; t <= 0xfe; t++) {
      const s = td.decode(Uint8Array.from([c, t]));
      const decoderOk = browserOnly.has((c << 8) | t) ||
        (s.length === 1 && s !== '�' && !(s.charCodeAt(0) >= 0xe000 && s.charCodeAt(0) <= 0xf8ff));
      if (decoderOk !== C._cp949PairValid(c, t)) {
        assert.fail(c.toString(16) + t.toString(16) + ': node=' + decoderOk + ' validator=' + C._cp949PairValid(c, t));
      }
      checked++;
    }
  }
  assert.strictEqual(checked, 94 * 94);
});

test('QA: .xlsx / .xls / .pdf are recognised as non-text (were detected as "CP949, high")', () => {
  const xlsx = hex('504b0304 14000600 08000000 2100 9abc');
  assert.strictEqual(C.sniffBinary(xlsx), 'zip');
  assert.strictEqual(C.sniffBinary(hex('d0cf11e0a1b11ae1 0000')), 'ole');
  assert.strictEqual(C.sniffBinary(utf8('%PDF-1.7\n')), 'pdf');
  assert.strictEqual(C.sniffBinary(SAMPLE_CP949), null);
  assert.strictEqual(C.sniffBinary(utf8('PK,name\n')), null);
  assert.strictEqual(C.sniffBinary(new Uint8Array(0)), null);
});

test('QA: UTF-16 LE/BE without BOM (was "ASCII only" / CP949 garbage)', () => {
  const le = Uint8Array.from(Buffer.from(SAMPLE, 'utf16le'));
  const d = C.detectEncoding(le);
  assert.strictEqual(d.encoding, 'utf-16le');
  assert.strictEqual(d.hasBom, false);
  assert.strictEqual(d.asciiOnly, false);
  assert.strictEqual(C.decode(le, 'auto'), SAMPLE);
  const asciiLe = Uint8Array.from(Buffer.from('name,age\r\nhong,30\r\n', 'utf16le'));
  assert.strictEqual(C.detectEncoding(asciiLe).encoding, 'utf-16le');
  assert.strictEqual(C.decode(asciiLe, 'auto'), 'name,age\r\nhong,30\r\n');
  const be = Uint8Array.from(Buffer.from('이름,emoji😀\n', 'utf16le').swap16());
  assert.strictEqual(C.detectEncoding(be).encoding, 'utf-16be');
  assert.strictEqual(C.decode(be, 'auto'), '이름,emoji😀\n');
});

test('QA: NUL bytes that are not a UTF-16 pattern do not trigger UTF-16', () => {
  const padded = concat(utf8('이름,나이\n홍길동,30\n'), new Uint8Array(64)); // NUL padding at the end
  assert.strictEqual(C.detectEncoding(padded).encoding, 'utf-8');
  assert.strictEqual(C.countNul(C.decode(padded, 'auto')), 64);
  const twoNuls = utf8('abcdefghij\u0000klmnopqrstuvwxyz0123456789abcdefghij\u0000\n');
  assert.strictEqual(C.detectEncoding(twoNuls).encoding, 'utf-8');
  assert.strictEqual(C._guessUtf16(utf8('plain ascii text, no nul\n')), null);
  // unpaired surrogates -> not UTF-16
  assert.strictEqual(C._guessUtf16(hex('00d8 4100 4200 4300 2c00 0a00')), null);
});

test('QA: UTF-8 BOM followed by non-UTF-8 bytes is low confidence (was "high, already fine")', () => {
  const d = C.detectEncoding(concat(hex('efbbbf'), SAMPLE_CP949));
  assert.strictEqual(d.encoding, 'utf-8');
  assert.strictEqual(d.hasBom, true);
  assert.strictEqual(d.confidence, 'low');
  assert.strictEqual(C.detectEncoding(concat(hex('efbbbf'), utf8(SAMPLE))).confidence, 'high');
});

test('QA: short CP949 that is also valid UTF-8 (e.g. "치킨") is flagged low confidence', () => {
  // 치킨 = C4A1 C5B2 in CP949, which is also valid UTF-8 ("ġŲ")
  const bytes = concat(utf8('menu,'), hex('c4a1c5b2'), utf8('\r\n'));
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const d = C.detectEncoding(bytes);
  assert.strictEqual(d.encoding, 'utf-8'); // spec heuristic: valid UTF-8 wins...
  assert.strictEqual(d.confidence, 'low'); // ...but the page now warns the user
  // Real UTF-8 Korean (3-byte sequences) stays high
  assert.strictEqual(C.detectEncoding(utf8('메뉴,치킨\r\n')).confidence, 'high');
});

test('QA: literal U+FFFD already stored in the file is distinguished from decode errors', () => {
  const broken = utf8('이름,메모\n홍길동,��\n');
  assert.strictEqual(C.detectEncoding(broken).confidence, 'high');
  const text = C.decode(broken, 'auto');
  assert.strictEqual(C.countReplacementChars(text), 2);
  assert.strictEqual(C.literalReplacementCount(broken, 'utf-8'), 2);
  assert.strictEqual(C.literalReplacementCount(broken, 'auto'), 2);
  // real decode errors: CP949 read as UTF-8 -> replacements, none literal
  assert.ok(C.countReplacementChars(C.decode(SAMPLE_CP949, 'utf-8')) > 0);
  assert.strictEqual(C.literalReplacementCount(SAMPLE_CP949, 'utf-8'), 0);
  assert.strictEqual(C.literalReplacementCount(SAMPLE_CP949, 'euc-kr'), 0);
  // UTF-16 LE / BE
  assert.strictEqual(C.literalReplacementCount(Buffer.from('﻿a�,b', 'utf16le'), 'auto'), 1);
  assert.strictEqual(C.literalReplacementCount(Buffer.from('﻿a�,b', 'utf16le').swap16(), 'utf-16be'), 1);
});

test('QA: parseCsvPreview with an unterminated quote on a ~32M-char text is fast (was ~14 s)', () => {
  const big = '"abc,def\n' + '홍길동,30,서울시 강남구\r\n'.repeat(2000000);
  const t0 = Date.now();
  const rows = C.parseCsvPreview(big, 10);
  const ms = Date.now() - t0;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].length, 1);
  assert.strictEqual(rows[0][0], big.slice(1));
  assert.ok(ms < 1500, 'took ' + ms + ' ms');
  // a single huge unquoted line is fast too
  const line = 'x'.repeat(20000000) + ',y';
  const t1 = Date.now();
  assert.deepStrictEqual(C.parseCsvPreview(line, 10).map((r) => r.map((f) => f.length)), [[20000000, 1]]);
  assert.ok(Date.now() - t1 < 1500);
});

test('QA: parser rewrite keeps quote semantics', () => {
  assert.deepStrictEqual(C.parseCsvPreview('"abc"def,x', 10), [['abcdef', 'x']]);
  assert.deepStrictEqual(C.parseCsvPreview('5" 모니터,"a""b",""""', 10), [['5" 모니터', 'a"b', '"']]);
  assert.deepStrictEqual(C.parseCsvPreview('a,"', 10), [['a', '']]);
  assert.deepStrictEqual(C.parseCsvPreview('"",""\r\n', 10), [['', '']]);
  assert.deepStrictEqual(C.parseCsvPreview('"a\r\nb"\r\n"c', 10), [['a\r\nb'], ['c']]);
  assert.deepStrictEqual(C.parseCsvPreview(',\n,', 10), [['', ''], ['', '']]);
});

test('QA: truncate never splits a surrogate pair (was a fake "�" in the preview)', () => {
  const s = 'a'.repeat(79) + '😀' + 'tail';
  const out = C.truncate(s, 80);
  assert.strictEqual(out, 'a'.repeat(79) + '…');
  assert.doesNotMatch(out, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  assert.strictEqual(C.truncate('😀😀', 80), '😀😀');
  assert.strictEqual(C.truncate('가나다라', 2), '가나…');
  assert.strictEqual(C.truncate('', 80), '');
  assert.strictEqual(C.truncate(null, 80), '');
});

test('QA: fixedFileName edge cases (dotfile, trailing dot)', () => {
  assert.strictEqual(C.fixedFileName('.csv'), 'file_fixed.csv');
  assert.strictEqual(C.fixedFileName('file.'), 'file_fixed.csv');
  assert.strictEqual(C.fixedFileName('...'), 'file_fixed.csv');
  assert.strictEqual(C.fixedFileName('주소록.CSV', '_utf8'), '주소록_utf8.csv');
});
