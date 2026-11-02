'use strict';
// Unit tests: node --test tests/korean-numbers.test.js
const test = require('node:test');
const assert = require('node:assert');
const K = require('../en/korean-numbers/tool.js');

const eq = assert.strictEqual;

test('sino: basic numbers and the dropped 일 before 십/백/천/만', () => {
  const cases = [
    [0, '영'], [1, '일'], [2, '이'], [10, '십'], [11, '십일'], [16, '십육'], [20, '이십'],
    [99, '구십구'], [100, '백'], [101, '백일'], [110, '백십'], [111, '백십일'], [1000, '천'],
    [1111, '천백십일'], [2345, '이천삼백사십오'], [10000, '만'], [10001, '만 일'], [10010, '만 십'],
    [11000, '만 천'], [20000, '이만'], [35000, '삼만 오천'], [100000, '십만'], [110000, '십일만'],
    [123500, '십이만 삼천오백'], [1000000, '백만'], [10000000, '천만'], [11000000, '천백만'],
    [100000000, '일억'], [100000001, '일억 일'], [100010000, '일억 일만'], [110000000, '일억 천만'],
    [1000000000, '십억'], [1234567898, '십이억 삼천사백오십육만 칠천팔백구십팔'],
    [1000000000000, '일조'], [1000100000001, '일조 일억 일'], [1000000010000, '일조 일만'],
    [9999999999999, '구조 구천구백구십구억 구천구백구십구만 구천구백구십구']
  ];
  for (const [n, want] of cases) eq(K.sino(n), want, String(n));
});

test('sino: internal zero groups are skipped', () => {
  eq(K.sino(100000001), '일억 일');
  eq(K.sino(300000020), '삼억 이십');
  eq(K.sino(5000000000005), '오조 오');
  eq(K.sino(1000010001), '십억 일만 일');
});

test('sino: string and BigInt input up to 16 digits, beyond Number.MAX_SAFE_INTEGER', () => {
  eq(K.sino('9999999999999999'), '구천구백구십구조 구천구백구십구억 구천구백구십구만 구천구백구십구');
  eq(K.sino('9007199254740993'), '구천칠조 천구백구십이억 오천사백칠십사만 구백구십삼');
  eq(K.sino(10n ** 15n), '천조');
  eq(K.sino('000035000'), '삼만 오천');
  assert.throws(() => K.sino('10000000000000000'), RangeError);
  assert.throws(() => K.sino(-1), RangeError);
  assert.throws(() => K.sino(1.5), RangeError);
  assert.throws(() => K.sino('12a'), RangeError);
});

test('native numbers 1-99: base and counter forms', () => {
  const base = { 1: '하나', 2: '둘', 3: '셋', 4: '넷', 5: '다섯', 6: '여섯', 7: '일곱', 8: '여덟', 9: '아홉', 10: '열',
    11: '열하나', 12: '열둘', 19: '열아홉', 20: '스물', 21: '스물하나', 30: '서른', 40: '마흔', 50: '쉰', 60: '예순',
    70: '일흔', 80: '여든', 90: '아흔', 99: '아흔아홉' };
  for (const n in base) eq(K.native(+n).base, base[n], 'base ' + n);
  const counter = { 1: '한', 2: '두', 3: '세', 4: '네', 5: '다섯', 10: '열', 11: '열한', 12: '열두', 13: '열세',
    14: '열네', 20: '스무', 21: '스물한', 22: '스물두', 23: '스물세', 24: '스물네', 25: '스물다섯', 30: '서른',
    31: '서른한', 44: '마흔네', 99: '아흔아홉' };
  for (const n in counter) eq(K.native(+n).counter, counter[n], 'counter ' + n);
  for (const bad of [0, 100, -1, 1.5, '5']) eq(K.native(bad), null, 'out of range ' + bad);
});

test('native counter forms: only 1-4 and 20 change, for every number 1-99', () => {
  for (let n = 1; n <= 99; n++) {
    const { base, counter, changes } = K.native(n);
    const u = n % 10;
    const shouldChange = (u >= 1 && u <= 4) || n === 20;
    eq(changes, shouldChange, 'changes flag ' + n);
    if (!shouldChange) eq(counter, base, 'unchanged ' + n);
    assert.match(base, /^[가-힣]+$/);
  }
  eq(K.native(20).counter, '스무');
  eq(K.native(21).counter, '스물한');
});

