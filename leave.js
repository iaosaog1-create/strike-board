/* 휴무 업로드: 휴무계획 · ERP 근태 엑셀 → 사업부별 휴무·연차 자동 집계 (총괄팀장: 자기 사업부 / 관리자: 전체) */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, bizDivs, divName, divTone, shortDiv } = window.APP;
  const { today, hhmm, shiftList, ensureShifts } = window.APP.ops;
  const X = window.XLSX_LITE;
  const MASTERS = ['admin', 'master'];
  const TABS = [['plan', '휴무계획'], ['erp', 'ERP 근태'], ['team', '팀 구성'], ['quarter', '분기 적용일'], ['log', '업로드 기록']];
  const S = { tab: 'plan', div: null, year: null, plan: null, erp: null, teams: [], found: [] };
  const MAX_BYTES = 6 * 1024 * 1024;
  const q = async (p) => { const r = await p; if (r.error) throw r.error; return r.data || []; };

  /* ---------- 엑셀 해석 ---------- */
  const cell = (v) => (v == null ? '' : String(v).trim());
  const norm = (h) => cell(h).replace(/\s+/g, '');
  function findHeader(rows, must) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const hs = (rows[i] || []).map(norm);
      if (must.every((m) => hs.some((h) => h === m || h.includes(m)))) return { i, hs };
    }
    return null;
  }
  const colOf = (hs, names) => { for (const n of names) { const k = hs.findIndex((h) => h === n); if (k >= 0) return k; } return -1; };
  const SHIFT_KEYS = ['오전', '오후', '야간', '일근', '운영'];
  const toShift = (v) => { const s = cell(v); return SHIFT_KEYS.find((k) => s.includes(k)) || null; };
  const toPattern = (v) => { const s = cell(v).replace(/[\s,·/]/g, ''); return /^[월화수목금토일]{1,3}$/.test(s) ? s : (s ? '?' + s : null); };
  const SHIFT_COL_ALIASES = ['근무구분', '시간대', '근무시간대', '교대', '교대조', '주야', '주야구분', 'shift'];
  function matchDivision(v, fallback) {
    const s = cell(v);
    if (!s) return { id: fallback, explicit: false };
    const d = bizDivs().find((x) => x.name === s || x.name.includes(s) || s.includes(shortDiv(x.name)) || s.includes(x.name.slice(0, 2)));
    return d ? { id: d.id, explicit: true } : { id: null, explicit: true, bad: s };
  }

  function parsePlan(rows, fallbackDiv) {
    const h = findHeader(rows, ['사번', '성명']);
    if (!h) throw new Error('휴무계획 양식이 아닙니다. 첫 줄 근처에 "사번", "성명", "1분기~4분기" 열이 있어야 합니다');
    const { hs } = h;
    const c = {
      emp: colOf(hs, ['사번', '사원번호']), name: colOf(hs, ['성명', '이름']), title: colOf(hs, ['직책']), team: colOf(hs, ['근무팀', '팀']),
      sub: colOf(hs, ['근무조']), q: [1, 2, 3, 4].map((n) => colOf(hs, [n + '분기'])), hold: colOf(hs, ['휴직']),
      hs: colOf(hs, ['시작일자', '시작일']), he: colOf(hs, ['종료일자', '종료일']), note: colOf(hs, ['비고']),
      div: colOf(hs, ['사업부']), shift: SHIFT_COL_ALIASES.map((a) => colOf(hs, [a])).find((k) => k >= 0) ?? -1
    };
    if (c.emp < 0 || c.name < 0 || c.q.every((k) => k < 0)) throw new Error('"사번", "성명", "분기" 열을 찾지 못했습니다');
    const title = cell((rows[0] || [])[0]); const ym = /(20\d\d)\s*년/.exec(title);
    const out = { rows: [], warn: [], teams: new Set(), divs: {}, year: ym ? Number(ym[1]) : null, extra: { div: c.div >= 0, shift: c.shift >= 0 } };
    let badPat = 0, badDate = 0, noDiv = 0;
    for (const r of rows.slice(h.i + 1)) {
      const emp = cell(r[c.emp]), name = cell(r[c.name]);
      if (!emp || !name) continue;
      const dv = c.div >= 0 ? matchDivision(r[c.div], fallbackDiv) : { id: fallbackDiv };
      if (dv.id == null) { noDiv++; continue; }
      const rec = { emp_no: emp, name, title: cell(r[c.title]) || null, team: cell(r[c.team]) || null, sub: c.sub >= 0 ? cell(r[c.sub]) || null : null,
        shift: c.shift >= 0 ? toShift(r[c.shift]) : null, note: c.note >= 0 ? cell(r[c.note]) || null : null,
        hold_start: null, hold_end: null, q1: null, q2: null, q3: null, q4: null };
      c.q.forEach((k, n) => { if (k >= 0) { const p = toPattern(r[k]); if (p && p[0] === '?') badPat++; else rec['q' + (n + 1)] = p; } });
      if (c.hold >= 0 && cell(r[c.hold])) {
        rec.hold_start = X.toIso(r[c.hs]); rec.hold_end = X.toIso(r[c.he]);
        if (!rec.hold_start) { badDate++; rec.hold_end = null; }
      }
      if (rec.team) out.teams.add(rec.team);
      (out.divs[dv.id] || (out.divs[dv.id] = [])).push(rec);
      out.rows.push(rec);
    }
    if (badPat) out.warn.push(`요일 형식을 읽지 못한 칸 ${badPat}개는 건너뛰었습니다 (예: 월화, 금토)`);
    if (badDate) out.warn.push(`휴직 시작일을 읽지 못한 ${badDate}명은 휴직 기간 없이 처리됩니다`);
    if (noDiv) out.warn.push(`사업부를 알 수 없는 ${noDiv}줄은 제외했습니다`);
    if (!out.rows.length) throw new Error('읽을 수 있는 사원 줄이 없습니다');
    return out;
  }

  function parseErp(rows, fallbackDiv) {
    const h = findHeader(rows, ['근태코드', '시작일']);
    if (!h) throw new Error('ERP 근태 양식이 아닙니다. "사원번호", "근태코드", "승인상태", "시작일", "종료일" 열이 필요합니다');
    const { hs } = h;
    const c = {
      emp: colOf(hs, ['사원번호', '사번']), name: colOf(hs, ['성명', '이름']), shift: colOf(hs, ['근무조']), status: colOf(hs, ['승인상태']),
      code: colOf(hs, ['근태코드']), s: colOf(hs, ['시작일']), e: colOf(hs, ['종료일']), days: colOf(hs, ['일수']), type: colOf(hs, ['신청구분']), div: colOf(hs, ['사업부'])
    };
    if ([c.emp, c.code, c.s, c.e, c.status].some((k) => k < 0)) throw new Error('"사원번호", "근태코드", "승인상태", "시작일", "종료일" 열을 찾지 못했습니다');
    const out = { rows: [], warn: [], divs: {}, codes: {}, status: {}, extra: { div: c.div >= 0 } };
    let bad = 0, noDiv = 0;
    for (const r of rows.slice(h.i + 1)) {
      const emp = cell(r[c.emp]); if (!emp) continue;
      const s = X.toIso(r[c.s]), e = X.toIso(r[c.e]) || s;
      const status = cell(r[c.status]);
      if (!s || !['승인', '신청', '반려', '승인취소'].includes(status)) { bad++; continue; }
      const dv = c.div >= 0 ? matchDivision(r[c.div], fallbackDiv) : { id: fallbackDiv };
      if (dv.id == null) { noDiv++; continue; }
      const days = Number(cell(r[c.days]));
      const rec = { emp_no: emp, name: cell(r[c.name]) || null, shift: toShift(r[c.shift]), code: cell(r[c.code]), start_date: s, end_date: e < s ? s : e,
        days: Number.isFinite(days) ? days : null, status, req_type: cell(r[c.type]) || null };
      if (!rec.code) { bad++; continue; }
      (out.divs[dv.id] || (out.divs[dv.id] = [])).push(rec); out.rows.push(rec);
      out.codes[rec.code] = (out.codes[rec.code] || 0) + 1; out.status[status] = (out.status[status] || 0) + 1;
    }
    if (bad) out.warn.push(`날짜·상태를 읽지 못한 ${bad}줄은 제외했습니다`);
    if (noDiv) out.warn.push(`사업부를 알 수 없는 ${noDiv}줄은 제외했습니다`);
    if (!out.rows.length) throw new Error('읽을 수 있는 근태 줄이 없습니다');
    return out;
  }

  /* ---------- 화면 ---------- */
  async function leaveView(body) {
    await ensureShifts();
    const me = state.me;
    const master = MASTERS.includes(me.role);
    if (!master) S.div = me.division_id;
    if (!S.div) S.div = (bizDivs()[0] || {}).id;
    if (!S.year) S.year = Number(today().slice(0, 4));
    const redraw = () => leaveView(body);
    const divSeg = master ? el('div', { class: 'f top0' }, el('span', { class: 'hint' }, '사업부'),
      seg(bizDivs().map((d) => [String(d.id), shortDiv(d.name)]), String(S.div), (v) => { S.div = Number(v); S.plan = S.erp = null; redraw(); }, (v) => divTone(v))) : null;
    const tabs = seg(TABS, S.tab, (v) => { S.tab = v; redraw(); });
    body.replaceChildren(tabs, el('div', { class: 'card pick' }, divSeg || el('p', { class: 'hint top0' }, `${divName(S.div)} 업로드`)), el('p', { class: 'empty' }, '불러오는 중…'));
    let pane;
    try { pane = await { plan: planPane, erp: erpPane, team: teamPane, quarter: quarterPane, log: logPane }[S.tab](redraw); }
    catch (e) { pane = el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요'); }
    body.replaceChildren(tabs, el('div', { class: 'card pick' }, divSeg || el('p', { class: 'hint top0' }, `${divName(S.div)} 업로드`)), pane);
  }

  const cnt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ');
  async function readFile(file) {
    if (!file) return null;
    if (!/\.xlsx$/i.test(file.name)) throw new Error('.xlsx 엑셀 파일만 올릴 수 있습니다 (다른 이름으로 저장 → Excel 통합 문서)');
    if (file.size > MAX_BYTES) throw new Error('파일이 너무 큽니다 (6MB 이하)');
    return X.read(await file.arrayBuffer());
  }
  function filePicker(label, onFile, note) {
    const inp = el('input', { type: 'file', accept: '.xlsx', class: 'filein', 'aria-label': label });
    const box = el('div', { class: 'err', role: 'alert', hidden: true });
    inp.addEventListener('change', async () => {
      box.hidden = true;
      try { await onFile(inp.files[0]); } catch (e) { box.textContent = e.message || '파일을 읽지 못했습니다'; box.hidden = false; }
    });
    return el('div', { class: 'f' }, el('label', { class: 'filebtn' }, label, inp), note ? el('p', { class: 'hint' }, note) : null, box);
  }

  /* ---- 휴무계획 ---- */
  async function planPane(redraw) {
    const info = (await q(sb.from('leave_uploads').select('uploaded_at,row_count,file_name').eq('division_id', S.div).eq('kind', '휴무계획').order('uploaded_at', { ascending: false }))).slice(0, 1)[0];
    const teamShift = await q(sb.from('team_shift').select('team,shift').eq('division_id', S.div));
    const yIn = el('input', { type: 'text', inputmode: 'numeric', maxlength: '4', value: String(S.year), 'aria-label': '연도' });
    const chosen = { replace: false };
    const prev = el('div', {});
    const drawPrev = () => {
      const p = S.plan;
      if (!p) return prev.replaceChildren();
      const ids = Object.keys(p.divs);
      const miss = [...p.teams].filter((t) => !teamShift.some((x) => x.team === t) && !p.extra.shift);
      const go = el('button', { class: 'btn', type: 'button' }, chosen.replace ? '기존 내용을 지우고 교체 저장' : '업로드 저장');
      go.addEventListener('click', busy(go, async () => {
        const year = Number(yIn.value);
        if (!(year >= 2024 && year <= 2100)) return toast('연도를 확인하세요', 'err');
        let total = 0;
        for (const id of ids) {
          const { data, error } = await sb.rpc('save_leave_plan', { p_division: Number(id), p_year: year, p_rows: p.divs[id], p_file: p.fileName, p_replace: chosen.replace });
          if (error) return toast('저장하지 못했습니다. 권한과 파일 내용을 확인하세요', 'err');
          total += data || 0;
        }
        S.year = year; S.found = [...new Set([...S.found, ...p.teams])];
        toast(`${total}명의 휴무계획을 저장했습니다`); S.plan = null; redraw();
      }));
      prev.replaceChildren(el('div', { class: 'info' }, el('b', {}, `${p.fileName}`),
        `${p.rows.length}명 · 근무팀 ${p.teams.size}개` + (ids.length > 1 ? ` · 사업부 ${ids.length}곳` : '')),
        ...ids.length > 1 || p.extra.div ? [el('div', { class: 'rows' }, ids.map((id) => el('div', {}, el('span', {}, divName(Number(id))), el('b', {}, `${p.divs[id].length}명`))))] : [],
        ...p.warn.map((w) => el('p', { class: 'hint warn' }, w)),
        miss.length ? el('p', { class: 'hint warn' }, `팀 구성에 없는 팀: ${miss.join(', ')} → "팀 구성" 탭에서 근무조를 지정하세요`) : null,
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '저장 방식'),
          seg([['merge', '채운 값만 반영'], ['replace', '전체 교체']], chosen.replace ? 'replace' : 'merge', (v) => { chosen.replace = v === 'replace'; drawPrev(); })),
        el('p', { class: 'hint' }, chosen.replace ? '이 사업부·연도의 기존 휴무계획을 모두 지우고 이 파일 내용만 저장합니다.' : '파일에 값이 있는 칸만 바꾸고, 빈 칸은 기존 값을 그대로 둡니다.'), go);
    };
    drawPrev();
    return el('div', {}, el('div', { class: 'card' }, el('h2', {}, '휴무계획 업로드'),
      el('p', { class: 'hint' }, '사번·성명·근무팀과 분기별 주휴일(예: 월화)이 있는 엑셀입니다. 사업부·근무구분(오전/오후/야간/일근) 열이 있으면 함께 읽습니다.'),
      info ? el('p', { class: 'hint' }, `마지막 업로드: ${info.file_name || '-'} · ${info.row_count}명 · ${new Date(info.uploaded_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`) : el('p', { class: 'hint' }, '아직 업로드한 휴무계획이 없습니다'),
      el('label', { class: 'f' }, el('span', {}, '연도'), yIn),
      filePicker('엑셀 파일 선택 (.xlsx)', async (f) => {
        const rows = await readFile(f); if (!rows) return;
        S.plan = parsePlan(rows, S.div); S.plan.fileName = f.name;
        if (S.plan.year) yIn.value = String(S.plan.year);
        if (S.plan.teams.size) S.found = [...new Set([...S.found, ...S.plan.teams])];
        drawPrev();
      }), prev));
  }

  /* ---- ERP 근태 ---- */
  async function erpPane(redraw) {
    const info = (await q(sb.from('leave_uploads').select('uploaded_at,row_count,file_name').eq('division_id', S.div).eq('kind', 'ERP근태').order('uploaded_at', { ascending: false }))).slice(0, 1)[0];
    const prev = el('div', {});
    const drawPrev = () => {
      const p = S.erp; if (!p) return prev.replaceChildren();
      const ids = Object.keys(p.divs);
      const go = el('button', { class: 'btn', type: 'button' }, '업로드 저장');
      go.addEventListener('click', busy(go, async () => {
        let total = 0;
        for (const id of ids) {
          const { data, error } = await sb.rpc('save_leave_erp', { p_division: Number(id), p_rows: p.divs[id], p_file: p.fileName });
          if (error) return toast('저장하지 못했습니다. 권한과 파일 내용을 확인하세요', 'err');
          total += data || 0;
        }
        toast(`${total}건의 근태를 저장했습니다`); S.erp = null; redraw();
      }));
      prev.replaceChildren(el('div', { class: 'info' }, el('b', {}, p.fileName), `${p.rows.length}줄`),
        el('div', { class: 'rows' }, el('div', {}, el('span', {}, '근태 종류'), el('b', {}, cnt(p.codes))), el('div', {}, el('span', {}, '승인 상태'), el('b', {}, cnt(p.status))),
          ...(ids.length > 1 ? ids.map((id) => el('div', {}, el('span', {}, divName(Number(id))), el('b', {}, `${p.divs[id].length}줄`))) : [])),
        ...p.warn.map((w) => el('p', { class: 'hint warn' }, w)),
        el('p', { class: 'hint' }, '"승인"만 연차·휴가 인원에 반영하고, "신청"은 승인 대기로 따로 표시합니다. 반려·승인취소는 반영하지 않습니다. 같은 건을 다시 올리면 최신 상태로 바뀝니다.'), go);
    };
    drawPrev();
    return el('div', {}, el('div', { class: 'card' }, el('h2', {}, 'ERP 근태 업로드'),
      el('p', { class: 'hint' }, 'ERP에서 내려받은 근태 신청 엑셀입니다 (연차·반차·보건휴가·건강검진 등). 근무조(T1환경_오전 등)로 근무조를 구분합니다.'),
      info ? el('p', { class: 'hint' }, `마지막 업로드: ${info.file_name || '-'} · ${info.row_count}건 · ${new Date(info.uploaded_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`) : el('p', { class: 'hint' }, '아직 업로드한 근태가 없습니다'),
      filePicker('엑셀 파일 선택 (.xlsx)', async (f) => {
        const rows = await readFile(f); if (!rows) return;
        S.erp = parseErp(rows, S.div); S.erp.fileName = f.name; drawPrev();
      }), prev));
  }

  /* ---- 팀 구성: 휴무계획의 근무팀 → 근무조 ---- */
  async function teamPane(redraw) {
    const saved = await q(sb.from('team_shift').select('team,shift,start_time,end_time,duty').eq('division_id', S.div));
    let planTeams = [];
    try { planTeams = (await q(sb.from('leave_plan').select('team').eq('division_id', S.div).limit(5000))).map((x) => x.team).filter(Boolean); } catch (e) { /* 저장된 휴무계획이 없으면 무시 */ }
    const names = [...new Set([...saved.map((x) => x.team), ...planTeams, ...S.found])].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    const cur = Object.fromEntries(names.map((n) => [n, (saved.find((x) => x.team === n) || {}).shift || '']));
    const hm = (t) => (t ? String(t).slice(0, 5) : '');
    const tm = Object.fromEntries(names.map((n) => { const r = saved.find((x) => x.team === n) || {}; return [n, { s: hm(r.start_time), e: hm(r.end_time), d: r.duty || '' }]; }));
    const list = el('div', {});
    const drawList = () => list.replaceChildren(...(names.length ? names.map((n) => {
      const si = el('input', { type: 'time', 'aria-label': `${n} 출근시간`, value: tm[n].s }); si.addEventListener('input', () => { tm[n].s = si.value; });
      const ei = el('input', { type: 'time', 'aria-label': `${n} 퇴근시간`, value: tm[n].e }); ei.addEventListener('input', () => { tm[n].e = ei.value; });
      const di = el('input', { type: 'text', maxlength: '60', 'aria-label': `${n} 담당`, placeholder: '담당 (예: 탑승동 오전)', value: tm[n].d }); di.addEventListener('input', () => { tm[n].d = di.value; });
      return el('div', { class: 'teamrow' }, el('b', {}, n),
        seg([['', '미지정'], ...shiftList().map((s) => [s, s])], cur[n], (v) => { cur[n] = v; }),
        el('div', { class: 'tmtime' }, el('label', {}, el('span', {}, '출근'), si), el('label', {}, el('span', {}, '퇴근'), ei)), el('div', { class: 'tmduty' }, di));
    }) : [el('p', { class: 'empty' }, '휴무계획을 올리면 근무팀이 여기에 나타납니다. 아래에서 직접 추가할 수도 있습니다')]));
    drawList();
    const nIn = el('input', { type: 'text', maxlength: '20', placeholder: '예: 1팀', 'aria-label': '팀 이름' });
    const add = el('button', { class: 'btn ghost sm', type: 'button' }, '팀 추가');
    add.addEventListener('click', () => { const n = nIn.value.trim(); if (!n) return; if (!names.includes(n)) { names.push(n); cur[n] = ''; tm[n] = { s: '', e: '', d: '' }; } nIn.value = ''; drawList(); });
    const save = el('button', { class: 'btn', type: 'button' }, '팀 구성 저장');
    save.addEventListener('click', busy(save, async () => {
      const up = names.filter((n) => cur[n]).map((n) => ({ division_id: S.div, team: n, shift: cur[n], start_time: tm[n].s || null, end_time: tm[n].e || null, duty: tm[n].d.trim() || null }));
      const del = names.filter((n) => !cur[n] && saved.some((x) => x.team === n));
      if (up.length) { const { error } = await sb.from('team_shift').upsert(up, { onConflict: 'division_id,team' }); if (error) return toast('저장하지 못했습니다. 16 SQL 실행 여부와 권한을 확인하세요', 'err'); }
      for (const n of del) { const { error } = await sb.from('team_shift').delete().eq('division_id', S.div).eq('team', n); if (error) return toast('저장하지 못했습니다', 'err'); }
      toast('팀 구성을 저장했습니다'); redraw();
    }));
    return el('div', { class: 'card' }, el('h2', {}, '팀 구성'),
      el('p', { class: 'hint' }, '휴무계획의 근무팀(1팀, 2팀…)이 어느 근무조인지 정하고, 팀별 출근·퇴근 시간을 직접 수정합니다. 시간을 비워 두면 근무조 기본 시간이 쓰입니다. 휴무계획 파일에 근무구분 열이 있으면 그 값이 먼저 쓰입니다.'),
      list, el('div', { class: 'addrow' }, nIn, add), save);
  }

  /* ---- 분기 적용일 ---- */
  async function quarterPane(redraw) {
    const rows = await q(sb.from('leave_quarter').select('year,quarter,apply_from').eq('division_id', S.div).eq('year', S.year));
    const ins = [1, 2, 3, 4].map((n) => {
      const r = rows.find((x) => x.quarter === n);
      return el('input', { type: 'date', value: r ? r.apply_from : '', 'aria-label': `${n}분기 적용 시작일` });
    });
    const save = el('button', { class: 'btn', type: 'button' }, '적용일 저장');
    save.addEventListener('click', busy(save, async () => {
      for (let n = 1; n <= 4; n++) {
        const v = ins[n - 1].value; const had = rows.some((x) => x.quarter === n);
        if (v) { const { error } = await sb.from('leave_quarter').upsert({ division_id: S.div, year: S.year, quarter: n, apply_from: v }, { onConflict: 'division_id,year,quarter' }); if (error) return toast('저장하지 못했습니다. 권한을 확인하세요', 'err'); }
        else if (had) { const { error } = await sb.from('leave_quarter').delete().eq('division_id', S.div).eq('year', S.year).eq('quarter', n); if (error) return toast('저장하지 못했습니다', 'err'); }
      }
      toast('분기 적용일을 저장했습니다'); redraw();
    }));
    const yr = seg([[String(S.year - 1), String(S.year - 1)], [String(S.year), String(S.year)], [String(S.year + 1), String(S.year + 1)]], String(S.year), (v) => { S.year = Number(v); redraw(); });
    return el('div', { class: 'card' }, el('h2', {}, '분기 휴무 적용일'),
      el('p', { class: 'hint' }, '분기가 바뀔 때 새 분기 휴무를 적용하기 시작하는 날짜입니다. 비워 두면 분기 첫날(1/1, 4/1, 7/1, 10/1)부터 적용합니다. 예: 4분기를 10월 5일로 정하면 10월 4일까지는 3분기 휴무가 적용됩니다.'),
      el('div', { class: 'f' }, el('span', { class: 'hint' }, '연도'), yr),
      ...ins.map((i, n) => el('label', { class: 'f' }, el('span', {}, `${n + 1}분기 시작일`), i)), save);
  }

  /* ---- 업로드 기록 ---- */
  async function logPane() {
    const rows = (await q(sb.from('leave_uploads').select('kind,file_name,row_count,uploaded_at').eq('division_id', S.div).order('uploaded_at', { ascending: false }))).slice(0, 30);
    return el('div', { class: 'card' }, el('h2', {}, '업로드 기록'),
      rows.length ? el('div', { class: 'tblwrap' }, el('table', { class: 'tbl left' }, el('thead', {}, el('tr', {}, ...['구분', '파일', '건수', '시각'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, el('th', {}, r.kind), el('td', {}, r.file_name || '-'), el('td', {}, r.row_count),
          el('td', {}, new Date(r.uploaded_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))))))) : el('p', { class: 'empty' }, '업로드 기록이 없습니다'));
  }

  window.APP.leaveParse = { parsePlan, parseErp };
  register('leave', '휴무 업로드', ['chief', 'admin', 'master'], leaveView, '휴무계획·ERP 근태 엑셀을 올려 휴무·연차 자동 집계');
})();
