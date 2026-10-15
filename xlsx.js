/* 엑셀(.xlsx) 읽기·쓰기 - 외부 엑셀 라이브러리 없이 zip(fflate) + XML 로 직접 처리 */
(() => {
  'use strict';
  const F = window.fflate;
  const parseXml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const isDateCode = (code) => {
    const c = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[yd]/i.test(c) && !/^general$/i.test(c);
  };
  const serialToIso = (n) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

  /* ---------- 읽기: 첫 번째 시트를 2차원 배열로 ---------- */
  function read(buf) {
    const files = F.unzipSync(new Uint8Array(buf));
    const get = (p) => (files[p] ? F.strFromU8(files[p]) : null);
    const textOf = (node) => [...node.getElementsByTagName('t')]
      .filter((t) => ['r', 'si', 'is'].includes(t.parentNode.nodeName)).map((t) => t.textContent).join('');

    const ss = [];
    const sst = get('xl/sharedStrings.xml');
    if (sst) for (const si of parseXml(sst).getElementsByTagName('si')) ss.push(textOf(si));

    const dateXf = [];
    const sty = get('xl/styles.xml');
    if (sty) {
      const doc = parseXml(sty);
      const custom = {};
      for (const nf of doc.getElementsByTagName('numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode');
      const xfs = doc.getElementsByTagName('cellXfs')[0];
      if (xfs) for (const xf of xfs.getElementsByTagName('xf')) {
        const id = xf.getAttribute('numFmtId');
        dateXf.push(BUILTIN_DATE.has(Number(id)) || (custom[id] != null && isDateCode(custom[id])));
      }
    }

    let path = 'xl/worksheets/sheet1.xml';
    const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const sh = parseXml(wb).getElementsByTagName('sheet')[0];
      const rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      for (const r of parseXml(rels).getElementsByTagName('Relationship')) {
        if (r.getAttribute('Id') === rid) {
          const t = r.getAttribute('Target');
          path = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
        }
      }
    }
    const sheet = get(path);
    if (!sheet) throw new Error('시트를 찾을 수 없습니다');
    const rows = [];
    for (const row of parseXml(sheet).getElementsByTagName('row')) {
      const arr = [];
      for (const c of row.getElementsByTagName('c')) {
        const i = colIdx(c.getAttribute('r') || 'A1');
        if (i > 200) continue;
        const t = c.getAttribute('t');
        const vEl = c.getElementsByTagName('v')[0];
        const v = vEl ? vEl.textContent : null;
        let val = null;
        if (t === 's') val = v == null ? null : ss[Number(v)];
        else if (t === 'inlineStr') val = textOf(c);
        else if (t === 'str') val = v;
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = null;
        else if (v != null && v !== '') {
          const n = Number(v);
          val = dateXf[Number(c.getAttribute('s'))] && Number.isFinite(n) ? serialToIso(n) : n;
        }
        arr[i] = val;
      }
      rows.push(Array.from(arr, (x) => (x === undefined ? null : x)));
      if (rows.length > 20000) break;
    }
    return rows;
  }

  /* 날짜 값 → 'YYYY-MM-DD' (문자열 '2026-10-24 00:00:00', '2026.10.24' 등도 허용) */
  function toIso(v) {
    if (v == null || v === '') return null;
    const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(v).trim());
    if (!m) return null;
    const mm = Number(m[2]), dd = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${m[1]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  /* ---------- 쓰기 ---------- */
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    // XML 에서 쓸 수 없는 제어 문자 제거
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  // 셀 스타일 번호: 0 기본, 1 제목, 2 머리글, 3 글자(테두리), 4 숫자(테두리), 5 퍼센트(테두리), 6 합계 글자, 7 합계 숫자
  const STYLE = { title: 1, hdr: 2, txt: 3, num: 4, pct: 5, sumtxt: 6, sumnum: 7, plain: 0 };
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="14"/><name val="Malgun Gothic"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDE3F0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs></styleSheet>`;

  /* sheets: [{ name, rows: [[cell,…],…], widths: [..] }]   cell = 값 또는 { v, s: 'hdr'|'txt'|'num'|'pct'|'sumtxt'|'sumnum'|'title' } */
  function write(sheets) {
    const enc = F.strToU8;
    const files = {};
    files['[Content_Types].xml'] = enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    files['_rels/.rels'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    files['xl/workbook.xml'] = enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(String(s.name).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    files['xl/_rels/workbook.xml.rels'] = enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    files['xl/styles.xml'] = enc(STYLES_XML);
    sheets.forEach((sh, si) => {
      let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
      if (sh.widths) xml += '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
      xml += '<sheetData>';
      sh.rows.forEach((row, ri) => {
        xml += `<row r="${ri + 1}">`;
        row.forEach((cell, ci) => {
          if (cell == null || cell === '') return;
          const obj = typeof cell === 'object' ? cell : { v: cell };
          const isNum = typeof obj.v === 'number' && Number.isFinite(obj.v);
          const sname = obj.s || (isNum ? 'num' : 'txt');
          const ref = colName(ci) + (ri + 1);
          xml += isNum
            ? `<c r="${ref}" s="${STYLE[sname]}"><v>${obj.v}</v></c>`
            : `<c r="${ref}" s="${STYLE[sname]}" t="inlineStr"><is><t xml:space="preserve">${esc(obj.v)}</t></is></c>`;
        });
        xml += '</row>';
      });
      xml += '</sheetData>' + (sh.merges && sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') + '</worksheet>';
      files[`xl/worksheets/sheet${si + 1}.xml`] = enc(xml);
    });
    return F.zipSync(files);
  }

  function download(name, bytes, type) {
    const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.XLSX_LITE = { read, write, toIso, download };
})();
