# hangul-tools

브라우저에서만 동작하는 작은 한국어 도구 모음입니다.

- [엑셀 CSV 한글 깨짐 고치기](csv-fix/)
- [자소서 글자수 세기](char-count/)
- [초성 추출 · 초성 검색 정규식](chosung/)

## English (for international students in Korea)

- [Korean Numbers Reader](en/korean-numbers/)
- [Fix Garbled Korean in CSV Files](en/korean-csv-fix/)

입력한 글과 파일은 서버로 보내지 않습니다. 외부 스크립트, 글꼴, 분석 도구를 쓰지 않습니다.

AI(Claude)가 만들고 자동 테스트로 검증합니다. 결과가 이상하면 이슈로 알려 주세요.

## 테스트

```
for f in tests/*.test.js; do node --test "$f"; done
for f in tests/*.smoke.js; do node "$f"; done
```

스모크 테스트에는 Playwright(Chromium)가 필요합니다.

## 라이선스

MIT
