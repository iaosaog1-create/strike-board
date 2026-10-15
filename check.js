/* 출근 체크 · 구역 배치 (팀장: 내 팀 / 총괄팀장: 내 사업부 / 관리: 전체)
   휴무계획의 팀 명단을 가져와 팀장이 이름으로 출근을 체크하고 구역을 지정합니다.
   ERP 근태(연차·병가·휴직·보건·검진·기타)와 주휴일은 자동 표시, 체크하지 않은 사람은 완료 시 결근으로 확정됩니다. */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, bizDivs, divName, shortDiv } = window.APP;
  const O = window.APP.ops;
  const X = window.XLSX_LITE;
  const BLOCK = ['off', 'hold', 'annual', 'health', 'sick', 'other'];
  const KL = { off: '주휴', hold: '휴직', annual: '연차', health: '보건·검진', sick: '병가', other: '기타', half: '반차' };
  const S = { date: null, tab: null, division: null, team: null, mark: null, key: '', zone: '', gedit: {} };
  const q = async (p) => { const r = await p; if (r.error) throw r.error; return r.data || []; };
  const tnum = (t) => String(t || '').replace(/\D/g, '') || String(t || '').trim();
  const sortTeam = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
  const reason = (r) => (r.leave_kind === 'other' || r.leave_kind === 'half' ? r.leave_code || KL[r.leave_kind] : KL[r.leave_kind] || r.leave_code || '');
  const isLeave = (r) => BLOCK.includes(r.leave_kind);
  const gcls = (g) => (g === '남' ? 'gm' : g === '여' ? 'gf' : 'gx');
  const gline = (k) => `남 ${k.men}명 · 여 ${k.women}명` + (k.unk ? ` · 성별 미지정 ${k.unk}명` : '');
  const errText = (e) => (e && e.message && /[가-힣]/.test(e.message) ? e.message : '저장하지 못했습니다. 잠시 후 다시 시도하세요');

  /* 한 팀의 집계: live=true 이면 화면에서 고른 mark 를 기준으로 */
  function tally(rows, mark) {
    const t = { total: rows.length, leave: 0, present: 0, rest: 0, men: 0, women: 0, unk: 0, closed: rows.length > 0 && rows[0].closed };
    for (const r of rows) {
      if (isLeave(r)) t.leave += 1;
      else if (mark ? mark.has(r.emp_no) : r.checked) { t.present += 1; if (r.gender === '남') t.men += 1; else if (r.gender === '여') t.women += 1; else t.unk += 1; }
      else t.rest += 1;
    }
    return t;
  }
  const tile = (label, val, cls) => el('div', { class: 'ck-tile ' + (cls || '') }, el('b', {}, String(val)), el('span', {}, label));

  async function checkView(body) {
    await O.ensureShifts();
    const me = state.me;
    if (!S.date) S.date = O.today();
    if (me.role === 'leader') { S.division = me.division_id; S.team = me.plan_team; if (!S.tab || S.tab === 'progress') S.tab = 'check'; }
    else {
      if (me.role === 'chief') S.division = me.division_id;
      else if (!S.division) S.division = (bizDivs()[0] || {}).id;
      if (!S.tab) S.tab = 'progress';
    }
    const redraw = () => checkView(body);
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    let all, zones;
    try {
      [all, zones] = await Promise.all([
        q(sb.rpc('team_roster', { p_date: S.date, p_team: null })),
        q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active'))]);
    } catch (e) { body.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 08·09 SQL 실행 여부를 확인하세요')); return; }

    if (me.role === 'leader' && !me.plan_team) {
      body.replaceChildren(el('div', { class: 'card' }, el('h2', {}, '소속 팀이 지정되지 않았습니다'), el('p', { class: 'hint' }, '관리자에게 소속 팀(1팀~10팀) 지정을 요청하세요.')));
      return;
    }
    const zmap = new Map(zones.map((z) => [z.id, z]));
    const zoneLabel = (id) => { const z = zmap.get(id); return z ? `${z.floor} ${O.zoneName(z)}` : '구역 미배치'; };
    const divRows = all.filter((r) => r.division_id === S.division);
    const teams = [...new Set(divRows.map((r) => r.team || '미지정'))].sort(sortTeam);
    if (me.role !== 'leader' && (!S.team || !teams.some((t) => tnum(t) === tnum(S.team)))) S.team = teams[0] || null;
    const teamRows = divRows.filter((r) => tnum(r.team) === tnum(S.team));
    const key = [S.date, S.division, tnum(S.team), teamRows.length].join('|');
    if (S.key !== key || !S.mark) { S.key = key; S.mark = new Map(teamRows.filter((r) => r.checked).map((r) => [r.emp_no, r.zone_id || 0])); S.zone = ''; }

    /* ---- 상단: 날짜 · 사업부 · 팀 ---- */
    const dIn = el('input', { type: 'date', value: S.date, 'aria-label': '날짜' });
    dIn.addEventListener('change', () => { if (dIn.value) { S.date = dIn.value; redraw(); } });
    const step = (n) => () => { S.date = O.addDays(S.date, n); redraw(); };
    const top = el('div', { class: 'card' },
      el('div', { class: 'datebar' }, el('button', { type: 'button', class: 'btn ghost sm', onclick: step(-1) }, '‹'), dIn,
        el('button', { type: 'button', class: 'btn ghost sm', onclick: step(1) }, '›'),
        el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { S.date = O.today(); redraw(); } }, '오늘')),
      me.role === 'master' || me.role === 'admin'
        ? el('div', { class: 'f' }, el('span', { class: 'hint' }, '사업부'), seg(bizDivs().map((d) => [String(d.id), shortDiv(d.name)]), String(S.division), (v) => { S.division = Number(v); S.team = null; S.mark = null; redraw(); }, (v) => window.APP.divTone(Number(v)))) : null,
      me.role !== 'leader' && teams.length && S.tab !== 'progress'
        ? el('div', { class: 'f' }, el('span', { class: 'hint' }, '팀'), seg(teams.map((t) => [t, t]), teams.find((t) => tnum(t) === tnum(S.team)), (v) => { S.team = v; S.mark = null; redraw(); })) : null);

    const tabs = seg(me.role === 'leader' ? [['check', '출근 체크'], ['status', '내 팀 현황'], ['gender', '성별 설정']] : [['progress', '진행 현황'], ['check', '팀 체크'], ['status', '팀 현황'], ['gender', '성별 설정']], S.tab, (v) => { S.tab = v; redraw(); });

    if (!all.length) {
      body.replaceChildren(tabs, top, el('div', { class: 'card' }, el('p', { class: 'empty' }, '휴무계획이 없습니다. 휴무 업로드에서 휴무계획 엑셀을 먼저 올려 주세요.')));
      return;
    }

    /* ---- 진행 현황 (총괄·관리) ---- */
    if (S.tab === 'progress') {
      const trs = teams.map((t) => {
        const rs = divRows.filter((r) => (r.team || '미지정') === t); const k = tally(rs);
        const stat = k.closed ? ['완료', 'ok'] : k.present ? ['진행 중', 'mid'] : ['시작 전', 'none'];
        const tr = el('tr', { class: 'click', onclick: () => { S.team = t; S.tab = 'check'; S.mark = null; redraw(); } },
          el('th', {}, t), el('td', {}, (rs[0] || {}).shift || '-'), el('td', {}, k.total), el('td', {}, k.leave), el('td', { class: 'b' }, k.present),
          el('td', { class: k.closed ? 'pc low' : '' }, k.closed ? k.rest : `(${k.rest})`), el('td', { class: 'pc ' + stat[1] }, stat[0]));
        return tr;
      });
      const sum = teams.reduce((a, t) => { const k = tally(divRows.filter((r) => (r.team || '미지정') === t)); return { total: a.total + k.total, leave: a.leave + k.leave, present: a.present + k.present, rest: a.rest + k.rest, done: a.done + (k.closed ? 1 : 0) }; }, { total: 0, leave: 0, present: 0, rest: 0, done: 0 });
      const xl = el('button', { class: 'btn sm', type: 'button' }, '출근·결근 명단 엑셀');
      xl.addEventListener('click', () => { X.download(`출근결근명단_${S.date}.xlsx`, rosterExcel(all, zmap), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
      body.replaceChildren(tabs, top,
        el('div', { class: 'ck-tiles' }, tile('정원', sum.total), tile('근태', sum.leave), tile('출근 체크', sum.present, 'ok'), tile('팀 완료', `${sum.done}/${teams.length}`)),
        el('div', { class: 'card' }, el('h2', {}, `${O.dateLabel(S.date)} 팀별 진행 현황`),
          el('div', { class: 'tblwrap' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, ...['팀', '근무조', '정원', '근태', '출근', '결근', '상태'].map((h) => el('th', {}, h)))), el('tbody', {}, trs))),
          el('p', { class: 'hint' }, '결근은 팀장이 "출근 체크 완료"를 누른 팀만 확정되며, 괄호 숫자는 아직 체크되지 않은 인원입니다. 줄을 누르면 해당 팀 체크 화면으로 이동합니다.'),
          el('div', { class: 'btnrow' }, xl)));
      return;
    }

    if (!teamRows.length) { body.replaceChildren(tabs, top, el('div', { class: 'card' }, el('p', { class: 'empty' }, '이 팀의 명단이 없습니다.'))); return; }

    /* ---- 팀 현황 (읽기) ---- */
    if (S.tab === 'status') {
      const k = tally(teamRows);
      const chips = (list, cls) => el('div', { class: 'ck-names' }, list.map((r) => el('span', { class: 'ck-chip ' + cls + ' ' + gcls(r.gender) }, r.name, r.sub ? el('small', {}, r.sub) : null)));
      const present = teamRows.filter((r) => r.checked);
      const byZone = new Map();
      for (const r of present) { const kz = r.zone_id || 0; if (!byZone.has(kz)) byZone.set(kz, []); byZone.get(kz).push(r); }
      const zoneBlocks = [...byZone.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1)).map(([zid, list]) =>
        el('div', { class: 'f' }, el('span', { class: 'hint' }, `${zid ? zoneLabel(zid) : '구역 미배치'} · ${list.length}명 (남 ${list.filter((r) => r.gender === '남').length} · 여 ${list.filter((r) => r.gender === '여').length})`), chips(list, 'on')));
      const rest = teamRows.filter((r) => !isLeave(r) && !r.checked);
      const leaves = teamRows.filter(isLeave).map((r) => ({ ...r, sub: reason(r) }));
      body.replaceChildren(tabs, top,
        el('div', { class: 'ck-tiles' }, tile('정원', k.total), tile('근태', k.leave), tile('출근', k.present, 'ok'), tile(k.closed ? '결근' : '미확인', k.rest, k.closed ? 'low' : 'mid')),
        el('p', { class: 'ck-gline' }, `출근  ${gline(k)}`),
        el('div', { class: 'card' }, el('h2', {}, `${S.team} 출근 ${k.present}명`), el('p', { class: 'hint' }, gline(k)), zoneBlocks.length ? zoneBlocks : el('p', { class: 'hint' }, '아직 체크한 사람이 없습니다')),
        el('div', { class: 'card' }, el('h2', {}, k.closed ? `결근 ${k.rest}명` : `미확인 ${k.rest}명`),
          k.closed ? null : el('p', { class: 'hint' }, '"출근 체크 완료"를 누르면 아래 인원이 결근으로 확정됩니다.'),
          rest.length ? chips(rest, k.closed ? 'abs' : 'wait') : el('p', { class: 'hint' }, '없음')),
        el('div', { class: 'card' }, el('h2', {}, `근태 ${leaves.length}명`), leaves.length ? chips(leaves, 'lv') : el('p', { class: 'hint' }, '없음')));
      return;
    }

    /* ---- 성별 설정 (TOPS 방식: 카드를 누르면 남 → 여 → 미정) ---- */
    if (S.tab === 'gender') {
      const curG = (r) => (S.gedit[r.emp_no] !== undefined ? S.gedit[r.emp_no] : r.gender || '');
      const drawG = () => {
        const cards = teamRows.map((r) => el('button', { type: 'button', class: 'pp ' + gcls(curG(r)), onclick: () => { const g = curG(r); S.gedit[r.emp_no] = g === '' ? '남' : g === '남' ? '여' : ''; drawG(); } },
          el('b', {}, r.name), el('small', {}, curG(r) || '미정')));
        const m = teamRows.filter((r) => curG(r) === '남').length, w = teamRows.filter((r) => curG(r) === '여').length, u = teamRows.length - m - w;
        const changed = Object.keys(S.gedit).filter((e) => (S.gedit[e] || '') !== ((teamRows.find((r) => r.emp_no === e) || {}).gender || ''));
        const save = el('button', { class: 'btn', type: 'button' }, `성별 저장${changed.length ? ` (${changed.length}건)` : ''}`);
        save.addEventListener('click', busy(save, async () => {
          if (!changed.length) return toast('바뀐 내용이 없습니다');
          const { error } = await sb.rpc('save_gender', { p_date: S.date, p_rows: changed.map((e) => ({ emp_no: e, gender: S.gedit[e] || '' })) });
          if (error) return toast(errText(error), 'err');
          toast('성별을 저장했습니다'); S.gedit = {}; redraw();
        }));
        body.replaceChildren(tabs, top,
          el('div', { class: 'card' }, el('h2', {}, `${S.team} 직원 성별 설정`),
            el('p', { class: 'hint' }, '카드를 누를 때마다 남 → 여 → 미정 순서로 바뀝니다. 한 번 저장하면 계속 유지됩니다.'),
            el('p', { class: 'hint' }, `남 ${m}명 · 여 ${w}명` + (u ? ` · 미정 ${u}명` : '')),
            el('div', { class: 'ppgrid' }, cards)),
          el('div', { class: 'actions' }, save));
      };
      drawG(); return;
    }

    /* ---- 팀 체크 (입력) ---- */
    const draw = () => {
      const k = tally(teamRows, S.mark);
      const zs = zones.filter((z) => z.division_id === S.division && z.active).sort(O.zoneSort);
      const zSel = el('select', { 'aria-label': '배치할 구역' }, el('option', { value: '' }, '구역 선택 안 함 (출근만 체크)'),
        ...zs.map((z) => el('option', { value: z.id }, `${z.side} ${z.floor} · ${O.zoneName(z)}`)));
      zSel.value = S.zone;
      zSel.addEventListener('change', () => { S.zone = zSel.value; });
      const tap = (r) => () => {
        const cur = S.mark.get(r.emp_no); const z = S.zone ? Number(S.zone) : 0;
        if (cur === undefined) S.mark.set(r.emp_no, z);
        else if (cur !== z) { S.mark.set(r.emp_no, z); toast(`${r.name}님 구역을 바꿨습니다`); }
        else S.mark.delete(r.emp_no);
        draw();
      };
      const people = teamRows.map((r) => {
        const leave = isLeave(r); const on = S.mark.has(r.emp_no);
        const sub = leave ? reason(r) : on ? `✔ ${S.mark.get(r.emp_no) ? zoneLabel(S.mark.get(r.emp_no)) : '출근'}` : (r.leave_kind === 'half' ? '반차' : '');
        return el('button', { type: 'button', class: 'pp ' + gcls(r.gender) + (leave ? ' leave' : on ? ' on' : '') + (r.leave_kind === 'half' ? ' half' : ''), disabled: leave, 'aria-pressed': String(on), onclick: tap(r) },
          el('b', {}, r.name), el('small', {}, sub));
      });
      const noZone = [...S.mark.values()].filter((v) => !v).length;
      const doSave = (close) => async () => {
        if (close && !window.confirm(`체크하지 않은 ${k.rest}명이 결근으로 확정됩니다. 완료할까요?`)) return;
        const rows = [...S.mark.entries()].map(([emp, zid]) => ({ emp_no: emp, zone_id: zid || null }));
        const { error } = await sb.rpc('save_team_check', { p_date: S.date, p_division: S.division, p_team: S.team, p_rows: rows, p_close: close });
        if (error) return toast(errText(error), 'err');
        toast(close ? `${S.team} 출근 체크를 완료했습니다` : '임시 저장했습니다');
        S.key = ''; S.mark = null; redraw();
      };
      const save = el('button', { class: 'btn ghost', type: 'button' }, '임시 저장'); save.addEventListener('click', busy(save, doSave(false)));
      const done = el('button', { class: 'btn', type: 'button' }, k.closed ? '수정 후 다시 완료' : '출근 체크 완료'); done.addEventListener('click', busy(done, doSave(true)));
      body.replaceChildren(tabs, top,
        el('div', { class: 'ck-tiles' }, tile('정원', k.total), tile('근태', k.leave), tile('출근 체크', k.present, 'ok'), tile('남은 인원', k.rest, k.rest ? 'mid' : 'ok')),
        el('p', { class: 'ck-gline' }, `출근 체크  ${gline(k)}`),
        teamRows.some((r) => !r.gender) ? el('div', { class: 'err' }, `성별이 지정되지 않은 직원 ${teamRows.filter((r) => !r.gender).length}명 — 남·여 인원이 정확하지 않습니다. 위의 "성별 설정" 탭에서 지정하세요.`) : null,
        k.closed ? el('div', { class: 'info' }, el('b', {}, '완료된 팀입니다'), '고친 뒤 "다시 완료"를 누르면 결근이 다시 계산됩니다.') : null,
        el('div', { class: 'card' }, el('h2', {}, `${S.team} 출근 체크`),
          el('label', { class: 'f' }, el('span', {}, '① 배치할 구역'), zSel),
          el('div', { class: 'f' }, el('span', { class: 'hint' }, '② 출근한 사람 이름을 누르세요 (다시 누르면 취소, 다른 구역을 고르고 누르면 구역 변경)'), el('div', { class: 'ppgrid' }, people)),
          noZone ? el('p', { class: 'hint' }, `구역을 지정하지 않은 사람 ${noZone}명`) : null,
          el('p', { class: 'hint' }, '"출근 체크 완료"를 누르면 체크하지 않은 사람이 결근으로 확정됩니다.')),
        el('div', { class: 'actions' }, save, done));
    };
    draw();
  }

  /* 엑셀: 출근자 · 결근자 · 근태자 · 팀별 요약 */
  function rosterExcel(all, zmap) {
    const H = (v) => ({ v, s: 'hdr' });
    const dn = (id) => shortDiv(divName(id));
    const zl = (id) => { const z = zmap.get(id); return z ? `${z.side} ${z.floor} ${O.zoneName(z)}` : '구역 미배치'; };
    const sorted = [...all].sort((a, b) => a.division_id - b.division_id || sortTeam(a.team, b.team) || a.name.localeCompare(b.name, 'ko'));
    const present = sorted.filter((r) => r.checked);
    const absent = sorted.filter((r) => !r.checked && !isLeave(r));
    const leave = sorted.filter(isLeave);
    const base = (r) => [dn(r.division_id), r.team || '미지정', r.shift || '-', r.emp_no, r.name, r.gender || '미정'];
    const s1 = { name: '출근자', widths: [14, 8, 8, 12, 12, 8, 30], rows: [['사업부', '팀', '근무조', '사번', '이름', '성별', '배치 구역'].map(H), ...present.map((r) => [...base(r), zl(r.zone_id)])] };
    const s2 = { name: '결근자', widths: [14, 8, 8, 12, 12, 8, 16], rows: [['사업부', '팀', '근무조', '사번', '이름', '성별', '구분'].map(H), ...absent.map((r) => [...base(r), r.closed ? '결근 확정' : '체크 전(미확인)'])] };
    const s3 = { name: '근태자', widths: [14, 8, 8, 12, 12, 8, 14], rows: [['사업부', '팀', '근무조', '사번', '이름', '성별', '사유'].map(H), ...leave.map((r) => [...base(r), reason(r)])] };
    const keys = [...new Set(sorted.map((r) => `${r.division_id}|${r.team || '미지정'}`))];
    const sumRows = keys.map((kk) => {
      const [d, t] = kk.split('|'); const rs = sorted.filter((r) => String(r.division_id) === d && (r.team || '미지정') === t); const k = tally(rs);
      return [dn(Number(d)), t, rs[0].shift || '-', k.total, k.leave, k.present, k.men, k.women, k.unk, k.closed ? k.rest : `${k.rest} (미확인)`, k.closed ? '완료' : k.present ? '진행 중' : '시작 전'];
    });
    const s4 = { name: '팀별 요약', widths: [14, 8, 8, 8, 8, 8, 8, 8, 10, 14, 10], rows: [['사업부', '팀', '근무조', '정원', '근태', '출근', '출근 남', '출근 여', '출근 성별미정', '결근', '상태'].map(H), ...sumRows] };
    return X.write([s1, s2, s3, s4]);
  }

  window.APP.check = { rosterExcel, tally, isLeave, reason };
  register('check', '출근 체크', ['leader', 'chief', 'admin', 'master'], checkView, '팀 직원 이름으로 출근 체크·구역 배치');
})();
