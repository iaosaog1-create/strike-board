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
  /* team_roster 는 한 번에 1000행까지만 오므로 끝까지 이어 받음 */
  const rosterPaged = async (date, soft) => {
    const out = []; const N = 1000;
    for (let from = 0; from < 20000; from += N) {
      const r = await sb.rpc('team_roster', { p_date: date, p_team: null }).range(from, from + N - 1);
      if (r.error) { if (soft) return []; throw r.error; }
      const d = r.data || []; out.push(...d); if (d.length < N) break;
    }
    return out;
  };
  /* 조합 색 표시: 열람 권한자만 (권한 없으면 null → 표시 안 함). 5분 캐시 */
  let UK = null, UK_AT = 0;
  const loadUk = async () => {
    if (UK_AT && Date.now() - UK_AT < 300000) return UK;
    try {
      const m = new Map();
      for (let from = 0; from < 20000; from += 1000) {
        const r = await sb.rpc('union_kinds').range(from, from + 999);
        if (r.error) { UK = null; UK_AT = Date.now(); return null; }
        for (const x of r.data || []) m.set(String(x.emp_no), x.kind);
        if ((r.data || []).length < 1000) break;
      }
      UK = m;
    } catch (e) { UK = null; }
    UK_AT = Date.now(); return UK;
  };
  const ukCls = (emp) => (UK ? (UK.get(String(emp)) === '민노' ? 'uk-m' : UK.get(String(emp)) === '한마음' ? 'uk-h' : 'uk-n') : '');
  const ukb = (emp) => (UK ? ' ukb-' + (UK.get(String(emp)) === '민노' ? 'm' : UK.get(String(emp)) === '한마음' ? 'h' : 'n') : '');
  const ukDot = (emp) => (UK ? el('i', { class: 'ukd ' + ukCls(emp), 'aria-hidden': 'true' }) : null);
  const ukLegend = () => (UK ? el('p', { class: 'uklg' }, el('i', { class: 'ukd uk-m' }), '민노 ', el('i', { class: 'ukd uk-h' }), '한마음 ', el('i', { class: 'ukd uk-n' }), '비노조') : null);
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
      [all, zones, S.ts, S.sup] = await Promise.all([
        rosterPaged(S.date),
        q(sb.from('zones').select('id,division_id,side,floor,area,team,label,task,required,active')),
        sb.from('team_shift').select('division_id,team,start_time,end_time,duty').then((r) => (r.error ? [] : r.data || []), () => []),
        sb.rpc('list_team_support', { p_date: S.date }).then((r) => (r.error ? [] : r.data || []), () => [])]);
    } catch (e) { body.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 08·09 SQL 실행 여부를 확인하세요')); return; }

    await loadUk();
    if (me.role === 'leader' && !me.plan_team) {
      body.replaceChildren(el('div', { class: 'card' }, el('h2', {}, '소속 팀이 지정되지 않았습니다'), el('p', { class: 'hint' }, '관리자에게 소속 팀(1팀~10팀) 지정을 요청하세요.')));
      return;
    }
    const zmap = new Map(zones.map((z) => [z.id, z]));
    const zoneShort = (id) => { const z = zmap.get(id); return z ? String(O.zoneName(z)).split('·').pop().trim() : '구역'; };
    const zoneBrief = (id) => { const z = zmap.get(id); return z ? (z.area === '전체' ? z.floor : `${z.floor} ${z.area}`) : '구역'; };
    const zoneLabel = (id) => { const z = zmap.get(id); return z ? `${z.floor} ${O.zoneName(z)}` : '구역 미배치'; };
    /* 팀 담당구역: 팀장 화면에는 내 팀 구역 + 공통 구역(현장지원)만 */
    const hasTeamZones = zones.some((z) => z.division_id === S.division && z.active && z.team);
    const teamZones = (team) => zones.filter((z) => z.division_id === S.division && z.active && z.team && tnum(z.team) === tnum(team)).sort(O.zoneSort);
    const myZones = () => (hasTeamZones ? [...teamZones(S.team), ...zones.filter((z) => z.division_id === S.division && z.active && !z.team && z.task !== '관리자').sort(O.zoneSort)]
      : zones.filter((z) => z.division_id === S.division && z.active).sort(O.zoneSort));
    const supAll = (S.sup || []).filter((s) => s.division_id === S.division);
    const supOut = new Map(supAll.filter((s) => tnum(s.from_team) === tnum(S.team)).map((s) => [s.emp_no, s]));
    const supIn = supAll.filter((s) => tnum(s.to_team) === tnum(S.team));
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

    const tabs = seg(me.role === 'leader' ? [['check', '출근 체크'], ['support', '팀 지원'], ['status', '내 팀 현황'], ['gender', '성별 설정']] : [['progress', '진행 현황'], ['check', '팀 체크'], ['support', '팀 지원'], ['status', '팀 현황'], ['gender', '성별 설정']], S.tab, (v) => { S.tab = v; redraw(); });

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
          el('th', {}, t, (() => { const r = (S.ts || []).find((x) => x.division_id === S.division && tnum(x.team) === tnum(t)); return r && (r.start_time || r.end_time) ? el('small', { class: 'tmsm' }, `${r.start_time ? String(r.start_time).slice(0, 5) : '--:--'}~${r.end_time ? String(r.end_time).slice(0, 5) : '--:--'}${r.duty ? ' ' + r.duty : ''}`) : null; })()), el('td', {}, (rs[0] || {}).shift || '-'), el('td', {}, k.total), el('td', {}, k.leave), el('td', { class: 'b' }, k.present),
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

    /* ---- 팀 지원: 남는 팀 → 부족한 팀 (같은 사업부) ---- */
    function supCards() {
      const cards = [];
      if (supOut.size) cards.push(el('div', { class: 'card' }, el('h2', {}, `${S.team} → 다른 팀 지원 ${supOut.size}명`),
        el('div', { class: 'ck-names' }, [...supOut.values()].map((s) => el('span', { class: 'ck-chip on gx' }, s.name, el('small', {}, `${s.to_team} · ${zoneBrief(s.zone_id)}`))))));
      if (supIn.length) cards.push(el('div', { class: 'card' }, el('h2', {}, `${S.team} ← 다른 팀 지원 ${supIn.length}명`),
        el('div', { class: 'ck-names' }, supIn.map((s) => el('span', { class: 'ck-chip on gx' }, s.name, el('small', {}, `${s.from_team} · ${zoneBrief(s.zone_id)}`))))));
      return cards.length ? cards : null;
    }
    if (S.tab === 'support') {
      const toTeams = [...new Set(zones.filter((z) => z.division_id === S.division && z.active && z.team && tnum(z.team) !== tnum(S.team)).map((z) => z.team))].sort(sortTeam);
      const sk = key + '|sup';
      if (S.skey !== sk) { S.skey = sk; S.smap = new Map([...supOut.values()].map((s) => [s.emp_no, { to_team: s.to_team, zone_id: s.zone_id }])); S.sZone = ''; }
      if (!S.sTo || !toTeams.includes(S.sTo)) { S.sTo = toTeams[0] || ''; S.sZone = ''; }
      const drawSup = () => {
        const tz = S.sTo ? teamZones(S.sTo) : [];
        if (!tz.some((z) => String(z.id) === String(S.sZone))) S.sZone = tz[0] ? String(tz[0].id) : '';
        const zsel = el('select', { 'aria-label': '지원 갈 구역' }, ...tz.map((z) => el('option', { value: z.id }, `${z.side} ${z.floor} · ${O.zoneName(z)}`)));
        zsel.value = S.sZone; zsel.addEventListener('change', () => { S.sZone = zsel.value; });
        const tap = (r) => () => {
          const cur = S.smap.get(r.emp_no); const zid = Number(S.sZone);
          if (!S.sTo || !zid) return toast('받는 팀과 구역을 먼저 고르세요', 'err');
          if (cur && cur.to_team === S.sTo && cur.zone_id === zid) S.smap.delete(r.emp_no); else S.smap.set(r.emp_no, { to_team: S.sTo, zone_id: zid });
          drawSup();
        };
        const people = teamRows.map((r) => {
          const leave = isLeave(r); const a = S.smap.get(r.emp_no);
          return el('button', { type: 'button', class: 'pp ' + gcls(r.gender) + ukb(r.emp_no) + (leave ? ' leave' : a ? ' on sup' : ''), disabled: leave, 'aria-pressed': String(!!a), onclick: tap(r) },
            el('b', {}, r.name), el('small', {}, leave ? reason(r) : a ? `→ ${a.to_team} ${zoneBrief(a.zone_id)}` : r.checked ? '출근' : ''));
        });
        const save = el('button', { class: 'btn', type: 'button' }, `지원 저장 (${S.smap.size}명)`);
        save.addEventListener('click', busy(save, async () => {
          const out = [...S.smap.entries()].map(([emp_no, v]) => ({ emp_no, to_team: v.to_team, zone_id: v.zone_id }));
          const { error } = await sb.rpc('set_team_support', { p_date: S.date, p_division: S.division, p_from_team: S.team, p_rows: out });
          if (error) return toast(errText(error), 'err');
          // 이미 출근 체크된 사람은 받는 팀 구역으로 바로 옮기고, 해제된 사람은 구역을 비움
          const base = new Map(teamRows.filter((r) => r.checked).map((r) => [r.emp_no, r.zone_id || 0])); let changed = false;
          for (const [emp, v] of S.smap) if (base.has(emp) && base.get(emp) !== v.zone_id) { base.set(emp, v.zone_id); changed = true; }
          for (const [emp, zid] of base) if (!S.smap.has(emp) && zid) { const z = zmap.get(zid); if (z && z.team && tnum(z.team) !== tnum(S.team)) { base.set(emp, 0); changed = true; } }
          if (changed) {
            const rows2 = [...base.entries()].map(([emp_no, zid]) => ({ emp_no, zone_id: zid || null }));
            const r2 = await sb.rpc('save_team_check', { p_date: S.date, p_division: S.division, p_team: S.team, p_rows: rows2, p_close: teamRows.some((r) => r.closed) });
            if (r2.error) return toast(errText(r2.error), 'err');
          }
          toast(out.length ? `${out.length}명의 팀 지원을 저장했습니다` : '팀 지원을 모두 해제했습니다');
          S.key = ''; S.mark = null; S.skey = ''; redraw();
        }));
        body.replaceChildren(tabs, top,
          el('div', { class: 'card' }, el('h2', {}, `${S.team} 인원 지원 보내기`),
            toTeams.length ? [
              el('div', { class: 'f' }, el('span', { class: 'hint' }, '① 받는 팀 (인력이 부족한 팀)'), seg(toTeams.map((t) => [t, t]), S.sTo, (v) => { S.sTo = v; S.sZone = ''; drawSup(); })),
              el('label', { class: 'f' }, el('span', {}, '② 지원 갈 구역'), zsel),
              el('div', { class: 'f' }, el('span', { class: 'hint' }, '③ 보낼 사람 이름을 누르세요 (같은 곳으로 다시 누르면 해제, 다른 팀·구역을 고르고 누르면 변경)'), el('div', { class: 'ppgrid' }, people))]
              : el('p', { class: 'hint' }, '받을 수 있는 다른 팀 구역이 없습니다. 구역·정원 설정에서 팀별 구역을 먼저 등록하세요.'),
            el('p', { class: 'hint' }, '지원 간 사람은 우리 팀 출근자로 남고, 받는 팀 구역에서 근무하는 것으로 집계됩니다. 사업부 전체 인원은 늘거나 줄지 않습니다.')),
          supIn.length ? el('div', { class: 'card' }, el('h2', {}, `우리 팀으로 오는 지원 ${supIn.length}명`),
            el('div', { class: 'ck-names' }, supIn.map((s) => el('span', { class: 'ck-chip on gx' }, s.name, el('small', {}, `${s.from_team} · ${zoneBrief(s.zone_id)}`))))) : null,
          el('div', { class: 'actions' }, save));
      };
      drawSup(); return;
    }

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
        supCards(),
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
      const zs = myZones();
      const zSel = el('select', { 'aria-label': '배치할 구역' }, el('option', { value: '' }, '구역 선택 안 함 (출근만 체크)'),
        ...zs.map((z) => el('option', { value: z.id }, `${z.side} ${z.floor} · ${O.zoneName(z)}`)));
      zSel.value = S.zone;
      zSel.addEventListener('change', () => { S.zone = zSel.value; });
      const tap = (r) => () => {
        const cur = S.mark.get(r.emp_no); const sp = supOut.get(r.emp_no); const z = sp ? sp.zone_id : S.zone ? Number(S.zone) : 0;   // 팀 지원으로 지정된 사람은 받는 팀 구역으로
        if (cur === undefined) S.mark.set(r.emp_no, z);
        else if (cur !== z) { S.mark.set(r.emp_no, z); toast(`${r.name}님 구역을 바꿨습니다`); }
        else S.mark.delete(r.emp_no);
        draw();
      };
      /* 휴무 변경: 휴무인 사람 → 그날 출근 / 근무인 사람 → 그날 휴무 / 변경된 사람 → 취소 (그날 하루만 적용) */
      const ovTap = (r) => async () => {
        const mode = r.changed ? null : (isLeave(r) ? 'work' : 'off');
        if (mode === 'work' && !window.confirm(`${r.name}님의 휴무(${reason(r)})를 오늘 출근으로 변경할까요?`)) return;
        if (mode === 'off' && !window.confirm(`${r.name}님을 오늘 휴무로 변경할까요?`)) return;
        const { error } = await sb.rpc('set_leave_override', { p_date: S.date, p_division: S.division, p_team: S.team, p_emp: r.emp_no, p_mode: mode });
        if (error) return toast(errText(error), 'err');
        const willLeave = mode === 'off' || (mode === null && r.changed === 'work');
        if (willLeave) {
          S.mark.delete(r.emp_no);
          if (r.checked) {   // 이미 저장된 출근 체크에서 빼기
            const rows2 = teamRows.filter((x) => x.checked && x.emp_no !== r.emp_no).map((x) => ({ emp_no: x.emp_no, zone_id: x.zone_id || null }));
            const r2 = await sb.rpc('save_team_check', { p_date: S.date, p_division: S.division, p_team: S.team, p_rows: rows2, p_close: teamRows.some((x) => x.closed) });
            if (r2.error) return toast(errText(r2.error), 'err');
          }
        }
        toast(mode === 'work' ? `${r.name}님을 오늘 출근으로 변경했습니다` : mode === 'off' ? `${r.name}님을 오늘 휴무로 변경했습니다` : '휴무 변경을 취소했습니다');
        redraw();
      };
      const card = (r) => {
        const leave = isLeave(r); const on = S.mark.has(r.emp_no); const ov = !!S.ovMode;
        const sp = supOut.get(r.emp_no);
        const chg = r.changed === 'work' ? '변경 · 출근' : r.changed === 'off' ? '변경 · 휴무' : '';
        const sub = leave ? (chg || reason(r)) : on ? `✔ ${S.mark.get(r.emp_no) ? (sp ? `${sp.to_team} 지원` : zoneShort(S.mark.get(r.emp_no))) : '출근'}` : sp ? `→ ${sp.to_team} 지원` : (chg || (r.leave_kind === 'half' ? '반차' : ''));
        return el('button', { type: 'button', class: 'pp ' + gcls(r.gender) + ukb(r.emp_no) + (leave ? ' leave' : on ? ' on' : '') + (sp && !leave ? ' sup' : '') + (r.changed ? ' chg' : '') + (r.leave_kind === 'half' ? ' half' : ''), disabled: leave && !ov, 'aria-pressed': String(on), onclick: ov ? ovTap(r) : tap(r) },
          el('b', {}, r.name), el('small', {}, sub));
      };
      const leads = teamRows.filter((r) => r.is_lead); const mems = teamRows.filter((r) => !r.is_lead);
      const people = leads.length ? [
        ukLegend(), el('div', { class: 'f' }, el('span', { class: 'hint' }, `팀 현장관리 ${leads.length}명 (팀장·조장)`), el('div', { class: 'ppgrid' }, leads.map(card))),
        el('div', { class: 'f' }, el('span', { class: 'hint' }, `팀원 ${mems.length}명`), el('div', { class: 'ppgrid' }, mems.map(card)))] : [ukLegend(), el('div', { class: 'ppgrid' }, teamRows.map(card))];
      const lineOf = (list) => { const t = tally(list, S.mark); return `${t.present}/${t.total - t.leave}`; };
      const ovBtn = el('button', { type: 'button', class: 'btn sm ' + (S.ovMode ? '' : 'ghost'), 'aria-pressed': String(!!S.ovMode), onclick: () => { S.ovMode = !S.ovMode; draw(); } }, S.ovMode ? '휴무 변경 모드 끄기' : '휴무 변경 모드');
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
        leads.length ? el('p', { class: 'ck-gline' }, `팀 현장관리 ${lineOf(leads)}명 · 팀원 ${lineOf(mems)}명 (출근 / 근무 예정)`) : null,
        teamRows.some((r) => !r.gender) ? el('div', { class: 'err' }, `성별이 지정되지 않은 직원 ${teamRows.filter((r) => !r.gender).length}명 — 남·여 인원이 정확하지 않습니다. 위의 "성별 설정" 탭에서 지정하세요.`) : null,
        k.closed ? el('div', { class: 'info' }, el('b', {}, '완료된 팀입니다'), '고친 뒤 "다시 완료"를 누르면 결근이 다시 계산됩니다.') : null,
        el('div', { class: 'card' }, el('h2', {}, `${S.team} 출근 체크`),
          el('label', { class: 'f' }, el('span', {}, '① 배치할 구역'), zSel),
          el('div', { class: 'btnrow' }, ovBtn),
          S.ovMode ? el('div', { class: 'info' }, el('b', {}, '휴무 변경 모드'), '휴무인 사람을 누르면 오늘 출근으로, 근무인 사람을 누르면 오늘 휴무로 바뀝니다. "변경" 표시가 있는 사람을 누르면 취소됩니다. 오늘 하루만 적용됩니다.') : null,
          el('div', { class: 'f' }, el('span', { class: 'hint' }, S.ovMode ? '② 변경할 사람 이름을 누르세요' : '② 출근한 사람 이름을 누르세요 (다시 누르면 취소)'), people),
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

  /* ---- 관리자(관리자·총괄팀장·master) 이름 카드 출근 체크 + 구역 배치 + 관리자 현황 ---- */
  const ST = { div: null, shift: null, zone: '' };
  const ROLE_NAME = { master: '최고관리자', admin: '관리자', chief: '총괄팀장' };
  async function staffPanel(body, redrawAll) {
    const me = state.me; await O.ensureShifts();
    const canEdit = me.role === 'master' || me.role === 'admin';   // 다른 사람 대리 체크·위치 이동
    if (!S.date) S.date = O.today();
    if (!ST.div) ST.div = (bizDivs().find((d) => d.id === me.division_id) || bizDivs()[0] || {}).id;
    if (!ST.shift) ST.shift = O.basisFor(null)[0] || O.shiftList()[0];
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    let rows = []; let zones = [];
    try {
      const [r, z] = await Promise.all([sb.rpc('staff_roster', { p_date: S.date }), sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active').eq('active', true)]);
      if (r.error) throw r.error; rows = r.data || []; zones = z.data || [];
    } catch (e) { body.replaceChildren(el('div', { class: 'card' }, el('h2', {}, '관리자 출근'), el('p', { class: 'hint' }, '불러오지 못했습니다. 14 SQL 실행 여부를 확인하세요'))); return; }
    const zmap = new Map(zones.map((z) => [z.id, z]));
    const zlabel = (id) => { const z = zmap.get(id); return z ? `${z.side} ${z.floor} ${O.zoneName(z)}` : '구역 미배치'; };
    const draw = () => {
      const zs = zones.filter((z) => z.division_id === ST.div).sort(O.zoneSort);
      const zsel = el('select', { 'aria-label': '배치 구역' }, el('option', { value: '' }, '구역 선택 안 함'), ...zs.map((z) => el('option', { value: z.id }, `${z.side} ${z.floor} · ${O.zoneName(z)}`)));
      zsel.value = ST.zone; zsel.addEventListener('change', () => { ST.zone = zsel.value; });
      const dIn = el('input', { type: 'date', value: S.date, 'aria-label': '날짜' });
      dIn.addEventListener('change', () => { if (dIn.value) { S.date = dIn.value; staffPanel(body, redrawAll); } });
      const stepD = (n) => () => { S.date = O.addDays(S.date, n); staffPanel(body, redrawAll); };
      const mark = async (r) => {
        const same = r.checked && r.division_id === ST.div && r.shift === ST.shift && (r.zone_id || null) === (ST.zone ? Number(ST.zone) : null);
        const on = !same;   // 같은 설정이면 취소, 다르면 저장·변경
        const { error } = await sb.rpc('set_staff_checkin', { p_date: S.date, p_user: r.user_id, p_division: ST.div, p_shift: ST.shift, p_zone: ST.zone ? Number(ST.zone) : null, p_on: on });
        if (error) return toast(errText(error), 'err');
        Object.assign(r, on ? { checked: true, division_id: ST.div, shift: ST.shift, zone_id: ST.zone ? Number(ST.zone) : null } : { checked: false, division_id: null, shift: null, zone_id: null });
        draw();
      };
      const cards = rows.map((r) => el('button', { type: 'button', class: 'pp gx' + (r.checked ? ' on' : '') + (r.user_id === me.id ? ' me' : ''), disabled: !(canEdit || r.user_id === me.id), 'aria-pressed': String(!!r.checked), onclick: () => mark(r) },
        el('b', {}, r.name), el('small', {}, r.checked ? `✔ ${shortDiv(divName(r.division_id))} ${r.shift}${r.auto ? ' · 자동' : ''}` : (r.user_id === me.id ? '내 출근 ▶' : ROLE_NAME[r.role] || ''))));
      const on = rows.filter((r) => r.checked);
      const byDiv = bizDivs().map((d) => [d, on.filter((r) => r.division_id === d.id)]).filter(([, l]) => l.length);
      const top = el('div', { class: 'card' },
        el('div', { class: 'datebar' }, el('button', { type: 'button', class: 'btn ghost sm', onclick: stepD(-1) }, '‹'), dIn,
          el('button', { type: 'button', class: 'btn ghost sm', onclick: stepD(1) }, '›'),
          el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { S.date = O.today(); staffPanel(body, redrawAll); } }, '오늘')),
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '① 근무 사업부'), seg(bizDivs().map((d) => [String(d.id), shortDiv(d.name)]), String(ST.div), (v) => { ST.div = Number(v); ST.zone = ''; draw(); })),
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '② 근무조'), seg(O.shiftList().map((x) => [x, x]), ST.shift, (v) => { ST.shift = v; draw(); })),
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '③ 배치 구역'), zsel));
      body.replaceChildren(top,
        el('div', { class: 'ck-tiles' }, tile('대상', rows.length), tile('출근', on.length, 'ok'), tile('미출근', rows.length - on.length, rows.length - on.length ? 'mid' : ''), tile('구역 배치', on.filter((r) => r.zone_id).length)),
        el('div', { class: 'card' }, el('h2', {}, '관리자 출근 체크'),
          el('p', { class: 'hint' }, canEdit ? '본인은 "내 출근" 카드를 눌러 출근합니다. 다른 사람은 사업부·근무조·구역을 고른 뒤 이름을 누르면 그 위치로 옮겨집니다. 같은 설정으로 다시 누르면 취소됩니다' : '근무 사업부·근무조·구역을 고른 뒤 내 이름 카드를 누르세요. 같은 설정으로 다시 누르면 취소, 다른 설정이면 변경됩니다. 다른 사람은 조회만 가능합니다'),
          el('div', { class: 'ppgrid' }, cards)),
        el('div', { class: 'card' }, el('h2', {}, '관리자 현황'),
          byDiv.length ? byDiv.map(([d, l]) => el('div', { class: 'f' }, el('span', { class: 'hint' }, `${d.name} · ${l.length}명`),
            el('div', { class: 'ck-names' }, l.map((r) => el('span', { class: 'ck-chip gx' }, r.name, el('small', {}, `${r.shift}${r.zone_id ? ' · ' + zlabel(r.zone_id) : ' · 구역 미배치'}`)))))) : el('p', { class: 'hint' }, '아직 출근 체크한 관리자가 없습니다'),
          rows.length - on.length ? el('div', { class: 'f' }, el('span', { class: 'hint' }, `미출근 ${rows.length - on.length}명`), el('div', { class: 'ck-names' }, rows.filter((r) => !r.checked).map((r) => el('span', { class: 'ck-chip wait gx' }, r.name)))) : null,
          el('p', { class: 'hint' }, '관리자 출근 인원은 현황에서 master가 정한 칸(지원 또는 근무)으로 집계됩니다')));
    };
    draw();
  }
  async function checkEntry(body) {
    const r = state.me.role;
    if (r === 'leader') return checkView(body);
    const tabsBox = el('div'); const sub = el('div'); body.replaceChildren(tabsBox, sub);
    const go = (v) => { S.mode = v; drawTabs(); if (v === 'staff') staffPanel(sub); else checkView(sub); };
    const drawTabs = () => tabsBox.replaceChildren(seg([['team', '팀 출근 체크'], ['staff', '관리자 출근·현황']], S.mode || 'team', go));
    drawTabs(); go(S.mode || 'team');
  }

  window.APP.check = { rosterExcel, tally, isLeave, reason };
  register('check', '출근 체크', ['leader', 'chief', 'admin', 'master'], checkEntry, '팀 직원 이름으로 출근 체크·구역 배치');
})();