test('romanization: required examples', () => {
  const cases = [
    ['십육', 'simnyuk'], ['백만', 'baengman'], ['육십', 'yuksip'], ['삼만 오천', 'samman ocheon'],
    ['이십', 'isip'], ['십', 'sip'], ['백', 'baek'], ['천', 'cheon'], ['십만', 'simman']
  ];
  for (const [ko, rr] of cases) eq(K.romanize(ko), rr, ko);
});

test('romanization: liaison, nasalization and ㄴ-insertion in number words', () => {
  const cases = [
    ['영', 'yeong'], ['일', 'il'], ['십일', 'sibil'], ['십이', 'sibi'], ['십오', 'sibo'], ['십삼', 'sipsam'],
    ['백일', 'baegil'], ['백육', 'baengnyuk'], ['천육백', 'cheonnyukbaek'], ['삼십육', 'samsimnyuk'],
    ['백육십', 'baengnyuksip'], ['육만', 'yungman'], ['일억', 'ireok'], ['삼억', 'sameok'], ['칠억', 'chireok'],
    ['십억', 'sibeok'], ['일조', 'iljo'], ['칠십', 'chilsip'], ['육백', 'yukbaek'], ['천오백', 'cheonobaek'],
    ['십육만', 'simnyungman'], ['구천구백구십구', 'gucheongubaekgusipgu'], ['원', 'won']
  ];
  for (const [ko, rr] of cases) eq(K.romanize(ko), rr, ko);
});

test('romanization: native numbers', () => {
  const cases = [
    ['하나', 'hana'], ['둘', 'dul'], ['셋', 'set'], ['넷', 'net'], ['다섯', 'daseot'], ['여섯', 'yeoseot'],
    ['일곱', 'ilgop'], ['여덟', 'yeodeol'], ['아홉', 'ahop'], ['열', 'yeol'], ['열하나', 'yeolhana'],
    ['열넷', 'yeollet'], ['열여섯', 'yeollyeoseot'], ['열일곱', 'yeollilgop'], ['열여덟', 'yeollyeodeol'],
    ['열아홉', 'yeorahop'], ['스물', 'seumul'], ['스무', 'seumu'], ['스물한', 'seumulhan'], ['스물아홉', 'seumurahop'],
    ['서른여섯', 'seoreunnyeoseot'], ['쉰', 'swin'], ['예순', 'yesun'], ['일흔', 'ilheun'], ['열네', 'yeolle'],
    ['한', 'han'], ['두', 'du'], ['세', 'se'], ['네', 'ne']
  ];
  for (const [ko, rr] of cases) eq(K.romanize(ko), rr, ko);
});

test('romanization: every output word is plain lowercase ASCII', () => {
  for (let n = 0; n <= 20000; n += 7) assert.match(K.romanize(K.sino(n)), /^[a-z ]+$/, String(n));
  for (let n = 1; n <= 99; n++) {
    assert.match(K.romanize(K.native(n).base), /^[a-z]+$/);
    assert.match(K.romanize(K.native(n).counter), /^[a-z]+$/);
  }
});

test('letterByLetter: no sound changes', () => {
  eq(K.letterByLetter('십육'), 'sipyuk');
  eq(K.letterByLetter('공일공 일이삼사', '-'), 'gong-il-gong il-i-sam-sa');
});

test('readNumber: input handling', () => {
  let r = K.readNumber('35,000');
  eq(r.ok, true); eq(r.sino, '삼만 오천'); eq(r.sinoRoman, 'samman ocheon'); eq(r.formatted, '35,000');
  eq(r.native, null); assert.match(r.nativeNote, /1 to 99/);
  r = K.readNumber('３５０００'); // full-width digits
  eq(r.ok, true); eq(r.sino, '삼만 오천');
  r = K.readNumber(' 1 000 000 ');
  eq(r.ok, true); eq(r.sino, '백만'); eq(r.sinoRoman, 'baengman');
  r = K.readNumber('0016');
  eq(r.sino, '십육'); eq(r.native.base, '열여섯'); eq(r.native.counter, '열여섯'); eq(r.native.baseRoman, 'yeollyeoseot');
  r = K.readNumber('20');
  eq(r.native.base, '스물'); eq(r.native.counter, '스무'); eq(r.native.changes, true);
  r = K.readNumber('0');
  eq(r.sino, '영'); eq(r.native, null); assert.match(r.nativeNote, /no word for zero/);
  r = K.readNumber('100');
  eq(r.native, null); assert.match(r.nativeNote, /100 and above/);
  eq(K.readNumber('₩35,000').sino, '삼만 오천');
  eq(K.readNumber('35,000원').sino, '삼만 오천');
  eq(K.readNumber('35, 000').sino, '삼만 오천');
  eq(K.readNumber('+5').sino, '오');
  r = K.readNumber('9,007,199,254,740,993');
  eq(r.ok, true); eq(r.digits, '9007199254740993');
});

