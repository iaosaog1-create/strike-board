/* 시각별 저장 · 보고서 (관리자·최고관리자): 08:30 / 11:00 / 12:30 / 22:00 저장 → 화면·엑셀·PDF(A4 인쇄) */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, bizDivs, divName, divTone, shortDiv, printNode } = window.APP;
  const O = window.APP.ops;
  const X = window.XLSX_LITE;
  const PRESET = ['08:30', '11:00', '12:30', '22:00'];
  const S = { date: null, sel: null, basis: null };
  const q = async (p) => { const r = await p; if (r.error) throw r.error; return r.data || []; };
  const ATT_COLS = [['day_off', '휴무'], ['annual', '연차'], ['health', '보건·검진'], ['leave_long', '휴직'], ['sick', '병가'], ['other', '기타'], ['abnormal', '비정상상황 참여']];
  const pctTxt = (p) => (p == null ? '-' : p + '%');
  const dotDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}(${'일월화수목금토'[d.getUTCDay()]})`; };

  /* 저장본 + 구역 정보 → 보고서 모형 (화면·엑셀·인쇄가 같은 숫자를 씁니다) */
  function buildModel(snap, zones, basis) {
    const d = snap.data || {};
    const rows = d.zones || [], quota = d.quota || [];
    const inB = (x) => basis.includes(x.shift);
    const divs = bizDivs();
    const sumRows = divs.map((dv) => {
      const s = O.sumBy(rows, (x) => x.division_id === dv.id && inB(x)); const qq = O.quotaSum(quota, dv.id, basis);
      return { name: shortDiv(dv.name), tone: divTone(dv.id), biz: s.biz, sup: s.sup, coop: s.coop, total: s.total, quota: qq, pct: O.pct(s.total, qq) };
    });
    const tot = sumRows.reduce((a, r) => ({ biz: a.biz + r.biz, sup: a.sup + r.sup, coop: a.coop + r.coop, total: a.total + r.total, quota: a.quota + r.quota }), { biz: 0, sup: 0, coop: 0, total: 0, quota: 0 });
    tot.pct = O.pct(tot.total, tot.quota); tot.name = '소계';
    const zoneRows = [];
    for (const dv of divs) {
      const zs = zones.filter((z) => z.division_id === dv.id && (z.active || rows.some((r) => r.zone_id === z.id)));
      for (const g of O.groupZones(zs)) for (const f of g.floors) for (const z of f.zones) {
        const s = O.sumBy(rows, (x) => x.zone_id === z.id && inB(x));
        zoneRows.push({ div: shortDiv(dv.name), side: g.side, floor: f.floor, name: O.zoneName(z), required: z.required, biz: s.biz, sup: s.sup, coop: s.coop, total: s.total, pct: O.pct(s.total, z.required) });
      }
    }
    const att = divs.map((dv) => {
      const acc = { present: null, day_off: 0, annual: 0, health: 0, leave_long: 0, sick: 0, other: 0, abnormal: 0 }; let from = new Set();
      for (const sh of basis) {
        const a = (d.attendance || []).find((x) => x.division_id === dv.id && x.shift === sh);
        const l = (d.leave || []).find((x) => x.division_id === dv.id && x.shift === sh);
        const v = a || (l ? { day_off: l.day_off, annual: l.annual, health: l.health, leave_long: l.hold, sick: l.sick, other: l.other } : null);
        if (!v) continue; from.add(a ? '입력' : '자동');
        if (a) acc.present = (acc.present || 0) + a.present;
        for (const [k] of ATT_COLS) acc[k] += v[k] || 0;
      }
      return { name: shortDiv(dv.name), ...acc, src: from.size === 2 ? '입력+자동' : [...from][0] || '-' };
    });
    return { title: '환경미화 비정상상황 근무 현황', stamp: `${dotDate(snap.work_date)} ${snap.label} 기준`, basis, sumRows, tot, zoneRows, att, coopIn: d.coop_in || 0 };
  }

  /* 화면·인쇄용 */
  function reportNode(m) {
    const th = (...h) => el('thead', {}, el('tr', {}, ...h.map((x) => el('th', {}, x))));
    const sumTbl = el('table', { class: 'rtbl' }, th('구분', '현장투입', '행정인력', '협정사', '합계', '일일근무정원', '상근 대비'),
      el('tbody', {}, [...m.sumRows, m.tot].map((r, i, a) => el('tr', { class: i === a.length - 1 ? 'sum' : '' },
        el('th', { class: r.tone || '' }, r.name), el('td', {}, r.biz), el('td', {}, r.sup), el('td', {}, r.coop), el('td', { class: 'b' }, r.total), el('td', {}, r.quota || '-'), el('td', { class: 'b' }, pctTxt(r.pct))))));
    let prev = '';
    const zTbl = el('table', { class: 'rtbl zr' }, th('사업부', '구분·층', '구역', '필요', '현장투입', '행정', '협정', '합계', '달성'),
      el('tbody', {}, m.zoneRows.length ? m.zoneRows.map((r) => {
        const head = `${r.div}|${r.side} ${r.floor}`; const first = head !== prev; prev = head;
        return el('tr', {}, el('th', {}, first ? r.div : ''), el('td', { class: 'l' }, first ? `${r.side} ${r.floor}` : ''), el('td', { class: 'l' }, r.name), el('td', {}, r.required),
          el('td', {}, r.biz), el('td', {}, r.sup), el('td', {}, r.coop), el('td', { class: 'b' }, r.total), el('td', { class: 'b' }, pctTxt(r.pct)));
      }) : [el('tr', {}, el('td', { colspan: '9' }, '등록된 구역이 없습니다'))]));
    const attTbl = el('table', { class: 'rtbl' }, th('구분', '출근', ...ATT_COLS.map(([, l]) => l), '출처'),
      el('tbody', {}, m.att.map((r) => el('tr', {}, el('th', {}, r.name), el('td', {}, r.present == null ? '-' : r.present), ...ATT_COLS.map(([k]) => el('td', {}, r[k])), el('td', {}, r.src)))));
    return el('div', { class: 'rpt' },
      el('div', { class: 'rhead' }, el('h1', {}, m.title), el('p', {}, m.stamp), el('small', {}, `기준 근무조: ${m.basis.join('·') || '없음'} · 협정 출근 ${m.coopIn}명`)),
      el('section', {}, el('h3', {}, '1. 사업부별 근무 인원'), sumTbl, el('p', { class: 'rnote' }, '상근 대비(%) = 근무 인원 합계 ÷ 기준 근무조의 일일근무정원')),
      el('section', { class: 'grow' }, el('h3', {}, '2. 구역별 근무 인원'), zTbl),
      el('section', {}, el('h3', {}, '3. 출근 현황'), attTbl, el('p', { class: 'rnote' }, '출처 "자동" = 업로드한 휴무계획·ERP 근태 집계, "입력" = 팀장이 입력한 값')),
      el('div', { class: 'rfoot' }, '인천공항운영서비스'));
  }

  function toExcel(m) {
    const H = (v) => ({ v, s: 'hdr' });
    const rowOf = (r, last) => [{ v: r.name, s: last ? 'sumtxt' : 'txt' }, ...[r.biz, r.sup, r.coop, r.total].map((v) => ({ v, s: last ? 'sumnum' : 'num' })), { v: r.quota || 0, s: last ? 'sumnum' : 'num' }, { v: r.pct == null ? '-' : r.pct / 100, s: r.pct == null ? 'txt' : 'pct' }];
    const s1 = { name: '사업부별', widths: [16, 12, 12, 12, 12, 14, 12], merges: ['A1:G1'], rows: [
      [{ v: `${m.title} - ${m.stamp}`, s: 'title' }], [`기준 근무조: ${m.basis.join('·')}`], [],
      ['구분', '현장투입', '행정인력', '협정사', '합계', '일일근무정원', '상근 대비'].map(H),
      ...m.sumRows.map((r) => rowOf(r, false)), rowOf(m.tot, true)] };
    const s2 = { name: '구역별', widths: [14, 14, 28, 8, 12, 8, 8, 8, 10], rows: [
      ['사업부', '구분·층', '구역', '필요', '현장투입', '행정', '협정', '합계', '달성'].map(H),
      ...m.zoneRows.map((r) => [r.div, `${r.side} ${r.floor}`, r.name, r.required, r.biz, r.sup, r.coop, r.total, { v: r.pct == null ? '-' : r.pct / 100, s: r.pct == null ? 'txt' : 'pct' }])] };
    const s3 = { name: '출근현황', widths: [16, 8, 8, 8, 12, 8, 8, 8, 16, 10], rows: [
      ['구분', '출근', ...ATT_COLS.map(([, l]) => l), '출처'].map(H),
      ...m.att.map((r) => [r.name, r.present == null ? '-' : r.present, ...ATT_COLS.map(([k]) => r[k]), r.src])] };
    return X.write([s1, s2, s3]);
  }

  async function reportView(body) {
    await O.ensureShifts();
    if (!S.date) S.date = O.today();
    const redraw = () => reportView(body);
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    let snaps, zones;
    try { [snaps, zones] = await Promise.all([
      q(sb.from('snapshots').select('id,work_date,label,taken_at').eq('work_date', S.date).order('taken_at')),
      q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active'))]); }
    catch (e) { body.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }

    const inp = el('input', { type: 'date', value: S.date, 'aria-label': '날짜' });
    inp.addEventListener('change', () => { if (inp.value) { S.date = inp.value; S.sel = null; redraw(); } });
    const step = (n) => () => { S.date = O.addDays(S.date, n); S.sel = null; redraw(); };
    const take = async (label) => {
      const { error } = await sb.rpc('take_snapshot', { p_date: S.date, p_label: label, p_note: null });
      if (error) return toast('저장하지 못했습니다. 권한을 확인하세요', 'err');
      toast(`${label} 현황을 저장했습니다`); S.sel = null; redraw();
    };
    const custom = el('input', { type: 'text', maxlength: '10', placeholder: '예: 14:00', 'aria-label': '시각 이름' });
    const customBtn = el('button', { class: 'btn ghost sm', type: 'button' }, '이 시각으로 저장');
    customBtn.addEventListener('click', busy(customBtn, async () => { const l = custom.value.trim(); if (!l) return toast('시각 이름을 입력하세요', 'err'); await take(l); }));
    const saveBox = el('div', { class: 'card' }, el('h2', {}, '현황 저장'),
      el('p', { class: 'hint' }, '버튼을 누른 순간의 전체 현황(구역별 인원·정원·출근 현황)이 통째로 저장되며, 나중에 바뀌지 않습니다.'),
      el('div', { class: 'datebar' }, el('button', { type: 'button', class: 'btn ghost sm', onclick: step(-1) }, '‹'), inp,
        el('button', { type: 'button', class: 'btn ghost sm', onclick: step(1) }, '›'), el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { S.date = O.today(); S.sel = null; redraw(); } }, '오늘')),
      el('div', { class: 'presets' }, ...PRESET.map((l) => { const b = el('button', { class: 'btn sm', type: 'button' }, `${l} 저장`); b.addEventListener('click', busy(b, () => take(l))); return b; })),
      el('div', { class: 'addrow' }, custom, customBtn));

    const list = el('div', { class: 'card' }, el('h2', {}, `${O.dateLabel(S.date)} 저장본 ${snaps.length}개`),
      snaps.length ? snaps.map((s) => el('button', { type: 'button', class: 'list-item' + (S.sel && S.sel.id === s.id ? ' sel' : ''), onclick: () => { S.sel = s; S.basis = null; redraw(); } },
        el('b', {}, s.label), el('span', { class: 'badge ok' }, '저장됨'), el('small', {}, `${O.hhmm(s.taken_at)}에 저장`), el('span', {}))) : el('p', { class: 'empty' }, '이 날짜에 저장된 현황이 없습니다'));

    /* 시각별 비교: 저장본이 2개 이상일 때 */
    const cmpHolder = el('div', {});
    const cmpBtn = el('button', { class: 'btn ghost sm', type: 'button' }, '시각별 비교 보기');
    cmpBtn.addEventListener('click', busy(cmpBtn, async () => {
      let all;
      try { all = await q(sb.from('snapshots').select('id,work_date,label,taken_at,data').eq('work_date', S.date).order('taken_at')); } catch (e) { return toast('불러오지 못했습니다', 'err'); }
      const ms = all.map((sn) => ({ sn, m: buildModel(sn, zones, O.basisFor(sn.label)) }));
      const names = ms[0].m.sumRows.map((r) => r.name);
      const head = el('tr', {}, el('th', {}, '구분'), ...ms.map((x) => el('th', {}, x.sn.label)), el('th', {}, '변화'));
      const rowOf = (name, get, fmt) => { const vals = ms.map((x) => get(x.m, name)); const d = vals[vals.length - 1] - vals[0];
        return el('tr', {}, el('th', {}, name), ...vals.map((v) => el('td', {}, fmt(v))), el('td', { class: 'b ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, d > 0 ? `+${d}` : String(d))); };
      const sumRow = (m, n) => (n === '소계' ? m.tot : m.sumRows.find((r) => r.name === n));
      const trs = [...names.map((n) => rowOf(n, (m, k) => sumRow(m, k).total, String)), rowOf('소계', (m, k) => sumRow(m, k).total, String),
        rowOf('상근 대비 %(소계)', (m) => m.tot.pct || 0, (v) => v + '%'),
        rowOf('부족 구역 수', (m) => m.zoneRows.filter((z) => z.required > 0 && z.total < z.required).length, String)];
      cmpHolder.replaceChildren(el('div', { class: 'tblwrap' }, el('table', { class: 'tbl cmp' }, el('thead', {}, head), el('tbody', {}, trs))),
        el('p', { class: 'hint' }, '각 저장본은 그 시각의 기준 근무조(08:30·11:00=오전+일근, 12:30=오전+오후+일근, 22:00=오후+야간)로 계산한 인원입니다'));
    }));
    const cmpCard = snaps.length >= 2 ? el('div', { class: 'card' }, el('h2', {}, '시각별 비교'), el('p', { class: 'hint' }, `${snaps.map((x) => x.label).join(' → ')} 인원 변화`), cmpBtn, cmpHolder) : null;
    const parts = [saveBox, cmpCard, list];
    if (S.sel) {
      let full;
      try { [full] = await q(sb.from('snapshots').select('id,work_date,label,taken_at,data').eq('id', S.sel.id)); } catch (e) { full = null; }
      if (full) {
        if (!S.basis) S.basis = O.basisFor(full.label);
        const draw = () => {
          const m = buildModel(full, zones, S.basis);
          const chips = el('div', { class: 'chips' }, ...O.shiftList().map((sh) => el('button', {
            type: 'button', class: 'chip' + (S.basis.includes(sh) ? ' on' : ''), 'aria-pressed': String(S.basis.includes(sh)),
            onclick: () => { S.basis = S.basis.includes(sh) ? S.basis.filter((x) => x !== sh) : [...S.basis, sh]; draw(); }
          }, sh)), el('button', { type: 'button', class: 'chip auto', onclick: () => { S.basis = O.basisFor(full.label); draw(); } }, '시각 기준으로'));
          const xl = el('button', { class: 'btn sm', type: 'button' }, '엑셀 다운로드');
          xl.addEventListener('click', () => X.download(`비정상상황_${full.work_date}_${full.label.replace(':', '')}.xlsx`, toExcel(m), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
          const pdf = el('button', { class: 'btn sm', type: 'button' }, 'PDF 출력 (A4)');
          pdf.addEventListener('click', () => printNode(reportNode(m)));
          const del = el('button', { class: 'btn danger sm', type: 'button' }, '이 저장본 삭제');
          del.addEventListener('click', busy(del, async () => {
            if (!window.confirm(`${full.label} 저장본을 삭제할까요? 되돌릴 수 없습니다.`)) return;
            const { error } = await sb.from('snapshots').delete().eq('id', full.id);
            if (error) return toast('삭제하지 못했습니다', 'err');
            toast('삭제했습니다'); S.sel = null; redraw();
          }));
          holder.replaceChildren(el('div', { class: 'card' }, el('h2', {}, `${full.label} 저장본`),
            el('div', { class: 'f' }, el('span', { class: 'hint' }, '상근 대비 기준 근무조'), chips),
            el('div', { class: 'btnrow' }, xl, pdf, del)),
            el('div', { class: 'card rptwrap' }, reportNode(m)));
        };
        const holder = el('div', {}); parts.push(holder); draw();
      }
    }
    body.replaceChildren(...parts);
  }

  window.APP.report = { buildModel };
  register('report', '시각별 저장·보고서', ['admin', 'master'], reportView, '08:30·11:00·12:30·22:00 현황 저장과 엑셀/PDF 출력');
})();
