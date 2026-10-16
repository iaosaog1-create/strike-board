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
    || a.floor.localeCompare(b.floor, 'ko', { numeric: true }) || a.area.localeCompare(b.area, 'ko') || a.task.localeCompare(b.task, 'ko')
    || String(a.team || '').localeCompare(String(b.team || ''), 'ko', { numeric: true });
  const zoneName = (z) => [z.team || null, z.area === '전체' ? null : z.area, z.task].filter(Boolean).join(' · ') + (z.label ? ` (${z.label})` : '');
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
    .select('id,division_id,side,floor,area,team,label,task,required,active').eq('division_id', div).eq('active', true));
  const tnumO = (t) => String(t || '').replace(/\D/g, '') || String(t || '').trim();
  const loadTeamShift = (div) => sb.from('team_shift').select('team,shift').eq('division_id', div).then((r) => new Map((r.error ? [] : r.data || []).map((x) => [tnumO(x.team), x.shift])), () => new Map());
  /* 팀 담당구역 거르기: 팀장 = 내 팀 + 공통 구역, 그 외 = 선택한 근무조에 해당하는 팀 구역 + 공통 구역 */
  const teamFilter = (zones, tsMap, shift) => {
    const me = state.me;
    if (me.role === 'leader' && me.plan_team) return zones.filter((z) => !z.team || tnumO(z.team) === tnumO(me.plan_team));
    return zones.filter((z) => !z.team || !shift || !tsMap.get(tnumO(z.team)) || tsMap.get(tnumO(z.team)) === shift);
  };
  const loadLatest = (date, div, extra) => {
    let r = sb.from('deployments_latest').select('zone_id,division_id,shift,source,dept_id,vendor_id,headcount,entered_at').eq('work_date', date);
    if (div && div !== 'all') r = r.eq('division_id', div);
    if (extra) r = extra(r);
    return q(r);
  };
  const loadQuota = () => q(sb.from('staffing_quota').select('division_id,shift,daily_quota,full_quota'));
  const noZones = () => el('div', { class: 'card' }, el('p', { class: 'empty' },
    '등록된 구역이 없습니다. 관리자가 "구역·정원 설정"에서 구역을 먼저 등록해야 합니다'));
  /* 숫자 입력 − [ n ] + (손가락으로 누르기 쉬운 카드형 입력) */
  const stepper = (inp) => {
    const bump = (d) => { const v = toInt(inp.value) || 0; inp.value = String(Math.max(0, v + d)); inp.dispatchEvent(new Event('input', { bubbles: true })); };
    return el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'stp', 'aria-label': '1명 줄이기', onclick: () => bump(-1) }, '−'),
      inp,
      el('button', { type: 'button', class: 'stp', 'aria-label': '1명 늘리기', onclick: () => bump(1) }, '+'));
  };
  const floorHead = (side, floor) => el('h3', { class: 'fl' }, `${side} · ${floor}`);

  /* =========================================================
     1) 인력 입력  (팀장: 자기 사업부·자기 팀 / 관리자: 사업부·근무조 선택)
     ========================================================= */
  async function inputView(body) {
    await ensureShifts();
    const o = ctx();
    const redraw = () => inputView(body);
    body.replaceChildren(pickers(o, redraw), loading());
    let zones, latest, quota; let rosterAll = [];
    try { let tsm; [zones, latest, quota, tsm, rosterAll] = await Promise.all([loadZones(o.division), loadLatest(o.date, o.division, (r) => r.eq('shift', o.shift).eq('source', '사업부')), loadQuota(), loadTeamShift(o.division), sb.rpc('team_roster', { p_date: o.date, p_team: null }).then((r) => (r.error ? [] : r.data || []), () => [])]); zones = teamFilter(zones, tsm, o.shift); }
    catch (e) { body.replaceChildren(pickers(o, redraw), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const last = new Map(latest.map((r) => [r.zone_id, r]));
    const lastAt = latest.reduce((m, r) => (r.entered_at > m ? r.entered_at : m), '');
    const need = quota.filter((x) => x.division_id === o.division && x.shift === o.shift).reduce((t, x) => t + x.daily_quota, 0);

    // 근무 가능 인원 = 이 사업부·근무조 휴무계획 명단에서 근태(휴무·연차 등)와 행정 팀을 뺀 인원. 명단이 없으면 제한하지 않음
    const OFFK0 = ['off', 'hold', 'annual', 'health', 'sick', 'other'];
    const rs0 = (rosterAll || []).filter((r) => r.division_id === o.division && r.shift === o.shift && String(r.team || '').trim() !== '행정');
    const avail = rs0.length ? rs0.filter((r) => !OFFK0.includes(r.leave_kind)).length : null;
    const inputs = new Map();
    const totalEl = el('b', {});
    const calc = () => { const t = [...inputs.values()].reduce((s, i) => s + (toInt(i.value) || 0), 0); totalEl.textContent = String(t); totalEl.className = avail != null && t > avail ? 'neg' : ''; };
    const sections = groupZones(zones).map((s) => s.floors.map((f) => el('div', { class: 'card' },
      floorHead(s.side, f.floor),
      el('div', { class: 'zgrid' }, f.zones.map((z) => {
        const inp = numIn(last.has(z.id) ? last.get(z.id).headcount : '', zoneName(z));
        const fill = el('i', {});
        const upd = () => { const v = toInt(inp.value) || 0; const r = z.required > 0 ? v / z.required : 0; fill.style.width = Math.min(100, Math.round(r * 100)) + '%'; fill.className = z.required > 0 ? (v >= z.required ? 'ok' : 'low') : ''; };
        inp.addEventListener('input', calc); inp.addEventListener('input', upd); upd();
        inputs.set(z.id, inp);
        return el('div', { class: 'zc' },
          el('div', { class: 'zch' }, el('b', {}, zoneName(z)), el('small', {}, `필요 ${z.required}명`)),
          stepper(inp),
          el('div', { class: 'zbar' }, fill));
      })))));
    calc();
    const save = el('button', { class: 'btn', type: 'button' }, '저장');
    save.addEventListener('click', busy(save, async () => {
      const rows = [];
      for (const z of zones) {
        const v = toInt(inputs.get(z.id).value);
        if (Number.isNaN(v)) return toast('인원은 숫자만 입력하세요', 'err');
      }
      const sumIn = [...inputs.values()].reduce((s, i) => s + (toInt(i.value) || 0), 0);
      if (avail != null && sumIn > avail) return toast(`입력 ${sumIn}명 > ${o.shift} 근무 가능 ${avail}명 — ${sumIn - avail}명 초과라 저장되지 않았습니다`, 'err');
      for (const z of zones) {
        const v = toInt(inputs.get(z.id).value);
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
        el('div', {}, el('span', {}, `${o.shift} 근무 가능`), el('b', {}, avail != null ? String(avail) : '-'), el('small', {}, avail != null ? '명' : '')),
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
    let cur, leave, dep, tms;
    try {
      [cur, leave, dep, tms] = await Promise.all([
        q(sb.from('attendance_latest').select('*').eq('work_date', o.date).eq('division_id', o.division).eq('shift', o.shift)),
        sb.rpc('leave_counts', { p_date: o.date }).then((r) => (r.error ? [] : r.data || [])),
        loadLatest(o.date, o.division, (r) => r.eq('shift', o.shift).eq('source', '사업부')),
        sb.rpc('leave_team', { p_date: o.date }).then((r) => (r.error ? [] : r.data || []), () => [])]);
    } catch (e) { body.replaceChildren(pickers(o, redraw), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const rosterN = (tms || []).filter((t) => t.division_id === o.division && t.shift === o.shift).reduce((n, t) => n + t.roster, 0);
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
    const absTxt = el('b', {}, '');
    const absBox = el('div', { class: 'absbox' }, el('span', {}, '결근 (자동 계산)'), absTxt, el('small', {}, rosterN ? `정원 ${rosterN}명 − 출근 − 근태` : '정원은 휴무계획 업로드 후 계산됩니다'));
    const calcAbs = () => {
      if (!rosterN) { absTxt.textContent = '-'; return; }
      const v = ATT_FIELDS.filter(([k]) => k !== 'abnormal').reduce((n, [k]) => n + (toInt(inputs[k].value) || 0), 0);
      absTxt.textContent = Math.max(0, rosterN - v) + '명';
    };
    ATT_FIELDS.forEach(([k]) => inputs[k].addEventListener('input', calcAbs)); calcAbs();
    const auto = el('button', { class: 'btn ghost sm', type: 'button', disabled: !lv }, '자동값 다시 채우기');
    auto.addEventListener('click', () => { fill(autoVals); calcAbs(); });
    const sumBtn = el('button', { class: 'btn ghost sm', type: 'button' }, `인력 입력 합계(${depSum}명)로 출근 채우기`);
    sumBtn.addEventListener('click', () => { inputs.present.value = String(depSum); calcAbs(); });
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
        grid, absBox,
        el('div', { class: 'btnrow' }, auto, sumBtn), save));
  }

  /* =========================================================
     3) 구역 현황  (전체 역할 조회)
     ========================================================= */
  /* 집계: rows = deployments_latest 형식, basis = 근무조 배열 */
  let SUPZ = new Set();   // '현장지원' 구역 id — 이 구역에 배치된 인원은 지원으로 집계
  function sumBy(rows, f) {
    const r = { biz: 0, sup: 0, coop: 0 };
    for (const x of rows) if (f(x)) { if (x.source === '사업부') { if (SUPZ.has(x.zone_id)) r.sup += x.headcount; else r.biz += x.headcount; } else if (x.source === '지원') r.sup += x.headcount; else r.coop += x.headcount; }
    r.total = r.biz + r.sup + r.coop;
    return r;
  }
  const ATT_LEAVE = ['day_off', 'annual', 'health', 'leave_long', 'sick', 'other'];
  const quotaSumRaw = (quota, div, basis) => quota.filter((x) => x.division_id === div && basis.includes(x.shift)).reduce((t, x) => t + x.daily_quota, 0);
  const quotaSum = quotaSumRaw;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  const tone = (p) => (p == null ? 'none' : p >= 100 ? 'ok' : p >= 80 ? 'mid' : 'low');

  /* 링 그래프 (SVG 속성만 사용 → CSP 안전) */
  function ringNode(p, t) {
    const C = 2 * Math.PI * 34, v = Math.min(100, p || 0);
    const w = document.createElement('div'); w.className = 'ring ' + t;
    w.innerHTML = `<svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true"><circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="9"/><circle cx="42" cy="42" r="34" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * v / 100).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
    const c = document.createElement('div'); c.className = 'c'; c.innerHTML = '<b></b><span>상근 대비</span>'; c.firstChild.textContent = p == null ? '-' : p + '%';
    w.append(c); return w;
  }
  /* 부족 구역: 필요 인원보다 적은 구역을 부족 인원이 큰 순서로 */
  function shortages(divs, zones, rows, basis, zin) {
    const out = [];
    for (const d of divs) {
      for (const z of zones.filter((x) => x.division_id === d.id && x.active && (!zin || zin(x)))) {
        if (!(z.required > 0)) continue;
        const t = sumBy(rows, (x) => x.zone_id === z.id && basis.includes(x.shift)).total;
        if (t < z.required) out.push({ div: d, zone: z, total: t, need: z.required, lack: z.required - t, p: pct(t, z.required) });
      }
    }
    return out.sort((a, b) => b.lack - a.lack || a.p - b.p);
  }
  const clockTxt = () => { const k = kstNow(); return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`; };

  async function statusView(body) {
    await ensureShifts();
    (state.timers || []).forEach(clearInterval); state.timers = [];
    const o = ctx(true);
    const me = state.me;
    if (!o.basis || !o.basisSet) { o.basis = [...shiftList()]; o.basisSet = true; }
    if (!isMaster(me) && o.division === 'all') o.division = me.division_id;
    const redraw = () => statusView(body);
    let cache = null; let fdiv = null; let teamRows = null; let attRows = []; let rosterRows = []; let ratioCfg = { mode: 'roster', custom: {} }; let staffRows = []; let staffBucket = 'sup'; let incRows = []; let tsRows = []; let unionRows = null;
    const refresh = async () => {
      let zones, rows, quota;
      try {
        let ratioV = null; let staffV = null;
        [zones, rows, quota, teamRows, attRows, rosterRows, ratioV, staffRows, staffV, incRows, tsRows, unionRows] = await Promise.all([
          q(sb.from('zones').select('id,division_id,side,floor,area,team,label,task,required,active')),
          loadLatest(o.date, o.division === 'all' ? null : o.division), loadQuota(),
          sb.rpc('leave_team', { p_date: o.date }).then((r) => (r.error ? null : r.data || []), () => null),
          sb.from('attendance_latest').select('division_id,shift,present,day_off,annual,health,leave_long,sick,other').eq('work_date', o.date).then((r) => (r.error ? [] : r.data || []), () => []),
          sb.rpc('team_roster', { p_date: o.date, p_team: null }).then((r) => (r.error ? [] : r.data || []), () => []),
          sb.from('settings').select('key,value').eq('key', 'ratio_base').then((r) => (r.error || !r.data || !r.data[0] ? null : r.data[0].value), () => null),
          sb.rpc('staff_checkins', { p_date: o.date }).then((r) => (r.error ? [] : r.data || []), () => []),
          sb.from('settings').select('key,value').eq('key', 'staff_bucket').then((r) => (r.error || !r.data || !r.data[0] ? null : r.data[0].value), () => null),
          sb.rpc('list_incidents', { p_limit: 300 }).then((r) => (r.error ? [] : r.data || []), () => []),
          sb.from('team_shift').select('division_id,team,shift,start_time,end_time,duty').then((r) => (r.error ? [] : r.data || []), () => []),
          sb.rpc('union_status', { p_date: o.date }).then((r) => (r.error ? null : r.data || []), () => null)]);
      // 같은 사람이 휴무계획 '행정' 팀 출근과 관리자 출근에 모두 잡히면 한 번만 집계 (행정 팀 쪽을 남김)
      const admNames = new Set((rosterRows || []).filter((r) => String(r.team || '').trim() === '행정' && r.checked).map((r) => r.name));
      staffRows = (staffRows || []).filter((x) => !admNames.has(x.name));
      staffBucket = staffV && staffV.bucket === 'biz' ? 'biz' : 'sup';
      if (ratioV && typeof ratioV === 'object') ratioCfg = { mode: ['roster', 'daily', 'full', 'custom'].includes(ratioV.mode) ? ratioV.mode : 'roster', custom: ratioV.custom || {} };
      } catch (e) { return body.replaceChildren(pickers(o, redraw, { shiftPick: false, allDiv: true }), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); }
      draw(zones, rows, quota);
    };

    /* ---- 이벤트 · 노조현황 집계 도우미 (홈 카드와 상황판이 함께 사용) ---- */
    const KIND_L = [['illegal', '불법행위'], ['obstruct', '업무방해']];
    const incCnt = (kind, div) => { const r = { new: 0, doing: 0, done: 0 }; for (const x of incRows || []) if (x.kind === kind && (div == null || x.division_id === div) && r[x.status] != null) r[x.status] += 1; return r; };
    const UK = ['민노', '한마음', '비노조'];
    const uAgg = (ids) => { const out = {}; for (const k of UK) out[k] = { total: 0, working: 0, present: 0, absent: 0, pending: 0 }; for (const r of unionRows || []) if ((ids == null || ids.includes(r.division_id)) && out[r.kind]) for (const f of ['total', 'working', 'present', 'absent', 'pending']) out[r.kind][f] += r[f] || 0; return out; };
    const uSum = (a) => { const s = { members: 0, working: 0, absent: 0, pending: 0 }; for (const k of ['민노', '한마음']) { s.members += a[k].total; s.working += a[k].working; s.absent += a[k].absent; s.pending += a[k].pending; } s.rate = s.working ? Math.round((s.absent * 100) / s.working) : null; return s; };
    const goIncident = () => { state.menu = 'incident'; window.APP.reload(); };
    const evCardEl = () => {
      const open = (incRows || []).filter((r) => r.status !== 'done').length;
      const col = ([k, label]) => { const c = incCnt(k); return el('div', { class: 'evk' }, el('div', { class: 'evl' }, label),
        el('div', { class: 'evn' }, el('span', { class: 'n new' }, el('b', {}, String(c.new)), '접수'), el('span', { class: 'n doing' }, el('b', {}, String(c.doing)), '조치 중'), el('span', { class: 'n done' }, el('b', {}, String(c.done)), '완료'))); };
      return el('div', { class: 'card evc' + (open ? ' hot' : '') },
        el('div', { class: 'evh' }, el('h2', {}, open ? `이벤트 신고 · 미조치 ${open}건` : '이벤트 신고'), el('button', { type: 'button', class: 'btn ghost sm', onclick: goIncident }, '신고하기')),
        el('div', { class: 'evg' }, ...KIND_L.map(col)));
    };
    const unionCardEl = (divs) => {
      if (unionRows == null) return null;
      const line = (name, ids, cls) => { const a = uAgg(ids); const u = uSum(a);
        const pc = (k) => el('td', {}, el('b', {}, String(a[k].present)), el('small', {}, ` / ${a[k].total}`));
        return el('tr', { class: cls || '' }, el('th', { scope: 'row' }, name), pc('민노'), pc('한마음'), pc('비노조'),
          el('td', { class: 'ust' }, el('b', {}, String(u.absent)), u.pending ? el('small', {}, ` (확인중 ${u.pending})`) : null), el('td', { class: 'urt' }, u.rate == null ? '-' : u.rate + '%')); };
      const all = uAgg(divs.map((d) => d.id)); const us = uSum(all);
      const tbl = el('table', { class: 'untbl' }, el('thead', {}, el('tr', {}, ...['구분', '민노', '한마음', '비노조', '파업 참여', '참여율'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...divs.map((d) => line(shortDiv(d.name), [d.id])), divs.length > 1 ? line('전체', divs.map((d) => d.id), 'tot') : null));
      return el('div', { class: 'card unc' }, el('div', { class: 'evh' }, el('h2', {}, '노조현황'), el('small', { class: 'hint' }, '출근 인원 / 조합원 · 비노조는 명단 외 인원')),
        el('div', { class: 'tblwrap' }, tbl),
        el('p', { class: 'hint' }, `파업 참여 = 근무 예정 조합원 중 미출근(팀 출근 체크 마감 기준) · 민노 ${all['민노'].absent}명 · 한마음 ${all['한마음'].absent}명 · 참여율은 근무 예정 조합원 ${us.working}명 대비`));
    };
    const draw = (zones, rows, quota) => {
      cache = { zones, rows, quota };
      SUPZ = new Set(zones.filter((z) => z.task === '현장지원').map((z) => z.id));
      const divs = (o.division === 'all' ? bizDivs() : bizDivs().filter((d) => d.id === o.division));
      const basis = o.basis;
      const chips = el('div', { class: 'chips' }, ...shiftList().map((s) =>
        el('button', {
          type: 'button', class: 'chip' + (basis.includes(s) ? ' on' : ''), 'aria-pressed': String(basis.includes(s)),
          onclick: () => { o.basis = basis.includes(s) ? basis.filter((x) => x !== s) : [...basis, s]; draw(zones, rows, quota); }
        }, s)),
        el('button', { type: 'button', class: 'chip auto', onclick: () => { o.basis = basisFor(null); draw(zones, rows, quota); } }, '현재 시각 기준'),
        el('button', { type: 'button', class: 'chip auto', onclick: () => { o.basis = [...shiftList()]; draw(zones, rows, quota); } }, '하루 전체 합산'));
      const inB = (x) => basis.includes(x.shift);
      // 팀 담당구역은 그 팀의 근무조가 선택한 기준에 들어올 때만 필요 인원에 포함
      const tShiftOf = (z) => { const r = z.team ? (tsRows || []).find((x) => x.division_id === z.division_id && tnumO(x.team) === tnumO(z.team)) : null; return r ? r.shift : null; };
      const zInB = (z) => { const sh = tShiftOf(z); return !sh || basis.includes(sh); };
      const allDay = basis.length >= shiftList().length;
      const tIn = (s) => basis.includes(s) || (s === '미지정' && allDay);
      const isAdm = (t) => String(t || '').trim() === '행정';
      // 행정 팀 출근 체크 인원 = 지원으로 집계
      const admOf = (d) => (rosterRows || []).filter((r) => r.division_id === d && isAdm(r.team) && r.checked && tIn(r.shift)).length;
      const staffOf = (d) => (staffRows || []).filter((x) => x.division_id === d && tIn(x.shift)).length;
      const stfB = (x) => (x.zone_id ? (SUPZ.has(x.zone_id) ? 'sup' : 'biz') : staffBucket);   // 구역 기준: 현장지원=지원, 그 외 구역=사업부 현장, 구역 없음=master 설정
      const sumD = (d, f) => { const r = sumBy(rows, f); const a = admOf(d); const ks = (staffRows || []).filter((x) => x.division_id === d && tIn(x.shift)); r.sup += a; r.total += a + ks.length; r.adm = a; r.stf = ks.length; for (const x of ks) { if (stfB(x) === 'biz') r.biz += 1; else r.sup += 1; } return r; };
      // 정원 대체값 = 휴무계획 전체 명단 (행정 제외). 휴무·연차는 빼지 않음 → 정원 = 출근 + 휴무외 + 결근 + 미확인
      const availOf = (d) => (teamRows || []).filter((t) => t.division_id === d && tIn(t.shift) && !isAdm(t.team)).reduce((n, t) => n + t.roster, 0);
      const OFFK = ['off', 'hold', 'annual', 'health', 'sick', 'other'];
      const quotaSum = (qu, d, b) => {
        if (ratioCfg.mode === 'custom' && Number(ratioCfg.custom[d]) > 0) return Number(ratioCfg.custom[d]);
        if (ratioCfg.mode === 'full') { const f = qu.filter((x) => x.division_id === d && b.includes(x.shift)).reduce((t, x) => t + (x.full_quota || 0), 0); if (f > 0) return f; }
        if (ratioCfg.mode !== 'roster') { const v = quotaSumRaw(qu, d, b); if (v > 0) return v; }
        const r0 = availOf(d); return r0 > 0 ? r0 : quotaSumRaw(qu, d, b);   // 기본: 사업부 전체 인원(휴무계획 명단)
      };
      // 사업부별 요약표
      let tot = { biz: 0, sup: 0, coop: 0, total: 0, q: 0 };
      const trs = divs.map((d) => {
        const s = sumD(d.id, (x) => x.division_id === d.id && inB(x)); const qq = quotaSum(quota, d.id, basis);
        tot = { biz: tot.biz + s.biz, sup: tot.sup + s.sup, coop: tot.coop + s.coop, total: tot.total + s.total, q: tot.q + qq };
        const p = pct(s.total, qq);
        return el('tr', {}, el('th', { class: divTone(d.id) }, shortDiv(d.name)), el('td', {}, s.biz), el('td', {}, s.sup), el('td', {}, s.coop), el('td', { class: 'b' }, s.total), el('td', {}, qq || '-'), el('td', { class: 'pc ' + tone(p) }, p == null ? '-' : p + '%'));
      });
      if (divs.length > 1) { const p = pct(tot.total, tot.q); trs.push(el('tr', { class: 'sum' }, el('th', {}, '소계'), el('td', {}, tot.biz), el('td', {}, tot.sup), el('td', {}, tot.coop), el('td', { class: 'b' }, tot.total), el('td', {}, tot.q || '-'), el('td', { class: 'pc ' + tone(p) }, p == null ? '-' : p + '%'))); }
      const basisLabel = allDay ? '하루 전체' : (basis.join('·') || '선택 없음');
      const head = el('div', { class: 'basisbar' },
        el('button', { type: 'button', class: 'basisbtn', 'aria-expanded': String(!!o.basisOpen), onclick: () => { o.basisOpen = !o.basisOpen; draw(zones, rows, quota); } },
          el('span', {}, `${dateLabel(o.date)} 근무 현황`), el('b', {}, `기준 ${basisLabel} ${o.basisOpen ? '▲' : '▼'}`)),
        o.basisOpen ? chips : null);
      const summary = el('div', { class: 'card' }, el('h2', {}, '사업부별 인원 합계'),
        el('div', { class: 'tblwrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['구분', '현장투입', '행정인력', '협정', '합계', '일일정원', '상근 대비'].map((h) => el('th', {}, h)))),
          el('tbody', {}, trs))),
        el('p', { class: 'hint' }, '상근 대비 = 근무 인원 합계 ÷ 선택한 근무조의 일일근무정원'));
      // 큰 숫자 카드: 사업부별 + 지원·협정
      const ICO = { ok: '✔', mid: '▲', low: '⚠', none: '' };
      const tiles = divs.map((d) => {
        const sm = sumD(d.id, (x) => x.division_id === d.id && inB(x)); const qq = quotaSum(quota, d.id, basis); const p = pct(sm.total, qq); const t = tone(p);
        return el('div', { class: 'stile ' + divTone(d.id) },
          el('div', { class: 'tn' }, shortDiv(d.name)),
          ringNode(p, t),
          el('div', { class: 'tb' }, String(sm.total), el('small', {}, `/ ${qq || '-'}명`)),
          el('div', { class: 'tp ' + t }, p == null ? '정원 미설정' : `${ICO[t]} ${t === 'ok' ? '충족' : '부족 ' + Math.max(0, qq - sm.total) + '명'}`),
          el('div', { class: 'm3' }, el('div', {}, el('b', {}, String(sm.biz)), '현장투입'), el('div', {}, el('b', {}, String(sm.sup)), '지원'), el('div', {}, el('b', {}, String(sm.coop)), '협정')));
      });
      const supDepts = state.divisions.filter((d) => d.kind === '지원부서');
      const inScope = (x) => inB(x) && (o.division === 'all' || x.division_id === o.division);
      tiles.push(el('div', { class: 'stile sup' }, el('div', { class: 'tn' }, '지원·협정'),
        ...supDepts.map((d) => el('div', { class: 'sl' }, el('span', {}, d.name), el('b', {}, `${rows.filter((x) => x.source === '지원' && x.dept_id === d.id && inScope(x)).reduce((t, x) => t + x.headcount, 0)}명`))),
        el('div', { class: 'sl' }, el('span', {}, '행정'), el('b', {}, `${divs.reduce((t, d) => t + admOf(d.id), 0)}명`)),
        el('div', { class: 'sl' }, el('span', {}, `관리(${staffBucket === 'biz' ? '근무' : '지원'} 집계)`), el('b', {}, `${divs.reduce((t, d) => t + staffOf(d.id), 0)}명`)),
        el('div', { class: 'sl' }, el('span', {}, '협정인력'), el('b', {}, `${rows.filter((x) => x.source === '협정' && inScope(x)).reduce((t, x) => t + x.headcount, 0)}명`))));
      const gTot0 = divs.reduce((t, d) => t + sumD(d.id, (x) => x.division_id === d.id && inB(x)).total, 0);
      const gQ0 = divs.reduce((t, d) => t + quotaSum(quota, d.id, basis), 0); const gP0 = pct(gTot0, gQ0); const gT0 = tone(gP0);
      const lack0 = Math.max(0, gQ0 - gTot0);
      const supCoop = rows.filter((x) => x.source === '협정' && inScope(x)).reduce((t, x) => t + x.headcount, 0);
      const supCells = [...supDepts.map((d) => [d.name, rows.filter((x) => x.source === '지원' && x.dept_id === d.id && inScope(x)).reduce((t, x) => t + x.headcount, 0)]), ['협정인력', supCoop]];
      const tilesRow = el('div', { class: 'card gcard' }, el('h2', {}, '근무 현황'),
        el('div', { class: 'gauge ' + gT0, style: `--a:${Math.min(100, gP0 || 0) * 1.8}deg` }, el('div', { class: 'arc' }), el('div', { class: 'gin' }),
          el('div', { class: 'gtx' }, el('b', {}, gP0 == null ? '-' : gP0 + '%'),
            el('small', {}, `투입 ${gTot0} / 정원 ${gQ0 || '-'}명`))),
        el('div', { class: 'gsup' }, supCells.map(([n, v]) => el('div', {}, el('b', {}, `${v}명`), el('small', {}, n)))),
        el('div', { class: 'tblwrap' }, el('table', { class: 'tbl gtbl' },
          el('thead', {}, el('tr', {}, ...['구분', '현장', '지원', '협정', '근무', '정원', '비율'].map((h) => el('th', {}, h)))),
          el('tbody', {}, trs))),
        null);
      const gTot = divs.reduce((t, d) => t + sumD(d.id, (x) => x.division_id === d.id && inB(x)).total, 0);
      const gQ = divs.reduce((t, d) => t + quotaSum(quota, d.id, basis), 0); const gP = pct(gTot, gQ);
      const digits = String(gTot).padStart(3, '0').split('');
      const shareBar = el('div', { class: 'share' }, divs.map((d) => { const n = sumBy(rows, (x) => x.division_id === d.id && inB(x)).total; return el('i', { class: divTone(d.id), style: `flex:${Math.max(n, 0.0001)}` }); }));
      const basisBtn = el('button', { type: 'button', class: 'basischip', 'aria-expanded': String(!!o.basisOpen), onclick: () => { o.basisOpen = !o.basisOpen; draw(zones, rows, quota); } }, `기준 ${basisLabel} ${o.basisOpen ? '▲' : '▼'}`);
      const flip = el('div', { class: 'flipboard' },
        el('div', { class: 'lb' }, el('span', {}, `${dateLabel(o.date)} 투입 인원`), basisBtn),
        el('div', { class: 'fmid' },
          el('div', { class: 'flap' }, digits.map((c) => el('div', { class: 'd' }, c)), el('span', { class: 'unit' }, '명')),
          el('div', { class: 'fq' }, el('b', {}, gQ ? `정원 ${gQ}명` : '정원 미설정'), el('small', {}, gQ ? `투입 비율 ${gP}%` : ''), el('em', {}, '근무+지원+협정'))),
        shareBar,
        el('div', { class: 'shl' }, divs.map((d) => el('span', {}, `${shortDiv(d.name)} ${sumBy(rows, (x) => x.division_id === d.id && inB(x)).total}`))),
        o.basisOpen ? el('div', { class: 'fchips' }, chips) : null);
      // 팀별 정원·근무 현황 (휴무계획 기준) + 근무조 합산
      const teamCard = el('div', { class: 'card teamcard' }, el('button', { type: 'button', class: 'basisbtn', 'aria-expanded': String(!!o.teamOpen), onclick: () => { o.teamOpen = !o.teamOpen; draw(zones, rows, quota); } }, el('span', {}, '팀별 정원 · 근무 현황'), el('b', {}, o.teamOpen ? '접기 ▲' : '펼치기 ▼')));
      const teamBox = el('div', { class: 'teambox' });
      if (teamRows === null) teamBox.append(el('p', { class: 'hint' }, '팀별 집계를 불러오지 못했습니다. 08_team.sql 실행 여부를 확인하세요'));
      else if (!teamRows.length) teamBox.append(el('p', { class: 'hint' }, '휴무계획을 업로드하면 팀별 정원이 나옵니다'));
      else {
        teamBox.append(el('p', { class: 'hint' }, '정원 = 휴무계획 · 근태 = 주휴·연차 등 · 출근 = 팀장 체크 · 결근 = 정원 − 근태 − 출근 (괄호는 미확인)'));
        const tnum = (t) => String(t || '').replace(/\D/g, '') || String(t || '').trim();
        for (const d of divs) {
          const tr = teamRows.filter((t) => t.division_id === d.id).sort((x, y) => x.team.localeCompare(y.team, 'ko', { numeric: true }));
          if (!tr.length) continue;
          // 팀별: 정원·근태(휴무계획+ERP) + 출근·결근(팀장 이름 체크)
          const tm = tr.map((t) => {
            const rs = rosterRows.filter((r) => r.division_id === d.id && tnum(r.team) === tnum(t.team));
            const has = rs.some((r) => r.checked || r.closed); const closed = rs.length > 0 && rs[0].closed;
            const present = rs.filter((r) => r.checked).length;
            const rest = rs.filter((r) => !r.checked && !['off', 'hold', 'annual', 'health', 'sick', 'other'].includes(r.leave_kind)).length;
            const zt = (id) => { const z = zones.find((x) => x.id === id); return z && z.team ? z.team : null; };
            const sent = rs.filter((r) => r.checked && zt(r.zone_id) && tnum(zt(r.zone_id)) !== tnum(t.team)).length;
            const got = rosterRows.filter((r) => r.division_id === d.id && r.checked && tnum(r.team) !== tnum(t.team) && zt(r.zone_id) && tnum(zt(r.zone_id)) === tnum(t.team)).length;
            const ldN = rs.filter((r) => r.is_lead).length; const ldP = rs.filter((r) => r.is_lead && r.checked).length;
            return { ldN, ldP, sent, got, team: t.team, shift: t.shift, roster: t.roster, leave: t.absent, has, closed, present, men: rs.filter((r) => r.checked && r.gender === '남').length, women: rs.filter((r) => r.checked && r.gender === '여').length, ab: closed ? rest : null, wait: has && !closed ? rest : null };
          });
          const S0 = tm.reduce((s, t) => ({ ldN: s.ldN + t.ldN, ldP: s.ldP + t.ldP, sent: s.sent + t.sent, got: s.got + t.got, r: s.r + t.roster, l: s.l + t.leave, p: s.p + t.present, m: s.m + t.men, w: s.w + t.women, a: s.a + (t.ab || 0), any: s.any || t.has }), { ldN: 0, ldP: 0, sent: 0, got: 0, r: 0, l: 0, p: 0, m: 0, w: 0, a: 0, any: false });
          const cellP = (t) => (t.has ? t.present : '-');
          const cellA = (t) => (t.ab != null ? el('td', { class: 'pc ' + (t.ab ? 'low' : 'none') }, t.ab) : el('td', {}, t.wait != null ? `(${t.wait})` : '-'));
          const tmSmall = (dv, team) => { const r = (tsRows || []).find((x) => x.division_id === dv && tnum(x.team) === tnum(team)); return r && (r.start_time || r.end_time) ? el('small', { class: 'tmsm' }, `${r.start_time ? String(r.start_time).slice(0, 5) : '--:--'}~${r.end_time ? String(r.end_time).slice(0, 5) : '--:--'}${r.duty ? ' ' + r.duty : ''}`) : null; };
          const trows = tm.map((t) => el('tr', {}, el('th', {}, t.team, tmSmall(d.id, t.team)), el('td', {}, t.shift), el('td', {}, t.roster), el('td', {}, t.leave), el('td', { class: 'b' }, cellP(t)), el('td', {}, t.has ? `${t.men}·${t.women}` : '-'), el('td', {}, t.ldN ? `${t.ldP}/${t.ldN}` : '-'), el('td', { class: t.sent ? 'sp out' : '' }, t.sent || '-'), el('td', { class: t.got ? 'sp in' : '' }, t.got || '-'), cellA(t)));
          trows.push(el('tr', { class: 'sum' }, el('th', {}, '합계'), el('td', {}, ''), el('td', {}, S0.r), el('td', {}, S0.l), el('td', { class: 'b' }, S0.any ? S0.p : '-'), el('td', {}, S0.any ? `${S0.m}·${S0.w}` : '-'), el('td', {}, S0.ldN ? `${S0.ldP}/${S0.ldN}` : '-'), el('td', {}, S0.sent || '-'), el('td', {}, S0.got || '-'), el('td', { class: 'pc ' + (S0.a ? 'low' : 'none') }, S0.any ? S0.a : '-')));
          // 근무조별 합산 (오전+오후+야간…)
          const shifts = [...new Set([...shiftList(), ...tm.map((t) => t.shift)])].filter((s) => tm.some((t) => t.shift === s) || rows.some((r) => r.division_id === d.id && r.shift === s));
          const T = { r: 0, k: 0, p: 0, a: 0, c: 0, any: false };
          const srows = shifts.map((s) => {
            const ts = tm.filter((t) => t.shift === s); const rs = ts.reduce((n, t) => n + t.roster, 0);
            const cu = sumBy(rows, (x) => x.division_id === d.id && x.shift === s).total;
            let kt = null, pr = null, ab = null;
            if (ts.some((t) => t.has)) { kt = ts.reduce((n, t) => n + t.leave, 0); pr = ts.reduce((n, t) => n + t.present, 0); ab = ts.reduce((n, t) => n + (t.ab || 0), 0); }
            else { const at = attRows.find((x) => x.division_id === d.id && x.shift === s); if (at) { kt = ATT_LEAVE.reduce((n, k) => n + (at[k] || 0), 0); pr = at.present; ab = Math.max(0, rs - at.present - kt); } }
            T.r += rs; T.c += cu; if (kt != null) { T.any = true; T.k += kt; T.p += pr; T.a += ab; }
            return el('tr', {}, el('th', {}, s), el('td', {}, rs || '-'), el('td', {}, kt == null ? '-' : kt), el('td', { class: 'b' }, pr == null ? '-' : pr),
              el('td', { class: 'pc ' + (ab ? 'low' : 'none') }, ab == null ? '-' : ab), el('td', {}, cu));
          });
          srows.push(el('tr', { class: 'sum' }, el('th', {}, '하루 합계'), el('td', {}, T.r || '-'), el('td', {}, T.any ? T.k : '-'), el('td', { class: 'b' }, T.any ? T.p : '-'),
            el('td', { class: 'pc ' + (T.a ? 'low' : 'none') }, T.any ? T.a : '-'), el('td', {}, T.c)));
          teamBox.append(el('h3', { class: 'divh2 ' + divTone(d.id) }, d.name),
            el('div', { class: 'tblwrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['팀', '근무조', '정원', '근태', '출근', '남·여', '현장관리', '지원 보냄', '지원 받음', '결근'].map((h) => el('th', {}, h)))), el('tbody', {}, trows))),
            el('div', { class: 'tblwrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['근무조', '정원', '근태', '출근', '결근', '현재 배치'].map((h) => el('th', {}, h)))), el('tbody', {}, srows))));
        }
      }
      if (o.teamOpen) teamCard.append(teamBox);
      // 사업부별 · 층별 현황 (정원 / 현재근무 / 지원 / 협정 / 휴무외 / 결근 / 계)
      const SIDE_ORD = { 'L/S': 0, 'A/S': 1 };
      const tnum2 = (t) => String(t || '').replace(/\D/g, '') || String(t || '').trim();
      const flCard = el('div', { class: 'card flcard' }, el('h2', {}, '사업부 층별 현황'));
      const dsum = [];
      for (const d of divs) {
        const zs = zones.filter((z) => z.division_id === d.id && z.active && zInB(z));
        const groups = new Map();
        for (const z of zs) { const k = `${z.side}\u0001${z.floor}`; if (!groups.has(k)) groups.set(k, { side: z.side, floor: z.floor, ids: new Set(), req: 0 }); const g = groups.get(k); g.ids.add(z.id); g.req += z.required || 0; }
        const list = [...groups.values()].sort((x, y) => (SIDE_ORD[x.side] ?? 9) - (SIDE_ORD[y.side] ?? 9) || x.floor.localeCompare(y.floor, 'ko', { numeric: true }));
        const frs = list.map((g) => { const sm = sumBy(rows, (x) => g.ids.has(x.zone_id) && inB(x)); const sk = (staffRows || []).filter((x) => g.ids.has(x.zone_id) && tIn(x.shift)).length; for (const x of (staffRows || []).filter((y) => g.ids.has(y.zone_id) && tIn(y.shift))) { if (stfB(x) === 'biz') sm.biz += 1; else sm.sup += 1; } sm.total += sk; return { name: `${g.side} ${g.floor}`, req: g.req, biz: sm.biz, sup: sm.sup, coop: sm.coop, total: sm.total }; });
        const dsm = sumD(d.id, (x) => x.division_id === d.id && inB(x));
        const tt = (teamRows || []).filter((t) => t.division_id === d.id && tIn(t.shift) && !isAdm(t.team));
        const leaveN = tt.reduce((n, t) => n + t.absent, 0);
        const dq = quotaSum(quota, d.id, basis);
        const W = dsm.biz; const L = tt.length ? leaveN : null;
        const AB = dq > 0 ? Math.max(0, dq - W - (L || 0)) : null;          // 결근 = 정원 − 근무 − 휴무외 (파업 참여 + 출근 배치가 안 된 인원)
        const GY = dq > 0 ? W + (L || 0) + AB : null;                          // 계 = 근무 + 휴무외 + 결근 (= 정원)
        const td = (v, cls) => el('td', cls ? { class: cls } : {}, v === null || v === undefined || v === 0 ? (v === 0 ? '0' : '-') : String(v));
        const dm = () => el('td', { class: 'dim' }, '-');
        dsum.push({ d, dq, biz: W, leave: L, ab: AB, gye: GY, sup: dsm.sup, coop: dsm.coop, total: dsm.total });
        const rowsEl = frs.map((f) => el('tr', {}, el('th', {}, f.name), td(f.req || null), td(f.biz), dm(), dm(), dm(), td(f.sup), td(f.coop), td(f.total, 'b')));
        const zonedStf = (staffRows || []).filter((x) => x.division_id === d.id && tIn(x.shift) && zs.some((z) => z.id === x.zone_id)).length;
        const freeStf = (dsm.stf || 0) - zonedStf;
        if (freeStf > 0) rowsEl.push(el('tr', { class: 'admrow' }, el('th', {}, '관리(구역 미배치)'), td(null), td(staffBucket === 'biz' ? freeStf : 0), dm(), dm(), dm(), td(staffBucket === 'sup' ? freeStf : 0), td(0), td(freeStf, 'b')));
        if (dsm.adm) rowsEl.push(el('tr', { class: 'admrow' }, el('th', {}, '행정(지원)'), td(null), td(0), dm(), dm(), dm(), td(dsm.adm), td(0), td(dsm.adm, 'b')));
        rowsEl.push(el('tr', { class: 'sum' }, el('th', {}, '합계'), td(dq || null), td(W), td(L), td(AB), td(GY), td(dsm.sup), td(dsm.coop), td(dsm.total, 'b')));
        // 팀 현장관리(휴무계획 직책 팀장·조장)를 팀원과 나눠서 표시 (합계는 위와 동일)
        const ld = (rosterRows || []).filter((r) => r.division_id === d.id && r.is_lead && tIn(r.shift) && !isAdm(r.team));
        if (ld.length && dq > 0) {
          const Lq = ld.length, Ll = ld.filter((r) => OFFK.includes(r.leave_kind)).length;
          const Lw = ld.filter((r) => r.checked && r.zone_id && !SUPZ.has(r.zone_id) && !OFFK.includes(r.leave_kind)).length;
          const Lab = Math.max(0, Lq - Lw - Ll);
          const mq = Math.max(0, dq - Lq), mw = Math.max(0, W - Lw), ml = Math.max(0, (L || 0) - Ll), mab = Math.max(0, mq - mw - ml);
          rowsEl.push(el('tr', { class: 'admrow' }, el('th', {}, '└ 팀원'), td(mq), td(mw), td(ml), td(mab), td(mw + ml + mab), dm(), dm(), dm()),
            el('tr', { class: 'admrow' }, el('th', {}, '└ 팀 현장관리'), td(Lq), td(Lw), td(Ll), td(Lab), td(Lw + Ll + Lab), dm(), dm(), dm()));
        }
        flCard.append(el('h3', { class: 'divh2 ' + divTone(d.id) }, d.name),
          el('div', { class: 'tblwrap' }, el('table', { class: 'tbl fltbl' },
            el('thead', {}, el('tr', {}, ...['층', '정원', '근무', '휴무외', '결근', '계', '지원', '협정', '투입'].map((h, i) => el('th', { class: i === 6 ? 'gl' : '' }, h)))),
            el('tbody', {}, rowsEl))));
      }
      {
        const nz = (arr, k) => (arr.some((x) => x[k] != null) ? arr.reduce((n, x) => n + (x[k] || 0), 0) : null);
        const cell = (v, cls) => el('td', cls ? { class: cls } : {}, v == null ? '-' : String(v));
        const rate = (x) => { const p = pct(x.total, x.dq); return el('td', { class: 'pc ' + tone(p) }, p == null ? '-' : p + '%'); };
        const srows2 = dsum.map((x) => el('tr', {}, el('th', { class: divTone(x.d.id) }, shortDiv(x.d.name)), cell(x.dq || null), cell(x.biz), cell(x.leave), cell(x.ab), cell(x.gye), cell(x.sup, 'gl'), cell(x.coop), cell(x.total, 'b'), rate(x)));
        const T = { dq: nz(dsum.map((x) => ({ v: x.dq || null })), 'v'), biz: nz(dsum, 'biz'), sup: nz(dsum, 'sup'), coop: nz(dsum, 'coop'), leave: nz(dsum, 'leave'), ab: nz(dsum, 'ab'), gye: nz(dsum, 'gye'), total: nz(dsum, 'total') };
        if (dsum.length > 1) srows2.push(el('tr', { class: 'sum' }, el('th', {}, '전체'), cell(T.dq), cell(T.biz), cell(T.leave), cell(T.ab), cell(T.gye), cell(T.sup, 'gl'), cell(T.coop), cell(T.total, 'b'), rate({ total: T.total || 0, dq: T.dq || 0 })));
        const sumTbl = el('div', { class: 'tblwrap' }, el('table', { class: 'tbl fltbl flsum' },
          el('thead', {}, el('tr', {}, ...['구분', '정원', '근무', '휴무외', '결근', '계', '지원', '협정', '투입', '비율'].map((h, i) => el('th', { class: i === 6 ? 'gl' : '' }, h)))),
          el('tbody', {}, srows2)));
        const MODES = [['roster', '사업부 전체 인원'], ['daily', '일일근무정원'], ['full', '상근정원'], ['custom', '직접 입력']];
        const canEdit = isMaster(me);
        const saveRatio = async (cfg) => {
          const { error } = await sb.from('settings').upsert({ key: 'ratio_base', value: cfg, note: '현황 비율 기준' }, { onConflict: 'key' });
          if (error) return toast('저장하지 못했습니다. 다시 시도해 주세요');
          ratioCfg = cfg; o.ratioOpen = false; toast('비율 기준을 저장했습니다'); draw(zones, rows, quota);
        };
        const ratioBar = el('div', { class: 'ratiobar' }, el('span', { class: 'rl' }, '비율 기준'),
          canEdit ? el('div', { class: 'rseg' }, MODES.map(([k, l]) => el('button', {
            type: 'button', class: 'rb' + (ratioCfg.mode === k ? ' on' : ''),
            onclick: () => { if (k === 'custom') { ratioCfg = { ...ratioCfg, mode: 'custom' }; draw(zones, rows, quota); } else saveRatio({ mode: k, custom: ratioCfg.custom }); }
          }, l))) : el('b', {}, (MODES.find((m) => m[0] === ratioCfg.mode) || MODES[0])[1]));
        const customBox = canEdit && ratioCfg.mode === 'custom' ? (() => {
          const ins = new Map();
          const box = el('div', { class: 'rcustom' }, ...divs.map((d) => { const i = numIn(String(ratioCfg.custom[d.id] || quotaSum(quota, d.id, basis) || ''), `${d.name} 기준 인원`); ins.set(d.id, i); return el('label', { class: 'rc' }, el('span', {}, shortDiv(d.name)), i); }),
            el('button', { type: 'button', class: 'btn sm', onclick: () => { const c = {}; ins.forEach((i, id) => { const n = toInt(i.value); if (n > 0) c[id] = n; }); saveRatio({ mode: 'custom', custom: c }); } }, '저장'));
          return box;
        })() : null;
        const saveStaff = async (b) => {
          const { error } = await sb.from('settings').upsert({ key: 'staff_bucket', value: { bucket: b }, note: '관리자 출근 집계 칸' }, { onConflict: 'key' });
          if (error) return toast('저장하지 못했습니다. 다시 시도해 주세요');
          staffBucket = b; toast('관리 인원 집계 칸을 저장했습니다'); draw(zones, rows, quota);
        };
        const staffBar = el('div', { class: 'ratiobar' }, el('span', { class: 'rl' }, '구역 없는 관리 출근'),
          el('div', { class: 'rseg' }, [['sup', '지원 칸'], ['biz', '근무 칸']].map(([k, l]) => el('button', { type: 'button', class: 'rb' + (staffBucket === k ? ' on' : ''), onclick: () => { if (k !== staffBucket) saveStaff(k); } }, l))));
        const panelOn = canEdit && !!o.ratioOpen;
        if (canEdit) { const h = tilesRow.querySelector('h2'); if (h) { h.classList.add('gh'); h.append(el('button', { type: 'button', class: 'gset' + (panelOn ? ' on' : ''), 'aria-expanded': String(panelOn), onclick: () => { o.ratioOpen = !o.ratioOpen; draw(zones, rows, quota); } }, panelOn ? '닫기' : '집계 기준 변경')); } }
        const sumWrap = el('div', { class: 'sumwrap' }, panelOn ? ratioBar : null, panelOn ? customBox : null, panelOn ? staffBar : null, sumTbl);
        const oldTbl = tilesRow.querySelector('.tblwrap'); if (oldTbl) oldTbl.replaceWith(sumWrap);
        const oldSup = tilesRow.querySelector('.gsup');
        if (oldSup) { oldSup.className = 'gsup kpi7'; oldSup.replaceChildren(...[['정원', T.dq, ''], ['근무', T.biz, ''], ['휴무외', T.leave, ''], ['결근', T.ab, 'warn'], ['지원', T.sup, 'gl'], ['협정', T.coop, ''], ['투입', T.total, 'tot']].map(([n, v, c]) => el('div', c ? { class: c } : {}, el('b', {}, v == null ? '-' : `${v}`), el('small', {}, n)))); }
      }
      flCard.append(el('p', { class: 'hint' }, '정원 = 사업부 전체 인원(휴무계획) · 근무 = 출근 인원 · 휴무외 = 연차·휴무·병가·보건휴가·휴직 등 · 결근 = 정원 − 근무 − 휴무외(파업 참여·출근 배치가 안 된 인원) · 계 = 근무+휴무외+결근 · 지원(경영본부·사업본부·행정 등)·협정은 사업부 인력이 아니라 정원에 포함되지 않음 · 투입 = 근무+지원+협정 · 비율 = 투입 ÷ 정원 · 층별 줄의 정원은 구역 필요 인원, 휴무외·결근·계는 합계 행에만 표시 · 팀원 / 팀 현장관리(팀장·조장)는 합계를 둘로 나눠 본 값'));
      // 부족 구역 강조
      const lacks = shortages(divs, zones, rows, basis, zInB);
      const lackSet = new Set(lacks.map((l) => l.zone.id));
      const lackCard = el('div', { class: 'card lackcard' + (lacks.length ? '' : ' fine') },
        el('h2', {}, lacks.length ? `부족 구역 ${lacks.length}곳` : '모든 구역 충족'),
        lacks.length ? el('div', { class: 'lacklist' }, lacks.slice(0, 12).map((l) => el('div', { class: 'lackrow' },
          el('span', { class: 'lk-dv ' + divTone(l.div.id) }, shortDiv(l.div.name)),
          el('b', {}, `${l.zone.side} ${l.zone.floor} · ${zoneName(l.zone)}`),
          el('span', { class: 'lk-n' }, `${l.total}/${l.need}명`),
          el('span', { class: 'lk-m' }, `-${l.lack}`)))) : el('p', { class: 'hint' }, '필요 인원 이상 배치된 상태입니다'),
        lacks.length > 12 ? el('p', { class: 'hint' }, `외 ${lacks.length - 12}곳은 아래 구역별 현황에서 확인`) : null);
      // 층별 배치도
      if (!fdiv || !divs.some((d) => d.id === fdiv)) fdiv = divs[0] && divs[0].id;
      const room = (z) => {
        const sm = sumBy(rows, (x) => x.zone_id === z.id && inB(x)); const p = pct(sm.total, z.required); const t = z.required > 0 ? (sm.total >= z.required ? 'ok' : p >= 80 ? 'mid' : 'low') : 'none';
        const lack = Math.max(0, z.required - sm.total);
        return el('div', { class: 'rm ' + t },
          el('div', { class: 'rt' }, el('b', {}, z.task, (z.area === '동편' || z.area === '서편') ? el('i', { class: 'ar' }, z.area) : null), z.required > 0 ? el('span', { class: 'bd' }, lack ? `${ICO[t]} 부족 ${lack}` : '✔ 충족') : null),
          z.label ? el('div', { class: 'lb', title: z.label }, z.label) : null,
          el('div', { class: 'rn' }, String(sm.total), el('small', {}, z.required > 0 ? `/ 필요 ${z.required}명` : '필요 인원 미설정')),
          el('div', { class: 'rs' }, `현장 ${sm.biz} · 지원 ${sm.sup} · 협정 ${sm.coop}`),
          (() => { const g = rosterRows.filter((r) => r.zone_id === z.id && r.checked && inB(r)); return g.length ? el('div', { class: 'rs gn' }, `남 ${g.filter((r) => r.gender === '남').length} · 여 ${g.filter((r) => r.gender === '여').length}` + (g.some((r) => !r.gender) ? ` · 미정 ${g.filter((r) => !r.gender).length}` : '')) : null; })());
      };
      const floorCard = (side, f) => {
        const tot = f.zones.reduce((t, z) => t + sumBy(rows, (x) => x.zone_id === z.id && inB(x)).total, 0); const req = f.zones.reduce((t, z) => t + (z.required || 0), 0);
        const p = pct(tot, req); const t = req > 0 ? (tot >= req ? 'ok' : p >= 80 ? 'mid' : 'low') : 'none';
        const wing = (name, list, cls) => list.length ? el('div', { class: 'wing ' + (cls || '') }, el('div', { class: 'wl' }, name), list.map(room)) : null;
        const E = f.zones.filter((z) => z.area === '동편'), W = f.zones.filter((z) => z.area === '서편'), A = f.zones.filter((z) => z.area !== '동편' && z.area !== '서편');
        return el('section', { class: 'floor' },
          el('div', { class: 'fh' }, el('div', {}, el('b', {}, side), ` · ${f.floor}`), el('div', { class: 'fp ' + t }, `${tot}${req ? ` / ${req}` : ''}명${p == null ? '' : ` · ${p}%`}`)),
          el('div', { class: 'bld' }, [...E, ...W, ...A].map(room)));
      };
      const dsel = divs.length > 1 ? seg(divs.map((d) => [String(d.id), shortDiv(d.name)]), String(fdiv), (v) => { fdiv = Number(v); draw(zones, rows, quota); }, (v) => divTone(v)) : null;
      const fz = zones.filter((z) => z.division_id === fdiv && ((z.active && zInB(z)) || rows.some((r) => r.zone_id === z.id && inB(r))));
      const fcols = groupZones(fz).map((g) => el('div', { class: 'col' }, g.floors.map((f) => floorCard(g.side, f))));
      const floorsCard = el('div', { class: 'card' }, el('h2', {}, '층별 배치 현황'), dsel,
        fz.length ? el('div', { class: 'floors' }, fcols) : el('p', { class: 'empty' }, '등록된 구역이 없습니다'),
        el('div', { class: 'legend' }, el('span', {}, el('b', { class: 'lg ok' }, '✔ 충족'), ' 필요 인원 이상'), el('span', {}, el('b', { class: 'lg mid' }, '▲ 부족'), ' 80% 이상'), el('span', {}, el('b', { class: 'lg low' }, '⚠ 부족'), ' 80% 미만')));
      const bar = pickers(o, redraw, { shiftPick: false, allDiv: true });
      bar.append(el('button', { type: 'button', class: 'btn ghost sm', onclick: refresh }, '새로고침'),
        el('button', { type: 'button', class: 'btn sm', onclick: openBoard }, '상황판 (큰 화면)'));
      const unEl = unionCardEl(divs);
      body.replaceChildren(bar, flip, tilesRow, el('div', { class: 'homepair' + (unEl ? ' two' : '') }, evCardEl(), unEl), flCard, lackCard, floorsCard, teamCard);
    };
    /* 상황판: 큰 글씨 전체화면, 30초마다 자동 갱신 */
    function openBoard() {
      const box = el('div', { class: 'board', role: 'dialog', 'aria-label': '상황판' });
      document.body.append(box); document.body.classList.add('boardon');
      try { if (box.requestFullscreen) box.requestFullscreen().catch(() => {}); } catch (e) { /* 무시 */ }
      let timer = null;
      const close = () => { clearInterval(timer); document.removeEventListener('keydown', onKey); document.body.classList.remove('boardon'); box.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      const render = (zones, rows, quota) => {
        const divs = (o.division === 'all' ? bizDivs() : bizDivs().filter((d) => d.id === o.division));
        const basis = o.basis; const inB = (x) => basis.includes(x.shift);
        const tInB = (sh) => basis.includes(sh) || ((sh == null || sh === '미지정') && basis.length >= shiftList().length);
        const rosterB = (dv) => (teamRows || []).filter((t) => t.division_id === dv && tInB(t.shift) && String(t.team || '').trim() !== '행정').reduce((n, t) => n + t.roster, 0);
        const quotaB = (dv) => {   // 홈 화면과 같은 정원 기준
          if (ratioCfg.mode === 'custom' && Number(ratioCfg.custom[dv]) > 0) return Number(ratioCfg.custom[dv]);
          if (ratioCfg.mode === 'full') { const f = quota.filter((x) => x.division_id === dv && basis.includes(x.shift)).reduce((t, x) => t + (x.full_quota || 0), 0); if (f > 0) return f; }
          if (ratioCfg.mode !== 'roster') { const v = quotaSumRaw(quota, dv, basis); if (v > 0) return v; }
          const r0 = rosterB(dv); return r0 > 0 ? r0 : quotaSumRaw(quota, dv, basis);
        };
        const calc = (d) => {
          const sm = sumBy(rows, (x) => x.division_id === d.id && inB(x)); const admN = (rosterRows || []).filter((r) => r.division_id === d.id && String(r.team || '').trim() === '행정' && r.checked && basis.includes(r.shift)).length; sm.sup += admN;
          const ks = (staffRows || []).filter((x) => x.division_id === d.id && basis.includes(x.shift)); sm.total += admN + ks.length;
          for (const x of ks) { const b = x.zone_id ? (SUPZ.has(x.zone_id) ? 'sup' : 'biz') : staffBucket; if (b === 'biz') sm.biz += 1; else sm.sup += 1; }
          const qq = quotaB(d.id);
          const tt = (teamRows || []).filter((t) => t.division_id === d.id && (basis.includes(t.shift) || (t.shift == null && basis.length >= shiftList().length) || (t.shift === '미지정' && basis.length >= shiftList().length)) && String(t.team || '').trim() !== '행정');
          const lv = tt.reduce((n, t) => n + t.absent, 0); const ab = qq > 0 ? Math.max(0, qq - sm.biz - lv) : 0;
          return { d, sm, qq, lv, ab, p: pct(sm.total, qq) };
        };
        const L = divs.map(calc);
        const T = L.reduce((t, x) => ({ total: t.total + x.sm.total, biz: t.biz + x.sm.biz, sup: t.sup + x.sm.sup, coop: t.coop + x.sm.coop, q: t.q + x.qq, lv: t.lv + x.lv, ab: t.ab + x.ab }), { total: 0, biz: 0, sup: 0, coop: 0, q: 0, lv: 0, ab: 0 });
        const tp = pct(T.total, T.q);
        const hero = el('div', { class: 'bhero' },
          el('div', { class: 'hl' }, el('div', { class: 'bname' }, '환경미화 전체 투입 현황 (근무+지원+협정)'),
            el('div', { class: 'bbig' }, String(T.total), el('small', {}, `명 / 정원 ${T.q || '-'}명`))),
          el('div', { class: 'hr' }, el('div', { class: 'bpct pc ' + tone(tp) }, tp == null ? '-' : tp + '%'),
            el('div', { class: 'hbar w' + (Math.round(Math.min(100, tp || 0) / 5) * 5) }, el('i', { class: 'f ' + tone(tp) })),
            el('div', { class: 'hsub' }, el('span', {}, '근무 ', el('b', {}, String(T.biz))), el('span', {}, '휴무외 ', el('b', {}, String(T.lv))), el('span', {}, '결근 ', el('b', { class: 'hab' }, String(T.ab))), el('span', { class: 'hgap' }, '지원 ', el('b', {}, String(T.sup))), el('span', {}, '협정 ', el('b', {}, String(T.coop))))));
        const cards = L.map(({ d, sm, qq, lv, ab, p }) => el('div', { class: 'bcard ' + divTone(d.id) },
          el('div', { class: 'bname' }, shortDiv(d.name)),
          el('div', { class: 'bbig' }, String(sm.total), el('small', {}, `/ ${qq || '-'}명`)),
          el('div', { class: 'bpct pc ' + tone(p) }, p == null ? '-' : p + '%'),
          el('div', { class: 'bsub' }, `근무 ${sm.biz} · 휴무외 ${lv} · 결근 ${ab}`), el('div', { class: 'bsub' }, `지원 ${sm.sup} · 협정 ${sm.coop}`)));
        const evCell = (k, div) => { const c = incCnt(k, div); return el('td', {}, el('span', { class: 'n new' }, '접수 ', el('b', {}, String(c.new))), el('span', { class: 'n doing' }, '조치 ', el('b', {}, String(c.doing))), el('span', { class: 'n done' }, '완료 ', el('b', {}, String(c.done)))); };
        const evRow = (name, div, cls) => el('tr', { class: cls || '' }, el('th', { scope: 'row' }, name), ...KIND_L.map(([k]) => evCell(k, div)));
        const evCard = el('div', { class: 'black bsec' }, el('h2', {}, '이벤트 (불법행위 · 업무방해)'),
          el('table', { class: 'btbl' }, el('thead', {}, el('tr', {}, el('th', {}, '구분'), ...KIND_L.map(([, l]) => el('th', {}, l)))),
            el('tbody', {}, ...divs.map((d) => evRow(shortDiv(d.name), d.id)), divs.length > 1 ? evRow('전체', null, 'tot') : null)));
        let unCard = null;
        if (unionRows != null) {
          const row = (name, ids, cls) => { const a = uAgg(ids); const u = uSum(a); const pc = (k) => el('td', {}, el('b', {}, String(a[k].present)), el('small', {}, ` / ${a[k].total}`));
            return el('tr', { class: cls || '' }, el('th', { scope: 'row' }, name), pc('민노'), pc('한마음'), pc('비노조'), el('td', { class: 'ust' }, el('b', {}, String(u.absent)), u.pending ? el('small', {}, ` (확인중 ${u.pending})`) : null), el('td', { class: 'urt' }, u.rate == null ? '-' : u.rate + '%')); };
          unCard = el('div', { class: 'black bsec' }, el('h2', {}, '노조현황'),
            el('table', { class: 'btbl' }, el('thead', {}, el('tr', {}, ...['구분', '민노', '한마음', '비노조', '파업 참여', '참여율'].map((h) => el('th', {}, h)))),
              el('tbody', {}, ...divs.map((d) => row(shortDiv(d.name), [d.id])), divs.length > 1 ? row('전체', divs.map((d) => d.id), 'tot') : null)),
            el('p', { class: 'bnote' }, '출근 인원 / 조합원 · 파업 참여 = 근무 예정 조합원 중 미출근 · 참여율 = 근무 예정 조합원 대비'));
        }
        box.replaceChildren(
          el('div', { class: 'bhead' }, el('div', {}, el('b', {}, 'IAOS 비정상상황 근무 현황'), el('span', {}, `${dateLabel(o.date)} · 기준 ${basis.join('·')}`)),
            el('div', { class: 'bclock' }, clockTxt()), el('button', { type: 'button', class: 'btn ghost', onclick: close }, '닫기 (Esc)')),
          hero, el('div', { class: 'bcards' }, cards), evCard, unCard);
      };
      const load = async () => {
        try {
          const [zones, rows, quota, inc, un] = await Promise.all([
            q(sb.from('zones').select('id,division_id,side,floor,area,team,label,task,required,active')),
            loadLatest(o.date, o.division === 'all' ? null : o.division), loadQuota(),
            sb.rpc('list_incidents', { p_limit: 300 }).then((r) => (r.error ? incRows : r.data || []), () => incRows),
            sb.rpc('union_status', { p_date: o.date }).then((r) => (r.error ? null : r.data || []), () => unionRows)]);
          incRows = inc; unionRows = un;
          render(zones, rows, quota);
        } catch (e) { /* 다음 갱신 때 다시 시도 */ }
      };
      if (cache) render(cache.zones, cache.rows, cache.quota);
      load(); timer = setInterval(load, 30000);
    }

    body.replaceChildren(pickers(o, redraw, { shiftPick: false, allDiv: true }), loading());
    await refresh();
    state.timers.push(setInterval(() => { if ((state.menu === 'status' || state.menu === 'home') && document.body.contains(body)) refresh(); }, 60000));
  }

  /* =========================================================
     4) 협정·지원 배치  (총괄팀장 / 관리자)
     ========================================================= */
  async function placeView(body) {
    await ensureShifts();
    const o = ctx();
    const redraw = () => placeView(body);
    body.replaceChildren(pickers(o, redraw), loading());
    let zones, latest, counts, depts; let availList = null;
    try {
      let tsm;
      [zones, latest, counts, tsm, availList] = await Promise.all([
        loadZones(o.division),
        loadLatest(o.date, o.division, (r) => r.eq('shift', o.shift).in('source', ['지원', '협정'])),
        sb.rpc('coop_counts', { p_date: o.date }).then((r) => (r.error ? [] : r.data || [])),
        loadTeamShift(o.division),
        sb.rpc('list_support_avail', { p_date: o.date, p_division: o.division, p_shift: o.shift }).then((r) => (r.error ? null : r.data || []), () => null)]);
      zones = teamFilter(zones, tsm, o.shift);
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
    // 지원부서별 '오늘 지원 가능 인원' (입력하면 배치 합계가 이 인원을 넘을 때 저장 차단, 비우면 제한 없음)
    const availIn = new Map(depts.map((d) => { const a = (availList || []).find((x) => x.dept_id === d.id); return [d.id, numIn(a ? a.available : '', `${d.name} 지원 가능 인원`)]; }));
    const availCard = availList === null ? null : el('div', { class: 'card' }, el('h2', {}, `${o.shift} 지원 가능 인원`),
      el('p', { class: 'hint' }, '부서별로 이 근무조에 지원 나올 수 있는 인원을 입력하면, 아래 배치 합계가 그 인원을 넘을 때 저장되지 않습니다. 비워 두면 제한하지 않습니다.'),
      el('div', { class: 'zgrid' }, depts.map((d) => el('div', { class: 'zc' }, el('div', { class: 'zch' }, el('b', {}, d.name)), stepper(availIn.get(d.id))))));
    const cols = depts.map((d) => [d.name, '지원', d.id]);   // 협정은 '협정 출퇴근' 화면에서 이름으로 배치
    const secs = groupZones(zones).map((s) => s.floors.map((f) => el('div', { class: 'card' }, floorHead(s.side, f.floor),
      el('div', { class: 'zgrid' }, f.zones.map((z) => el('div', { class: 'zc' },
        el('div', { class: 'zch' }, el('b', {}, zoneName(z)), el('small', {}, `필요 ${z.required}명`)),
        ...cols.map(([label, source, dept]) => {
          const k = key(z.id, source, dept);
          const inp = numIn(last.has(k) ? last.get(k) : '', `${zoneName(z)} ${label}`);
          inp.addEventListener('input', calc); inputs.set(k, inp);
          return el('div', { class: 'zl' }, el('span', {}, label), stepper(inp));
        })))))));
    calc();
    const save = el('button', { class: 'btn', type: 'button' }, '저장');
    save.addEventListener('click', busy(save, async () => {
      const rows = [];
      const lim = new Map();
      for (const d of depts) { const v = toInt(availIn.get(d.id).value); if (Number.isNaN(v)) return toast('지원 가능 인원은 숫자만 입력하세요', 'err'); lim.set(d.id, v); }
      for (const d of depts) {
        const lv = lim.get(d.id); if (lv == null) continue;
        const sm = [...inputs].filter(([k]) => k.endsWith(`|지원|${d.id}`)).reduce((t, [, i]) => t + (toInt(i.value) || 0), 0);
        if (sm > lv) return toast(`${d.name} 배치 ${sm}명 > 지원 가능 ${lv}명 — ${sm - lv}명 초과라 저장되지 않았습니다`, 'err');
      }
      if (availList !== null) {
        const ar = depts.filter((d) => lim.get(d.id) != null).map((d) => ({ dept_id: d.id, available: lim.get(d.id) }));
        const rr = await sb.rpc('set_support_avail', { p_date: o.date, p_division: o.division, p_shift: o.shift, p_rows: ar });
        if (rr.error) return toast('지원 가능 인원을 저장하지 못했습니다', 'err');
      }
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
        el('div', {}, el('span', {}, '구역 배치'), el('b', {}, String(cnt.assigned)), el('small', {}, '명')),
        el('div', {}, el('span', {}, '남은 인원'), el('b', { class: cnt.remaining < 0 ? 'neg' : '' }, String(cnt.remaining)), el('small', {}, '명'))),
      el('p', { class: 'hint pad' }, '협정인력은 "협정 출퇴근" 화면에서 이름으로 구역에 배치합니다(출근한 협정 인원보다 많이 배치할 수 없음). 여기에서는 지원부서 인원만 입력합니다.'),
      availCard,
      zones.length ? [secs, save] : noZones());
  }

  window.APP.ops = { tnumO, today, addDays, hhmm, dateLabel, basisFor, zoneName, groupZones, sumBy, quotaSum, pct, tone, shiftList, ensureShifts, ctx, zoneSort };

  register('input', '인력 입력', ['leader', 'admin', 'master'], inputView, '내 팀 인원을 구역별로 입력');
  register('place', '지원 배치', ['chief', 'admin', 'master'], placeView, '지원부서 인원을 구역에 배치');
  register('att', '출근 현황', ['leader', 'chief', 'admin', 'master'], attView, '출근·휴무·연차 등 인원 입력');
  register('status', '구역 현황', ['leader', 'chief', 'admin', 'master'], statusView, '구역별 인원과 상근 대비 % 확인');
})();