test('readNumber: rejects bad input with a message', () => {
  const bad = {
    '': /whole number/, '   ': /whole number/, '-5': /Negative/, '3.5': /decimals/, '35.000': /thousands separator/,
    '1e5': /digits only/, '1,2,3': /groups of three/, '1234 5678': /groups of three/, '35,00': /groups of three/, '3만': /price box/, 'abc': /digits only/, '10000000000000000': /Too large/
  };
  for (const input in bad) {
    const r = K.readNumber(input);
    eq(r.ok, false, JSON.stringify(input));
    assert.match(r.error, bad[input], JSON.stringify(input));
  }
  eq(K.readNumber('').empty, true);
});

test('price: number -> Korean', () => {
  eq(K.price(35000), '삼만 오천 원');
  eq(K.price(10000), '만 원');
  eq(K.price(1000), '천 원');
  eq(K.price(123500), '십이만 삼천오백 원');
  eq(K.price(100000000), '일억 원');
  eq(K.romanize(K.price(35000)), 'samman ocheon won');
});

test('parsePrice: Korean text -> number', () => {
  const cases = {
    '삼만오천원': '35,000', '3만 5천원': '35,000', '만 원': '10,000', '십이만 삼천오백 원': '123,500',
    '삼만 오천 원': '35,000', '35,000원': '35,000', '35000': '35,000', '35 000원': '35,000', '₩35,000': '35,000',
    '３만 ５천원': '35,000', '일만 원': '10,000', '천만 원': '10,000,000', '만천 원': '11,000', '백만원': '1,000,000',
    '1억 2천만 원': '120,000,000', '일억 일만 원': '100,010,000', '1,200만 원': '12,000,000', '3천500원': '3,500',
    '3만 5000원': '35,000', '오천원': '5,000', '구백구십구원': '999', '영 원': '0', '0원': '0', '이십오만원': '250,000',
    '일조 원': '1,000,000,000,000', 'KRW 5000': '5,000', 'krw5000': '5,000', '35000 won': '35,000',
    '3만 5,000원': '35,000', '삼 만 오 천 원': '35,000', '만십 원': '10,010', '일천원': '1,000', '일백만원': '1,000,000', '삼만 원정': '30,000', '구천구백구십구조 구천구백구십구억 구천구백구십구만 구천구백구십구원': '9,999,999,999,999,999'
  };
  for (const input in cases) {
    const r = K.parsePrice(input);
    eq(r.ok, true, input + ' -> ' + JSON.stringify(r));
    eq(r.formatted, cases[input], input);
  }
  const r = K.parsePrice('3만 5천원');
  eq(r.reading, '삼만 오천 원'); eq(r.roman, 'samman ocheon won'); eq(r.digits, '35000');
});

test('parsePrice: rejects invalid text with a clear message', () => {
  const bad = {
    '삼오': /Two digits in a row/, '35천원': /single digit/, '만만': /out of order/, '만 억': /out of order/,
    '천천': /out of order/, '십백': /out of order/, '원': /No number/, '3만 50000원': /too big/,
    '세 개': /native/, '스무 원': /native/, '3.5만원': /Decimals/, '-500원': /Negative/, 'abc': /Unexpected/,
    '3 5원': /not one number/, '3,5000원': /groups of three/, '12345678901234567': /too large/i, '영만': /영/, '0만': /0 cannot/,
    '3천5000원': /too big/, '10000만': /below 10,000/, '일억 달러': /Unexpected “달”/
  };
  for (const input in bad) {
    const r = K.parsePrice(input);
    eq(r.ok, false, input + ' should fail, got ' + JSON.stringify(r));
    assert.match(r.error, bad[input], input + ': ' + r.error);
  }
  eq(K.parsePrice('').empty, true);
});

test('parsePrice round-trips every price reading', () => {
  for (const n of [0, 1, 10, 16, 100, 999, 1000, 10000, 10010, 35000, 100001, 123500, 1000000, 99999999, 100000000,
    100010000, 1000000000000, 1234567898765]) {
    eq(K.parsePrice(K.price(n)).digits, String(n), String(n));
  }
});

