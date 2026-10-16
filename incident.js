/* 이벤트 신고 — 대응계획 붙임 1 '상황 대응 기록 양식'
   ① 불법행위 수집 기록  ② 업무방해 조치 기록  (처리 상태: 접수 → 조치 중 → 완료) */
(() => {
  'use strict';
  const { sb, state, el, seg, busy, toast, register, bizDivs, divName, shortDiv } = window.APP;
  const KINDS = {
    illegal: { label: '불법행위 수집 기록', types: ['무단 점거', '기물파손', '폭언/위협', '폭력 행위', '기타'] },
    obstruct: { label: '업무방해 조치 기록', types: ['변기 막힘', '소모품 소비', '오물 투척', '고의 넘침', '청소도구 방치', '악취유발', '기타'] }
  };
  const EVID = ['사진', '영상', '음성', '기타'];
  const STATUS = { new: '접수', doing: '조치 중', done: '완료' };
  const S = { kind: 'illegal', filter: 'open', open: null, form: null };
  const errText = (e) => (e && e.message && /[가-힣]/.test(e.message) ? e.message : '저장하지 못했습니다. 잠시 후 다시 시도하세요');
  const pad = (n) => String(n).padStart(2, '0');
  const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmt = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const newForm = () => ({ div: state.me.division_id && bizDivs().some((d) => d.id === state.me.division_id) ? state.me.division_id : (bizDivs()[0] || {}).id, at: localNow(), place: '', types: [], related: '', detail: '', response: '', evid: [], note: '' });

  async function incidentView(body) {
    const me = state.me;
    if (!S.form) S.form = newForm();
    const f = S.form;
    let list = []; let zones = [];
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    try {
      const [r, z] = await Promise.all([sb.rpc('list_incidents', { p_limit: 200 }), sb.from('zones').select('id,division_id,side,floor,area,label,task,active').eq('active', true)]);
      if (r.error) throw r.error; list = r.data || []; zones = z.data || [];
    } catch (e) { body.replaceChildren(el('div', { class: 'card' }, el('h2', {}, '이벤트 신고'), el('p', { class: 'hint' }, '불러오지 못했습니다. 15 SQL 실행 여부를 확인하세요'))); return; }
    const canHandle = ['master', 'admin', 'chief'].includes(me.role);
    const O = window.APP.ops;

    const draw = () => {
      const K = KINDS[S.kind];
      const chip = (txt, on, fn) => el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: fn }, txt);
      const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
      const zs = zones.filter((z) => z.division_id === f.div).sort(O.zoneSort);
      const zsel = el('select', { 'aria-label': '구역 선택' }, el('option', { value: '' }, '구역에서 선택 (선택 사항)'), ...zs.map((z) => el('option', { value: z.id }, `${z.side} ${z.floor} · ${O.zoneName(z)}`)));
      zsel.addEventListener('change', () => { const z = zones.find((x) => String(x.id) === zsel.value); if (z) { f.place = `${z.side} ${z.floor} ${O.zoneName(z)}`; draw(); } });
      const tin = (key, label, rows) => { const i = rows ? el('textarea', { rows: String(rows), 'aria-label': label }) : el('input', { type: 'text', 'aria-label': label, autocomplete: 'off' }); i.value = f[key]; i.addEventListener('input', () => { f[key] = i.value; }); return i; };
      const at = el('input', { type: 'datetime-local', value: f.at, 'aria-label': '발생일시' }); at.addEventListener('input', () => { f.at = at.value; });
      const send = el('button', { type: 'button', class: 'btn' }, '신고 등록');
      send.addEventListener('click', busy(send, async () => {
        if (!f.types.length) return toast('상황 유형을 선택하세요', 'err');
        if (!f.detail.trim()) return toast('상세 상황을 입력하세요', 'err');
        const { error } = await sb.rpc('report_incident', { p_kind: S.kind, p_division: f.div, p_occurred: f.at ? new Date(f.at).toISOString() : null, p_place: f.place || null, p_types: f.types, p_related: f.related || null, p_detail: f.detail, p_response: f.response || null, p_evidence: f.evid, p_evidence_note: f.note || null });
        if (error) return toast(errText(error), 'err');
        S.form = newForm(); toast('신고를 등록했습니다'); S.filter = 'open'; await incidentView(body);
      }));
      const field = (label, node) => el('div', { class: 'f' }, el('span', { class: 'hint' }, label), node);
      const formCard = el('div', { class: 'card inc-form' }, el('h2', {}, '이벤트 신고'),
        seg(Object.entries(KINDS).map(([k, v]) => [k, v.label]), S.kind, (v) => { S.kind = v; f.types = []; draw(); }),
        field('현장', seg(bizDivs().map((d) => [String(d.id), shortDiv(d.name)]), String(f.div), (v) => { f.div = Number(v); draw(); })),
        field('담당자', el('div', { class: 'inc-who' }, `${me.name} (${window.APP.ROLE_LABEL[me.role] || ''})`)),
        field('발생일시', at),
        field('발생장소', el('div', {}, tin('place', '발생장소'), zsel)),
        field('상황 유형 (복수 선택)', el('div', { class: 'chips' }, K.types.map((t) => chip(t, f.types.includes(t), () => { f.types = toggle(f.types, t); draw(); })))),
        field('관련자 (이름 · 소속 · 비정상상황 참여 여부)', tin('related', '관련자', 2)),
        field('상세 상황 (발생 내용 · 관련자 발언과 행동 · 주변 반응)', tin('detail', '상세 상황', 4)),
        field('현장 대응 (즉각 조치한 내용)', tin('response', '현장 대응', 3)),
        field('증거자료', el('div', { class: 'chips' }, EVID.map((t) => chip(t, f.evid.includes(t), () => { f.evid = toggle(f.evid, t); draw(); })))),
        field('첨부 내용 (예: 사진 3장, 영상 10MB)', tin('note', '첨부 내용')),
        el('div', { class: 'actions' }, send));

      const open = list.filter((r) => r.status !== 'done');
      const shown = list.filter((r) => (S.filter === 'open' ? r.status !== 'done' : S.filter === 'done' ? r.status === 'done' : true));
      const items = shown.map((r) => {
        const isOpen = S.open === r.id;
        const head = el('button', { type: 'button', class: 'inc-row ' + r.status, 'aria-expanded': String(isOpen), onclick: () => { S.open = isOpen ? null : r.id; draw(); } },
          el('span', { class: 'ik' }, KINDS[r.kind].label.slice(0, 2)), el('b', {}, r.types.join(' · ')),
          el('small', {}, `${shortDiv(divName(r.division_id))} · ${r.place || '장소 미기재'} · ${fmt(r.occurred_at)}`),
          el('span', { class: 'badge ' + (r.status === 'done' ? 'ok' : r.status === 'doing' ? 'wait' : 'no') }, STATUS[r.status]));
        if (!isOpen) return el('div', { class: 'inc-item' }, head);
        const row = (k, v) => (v ? el('div', { class: 'inc-d' }, el('span', {}, k), el('p', {}, v)) : null);
        const ops = canHandle ? el('div', { class: 'actions' }, ...['new', 'doing', 'done'].filter((s) => s !== r.status).map((s) => {
          const b = el('button', { type: 'button', class: 'btn sm' + (s === 'done' ? '' : ' ghost') }, `${STATUS[s]}로 변경`);
          b.addEventListener('click', busy(b, async () => { const { error } = await sb.rpc('set_incident_status', { p_id: r.id, p_status: s }); if (error) return toast(errText(error), 'err'); await incidentView(body); }));
          return b;
        }), me.role === 'master' ? (() => { const d = el('button', { type: 'button', class: 'btn sm danger' }, '삭제'); d.addEventListener('click', busy(d, async () => { if (!window.confirm('이 신고를 삭제합니다. 되돌릴 수 없습니다.')) return; const { error } = await sb.rpc('delete_incident', { p_id: r.id }); if (error) return toast(errText(error), 'err'); S.open = null; await incidentView(body); })); return d; })() : null) : null;
        return el('div', { class: 'inc-item open' }, head, el('div', { class: 'inc-body' },
          row('종류', KINDS[r.kind].label), row('담당자', r.reporter_name), row('관련자', r.related), row('상세 상황', r.detail), row('현장 대응', r.response),
          row('증거자료', [...(r.evidence || []), r.evidence_note].filter(Boolean).join(' · ')), r.handled_by ? row('처리', `${STATUS[r.status]} · ${r.handled_by} · ${fmt(r.handled_at)}`) : null, ops));
      });
      const listCard = el('div', { class: 'card' }, el('h2', {}, `신고 목록 · 미조치 ${open.length}건`),
        seg([['open', '미조치'], ['done', '완료'], ['all', '전체']], S.filter, (v) => { S.filter = v; draw(); }),
        items.length ? items : el('p', { class: 'empty' }, '해당하는 신고가 없습니다'));
      body.replaceChildren(formCard, listCard);
    };
    draw();
  }
  window.APP.incident = { KINDS, STATUS, fmt };
  register('incident', '이벤트 신고', ['leader', 'chief', 'admin', 'master'], incidentView, '불법행위·업무방해 발생 신고와 처리');
})();
