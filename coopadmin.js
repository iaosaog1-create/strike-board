/* 협정인력 관리 (관리자·최고관리자): 오늘 출근 · 명단 · 가입 신청 · QR 장소 · 협정사 업체 */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, bizDivs, divName, shortDiv, printNode } = window.APP;
  const { today, addDays, hhmm, dateLabel, shiftList, ensureShifts, zoneName, zoneSort } = window.APP.ops;
  const TABS = [['today', '오늘 출근'], ['workers', '명단'], ['pending', '가입 신청'], ['places', 'QR 장소'], ['vendors', '협정사 업체']];
  const S = { tab: 'today', date: null, edit: null, pend: null };
  const t5 = (t) => String(t || '').slice(0, 5);
  const q = async (p) => { const r = await p; if (r.error) throw r.error; return r.data || []; };
  const errMsg = (e) => (e && e.message && /PIN|숫자|권한|필요|관리자/.test(e.message) ? e.message : '처리하지 못했습니다. 입력값과 권한을 확인하세요');
  const qrUrl = (token) => new URL('coop.html?p=' + encodeURIComponent(token), window.location.href).href;
  function qrImg(url, cell) {
    const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
    return el('img', { class: 'qr', src: qr.createDataURL(cell || 6, 2), alt: 'QR 코드' });
  }

  async function coopView(body) {
    await ensureShifts();
    if (!S.date) S.date = today();
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    let vendors, workers, places, pending, att, zones;
    try {
      [vendors, workers, places, pending, att, zones] = await Promise.all([
        q(sb.from('coop_vendors').select('id,name,active').order('name')),
        q(sb.from('coop_workers').select('id,name,work_start,work_end,active,locked,vendor_id,shift').order('name')),
        q(sb.from('coop_places').select('id,name,qr_token,zone_id,division_id,active').order('name')),
        q(sb.from('coop_pending').select('id,name,status,requested_at').eq('status', 'pending').order('requested_at')),
        q(sb.from('coop_attendance').select('id,worker_id,place_id,clock_in,clock_out,note').eq('work_date', S.date)),
        q(sb.from('zones').select('id,division_id,side,floor,area,label,task,required,active'))]);
    } catch (e) { body.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요')); return; }
    const D = { vendors, workers, places, pending, att, zones };
    const redraw = () => coopView(body);
    const tabs = seg(TABS.map(([k, l]) => [k, k === 'pending' && pending.length ? `${l} ${pending.length}` : l]), S.tab, (v) => { S.tab = v; S.edit = null; S.pend = null; draw(); });
    const draw = () => {
      const pane = { today: todayPane, workers: workersPane, pending: pendingPane, places: placesPane, vendors: vendorsPane }[S.tab](D, redraw, draw);
      body.replaceChildren(tabs, pane);
    };
    draw();
  }

  const vendorName = (D, id) => (D.vendors.find((v) => v.id === id) || {}).name || '';
  const timeIn = (v, label) => el('input', { type: 'time', value: t5(v), 'aria-label': label });

  /* ---- 오늘 출근 ---- */
  function todayPane(D, redraw) {
    const inp = el('input', { type: 'date', value: S.date, 'aria-label': '날짜' });
    inp.addEventListener('change', () => { if (inp.value) { S.date = inp.value; redraw(); } });
    const step = (n) => () => { S.date = addDays(S.date, n); redraw(); };
    const bar = el('div', { class: 'card pick' }, el('div', { class: 'datebar' },
      el('button', { type: 'button', class: 'btn ghost sm', onclick: step(-1) }, '‹'), inp,
      el('button', { type: 'button', class: 'btn ghost sm', onclick: step(1) }, '›'),
      el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { S.date = today(); redraw(); } }, '오늘')));
    const rows = D.att.map((a) => ({ a, w: D.workers.find((x) => x.id === a.worker_id) || {}, p: D.places.find((x) => x.id === a.place_id) || {} }))
      .sort((x, y) => x.a.clock_in.localeCompare(y.a.clock_in));
    const working = rows.filter((r) => !r.a.clock_out).length;
    const active = D.workers.filter((w) => w.active).length;
    return el('div', {}, bar,
      el('div', { class: 'card sumbar' },
        el('div', {}, el('span', {}, '출근'), el('b', {}, String(rows.length)), el('small', {}, '명')),
        el('div', {}, el('span', {}, '근무 중'), el('b', {}, String(working)), el('small', {}, '명')),
        el('div', {}, el('span', {}, '미출근'), el('b', {}, String(Math.max(0, active - rows.length))), el('small', {}, '명'))),
      el('div', { class: 'card' }, el('h2', {}, `${dateLabel(S.date)} 출퇴근 기록`),
        rows.length ? el('div', { class: 'tblwrap' }, el('table', { class: 'tbl left' },
          el('thead', {}, el('tr', {}, ...['이름', '업체', '근무조', '장소', '출근', '퇴근'].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows.map((r) => el('tr', {}, el('th', {}, r.w.name || '-'), el('td', {}, vendorName(D, r.w.vendor_id) || '-'),
            el('td', {}, r.w.shift || '-'), el('td', {}, r.p.name || '-'), el('td', {}, hhmm(r.a.clock_in)), el('td', {}, r.a.clock_out ? hhmm(r.a.clock_out) : '근무 중'))))))
          : el('p', { class: 'empty' }, '이 날짜의 출근 기록이 없습니다')));
  }

  /* ---- 명단 ---- */
  function workersPane(D, redraw, draw) {
    const w = S.edit || { id: null, name: '', work_start: '07:00', work_end: '16:30', active: true, vendor_id: null, shift: null };
    const f = { shift: w.shift || '', active: w.active };
    const nameIn = el('input', { type: 'text', maxlength: '20', value: w.name, 'aria-label': '이름' });
    const pinIn = el('input', { type: 'text', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: w.id ? '비워 두면 그대로' : '숫자 4자리', 'aria-label': 'PIN' });
    const sIn = timeIn(w.work_start, '출근 시각'), eIn = timeIn(w.work_end, '퇴근 시각');
    const vSel = el('select', { 'aria-label': '협정사 업체' }, el('option', { value: '' }, '선택 안 함'),
      ...D.vendors.filter((v) => v.active || v.id === w.vendor_id).map((v) => el('option', { value: v.id }, v.name)));
    vSel.value = w.vendor_id ? String(w.vendor_id) : '';
    const save = el('button', { class: 'btn', type: 'button' }, w.id ? '수정 저장' : '명단에 추가');
    save.addEventListener('click', busy(save, async () => {
      const name = nameIn.value.trim(), pin = pinIn.value.trim();
      if (name.length < 2) return toast('이름을 입력하세요', 'err');
      if (pin && !/^\d{4}$/.test(pin)) return toast('PIN은 숫자 4자리입니다', 'err');
      if (!w.id && !pin) return toast('새로 등록할 때는 PIN이 필요합니다', 'err');
      if (!sIn.value || !eIn.value) return toast('출근·퇴근 시각을 입력하세요', 'err');
      const { error } = await sb.rpc('coop_save_worker', { p_id: w.id, p_name: name, p_pin: pin || null, p_start: sIn.value, p_end: eIn.value,
        p_active: f.active, p_vendor: vSel.value ? Number(vSel.value) : null, p_shift: f.shift || null });
      if (error) return toast(errMsg(error), 'err');
      toast(w.id ? '수정했습니다' : '명단에 추가했습니다'); S.edit = null; redraw();
    }));
    const form = el('div', { class: 'card' }, el('h2', {}, w.id ? `${w.name} 수정` : '협정인력 추가'),
      el('label', { class: 'f' }, el('span', {}, '이름'), nameIn),
      el('label', { class: 'f' }, el('span', {}, 'PIN (본인이 출퇴근 때 입력)'), pinIn),
      el('div', { class: 'f' }, el('span', { class: 'hint' }, '근무조'), seg([['', '미지정'], ...shiftList().map((s) => [s, s])], f.shift, (v) => { f.shift = v; })),
      el('div', { class: 'two' }, el('label', { class: 'f' }, el('span', {}, '출근 시각'), sIn), el('label', { class: 'f' }, el('span', {}, '퇴근 시각'), eIn)),
      el('label', { class: 'f' }, el('span', {}, '협정사 업체'), vSel),
      w.id ? el('div', { class: 'f' }, el('span', { class: 'hint' }, '상태'), seg([['y', '사용'], ['n', '중지']], f.active ? 'y' : 'n', (v) => { f.active = v === 'y'; })) : null,
      save, w.id ? el('button', { class: 'btn ghost', type: 'button', onclick: () => { S.edit = null; draw(); } }, '취소') : null);
    const list = el('div', { class: 'card' }, el('h2', {}, `협정인력 ${D.workers.length}명`),
      D.workers.length ? D.workers.map((x) => {
        const unlock = x.locked ? el('button', { class: 'btn ghost sm', type: 'button' }, 'PIN 잠금 해제') : null;
        if (unlock) unlock.addEventListener('click', busy(unlock, async () => {
          const { error } = await sb.rpc('coop_unlock', { p_id: x.id });
          if (error) return toast(errMsg(error), 'err'); toast('잠금을 풀었습니다'); redraw();
        }));
        return el('div', { class: 'zrow' + (x.active ? '' : ' off') },
          el('div', {}, el('b', {}, x.name), el('small', {}, [vendorName(D, x.vendor_id), x.shift, `${t5(x.work_start)}~${t5(x.work_end)}`].filter(Boolean).join(' · ')),
            x.locked ? el('small', { class: 'warn' }, 'PIN 잠김') : null, x.active ? null : el('small', {}, '사용 중지')),
          el('div', { class: 'zact' }, unlock, el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.edit = x; draw(); } }, '수정')));
      }) : el('p', { class: 'empty' }, '아직 등록된 협정인력이 없습니다'));
    return el('div', {}, form, list);
  }

  /* ---- 가입 신청 ---- */
  function pendingPane(D, redraw, draw) {
    const p = S.pend && D.pending.find((x) => x.id === S.pend.id);
    const list = el('div', { class: 'card' }, el('h2', {}, `승인 대기 ${D.pending.length}명`),
      D.pending.length ? D.pending.map((x) => el('button', { type: 'button', class: 'list-item' + (p && p.id === x.id ? ' sel' : ''), onclick: () => { S.pend = x; draw(); } },
        el('b', {}, x.name), el('span', { class: 'badge wait' }, '대기'), el('small', {}, hhmm(x.requested_at) + ' 신청'), el('span', {})))
        : el('p', { class: 'empty' }, '대기 중인 신청이 없습니다'));
    if (!p) return el('div', {}, list);
    const f = { shift: '' };
    const sIn = timeIn('07:00', '출근 시각'), eIn = timeIn('16:30', '퇴근 시각');
    const vSel = el('select', { 'aria-label': '협정사 업체' }, el('option', { value: '' }, '선택 안 함'), ...D.vendors.filter((v) => v.active).map((v) => el('option', { value: v.id }, v.name)));
    const run = (approve) => async () => {
      if (approve && (!sIn.value || !eIn.value)) return toast('출근·퇴근 시각을 입력하세요', 'err');
      const { error } = await sb.rpc('coop_review_join', { p_id: p.id, p_approve: approve, p_start: approve ? sIn.value : null, p_end: approve ? eIn.value : null,
        p_vendor: vSel.value ? Number(vSel.value) : null, p_shift: f.shift || null });
      if (error) return toast(errMsg(error), 'err');
      toast(approve ? `${p.name}님을 명단에 등록했습니다` : '반려했습니다'); S.pend = null; redraw();
    };
    const ok = el('button', { class: 'btn', type: 'button' }, '승인하고 명단에 등록'), no = el('button', { class: 'btn danger', type: 'button' }, '반려');
    ok.addEventListener('click', busy(ok, run(true))); no.addEventListener('click', busy(no, run(false)));
    return el('div', {}, list, el('div', { class: 'card' }, el('h2', {}, `${p.name} 승인`),
      el('p', { class: 'hint' }, 'PIN은 본인이 신청할 때 정한 번호가 그대로 사용됩니다.'),
      el('div', { class: 'f' }, el('span', { class: 'hint' }, '근무조'), seg([['', '미지정'], ...shiftList().map((s) => [s, s])], f.shift, (v) => { f.shift = v; })),
      el('div', { class: 'two' }, el('label', { class: 'f' }, el('span', {}, '출근 시각'), sIn), el('label', { class: 'f' }, el('span', {}, '퇴근 시각'), eIn)),
      el('label', { class: 'f' }, el('span', {}, '협정사 업체'), vSel), el('div', { class: 'actions' }, ok, no)));
  }

  /* ---- QR 장소 ---- */
  function placesPane(D, redraw) {
    const f = { div: String((bizDivs()[0] || {}).id || '') };
    const nameIn = el('input', { type: 'text', maxlength: '30', placeholder: '예: T1 3층 동편 휴게실', 'aria-label': '장소 이름' });
    const zSel = el('select', { 'aria-label': '연결할 구역' });
    const drawZ = () => {
      const zs = D.zones.filter((z) => String(z.division_id) === f.div && z.active).sort(zoneSort);
      zSel.replaceChildren(el('option', { value: '' }, '연결 안 함'), ...zs.map((z) => el('option', { value: z.id }, `${z.side} · ${z.floor} · ${zoneName(z)}`)));
    };
    drawZ();
    const dSel = el('select', { 'aria-label': '사업부' }, ...bizDivs().map((d) => el('option', { value: d.id }, d.name)));
    dSel.addEventListener('change', () => { f.div = dSel.value; drawZ(); });
    const add = el('button', { class: 'btn', type: 'button' }, '장소 추가');
    add.addEventListener('click', busy(add, async () => {
      const name = nameIn.value.trim();
      if (!name) return toast('장소 이름을 입력하세요', 'err');
      const { error } = await sb.from('coop_places').insert({ name, division_id: Number(f.div), zone_id: zSel.value ? Number(zSel.value) : null });
      if (error) return toast('추가하지 못했습니다. 권한을 확인하세요', 'err');
      toast('장소를 추가했습니다'); redraw();
    }));
    const form = el('div', { class: 'card' }, el('h2', {}, 'QR 장소 추가'),
      el('p', { class: 'hint' }, '협정인력이 출퇴근할 때 스캔하는 QR 코드를 만듭니다. 사업부를 지정해야 총괄팀장이 배치할 수 있습니다.'),
      el('label', { class: 'f' }, el('span', {}, '장소 이름'), nameIn), el('label', { class: 'f' }, el('span', {}, '사업부'), dSel),
      el('label', { class: 'f' }, el('span', {}, '연결할 구역 (선택)'), zSel), add);
    const list = el('div', { class: 'card' }, el('h2', {}, `QR 장소 ${D.places.length}곳`),
      D.places.length ? el('div', { class: 'qrgrid' }, D.places.map((pl) => {
        const url = qrUrl(pl.qr_token);
        const poster = el('button', { class: 'btn ghost sm', type: 'button' }, '인쇄');
        poster.addEventListener('click', () => printNode(el('div', { class: 'poster' },
          el('h1', {}, '협정인력 출퇴근'), el('h2', {}, pl.name), qrImg(url, 14),
          el('p', {}, '휴대폰 카메라로 QR을 스캔하세요'), el('ol', {}, el('li', {}, '이름을 선택'), el('li', {}, 'PIN 4자리 입력'), el('li', {}, '출근 또는 퇴근 버튼')))));
        const copy = el('button', { class: 'btn ghost sm', type: 'button' }, '링크 복사');
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); toast('링크를 복사했습니다'); } catch (e) { toast(url); } });
        const tog = el('button', { class: 'btn ghost sm', type: 'button' }, pl.active ? '사용 중지' : '다시 사용');
        tog.addEventListener('click', busy(tog, async () => {
          const { error } = await sb.from('coop_places').update({ active: !pl.active }).eq('id', pl.id);
          if (error) return toast('처리하지 못했습니다', 'err'); redraw();
        }));
        const z = D.zones.find((x) => x.id === pl.zone_id);
        return el('div', { class: 'qrcell' + (pl.active ? '' : ' off') }, qrImg(url, 5),
          el('b', {}, pl.name), el('small', {}, [shortDiv(divName(pl.division_id)), z ? `${z.floor} ${zoneName(z)}` : ''].filter(Boolean).join(' · ') || '사업부 미지정'),
          el('div', { class: 'zact wrap' }, poster, copy, tog));
      })) : el('p', { class: 'empty' }, '아직 등록된 장소가 없습니다'));
    return el('div', {}, form, list);
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
    return el('div', {}, el('div', { class: 'card' }, el('h2', {}, '협정사 업체 추가'), el('label', { class: 'f' }, el('span', {}, '업체 이름'), nameIn), add),
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

  register('coop', '협정인력 관리', ['admin', 'master'], coopView, '명단·PIN·QR 장소·협정사 업체 관리');
})();
