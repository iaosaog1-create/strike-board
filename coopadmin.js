/* 협정 출퇴근 (총괄팀장·관리자): 오늘 출근 확인·구역 배치 · 기간 기록/엑셀/보고서 · 명단 합치기 · QR · 협정사 업체 */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, bizDivs, divName, shortDiv, divTone, printNode } = window.APP;
  const { today, addDays, hhmm, dateLabel, ensureShifts, zoneName, zoneSort } = window.APP.ops;
  const X = window.XLSX_LITE;
  const S = { tab: 'today', date: null, to: null, division: null, zone: '', sel: new Map(), key: '', merge: null };
  const q = async (p) => { const r = await p; if (r.error) throw r.error; return r.data || []; };
  const errMsg = (e) => (e && e.message && /[가-힣]/.test(e.message) && !/violates|constraint/.test(e.message) ? e.message : '처리하지 못했습니다. 입력값과 권한을 확인하세요');
  const qrUrl = (token) => new URL('coop.html?p=' + encodeURIComponent(token), window.location.href).href;
  const dotDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}(${'일월화수목금토'[d.getUTCDay()]})`; };
  function qrImg(url, cell) {
    const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
    return el('img', { class: 'qr', src: qr.createDataURL(cell || 6, 2), alt: 'QR 코드' });
  }
  const isChief = () => state.me.role === 'chief';
  const TABS = () => [['today', '오늘 출근·배치'], ['range', '기간 기록·엑셀'], ['people', '명단·합치기'], ['places', 'QR'], ...(isChief() ? [] : [['vendors', '협정사 업체']])];

  async function coopView(body) {
    await ensureShifts();
    if (!S.date) S.date = today();
    if (!S.to) S.to = S.date;
    if (isChief()) S.division = state.me.division_id; else if (!S.division) S.division = (bizDivs()[0] || {}).id;
    if (!TABS().some(([k]) => k === S.tab)) S.tab = 'today';
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    let vendors, places, zones, log, people = [];
    try {
      [vendors, places, zones] = await Promise.all([
        q(sb.from('coop_vendors').select('id,name,active').order('name')),
        q(sb.from('coop_places').select('id,name,qr_token,zone_id,division_id,active').order('name')),
        q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active'))]);
      const to = S.tab === 'range' ? S.to : S.date;
      log = S.tab === 'places' || S.tab === 'vendors' || S.tab === 'people' ? [] : await q(sb.rpc('coop_roster', { p_from: S.date, p_to: to, p_division: S.division }));
      if (S.tab === 'people') people = await q(sb.rpc('coop_people_list', { p_division: S.division }));
    } catch (e) { body.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const missing = bizDivs().filter((d) => !places.some((p) => p.division_id === d.id && p.active));
    if (missing.length && !isChief()) {
      try {
        await sb.from('coop_places').insert(missing.map((d) => ({ name: `${shortDiv(d.name)} 협정 출퇴근`, division_id: d.id })));
        places = await q(sb.from('coop_places').select('id,name,qr_token,zone_id,division_id,active').order('name'));
      } catch (e) { /* 권한이 없으면 건너뜀 */ }
    }
    const D = { vendors, places, zones, log, people };
    const redraw = () => coopView(body);
    const key = `${S.date}|${S.division}`;
    if (S.key !== key) { S.key = key; S.sel = new Map(); log.forEach((r) => S.sel.set(r.log_id, r.zone_id || 0)); }
    else log.forEach((r) => { if (!S.sel.has(r.log_id)) S.sel.set(r.log_id, r.zone_id || 0); });
    const tabs = seg(TABS(), S.tab, (v) => { S.tab = v; S.key = ''; redraw(); });
    const pane = { today: todayPane, range: rangePane, people: peoplePane, places: placesPane, vendors: vendorsPane }[S.tab](D, redraw);
    body.replaceChildren(tabs, divBar(redraw), pane);
  }

  function divBar(redraw) {
    if (isChief() || S.tab === 'vendors' || S.tab === 'places') return null;
    return seg(bizDivs().map((d) => [String(d.id), shortDiv(d.name)]), String(S.division), (v) => { S.division = Number(v); S.key = ''; redraw(); });
  }
  const zoneLabel = (D, id) => { const z = D.zones.find((x) => x.id === id); return z ? `${z.floor} ${zoneName(z)}` : '미배치'; };
  const vendorOf = (r) => r.vendor || '-';

  function dateBar(redraw, range) {
    const inp = el('input', { type: 'date', value: S.date, 'aria-label': range ? '시작 날짜' : '날짜' });
    inp.addEventListener('change', () => { if (inp.value) { S.date = inp.value; if (S.to < S.date || !range) S.to = S.date; redraw(); } });
    const step = (n) => () => { S.date = addDays(S.date, n); if (!range || S.to < S.date) S.to = S.date; redraw(); };
    const kids = [el('button', { type: 'button', class: 'btn ghost sm', onclick: step(-1) }, '‹'), inp];
    if (range) {
      const to = el('input', { type: 'date', value: S.to, 'aria-label': '끝 날짜' });
      to.addEventListener('change', () => { if (to.value) { S.to = to.value < S.date ? S.date : to.value; redraw(); } });
      kids.push(el('span', { class: 'hint' }, '~'), to);
    }
    kids.push(el('button', { type: 'button', class: 'btn ghost sm', onclick: step(1) }, '›'),
      el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { S.date = today(); S.to = S.date; redraw(); } }, '오늘'));
    return el('div', { class: 'card pick' }, el('div', { class: 'datebar' }, ...kids));
  }

  /* ---- 오늘 출근·배치 ---- */
  function todayPane(D, redraw) {
    const rows = D.log;
    const zs = D.zones.filter((z) => z.division_id === S.division && z.active).sort(zoneSort);
    const zSel = el('select', { 'aria-label': '배치할 구역' }, el('option', { value: '' }, '구역을 고르세요'),
      ...zs.map((z) => el('option', { value: z.id }, `${z.side} ${z.floor} · ${zoneName(z)}`)));
    zSel.value = S.zone; zSel.addEventListener('change', () => { S.zone = zSel.value; });
    const waitIn = rows.filter((r) => !r.in_ok).length;
    const waitOut = rows.filter((r) => r.out_at && !r.out_ok).length;
    const unplaced = rows.filter((r) => !S.sel.get(r.log_id)).length;
    const noOut = rows.filter((r) => !r.out_at).length;
    const drawSelf = () => redraw();
    const tap = (r) => () => {
      const cur = S.sel.get(r.log_id) || 0; const z = S.zone ? Number(S.zone) : 0;
      if (!z && !cur) return toast('먼저 위에서 구역을 고르세요', 'err');
      if (!cur) S.sel.set(r.log_id, z);
      else if (cur !== z && z) { S.sel.set(r.log_id, z); toast(`${r.name}님 구역을 바꿨습니다`); }
      else S.sel.set(r.log_id, 0);
      drawSelf();
    };
    const save = el('button', { class: 'btn', type: 'button' }, '구역 배치 저장');
    save.addEventListener('click', busy(save, async () => {
      const { error } = await sb.rpc('coop_assign', { p_date: S.date, p_division: S.division, p_rows: rows.map((r) => ({ log_id: r.log_id, zone_id: S.sel.get(r.log_id) || null })) });
      if (error) return toast(errMsg(error), 'err');
      toast('구역 배치를 저장했습니다. 구역별 인원이 현황에 반영됩니다'); S.key = ''; redraw();
    }));
    const confirm = (ids, kind, msg) => async () => {
      if (!ids.length) return toast('확인할 항목이 없습니다');
      const { error } = await sb.rpc('coop_confirm', { p_ids: ids, p_kind: kind });
      if (error) return toast(errMsg(error), 'err');
      toast(msg); redraw();
    };
    const sessions = ['오전', '오후'].map((ses) => {
      const rs = rows.filter((r) => r.session === ses);
      if (!rs.length) return null;
      const cards = rs.map((r) => {
        const z = S.sel.get(r.log_id) || 0;
        return el('button', { type: 'button', class: 'pp' + (z ? ' on' : ''), 'aria-pressed': String(!!z), onclick: tap(r) },
          el('b', {}, r.name), el('small', {}, z ? `✔ ${String(zoneName(D.zones.find((x) => x.id === z) || {})).split('·').pop().trim()}` : vendorOf(r)));
      });
      const confirmBtn = (r, kind) => {
        const ok = kind === 'in' ? r.in_ok : r.out_ok;
        if (kind === 'out' && !r.out_at) return el('span', { class: 'cp-wait' }, '근무 중');
        if (ok) return el('span', { class: 'cp-ok' }, `✓ ${(kind === 'in' ? r.in_ok_by : r.out_ok_by) || '확인'}`);
        const b = el('button', { class: 'btn ghost sm', type: 'button' }, '확인'); b.addEventListener('click', busy(b, confirm([r.log_id], kind, '확인했습니다'))); return b;
      };
      const tbl = el('div', { class: 'tblwrap' }, el('table', { class: 'tbl left' },
        el('thead', {}, el('tr', {}, ...['이름', '협정사', '구역', '출근·서명', '확인', '퇴근·서명', '확인'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rs.map((r) => el('tr', {}, el('th', {}, r.name), el('td', {}, vendorOf(r)), el('td', {}, zoneLabel(D, S.sel.get(r.log_id) || 0)),
          el('td', {}, `${hhmm(r.in_at)} `, el('span', { class: 'cp-sign' }, r.in_sign)), el('td', {}, confirmBtn(r, 'in')),
          el('td', {}, r.out_at ? [`${hhmm(r.out_at)} `, el('span', { class: 'cp-sign' }, r.out_sign || '')] : '-'), el('td', {}, confirmBtn(r, 'out')))))));
      const allOk = el('button', { class: 'btn ghost sm', type: 'button' }, `${ses} 전체 확인`);
      allOk.addEventListener('click', busy(allOk, confirm(rs.map((r) => r.log_id), 'both', `${ses} 출퇴근을 모두 확인했습니다`)));
      return el('div', { class: 'card' }, el('h2', {}, `${ses}조 · 출근 ${rs.length}명`), el('div', { class: 'ppgrid' }, cards), tbl, el('div', { class: 'actions' }, allOk));
    });
    return el('div', {}, dateBar(redraw),
      el('div', { class: 'ck-tiles' }, ...[['출근', rows.length, 'ok'], ['미배치', unplaced, unplaced ? 'mid' : 'ok'], ['확인 대기', waitIn + waitOut, waitIn + waitOut ? 'mid' : 'ok'], ['퇴근 전', noOut, '']]
        .map(([l, v, c]) => el('div', { class: 'ck-tile ' + c }, el('b', {}, String(v)), el('span', {}, l)))),
      rows.length ? el('div', { class: 'card' }, el('h2', {}, `${dateLabel(S.date)} 구역 배치`),
        el('label', { class: 'f' }, el('span', {}, '① 배치할 구역'), zSel),
        el('p', { class: 'hint' }, '② 아래 이름을 누르면 선택한 구역에 배치됩니다. 다시 누르면 취소, 다른 구역을 고르고 누르면 구역이 바뀝니다.'),
        el('div', { class: 'actions' }, save))
        : el('div', { class: 'card' }, el('p', { class: 'empty' }, '이 날짜의 협정 출근 기록이 없습니다. 협정인력이 QR로 출근하면 이름이 바로 나타납니다')),
      ...sessions);
  }

  /* ---- 기간 기록 · 엑셀 · 보고서 ---- */
  const excelSheets = (rows, divLabel, zmapFn) => {
    const H = (v) => ({ v, s: 'hdr' });
    const base = (r) => [dotDate(r.work_date), r.session, r.name, r.vendor || '-', zmapFn(r.division_id, r.zone_id)];
    const detail = { name: '출퇴근 기록', widths: [16, 8, 12, 16, 28, 10, 12, 12, 10, 12, 12], rows: [['날짜', '구분', '이름', '협정사', '배치 구역', '출근 시각', '출근 서명', '출근 확인', '퇴근 시각', '퇴근 서명', '퇴근 확인'].map(H),
      ...rows.map((r) => [...base(r), hhmm(r.in_at), r.in_sign, r.in_ok ? r.in_ok_by || '확인' : '미확인', r.out_at ? hhmm(r.out_at) : '퇴근 기록 없음', r.out_sign || '', r.out_at ? (r.out_ok ? r.out_ok_by || '확인' : '미확인') : ''])] };
    const days = [...new Set(rows.map((r) => r.work_date))].sort();
    const sum = { name: '일자별 요약', widths: [16, 10, 10, 10, 12, 12], rows: [['날짜', '오전 출근', '오후 출근', '합계', '퇴근 기록 없음', '확인 대기'].map(H),
      ...days.map((d) => { const rs = rows.filter((r) => r.work_date === d); return [dotDate(d), rs.filter((r) => r.session === '오전').length, rs.filter((r) => r.session === '오후').length, rs.length, rs.filter((r) => !r.out_at).length, rs.filter((r) => !r.in_ok || (r.out_at && !r.out_ok)).length]; })] };
    return [detail, sum];
  };
  function rangePane(D, redraw) {
    const rows = D.log;
    const zmapFn = (div, id) => { const z = D.zones.find((x) => x.id === id); return z ? `${z.side} ${z.floor} ${zoneName(z)}` : '구역 미배치'; };
    const dl = el('button', { class: 'btn', type: 'button' }, '엑셀 다운로드');
    dl.addEventListener('click', () => { if (!rows.length) return toast('내려받을 기록이 없습니다'); X.download(`협정출퇴근_${shortDiv(divName(S.division))}_${S.date}${S.to !== S.date ? '_' + S.to : ''}.xlsx`, X.write(excelSheets(rows, '', zmapFn)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
    const all = el('button', { class: 'btn ghost', type: 'button' }, '엑셀 (전체 사업부)');
    all.addEventListener('click', busy(all, async () => {
      const sheets = [];
      for (const d of bizDivs()) {
        const rs = await q(sb.rpc('coop_roster', { p_from: S.date, p_to: S.to, p_division: d.id }));
        const sh = excelSheets(rs, '', zmapFn); sh[0].name = `${shortDiv(d.name)} 기록`; sh[1].name = `${shortDiv(d.name)} 요약`; sheets.push(...sh);
      }
      X.download(`협정출퇴근_전체_${S.date}${S.to !== S.date ? '_' + S.to : ''}.xlsx`, X.write(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }));
    const pr = el('button', { class: 'btn ghost', type: 'button' }, '보고서 인쇄·PDF');
    pr.addEventListener('click', () => {
      if (!rows.length) return toast('인쇄할 기록이 없습니다');
      const th = (...h) => el('thead', {}, el('tr', {}, ...h.map((x) => el('th', {}, x))));
      printNode(el('div', { class: 'rpt' },
        el('div', { class: 'rhead' }, el('h1', {}, '협정인력 출퇴근 확인서'), el('p', {}, `${divName(S.division)} · ${dotDate(S.date)}${S.to !== S.date ? ' ~ ' + dotDate(S.to) : ''}`), el('small', {}, `총 ${rows.length}건`)),
        el('section', { class: 'grow' }, el('table', { class: 'rtbl' }, th('날짜', '구분', '이름', '협정사', '배치 구역', '출근', '서명', '퇴근', '서명', '확인'),
          el('tbody', {}, rows.map((r) => el('tr', {}, el('td', {}, dotDate(r.work_date).slice(5)), el('td', {}, r.session), el('th', {}, r.name), el('td', {}, vendorOf(r)), el('td', {}, zmapFn(r.division_id, r.zone_id)),
            el('td', {}, hhmm(r.in_at)), el('td', {}, r.in_sign), el('td', {}, r.out_at ? hhmm(r.out_at) : '-'), el('td', {}, r.out_sign || ''), el('td', {}, r.in_ok && (!r.out_at || r.out_ok) ? (r.in_ok_by || '확인') : '미확인')))))),
        el('div', { class: 'rfoot' }, '인천공항운영서비스')));
    });
    const list = el('div', { class: 'card' }, el('h2', {}, `${shortDiv(divName(S.division))} 기록 ${rows.length}건`),
      rows.length ? el('div', { class: 'tblwrap' }, el('table', { class: 'tbl left' },
        el('thead', {}, el('tr', {}, ...['날짜', '구분', '이름', '협정사', '구역', '출근', '퇴근', '확인'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, el('td', {}, dotDate(r.work_date).slice(5)), el('td', {}, r.session), el('th', {}, r.name), el('td', {}, vendorOf(r)), el('td', {}, zmapFn(r.division_id, r.zone_id)),
          el('td', {}, hhmm(r.in_at)), el('td', {}, r.out_at ? hhmm(r.out_at) : '-'), el('td', {}, r.in_ok && (!r.out_at || r.out_ok) ? el('span', { class: 'cp-ok' }, '✓') : el('span', { class: 'cp-wait' }, '대기')))))))
        : el('p', { class: 'empty' }, '기간 안에 기록이 없습니다'));
    return el('div', {}, dateBar(redraw, true), el('div', { class: 'card' }, el('div', { class: 'actions' }, dl, pr, isChief() ? null : all)), list);
  }

  /* ---- 명단 · 합치기 (이름 오타로 둘로 나뉜 경우) ---- */
  function peoplePane(D, redraw) {
    const ps = D.people;
    const sel = S.merge && ps.find((p) => p.person_id === S.merge);
    const list = el('div', { class: 'card' }, el('h2', {}, `협정인력 ${ps.length}명`),
      el('p', { class: 'hint' }, '같은 사람이 이름 철자 등으로 둘로 나뉘었다면, 합칠 사람을 눌러 하나로 합칩니다.'),
      ps.length ? ps.map((p) => el('div', { class: 'zrow' }, el('div', {}, el('b', {}, p.name), el('small', {}, `${p.vendor || '협정사 없음'} · 출근 ${p.days}회 · 최근 ${p.last_date}`)),
        el('div', { class: 'zact' }, el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.merge = p.person_id; redraw(); } }, '합치기')))) : el('p', { class: 'empty' }, '아직 출근한 협정인력이 없습니다'));
    if (!sel) return el('div', {}, list);
    const tgt = el('select', { 'aria-label': '합칠 대상' }, ...ps.filter((p) => p.person_id !== sel.person_id).map((p) => el('option', { value: p.person_id }, `${p.name} · ${p.vendor || '협정사 없음'}`)));
    const go = el('button', { class: 'btn danger', type: 'button' }, '합치기');
    go.addEventListener('click', busy(go, async () => {
      if (!tgt.value) return toast('합칠 대상을 고르세요', 'err');
      if (!window.confirm(`${sel.name}님의 기록을 선택한 사람으로 옮기고, ${sel.name}님은 명단에서 지웁니다. 계속할까요?`)) return;
      const { error } = await sb.rpc('coop_merge', { p_from: sel.person_id, p_to: Number(tgt.value), p_division: S.division });
      if (error) return toast(errMsg(error), 'err');
      toast('합쳤습니다'); S.merge = null; redraw();
    }));
    return el('div', {}, el('div', { class: 'card' }, el('h2', {}, `${sel.name} 기록을 어디로 합칠까요?`), el('label', { class: 'f' }, el('span', {}, '합칠 대상 (남는 사람)'), tgt),
      el('div', { class: 'actions' }, go, el('button', { class: 'btn ghost', type: 'button', onclick: () => { S.merge = null; redraw(); } }, '취소'))), list);
  }

  /* ---- QR ---- */
  function placesPane(D, redraw) {
    const main = bizDivs().filter((d) => !isChief() || d.id === state.me.division_id)
      .map((d) => ({ d, pl: D.places.find((p) => p.division_id === d.id && p.active && !p.zone_id) || D.places.find((p) => p.division_id === d.id && p.active) })).filter((x) => x.pl);
    const steps = ['이름 · 협정사 입력', '전화번호 뒤 6자리 입력 (***-**00-0000 의 00-0000)', '출근 또는 퇴근 버튼'];
    return el('div', {}, el('div', { class: 'card' }, el('h2', {}, '사업부별 출퇴근 QR'),
      el('p', { class: 'hint' }, '출근할 때와 퇴근할 때 같은 QR을 찍습니다. 인쇄해서 협정인력이 보이는 곳에 붙이세요.'),
      main.length ? el('div', { class: 'qrgrid big' }, main.map(({ d, pl }) => {
        const url = qrUrl(pl.qr_token);
        const pr = el('button', { class: 'btn sm', type: 'button' }, '인쇄');
        pr.addEventListener('click', () => printNode(el('div', { class: 'poster' }, el('h1', {}, '협정인력 출퇴근'), el('h2', {}, d.name), qrImg(url, 14),
          el('p', {}, '출근할 때, 퇴근할 때 휴대폰 카메라로 QR을 스캔하세요'), el('ol', {}, steps.map((s) => el('li', {}, s))))));
        const copy = el('button', { class: 'btn ghost sm', type: 'button' }, '링크 복사');
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); toast('링크를 복사했습니다'); } catch (e) { toast(url); } });
        return el('div', { class: 'qrcell ' + divTone(d.id) }, el('b', {}, shortDiv(d.name)), qrImg(url, 6), el('small', {}, pl.name), el('div', { class: 'zact wrap' }, pr, copy));
      })) : el('p', { class: 'empty' }, 'QR을 만들지 못했습니다. 관리자 권한을 확인하세요')));
  }

  /* ---- 협정사 업체 ---- */
  function vendorsPane(D, redraw) {
    const nameIn = el('input', { type: 'text', maxlength: '30', placeholder: '업체 이름', 'aria-label': '업체 이름' });
    const add = el('button', { class: 'btn', type: 'button' }, '업체 추가');
    add.addEventListener('click', busy(add, async () => {
      const name = nameIn.value.trim();
      if (!name) return toast('업체 이름을 입력하세요', 'err');
      const { error } = await sb.from('coop_vendors').insert({ name });
      if (error) return toast(error.code === '23505' ? '이미 있는 업체입니다' : '추가하지 못했습니다. 권한을 확인하세요', 'err');
      toast('업체를 추가했습니다'); redraw();
    }));
    return el('div', {}, el('div', { class: 'card' }, el('h2', {}, '협정사 업체 추가'), el('p', { class: 'hint' }, '업체가 등록되면 출퇴근 화면에서 협정사를 선택해야 합니다.'), el('label', { class: 'f' }, el('span', {}, '업체 이름'), nameIn), add),
      el('div', { class: 'card' }, el('h2', {}, `협정사 업체 ${D.vendors.length}곳`),
        D.vendors.length ? D.vendors.map((v) => {
          const tog = el('button', { class: 'btn ghost sm', type: 'button' }, v.active ? '사용 중지' : '다시 사용');
          tog.addEventListener('click', busy(tog, async () => {
            const { error } = await sb.from('coop_vendors').update({ active: !v.active }).eq('id', v.id);
            if (error) return toast('처리하지 못했습니다', 'err'); redraw();
          }));
          return el('div', { class: 'zrow' + (v.active ? '' : ' off') }, el('div', {}, el('b', {}, v.name), v.active ? null : el('small', {}, '사용 중지')), el('div', { class: 'zact' }, tog));
        }) : el('p', { class: 'empty' }, '등록된 업체가 없습니다. 위에서 추가하세요')));
  }

  register('coop', '협정 출퇴근', ['chief', 'admin', 'master'], coopView, '협정인력 출퇴근 확인·구역 배치·엑셀');
})();
