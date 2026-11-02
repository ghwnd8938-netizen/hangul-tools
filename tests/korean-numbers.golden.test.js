'use strict';
// Golden tests: node --test tests/korean-numbers.golden.test.js
//
// Hand-written expected readings, checked against NIKL (National Institute of Korean Language)
// rules and three outside reviewers, NOT generated from tool.js. The other test file and the
// pack build check that tool.js is consistent with itself; this file checks it against an
// independent answer key. If a case fails, fix tool.js (or ask a reviewer), never the expected value.
//
// Romanization = Revised Romanization of the standard pronunciation of each word
// (tensing is not written, 로마자 표기법 제3장 제1항 붙임).
const test = require('node:test');
const assert = require('node:assert');
const K = require('../en/korean-numbers/tool.js');

const eq = assert.strictEqual;

test('golden: Sino-Korean readings and romanization', () => {
  const cases = [
    // [number, Hangul, romanization, why]
    [16, '십육', 'simnyuk', 'ㄴ inserted before 육, ㅂ nasalized: [심뉵]'],
    [106, '백육', 'baengnyuk', 'ㄴ inserted before 육, ㄱ nasalized: [뱅뉵]'],
    [1000000, '백만', 'baengman', 'ㄱ nasalized before ㅁ: [뱅만]'],
    [60, '육십', 'yuksip', 'no ㄴ insertion; tensing [육씹] is not written in RR'],
    [10000, '만', 'man', 'leading 1 dropped when 만 is the first unit'],
    [100000000, '일억', 'ireok', '억 keeps its 1'],
    [100010000, '일억 일만', 'ireok ilman', '만 keeps its 1 after a bigger unit'],
  ];
  for (const [n, ko, rom, why] of cases) {
    eq(K.sino(n), ko, n + ' (' + why + ')');
    eq(K.romanize(ko), rom, n + ' romanization (' + why + ')');
  }
});

test('golden: native numbers and counter forms', () => {
  eq(K.native(17).base, '열일곱');
  eq(K.romanize('열일곱'), 'yeollilgop', '17: ㄴ inserted, then ㄹ+ㄴ -> [열릴곱]');
  eq(K.native(24).counter, '스물네');
  eq(K.romanize('스물네'), 'seumulle', '24 counter: ㄹ+ㄴ -> [스물레]');
  eq(K.native(22).counter, '스물두');
});

test('golden: prices', () => {
  eq(K.price(1200000), '백이십만 원');
  eq(K.romanize('백이십만 원'), 'baegisimman won');
  eq(K.price(35000), '삼만 오천 원');
  const p = K.parsePrice('3만 5천 원');
  eq(p.ok, true);
  eq(p.digits, '35000');
  eq(p.reading, '삼만 오천 원');
});

test('golden: time', () => {
  eq(K.readTime('15:45').withPeriod, '오후 세 시 사십오 분');
  eq(K.readTime('2:30').half, '두 시 반');
});
