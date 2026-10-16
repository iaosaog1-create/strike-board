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
  function sumBy(rows, f) {
    const r = { biz: 0, sup: 0, coop: 0 };
    for (const x of rows) if (f(x)) { if (x.source === '사업부') r.biz += x.headcount; else if (x.source === '지원') r.sup += x.headcount; else r.coop += x.headcount; }
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
  function shortages(divs, zones, rows, basis) {
    const out = [];
    for (const d of divs) {
      for (const z of zones.filter((x) => x.division_id === d.id && x.active)) {
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
    let cache = null; let fdiv = null; let teamRows = null; let attRows = []; let rosterRows = []; let ratioCfg = { mode: 'daily', custom: {} };
    const refresh = async () => {
      let zones, rows, quota;
      try {
        let ratioV = null;
        [zones, rows, quota, teamRows, attRows, rosterRows, ratioV] = await Promise.all([
          q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active')),
          loadLatest(o.date, o.division === 'all' ? null : o.division), loadQuota(),
          sb.rpc('leave_team', { p_date: o.date }).then((r) => (r.error ? null : r.data || []), () => null),
          sb.from('attendance_latest').select('division_id,shift,present,day_off,annual,health,leave_long,sick,other').eq('work_date', o.date).then((r) => (r.error ? [] : r.data || []), () => []),
          sb.rpc('team_roster', { p_date: o.date, p_team: null }).then((r) => (r.error ? [] : r.data || []), () => []),
          sb.from('settings').select('key,value').eq('key', 'ratio_base').then((r) => (r.error || !r.data || !r.data[0] ? null : r.data[0].value), () => null)]);
      if (ratioV && typeof ratioV === 'object') ratioCfg = { mode: ['daily', 'full', 'custom'].includes(ratioV.mode) ? ratioV.mode : 'daily', custom: ratioV.custom || {} };
      } catch (e) { return body.replaceChildren(pickers(o, redraw, { shiftPick: false, allDiv: true }), el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); }
      draw(zones, rows, quota);
    };
    const draw = (zones, rows, quota) => {
      cache = { zones, rows, quota };
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
      const allDay = basis.length >= shiftList().length;
      const tIn = (s) => basis.includes(s) || (s === '미지정' && allDay);
      const availOf = (d) => (teamRows || []).filter((t) => t.division_id === d && tIn(t.shift)).reduce((n, t) => n + t.roster - t.absent, 0);
      const quotaSum = (qu, d, b) => {
        if (ratioCfg.mode === 'custom' && Number(ratioCfg.custom[d]) > 0) return Number(ratioCfg.custom[d]);
        if (ratioCfg.mode === 'full') { const f = qu.filter((x) => x.division_id === d && b.includes(x.shift)).reduce((t, x) => t + (x.full_quota || 0), 0); if (f > 0) return f; }
        const v = quotaSumRaw(qu, d, b); return v > 0 ? v : availOf(d);
      };
      // 사업부별 요약표
      let tot = { biz: 0, sup: 0, coop: 0, total: 0, q: 0 };
      const trs = divs.map((d) => {
        const s = sumBy(rows, (x) => x.division_id === d.id && inB(x)); const qq = quotaSum(quota, d.id, basis);
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
        const sm = sumBy(rows, (x) => x.division_id === d.id && inB(x)); const qq = quotaSum(quota, d.id, basis); const p = pct(sm.total, qq); const t = tone(p);
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
        el('div', { class: 'sl' }, el('span', {}, '협정인력'), el('b', {}, `${rows.filter((x) => x.source === '협정' && inScope(x)).reduce((t, x) => t + x.headcount, 0)}명`))));
      const gTot0 = divs.reduce((t, d) => t + sumBy(rows, (x) => x.division_id === d.id && inB(x)).total, 0);
      const gQ0 = divs.reduce((t, d) => t + quotaSum(quota, d.id, basis), 0); const gP0 = pct(gTot0, gQ0); const gT0 = tone(gP0);
      const lack0 = Math.max(0, gQ0 - gTot0);
      const supCoop = rows.filter((x) => x.source === '협정' && inScope(x)).reduce((t, x) => t + x.headcount, 0);
      const supCells = [...supDepts.map((d) => [d.name, rows.filter((x) => x.source === '지원' && x.dept_id === d.id && inScope(x)).reduce((t, x) => t + x.headcount, 0)]), ['협정인력', supCoop]];
      const tilesRow = el('div', { class: 'card gcard' }, el('h2', {}, '근무 현황'),
        el('div', { class: 'gauge ' + gT0, style: `--a:${Math.min(100, gP0 || 0) * 1.8}deg` }, el('div', { class: 'arc' }), el('div', { class: 'gin' }),
          el('div', { class: 'gtx' }, el('b', {}, gP0 == null ? '-' : gP0 + '%'),
            el('small', {}, `${gTot0} / ${gQ0 || '-'}명 · `, lack0 ? el('em', {}, `부족 ${lack0}명`) : el('span', { class: 'okt' }, gQ0 ? '충족' : '정원 미설정')))),
        el('div', { class: 'tblwrap' }, el('table', { class: 'tbl gtbl' },
          el('thead', {}, el('tr', {}, ...['구분', '현장', '지원', '협정', '근무', '정원', '비율'].map((h) => el('th', {}, h)))),
          el('tbody', {}, trs))),
        el('div', { class: 'gsup' }, supCells.map(([n, v]) => el('div', {}, el('b', {}, `${v}명`), el('small', {}, n)))),
        null);
      const gTot = divs.reduce((t, d) => t + sumBy(rows, (x) => x.division_id === d.id && inB(x)).total, 0);
      const gQ = divs.reduce((t, d) => t + quotaSum(quota, d.id, basis), 0); const gP = pct(gTot, gQ);
      const digits = String(gTot).padStart(3, '0').split('');
      const shareBar = el('div', { class: 'share' }, divs.map((d) => { const n = sumBy(rows, (x) => x.division_id === d.id && inB(x)).total; return el('i', { class: divTone(d.id), style: `flex:${Math.max(n, 0.0001)}` }); }));
      const flip = el('div', { class: 'flipboard' },
        el('div', { class: 'lb' }, el('span', {}, '현재 근무 인원 합계'), el('span', {}, gQ ? `정원 ${gQ}명 · 상근 대비 ${gP}%` : '정원 미설정')),
        el('div', { class: 'flap' }, digits.map((c) => el('div', { class: 'd' }, c)), el('span', { class: 'unit' }, '명')),
        shareBar,
        el('div', { class: 'shl' }, divs.map((d) => el('span', {}, `${shortDiv(d.name)} ${sumBy(rows, (x) => x.division_id === d.id && inB(x)).total}`))));
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
            return { team: t.team, shift: t.shift, roster: t.roster, leave: t.absent, has, closed, present, men: rs.filter((r) => r.checked && r.gender === '남').length, women: rs.filter((r) => r.checked && r.gender === '여').length, ab: closed ? rest : null, wait: has && !closed ? rest : null };
          });
          const S0 = tm.reduce((s, t) => ({ r: s.r + t.roster, l: s.l + t.leave, p: s.p + t.present, m: s.m + t.men, w: s.w + t.women, a: s.a + (t.ab || 0), any: s.any || t.has }), { r: 0, l: 0, p: 0, m: 0, w: 0, a: 0, any: false });
          const cellP = (t) => (t.has ? t.present : '-');
          const cellA = (t) => (t.ab != null ? el('td', { class: 'pc ' + (t.ab ? 'low' : 'none') }, t.ab) : el('td', {}, t.wait != null ? `(${t.wait})` : '-'));
          const trows = tm.map((t) => el('tr', {}, el('th', {}, t.team), el('td', {}, t.shift), el('td', {}, t.roster), el('td', {}, t.leave), el('td', { class: 'b' }, cellP(t)), el('td', {}, t.has ? `${t.men}·${t.women}` : '-'), cellA(t)));
          trows.push(el('tr', { class: 'sum' }, el('th', {}, '합계'), el('td', {}, ''), el('td', {}, S0.r), el('td', {}, S0.l), el('td', { class: 'b' }, S0.any ? S0.p : '-'), el('td', {}, S0.any ? `${S0.m}·${S0.w}` : '-'), el('td', { class: 'pc ' + (S0.a ? 'low' : 'none') }, S0.any ? S0.a : '-')));
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
            el('div', { class: 'tblwrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['팀', '근무조', '정원', '근태', '출근', '남·여', '결근'].map((h) => el('th', {}, h)))), el('tbody', {}, trows))),
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
        const zs = zones.filter((z) => z.division_id === d.id && z.active);
        const groups = new Map();
        for (const z of zs) { const k = `${z.side}\u0001${z.floor}`; if (!groups.has(k)) groups.set(k, { side: z.side, floor: z.floor, ids: new Set(), req: 0 }); const g = groups.get(k); g.ids.add(z.id); g.req += z.required || 0; }
        const list = [...groups.values()].sort((x, y) => (SIDE_ORD[x.side] ?? 9) - (SIDE_ORD[y.side] ?? 9) || x.floor.localeCompare(y.floor, 'ko', { numeric: true }));
        const frs = list.map((g) => { const sm = sumBy(rows, (x) => g.ids.has(x.zone_id) && inB(x)); return { name: `${g.side} ${g.floor}`, req: g.req, biz: sm.biz, sup: sm.sup, coop: sm.coop, total: sm.total }; });
        const dsm = sumBy(rows, (x) => x.division_id === d.id && inB(x));
        const tt = (teamRows || []).filter((t) => t.division_id === d.id && tIn(t.shift));
        const leaveN = tt.reduce((n, t) => n + t.absent, 0);
        let ab = 0; let abAny = false;
        for (const t of tt) { const rs = (rosterRows || []).filter((r) => r.division_id === d.id && tnum2(r.team) === tnum2(t.team)); if (rs.length && rs[0].closed) { abAny = true; ab += rs.filter((r) => !r.checked && !['off', 'hold', 'annual', 'health', 'sick', 'other'].includes(r.leave_kind)).length; } }
        const dq = quotaSum(quota, d.id, basis);
        const td = (v, cls) => el('td', cls ? { class: cls } : {}, v === null || v === undefined || v === 0 ? (v === 0 ? '0' : '-') : String(v));
        dsum.push({ d, dq, biz: dsm.biz, sup: dsm.sup, coop: dsm.coop, leave: tt.length ? leaveN : null, ab: abAny ? ab : null, total: dsm.total });
        const rowsEl = frs.map((f) => el('tr', {}, el('th', {}, f.name), td(f.req || null), td(f.biz), td(f.sup), td(f.coop), el('td', { class: 'dim' }, '-'), el('td', { class: 'dim' }, '-'), td(f.total, 'b')));
        rowsEl.push(el('tr', { class: 'sum' }, el('th', {}, '합계'), td(dq || null), td(dsm.biz), td(dsm.sup), td(dsm.coop), td(tt.length ? leaveN : null), el('td', { class: abAny && ab ? 'pc low' : '' }, abAny ? String(ab) : '-'), td(dsm.total, 'b')));
        flCard.append(el('h3', { class: 'divh2 ' + divTone(d.id) }, d.name),
          el('div', { class: 'tblwrap' }, el('table', { class: 'tbl fltbl' },
            el('thead', {}, el('tr', {}, el('th', {}, '층'), el('th', {}, '정원'), el('th', {}, '근무'), el('th', {}, '지원'), el('th', {}, '협정'), el('th', {}, '휴무외'), el('th', {}, '결근'), el('th', {}, '계'))),
            el('tbody', {}, rowsEl))));
      }
      {
        const nz = (arr, k) => (arr.some((x) => x[k] != null) ? arr.reduce((n, x) => n + (x[k] || 0), 0) : null);
        const cell = (v, cls) => el('td', cls ? { class: cls } : {}, v == null ? '-' : String(v));
        const srows2 = dsum.map((x) => el('tr', {}, el('th', { class: divTone(x.d.id) }, shortDiv(x.d.name)), cell(x.dq || null), cell(x.biz), cell(x.sup), cell(x.coop), cell(x.leave), cell(x.ab), cell(x.total, 'b')));
        const T = { dq: nz(dsum.map((x) => ({ v: x.dq || null })), 'v'), biz: nz(dsum, 'biz'), sup: nz(dsum, 'sup'), coop: nz(dsum, 'coop'), leave: nz(dsum, 'leave'), ab: nz(dsum, 'ab'), total: nz(dsum, 'total') };
        if (dsum.length > 1) srows2.push(el('tr', { class: 'sum' }, el('th', {}, '전체'), cell(T.dq), cell(T.biz), cell(T.sup), cell(T.coop), cell(T.leave), cell(T.ab), cell(T.total, 'b')));
        const sumTbl = el('div', { class: 'tblwrap' }, el('table', { class: 'tbl fltbl flsum' },
          el('thead', {}, el('tr', {}, ...['구분', '정원', '근무', '지원', '협정', '휴무외', '결근', '계'].map((h) => el('th', {}, h)))),
          el('tbody', {}, srows2)));
        const MODES = [['daily', '일일근무정원'], ['full', '상근정원'], ['custom', '직접 입력']];
        const canEdit = isMaster(me);
        const saveRatio = async (cfg) => {
          const { error } = await sb.from('settings').upsert({ key: 'ratio_base', value: cfg, note: '현황 비율 기준' }, { onConflict: 'key' });
          if (error) return toast('저장하지 못했습니다. 다시 시도해 주세요');
          ratioCfg = cfg; toast('비율 기준을 저장했습니다'); draw(zones, rows, quota);
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
        const sumWrap = el('div', { class: 'sumwrap' }, ratioBar, customBox, sumTbl);
        const oldTbl = tilesRow.querySelector('.tblwrap'); if (oldTbl) oldTbl.replaceWith(sumWrap);
        const oldSup = tilesRow.querySelector('.gsup');
        if (oldSup) oldSup.replaceChildren(...[['근무', T.biz], ['지원', T.sup], ['협정', T.coop], ['총계', T.total]].map(([n, v]) => el('div', {}, el('b', {}, `${v || 0}명`), el('small', {}, n))));
      }
      flCard.append(el('p', { class: 'hint' }, '층 정원 = 구역 필요 인원 · 합계 정원 = 일일근무정원 · 휴무외 = 휴무·연차·병가·기타 · 휴무외·결근은 팀 기준이라 합계 행에만 표시'));
      // 부족 구역 강조
      const lacks = shortages(divs, zones, rows, basis);
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
      const fz = zones.filter((z) => z.division_id === fdiv && (z.active || rows.some((r) => r.zone_id === z.id)));
      const fcols = groupZones(fz).map((g) => el('div', { class: 'col' }, g.floors.map((f) => floorCard(g.side, f))));
      const floorsCard = el('div', { class: 'card' }, el('h2', {}, '층별 배치 현황'), dsel,
        fz.length ? el('div', { class: 'floors' }, fcols) : el('p', { class: 'empty' }, '등록된 구역이 없습니다'),
        el('div', { class: 'legend' }, el('span', {}, el('b', { class: 'lg ok' }, '✔ 충족'), ' 필요 인원 이상'), el('span', {}, el('b', { class: 'lg mid' }, '▲ 부족'), ' 80% 이상'), el('span', {}, el('b', { class: 'lg low' }, '⚠ 부족'), ' 80% 미만')));
      const bar = pickers(o, redraw, { shiftPick: false, allDiv: true });
      bar.append(el('button', { type: 'button', class: 'btn ghost sm', onclick: refresh }, '새로고침'),
        el('button', { type: 'button', class: 'btn sm', onclick: openBoard }, '상황판 (큰 화면)'));
      body.replaceChildren(bar, flip, head, tilesRow, flCard, lackCard, floorsCard, teamCard);
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
        const lacks = shortages(divs, zones, rows, basis);
        const cards = divs.map((d) => {
          const sm = sumBy(rows, (x) => x.division_id === d.id && inB(x)); const qq = quotaSum(quota, d.id, basis); const p = pct(sm.total, qq);
          return el('div', { class: 'bcard ' + divTone(d.id) },
            el('div', { class: 'bname' }, shortDiv(d.name)),
            el('div', { class: 'bbig' }, String(sm.total), el('small', {}, `/ ${qq || '-'}명`)),
            el('div', { class: 'bpct pc ' + tone(p) }, p == null ? '-' : p + '%'),
            el('div', { class: 'bsub' }, `사업부 ${sm.biz} · 지원 ${sm.sup} · 협정 ${sm.coop}`));
        });
        box.replaceChildren(
          el('div', { class: 'bhead' }, el('div', {}, el('b', {}, 'IAOS 비정상상황 근무 현황'), el('span', {}, `${dateLabel(o.date)} · 기준 ${basis.join('·')}`)),
            el('div', { class: 'bclock' }, clockTxt()), el('button', { type: 'button', class: 'btn ghost', onclick: close }, '닫기 (Esc)')),
          el('div', { class: 'bcards' }, cards),
          el('div', { class: 'black' }, el('h2', {}, lacks.length ? `부족 구역 ${lacks.length}곳` : '모든 구역 충족'),
            lacks.length ? el('div', { class: 'blist' }, lacks.slice(0, 10).map((l) => el('div', { class: 'brow' },
              el('span', { class: 'lk-dv ' + divTone(l.div.id) }, shortDiv(l.div.name)),
              el('b', {}, `${l.zone.side} ${l.zone.floor} ${zoneName(l.zone)}`),
              el('span', {}, `${l.total}/${l.need}`), el('span', { class: 'lk-m' }, `-${l.lack}`)))) : null));
      };
      const load = async () => {
        try {
          const [zones, rows, quota] = await Promise.all([
            q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active')),
            loadLatest(o.date, o.division === 'all' ? null : o.division), loadQuota()]);
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
      el('p', { class: 'hint pad' }, '협정인력은 "협정 출퇴근" 화면에서 이름으로 구역에 배치합니다. 여기에서는 지원부서 인원만 입력합니다.'),
      zones.length ? [secs, save] : noZones());
  }

  window.APP.ops = { today, addDays, hhmm, dateLabel, basisFor, zoneName, groupZones, sumBy, quotaSum, pct, tone, shiftList, ensureShifts, ctx, zoneSort };

  register('input', '인력 입력', ['leader', 'admin', 'master'], inputView, '내 팀 인원을 구역별로 입력');
  register('place', '지원 배치', ['chief', 'admin', 'master'], placeView, '지원부서 인원을 구역에 배치');
  register('att', '출근 현황', ['leader', 'chief', 'admin', 'master'], attView, '출근·휴무·연차 등 인원 입력');
  register('status', '구역 현황', ['leader', 'chief', 'admin', 'master'], statusView, '구역별 인원과 상근 대비 % 확인');
})();