test('time: 오전/오후 convention, 0:00 and 12:00', () => {
  let t = K.readTime('0:00');
  eq(t.period, '오전'); eq(t.withPeriod, '오전 열두 시'); eq(t.special, '자정'); eq(t.h24, '영 시');
  eq(t.withPeriodRoman, 'ojeon yeoldu si'); eq(t.specialRoman, 'jajeong');
  t = K.readTime('12:00');
  eq(t.period, '오후'); eq(t.withPeriod, '오후 열두 시'); eq(t.special, '정오'); eq(t.h24, null);
  eq(t.specialRoman, 'jeongo');
  t = K.readTime('12:30');
  eq(t.withPeriod, '오후 열두 시 삼십 분'); eq(t.halfWithPeriod, '오후 열두 시 반'); eq(t.half, '열두 시 반');
  eq(t.special, null);
  t = K.readTime('0:30');
  eq(t.withPeriod, '오전 열두 시 삼십 분'); eq(t.h24, '영 시 삼십 분');
  t = K.readTime('11:59');
  eq(t.withPeriod, '오전 열한 시 오십구 분');
});

test('time: 15:45, 23:59 and 3:30', () => {
  let t = K.readTime('15:45');
  eq(t.plain, '세 시 사십오 분'); eq(t.withPeriod, '오후 세 시 사십오 분'); eq(t.h24, '십오 시 사십오 분');
  eq(t.plainRoman, 'se si sasibo bun'); eq(t.withPeriodRoman, 'ohu se si sasibo bun'); eq(t.half, null);
  t = K.readTime('23:59');
  eq(t.withPeriod, '오후 열한 시 오십구 분'); eq(t.h24, '이십삼 시 오십구 분');
  t = K.readTime('03:30');
  eq(t.plain, '세 시 삼십 분'); eq(t.half, '세 시 반'); eq(t.halfWithPeriod, '오전 세 시 반'); eq(t.halfRoman, 'se si ban');
  eq(t.h24, null);
});

test('time: all native hour forms', () => {
  const hours = ['열두', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한'];
  for (let h = 0; h < 24; h++) {
    const t = K.readTime(h + ':05');
    eq(t.plain, hours[h % 12] + ' 시 오 분', String(h));
    eq(t.period, h < 12 ? '오전' : '오후');
  }
});

test('time: input formats and rejections', () => {
  eq(K.readTime('3:45 pm').withPeriod, '오후 세 시 사십오 분');
  eq(K.readTime('3:45PM').h, 15);
  eq(K.readTime('12am').h, 0);
  eq(K.readTime('12 p.m.').h, 12);
  eq(K.readTime('1545').plain, '세 시 사십오 분');
  eq(K.readTime('１５：４５').h, 15);
  eq(K.readTime('9:05').plain, '아홉 시 오 분');
  eq(K.readTime('오후 3시 45분').h, 15);
  eq(K.readTime('오후 3시 반').m, 30);
  eq(K.readTime('오전 12시').h, 0);
  eq(K.readTime('오후 12시').h, 12);
  eq(K.readTime('15시 45분').withPeriod, '오후 세 시 사십오 분');
  eq(K.readTime('9시').withPeriod, '오전 아홉 시');
  eq(K.readTime('오후 3:45').h, 15);
  for (const bad of ['오후 3:45 pm', '오후 13시', '9시 60분', '오후']) eq(K.readTime(bad).ok, false, bad);
  for (const bad of ['24:00', '12:60', '13:00 pm', '0 am', 'noon', '3', '3:5', '-1:00']) {
    eq(K.readTime(bad).ok, false, bad);
  }
  eq(K.readTime('').empty, true);
});

test('phone: digit by digit, 0 = 공, groups kept', () => {
  let p = K.readPhone('010-1234-5678');
  eq(p.ok, true); eq(p.korean, '공일공 일이삼사 오육칠팔'); eq(p.roman, 'gong-il-gong il-i-sam-sa o-yuk-chil-pal');
  p = K.readPhone('02 123 4567');
  eq(p.korean, '공이 일이삼 사오육칠');
  p = K.readPhone('(031) 900.0000');
  eq(p.korean, '공삼일 구공공 공공공공');
  p = K.readPhone('０１０－９８７６－５４３２');
  eq(p.korean, '공일공 구팔칠육 오사삼이');
  p = K.readPhone('112');
  eq(p.korean, '일일이');
  eq(K.readPhone('+82 10-1234-5678').ok, false);
  eq(K.readPhone('010-abcd').ok, false);
  eq(K.readPhone('---').ok, false);
  eq(K.readPhone('1'.repeat(21)).ok, false);
  eq(K.readPhone('').empty, true);
});
