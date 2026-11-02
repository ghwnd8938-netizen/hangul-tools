#!/usr/bin/env python3
"""Optional check: run the spreadsheet formula from chosung/tool.js in a real spreadsheet engine.

    python3 tests/chosung.libreoffice.py

LibreOffice Calc older than 24.8 has no LET or SEQUENCE, so this script inlines the two LET
bindings and replaces SEQUENCE(LEN(A1)) with ROW(INDIRECT("1:"&LEN(A1))). Every other token of
the exported Excel formula (UNICODE, MID, INT, IF over arrays, IFERROR, TEXTJOIN, the 19-letter
string, 44032/55203/588) is used exactly as exported. The result of every row is compared with
getChosung(). This is not a test of Excel or Google Sheets themselves.

Needs: node, LibreOffice (soffice) and its Python UNO bridge. Exits 0 with "SKIPPED" if missing.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, '..', 'chosung', 'tool.js')

NODE_SNIPPET = r"""
const C = require(process.argv[1]);
const F = C.EXCEL_FORMULA;
const m = /^=IF\(A1="","",LET\(chars,(MID\(A1,SEQUENCE\(LEN\(A1\)\),1\)),codes,(IFERROR\(UNICODE\(chars\),0\)),(.*)\)\)$/.exec(F);
if (!m) { console.error('unexpected formula shape: ' + F); process.exit(3); }
const charsExpr = m[1].replace('SEQUENCE(LEN(A1))', 'ROW(INDIRECT("1:"&LEN(A1)))');
const codesExpr = m[2].replace('chars', charsExpr);
const body = m[3].replace(/\bcodes\b/g, codesExpr).replace(/\bchars\b/g, charsExpr);
const formula = '=IF(A1="";"";' + body.replace(/,/g, ';') + ')';
const ch = (c) => String.fromCodePoint(c);
let all = '';
for (let c = 0xAC00; c <= 0xD7A3; c++) all += ch(c);
let bounds = '', outside = '';
for (let i = 0; i < 19; i++) {
  bounds += ch(0xAC00 + i * 588) + ch(0xAC00 + i * 588 + 587);
  outside += ch(0xAC00 + i * 588 - 1) + ch(0xAC00 + i * 588 + 588);
}
const inputs = ['홍길동', '대한민국 만세', '홍길동 Hello 123!', '가' + ch(0x1F600) + '나', ch(0x1F600),
  'ㅋㅋ 좋아요ㅠ', 'Ünïcödé 東京 Москва', 'a"b', ch(0x20000) + '한자', '가' + ch(10) + '나', bounds, outside,
  '2024', ch(0x1F468) + ch(0x200D) + ch(0x1F469) + ' 가족', all.slice(0, 5586), all.slice(5586)];
process.stdout.write(JSON.stringify({ formula, inputs, expected: inputs.map((s) => C.getChosung(s)) }));
"""


def main():
    try:
        import uno  # noqa: F401
        from com.sun.star.beans import PropertyValue
    except ImportError:
        print('SKIPPED: Python UNO bridge (LibreOffice) not available')
        return 0
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice or not shutil.which('node'):
        print('SKIPPED: soffice or node not found')
        return 0

    cases = json.loads(subprocess.check_output(['node', '-e', NODE_SNIPPET, TOOL]).decode('utf-8'))
    profile = tempfile.mkdtemp(prefix='lo-profile-')
    port = 2000 + os.getpid() % 5000
    proc = subprocess.Popen([soffice, '--headless', '--invisible', '--norestore', '--nologo',
                             '-env:UserInstallation=file://' + profile,
                             '--accept=socket,host=127.0.0.1,port=%d;urp;' % port],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    desktop = None
    failures = 0
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = None
        for _ in range(120):
            try:
                ctx = resolver.resolve('uno:socket,host=127.0.0.1,port=%d;urp;StarOffice.ComponentContext' % port)
                break
            except Exception:
                time.sleep(0.5)
        if ctx is None:
            print('FAILED: could not connect to soffice')
            return 1
        desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        hidden = PropertyValue()
        hidden.Name, hidden.Value = 'Hidden', True
        doc = desktop.loadComponentFromURL('private:factory/scalc', '_blank', 0, (hidden,))
        sheet = doc.Sheets.getByIndex(0)
        inputs = cases['inputs']
        for i, s in enumerate(inputs):
            sheet.getCellByPosition(0, i).setString(s)
            sheet.getCellRangeByName('B%d' % (i + 1)).setArrayFormula(cases['formula'].replace('A1', 'A%d' % (i + 1)))
        empty_row = len(inputs) + 1  # A is left empty: the IF(A1="","",...) guard
        sheet.getCellRangeByName('B%d' % empty_row).setArrayFormula(cases['formula'].replace('A1', 'A%d' % empty_row))
        doc.calculateAll()
        for i, s in enumerate(inputs):
            cell = sheet.getCellByPosition(1, i)
            got, exp = cell.getString(), cases['expected'][i]
            if cell.getError() != 0 or got != exp:
                failures += 1
                print('FAIL row %d: %r -> %r (error %d), expected %r' % (i + 1, s[:30], got[:40], cell.getError(), exp[:40]))
        empty = sheet.getCellByPosition(1, empty_row - 1)
        if empty.getError() != 0 or empty.getString() != '':
            failures += 1
            print('FAIL empty cell -> %r (error %d)' % (empty.getString(), empty.getError()))
        print('LibreOffice: %d/%d rows equal getChosung, empty cell -> %r'
              % (len(inputs) - failures, len(inputs), empty.getString()))
        doc.close(True)
    finally:
        try:
            if desktop is not None:
                desktop.terminate()
        except Exception:
            pass
        time.sleep(1)
        proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
    print('LIBREOFFICE CHECK ' + ('FAILED' if failures else 'PASSED'))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
