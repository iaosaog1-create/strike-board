/* 현장 운영 화면: 인력 입력 · 출근 현황 · 구역 현황 · 협정/지원 배치 */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, numIn, toInt, bizDivs, divName, divTone, shortDiv } = window.APP;
  const MASTERS = ['admin', 'master'];
  const isMaster = (me) => MASTERS.includes(me.role);

  /* ---------- 공통 도구 ---------- */
  const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
  const today = () => kstNow().toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  const WD = '일월화수목금토';
  const dateLabel = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]})`; };
  const SIDE_ORDER = ['L/S', 'A/S', '기타'];
  const zoneSort = (a, b) => SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side)
    || a.floor.localeCompare(b.floor, 'ko', { numeric: true }) || a.area.localeCompare(b.area, 'ko') || a.task.localeCompare(b.task, 'ko');
  const zoneName = (z) => [z.area === '전체' ? null : z.area, z.task].filter(Boolean).join(' · ') + (z.label ? ` (${z.label})` : '');
  const groupZones = (zones) => {
    const out = [];
    for (const z of [...zones].sort(zoneSort)) {
      let s = out.find((x) => x.side === z.side);
      if (!s) out.push(s = { side: z.side, floors: [] });
      let f = s.floors.find((x) => x.floor === z.floor);
      if (!f) s.floors.push(f = { floor: z.floor, zones: [] });
      f.zones.push(z);
    }
    return out;
  };
  const SHIFT_FALLBACK = ['오전', '오후', '야간', '일근', '운영'];
  const shiftList = () => (state.shiftCodes && state.shiftCodes.length ? state.shiftCodes : SHIFT_FALLBACK);
  async function ensureShifts() {
    if (state.shiftCodes) return;
    const { data } = await sb.from('shift_defs').select('code,sort').order('sort');
    state.shiftCodes = (data || []).map((r) => r.code);
  }
  /* 시각별 기준 근무조: 08:30·11:00 = 오전+일근 / 12:30 = 오전+오후+일근 / 22:00 = 오후+야간 */
  function basisFor(label) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(label || '').trim());
    const min = m ? Number(m[1]) * 60 + Number(m[2]) : kstNow().getUTCHours() * 60 + kstNow().getUTCMinutes();
    if (min < 12 * 60 + 30) return ['오전', '일근'];
    if (min < 21 * 60 + 30) return ['오전', '오후', '일근'];
    return ['오후', '야간'];
  }
  const defaultShift = () => {
    const b = basisFor(null);
    return b.includes('오후') && !b.includes('야간') ? '오후' : b.includes('야간') ? '야간' : '오전';
  };

  /* 선택값(날짜·사업부·근무조)은 화면을 옮겨도 유지 */
  function ctx(allowAll) {
    const me = state.me;
    const o = state.ops || (state.ops = {});
    if (!o.date) o.date = today();
    if (!allowAll && o.division === 'all') o.division = null;
    if (!o.division) o.division = me.division_id && bizDivs().some((d) => d.id === me.division_id) ? me.division_id : (bizDivs()[0] || {}).id;
    if (!o.shift) o.shift = me.role === 'leader' && me.team ? me.team : defaultShift();
    if (me.role === 'leader' && me.team) o.shift = me.team;
    if (!isMaster(me) && me.division_id) o.division = me.division_id;
    return o;
  }

  function dateBar(o, redraw) {
    const inp = el('input', { type: 'date', value: o.date, 'aria-label': '날짜' });
    inp.addEventListener('change', () => { if (inp.value) { o.date = inp.value; redraw(); } });
    const step = (n) => () => { o.date = addDays(o.date, n); redraw(); };
    return el('div', { class: 'datebar' },
      el('button', { type: 'button', class: 'btn ghost sm', onclick: step(-1), 'aria-label': '전날' }, '‹'),
      inp,
      el('button', { type: 'button', class: 'btn ghost sm', onclick: step(1), 'aria-label': '다음날' }, '›'),
      el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { o.date = today(); redraw(); } }, '오늘'));
  }
  function pickers(o, redraw, { shiftPick = true, allDiv = false } = {}) {
    const me = state.me;
    const parts = [dateBar(o, redraw)];
    if (isMaster(me)) {
      const opts = [...(allDiv ? [['all', '전체']] : []), ...bizDivs().map((d) => [String(d.id), shortDiv(d.name)])];
      parts.push(el('div', { class: 'f' }, el('span', { class: 'hint' }, '사업부'),
        seg(opts, allDiv && o.division === 'all' ? 'all' : String(o.division), (v) => { o.division = v === 'all' ? 'all' : Number(v); redraw(); }, (v) => (v === 'all' ? '' : divTone(v)))));
    }
    if (shiftPick && !(me.role === 'leader' && me.team)) {
      parts.push(el('div', { class: 'f' }, el('span', { class: 'hint' }, '근무조'),
        seg(shiftList().map((s) => [s, s]), o.shift, (v) => { o.shift = v; redraw(); })));
    }
    return el('div', { class: 'card pick' }, ...parts);
  }
  const loading = () => el('p', { class: 'empty' }, '불러오는 중…');
  const q = async (p) => { const r = await p; if (r.error) throw r.error; return r.data || []; };
  const loadZones = (div, activeOnly = true) => q(sb.from('zones')
    .select('id,division_id,side,floor,area,label,task,required,active').eq('division_id', div).eq('active', true));
  const loadLatest = (date, div, extra) => {
    let r = sb.from('deployments_latest').select('zone_id,division_id,shift,source,dept_id,vendor_id,headcount,entered_at').eq('work_date', date);
    if (div && div !== 'all') r = r.eq('division_id', div);
    if (extra) r = extra(r);
    return q(r);
  };
  const loadQuota = () => q(sb.from('staffing_quota').select('division_id,shift,daily_quota,full_quota'));
  const noZones = () => el('div', { class: 'card' }, el('p', { class: 'empty' },
    '등록된 구역이 없습니다. 관리자가 "구역·정원 설정"에서 구역을 먼저 등록해야 합니다'));
  const floorHead = (side, floor) => el('h3', { class: 'fl' }, `${side} · ${floor}`);

  /* =========================================================
     1) 인력 입력  (팀장: 자기 사업부·자기 팀 / 관리자: 사업부·근무조 선택)
     ========================================================= */
  async function inputView(body) {
    await ensureShifts();
    const o = ctx();
    const redraw = () => inputView(body);
    body.replaceChildren(pickers(o, redraw), loading());
    let zones, latest, quota;
    try { [zones, latest, quota] = await Promise.all([loadZones(o.division), loadLatest(o.date, o.division, (r) => r.eq('shift', o.shift).eq('source', '사업부')), loadQuota()]); }
    catch (e) { body.replaceChildren(pickers(o, redraw), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const last = new Map(latest.map((r) => [r.zone_id, r]));
    const lastAt = latest.reduce((m, r) => (r.entered_at > m ? r.entered_at : m), '');
    const need = quota.filter((x) => x.division_id === o.division && x.shift === o.shift).reduce((t, x) => t + x.daily_quota, 0);

    const inputs = new Map();
    const totalEl = el('b', {});
    const calc = () => { totalEl.textContent = String([...inputs.values()].reduce((t, i) => t + (toInt(i.value) || 0), 0)); };
    const sections = groupZones(zones).map((s) => s.floors.map((f) => el('div', { class: 'card' },
      floorHead(s.side, f.floor),
      f.zones.map((z) => {
        const inp = numIn(last.has(z.id) ? last.get(z.id).headcount : '', zoneName(z));
        inp.addEventListener('input', calc);
        inputs.set(z.id, inp);
        return el('div', { class: 'zin' },
          el('div', {}, el('b', {}, zoneName(z)), el('small', {}, `필요 ${z.required}명`)),
          el('div', { class: 'zact' }, inp, el('span', {}, '명')));
      }))));
    calc();
    const save = el('button', { class: 'btn', type: 'button' }, '저장');
    save.addEventListener('click', busy(save, async () => {
      const rows = [];
      for (const z of zones) {
        const v = toInt(inputs.get(z.id).value);
        if (Number.isNaN(v)) return toast('인원은 숫자만 입력하세요', 'err');
        if (v == null) continue;
        if (last.has(z.id) && last.get(z.id).headcount === v) continue;
        rows.push({ work_date: o.date, shift: o.shift, zone_id: z.id, division_id: o.division, headcount: v, entered_by: state.me.id, source: '사업부' });
      }
      if (!rows.length) return toast('바뀐 내용이 없습니다');
      const { error } = await sb.from('deployments').insert(rows);
      if (error) return toast('저장하지 못했습니다. 권한과 근무조를 확인하세요', 'err');
      toast(`${rows.length}곳을 저장했습니다`);
      await inputView(body);
    }));
    body.replaceChildren(pickers(o, redraw),
      el('div', { class: 'card sumbar' },
        el('div', {}, el('span', {}, '입력 합계'), totalEl, el('small', {}, '명')),
        el('div', {}, el('span', {}, '일일근무정원'), el('b', {}, need ? String(need) : '-'), el('small', {}, need ? '명' : '')),
        el('div', {}, el('span', {}, '마지막 저장'), el('b', {}, lastAt ? hhmm(lastAt) : '-'))),
      zones.length ? [sections, save] : noZones());
  }

  /* =========================================================
     2) 출근 현황  (팀장·총괄팀장·관리자)
     ========================================================= */
  const ATT_FIELDS = [['present', '출근'], ['day_off', '휴무'], ['annual', '연차'], ['health', '보건·검진'],
    ['leave_long', '휴직'], ['sick', '병가'], ['other', '기타'], ['abnormal', '비정상상황 참여']];
  async function attView(body) {
    await ensureShifts();
    const o = ctx();
    const redraw = () => attView(body);
    body.replaceChildren(pickers(o, redraw), loading());
    let cur, leave, dep;
    try {
      [cur, leave, dep] = await Promise.all([
        q(sb.from('attendance_latest').select('*').eq('work_date', o.date).eq('division_id', o.division).eq('shift', o.shift)),
        sb.rpc('leave_counts', { p_date: o.date }).then((r) => (r.error ? [] : r.data || [])),
        loadLatest(o.date, o.division, (r) => r.eq('shift', o.shift).eq('source', '사업부'))]);
    } catch (e) { body.replaceChildren(pickers(o, redraw), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const row = cur[0] || null;
    const lv = leave.find((x) => x.division_id === o.division && x.shift === o.shift) || null;
    const depSum = dep.reduce((t, r) => t + r.headcount, 0);
    const autoVals = lv ? { day_off: lv.day_off, annual: lv.annual, health: lv.health, leave_long: lv.hold, sick: lv.sick, other: lv.other } : {};
    const inputs = {};
    const fill = (vals) => ATT_FIELDS.forEach(([k]) => { inputs[k].value = vals[k] == null ? '' : String(vals[k]); });
    const grid = el('div', { class: 'agrid' }, ...ATT_FIELDS.map(([k, label]) => {
      inputs[k] = numIn('', label);
      return el('label', { class: 'f' + (!row && autoVals[k] != null ? ' auto' : '') }, el('span', {}, label), inputs[k]);
    }));
    fill(row || autoVals);
    const noteLines = [];
    if (row) noteLines.push(`${hhmm(row.entered_at)}에 입력한 값입니다. 저장하면 새 기록이 추가됩니다.`);
    else if (lv) noteLines.push('업로드한 휴무계획·ERP 근태로 자동 채운 값입니다. 현장 상황에 맞게 고쳐서 저장하세요.');
    else noteLines.push('업로드된 휴무·근태 자료가 없습니다. 직접 입력하세요.');
    if (lv && (lv.half || lv.pending)) noteLines.push(`반차 ${lv.half}명 (인원에 포함하지 않음) · 승인 대기 ${lv.pending}명 (반영 안 됨)`);
    const auto = el('button', { class: 'btn ghost sm', type: 'button', disabled: !lv }, '자동값 다시 채우기');
    auto.addEventListener('click', () => fill(autoVals));
    const sumBtn = el('button', { class: 'btn ghost sm', type: 'button' }, `인력 입력 합계(${depSum}명)로 출근 채우기`);
    sumBtn.addEventListener('click', () => { inputs.present.value = String(depSum); });
    const save = el('button', { class: 'btn', type: 'button' }, '저장');
    save.addEventListener('click', busy(save, async () => {
      const rec = { work_date: o.date, division_id: o.division, shift: o.shift, entered_by: state.me.id };
      for (const [k] of ATT_FIELDS) {
        const v = toInt(inputs[k].value);
        if (Number.isNaN(v)) return toast('인원은 숫자만 입력하세요', 'err');
        rec[k] = v || 0;
      }
      const { error } = await sb.from('attendance_status').insert(rec);
      if (error) return toast('저장하지 못했습니다. 권한과 근무조를 확인하세요', 'err');
      toast('출근 현황을 저장했습니다');
      await attView(body);
    }));
    body.replaceChildren(pickers(o, redraw),
      el('div', { class: 'card' }, el('h2', {}, `${shortDiv(divName(o.division))} · ${o.shift} 출근 현황`),
        ...noteLines.map((t) => el('p', { class: 'hint' }, t)),
        grid,
        el('div', { class: 'btnrow' }, auto, sumBtn), save));
  }

  /* =========================================================
     3) 구역 현황  (전체 역할 조회)
     ========================================================= */
  /* 집계: rows = deployments_latest 형식, basis = 근무조 배열 */
  function sumBy(rows, f) {
    const r = { biz: 0, sup: 0, coop: 0 };
    for (const x of rows) if (f(x)) { if (x.source === '사업부') r.biz += x.headcount; else if (x.source === '지원') r.sup += x.headcount; else r.coop += x.headcount; }
    r.total = r.biz + r.sup + r.coop;
    return r;
  }
  const quotaSum = (quota, div, basis) => quota.filter((x) => x.division_id === div && basis.includes(x.shift)).reduce((t, x) => t + x.daily_quota, 0);
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  const tone = (p) => (p == null ? 'none' : p >= 100 ? 'ok' : p >= 80 ? 'mid' : 'low');

  async function statusView(body) {
    await ensureShifts();
    (state.timers || []).forEach(clearInterval); state.timers = [];
    const o = ctx(true);
    const me = state.me;
    if (!o.basis) o.basis = basisFor(null);
    if (!isMaster(me) && o.division === 'all') o.division = me.division_id;
    const redraw = () => statusView(body);
    const refresh = async () => {
      let zones, rows, quota;
      try {
        [zones, rows, quota] = await Promise.all([
          q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active')),
          loadLatest(o.date, o.division === 'all' ? null : o.division), loadQuota()]);
      } catch (e) { return body.replaceChildren(pickers(o, redraw, { shiftPick: false, allDiv: true }), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); }
      draw(zones, rows, quota);
    };
    const draw = (zones, rows, quota) => {
      const divs = (o.division === 'all' ? bizDivs() : bizDivs().filter((d) => d.id === o.division));
      const basis = o.basis;
      const chips = el('div', { class: 'chips' }, ...shiftList().map((s) =>
        el('button', {
          type: 'button', class: 'chip' + (basis.includes(s) ? ' on' : ''), 'aria-pressed': String(basis.includes(s)),
          onclick: () => { o.basis = basis.includes(s) ? basis.filter((x) => x !== s) : [...basis, s]; draw(zones, rows, quota); }
        }, s)),
        el('button', { type: 'button', class: 'chip auto', onclick: () => { o.basis = basisFor(null); draw(zones, rows, quota); } }, '현재 시각 기준'));
      const inB = (x) => basis.includes(x.shift);
      // 사업부별 요약표
      let tot = { biz: 0, sup: 0, coop: 0, total: 0, q: 0 };
      const trs = divs.map((d) => {
        const s = sumBy(rows, (x) => x.division_id === d.id && inB(x)); const qq = quotaSum(quota, d.id, basis);
        tot = { biz: tot.biz + s.biz, sup: tot.sup + s.sup, coop: tot.coop + s.coop, total: tot.total + s.total, q: tot.q + qq };
        const p = pct(s.total, qq);
        return el('tr', {}, el('th', { class: divTone(d.id) }, shortDiv(d.name)), el('td', {}, s.biz), el('td', {}, s.sup), el('td', {}, s.coop), el('td', { class: 'b' }, s.total), el('td', {}, qq || '-'), el('td', { class: 'pc ' + tone(p) }, p == null ? '-' : p + '%'));
      });
      if (divs.length > 1) { const p = pct(tot.total, tot.q); trs.push(el('tr', { class: 'sum' }, el('th', {}, '소계'), el('td', {}, tot.biz), el('td', {}, tot.sup), el('td', {}, tot.coop), el('td', { class: 'b' }, tot.total), el('td', {}, tot.q || '-'), el('td', { class: 'pc ' + tone(p) }, p == null ? '-' : p + '%'))); }
      const summary = el('div', { class: 'card' },
        el('h2', {}, `${dateLabel(o.date)} 근무 현황`),
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '기준 근무조'), chips),
        el('div', { class: 'tblwrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['구분', '환경미화원', '행정인력', '협정', '합계', '일일정원', '상근 대비'].map((h) => el('th', {}, h)))),
          el('tbody', {}, trs))),
        el('p', { class: 'hint' }, '상근 대비 = 근무 인원 합계 ÷ 선택한 근무조의 일일근무정원'));
      // 구역별
      const zsecs = divs.map((d) => {
        const zs = zones.filter((z) => z.division_id === d.id && (z.active || rows.some((r) => r.zone_id === z.id)));
        if (!zs.length) return el('div', { class: 'card' }, el('h2', {}, shortDiv(d.name)), el('p', { class: 'empty' }, '등록된 구역이 없습니다'));
        return el('div', {}, divs.length > 1 ? el('h2', { class: 'divh ' + divTone(d.id) }, d.name) : null,
          groupZones(zs).map((s) => s.floors.map((f) => el('div', { class: 'card' }, floorHead(s.side, f.floor),
            el('div', { class: 'zgrid' }, f.zones.map((z) => {
              const s2 = sumBy(rows, (x) => x.zone_id === z.id && inB(x)); const p = pct(s2.total, z.required);
              return el('div', { class: 'zcell' },
                el('div', { class: 'zt' }, el('b', {}, zoneName(z)), el('span', { class: 'pc ' + tone(p) }, p == null ? '-' : p + '%')),
                el('div', { class: 'bar' }, el('i', { class: tone(p), style: `width:${Math.min(100, p || 0)}%` })),
                el('div', { class: 'zn' }, el('b', {}, `${s2.total}`), ` / 필요 ${z.required}명`),
                el('small', {}, `사업부 ${s2.biz} · 지원 ${s2.sup} · 협정 ${s2.coop}`));
            }))))));
      });
      const bar = pickers(o, redraw, { shiftPick: false, allDiv: true });
      bar.append(el('button', { type: 'button', class: 'btn ghost sm', onclick: refresh }, '새로고침'));
      body.replaceChildren(bar, summary, zsecs);
    };
    body.replaceChildren(pickers(o, redraw, { shiftPick: false, allDiv: true }), loading());
    await refresh();
    state.timers.push(setInterval(() => { if (state.menu === 'status' && document.body.contains(body)) refresh(); }, 60000));
  }

  /* =========================================================
     4) 협정·지원 배치  (총괄팀장 / 관리자)
     ========================================================= */
  async function placeView(body) {
    await ensureShifts();
    const o = ctx();
    const redraw = () => placeView(body);
    body.replaceChildren(pickers(o, redraw), loading());
    let zones, latest, counts, depts;
    try {
      [zones, latest, counts] = await Promise.all([
        loadZones(o.division),
        loadLatest(o.date, o.division, (r) => r.eq('shift', o.shift).in('source', ['지원', '협정'])),
        sb.rpc('coop_counts', { p_date: o.date }).then((r) => (r.error ? [] : r.data || []))]);
      depts = (state.divisions || []).filter((d) => d.kind === '지원부서');
    } catch (e) { body.replaceChildren(pickers(o, redraw), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const key = (zid, source, dept) => `${zid}|${source}|${dept || 0}`;
    const last = new Map(latest.map((r) => [key(r.zone_id, r.source, r.dept_id), r.headcount]));
    const cnt = counts.find((c) => c.division_id === o.division && c.shift === o.shift) || { present: 0, assigned: 0, remaining: 0 };
    const unset = counts.filter((c) => c.division_id === o.division && c.shift === '미지정').reduce((t, c) => t + c.present, 0);

    const inputs = new Map();
    const sums = { coop: el('b', {}), rem: el('b', {}) };
    const calc = () => {
      let c = 0; for (const [k, i] of inputs) if (k.split('|')[1] === '협정') c += toInt(i.value) || 0;
      sums.coop.textContent = String(c);
      const rem = cnt.present - c;
      sums.rem.textContent = String(rem); sums.rem.className = rem < 0 ? 'neg' : '';
    };
    const cols = [['협정', '협정', null], ...depts.map((d) => [d.name, '지원', d.id])];
    const secs = groupZones(zones).map((s) => s.floors.map((f) => el('div', { class: 'card' }, floorHead(s.side, f.floor),
      f.zones.map((z) => el('div', { class: 'zin multi' },
        el('div', {}, el('b', {}, zoneName(z)), el('small', {}, `필요 ${z.required}명`)),
        el('div', { class: 'mini' }, ...cols.map(([label, source, dept]) => {
          const k = key(z.id, source, dept);
          const inp = numIn(last.has(k) ? last.get(k) : '', `${zoneName(z)} ${label}`);
          inp.addEventListener('input', calc); inputs.set(k, inp);
          return el('label', {}, el('span', {}, label), inp);
        })))))));
    calc();
    const save = el('button', { class: 'btn', type: 'button' }, '저장');
    save.addEventListener('click', busy(save, async () => {
      const rows = [];
      for (const z of zones) for (const [, source, dept] of cols) {
        const k = key(z.id, source, dept); const v = toInt(inputs.get(k).value);
        if (Number.isNaN(v)) return toast('인원은 숫자만 입력하세요', 'err');
        if (v == null || (last.has(k) && last.get(k) === v)) continue;
        rows.push({ work_date: o.date, shift: o.shift, zone_id: z.id, division_id: o.division, headcount: v, entered_by: state.me.id, source, dept_id: dept });
      }
      if (!rows.length) return toast('바뀐 내용이 없습니다');
      const { error } = await sb.from('deployments').insert(rows);
      if (error) return toast('저장하지 못했습니다. 권한을 확인하세요', 'err');
      const over = [...inputs].filter(([k]) => k.split('|')[1] === '협정').reduce((t, [, i]) => t + (toInt(i.value) || 0), 0) > cnt.present;
      toast(over ? '저장했습니다. 협정 배치가 출근 인원보다 많습니다' : `${rows.length}곳을 저장했습니다`);
      await placeView(body);
    }));
    body.replaceChildren(pickers(o, redraw),
      el('div', { class: 'card sumbar' },
        el('div', {}, el('span', {}, '협정 출근'), el('b', {}, String(cnt.present)), el('small', {}, '명')),
        el('div', {}, el('span', {}, '배치 입력'), sums.coop, el('small', {}, '명')),
        el('div', {}, el('span', {}, '남은 인원'), sums.rem, el('small', {}, '명'))),
      unset ? el('p', { class: 'hint pad' }, `근무조가 지정되지 않은 협정 출근 인원 ${unset}명은 위 숫자에 포함되지 않습니다.`) : null,
      zones.length ? [secs, save] : noZones());
  }

  window.APP.ops = { today, addDays, hhmm, dateLabel, basisFor, zoneName, groupZones, sumBy, quotaSum, pct, tone, shiftList, ensureShifts, ctx, zoneSort };

  register('input', '인력 입력', ['leader', 'admin', 'master'], inputView, '내 팀 인원을 구역별로 입력');
  register('place', '협정·지원 배치', ['chief', 'admin', 'master'], placeView, '출근한 협정·지원 인원을 구역에 배치');
  register('att', '출근 현황', ['leader', 'chief', 'admin', 'master'], attView, '출근·휴무·연차 등 인원 입력');
  register('status', '구역 현황', ['leader', 'chief', 'admin', 'master'], statusView, '구역별 인원과 상근 대비 % 확인');
})();
