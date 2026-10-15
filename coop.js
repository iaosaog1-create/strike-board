/* 협정인력 출퇴근 화면 (로그인 없음): QR 스캔 → 이름 선택 → PIN → 출근/퇴근 */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const QR = new URLSearchParams(window.location.search).get('p') || '';
  const root = document.getElementById('app');
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  };
  const mount = (...nodes) => { root.replaceChildren(el('header', { class: 'top' }, el('img', { class: 'lg', src: 'icon-192.png', alt: '' }), el('div', { class: 'tt' }, el('h1', {}, 'IAOS 비정상상황'), el('small', {}, '협정인력 출퇴근'))), ...nodes); window.scrollTo(0, 0); };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  const busy = (btn, fn) => async (ev) => { ev && ev.preventDefault(); if (btn.disabled) return; btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
  const nowDate = () => new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });
  const clockEl = el('b', {}, '');
  const tick = () => { clockEl.textContent = hhmm(Date.now()); };
  tick(); setInterval(tick, 20000);
  const state = { place: null, workers: [], worker: null, filter: '' };

  const CLOCK_ERR = {
    invalid_qr: 'QR 코드가 올바르지 않습니다. 관리자에게 문의하세요',
    no_worker: '명단에서 이름을 찾을 수 없습니다. 관리자에게 문의하세요',
    locked: 'PIN을 여러 번 틀려서 잠겼습니다. 관리자에게 잠금 해제를 요청하세요',
    already_in: '오늘은 이미 출근 처리되었습니다',
    not_clocked_in: '출근 기록이 없어 퇴근할 수 없습니다. 먼저 출근을 눌러 주세요',
    bad_action: '처리할 수 없습니다. 다시 시도하세요'
  };
  const JOIN_ERR = {
    invalid_qr: 'QR 코드가 올바르지 않습니다. 관리자에게 문의하세요',
    bad_name: '이름을 2~20자로 입력하세요',
    bad_pin_format: 'PIN은 숫자 4자리로 입력하세요',
    duplicate: '이미 등록되었거나 신청 중인 이름입니다. 관리자에게 문의하세요',
    too_many: '신청이 많아 지금은 받을 수 없습니다. 관리자에게 문의하세요'
  };

  async function start() {
    mount(el('main', { class: 'wrap center' }, el('p', { class: 'lead' }, '불러오는 중…')));
    if (!QR) return fail('QR 코드로 접속해야 합니다');
    try {
      const { data, error } = await sb.rpc('coop_place_info', { p_qr: QR });
      if (error || !data || data.error) return fail('QR 코드가 올바르지 않습니다. 관리자에게 문의하세요');
      state.place = data;
      const w = await sb.rpc('coop_list_workers');
      state.workers = (w && w.data) || [];
    } catch (e) { return fail('연결할 수 없습니다. 잠시 후 다시 시도하세요'); }
    main();
  }
  function fail(msg) { mount(el('main', { class: 'wrap center' }, el('h2', { class: 'title' }, '이용할 수 없습니다'), el('div', { class: 'err' }, msg))); }

  function main() {
    const search = el('input', { type: 'search', placeholder: '이름 검색', autocomplete: 'off', 'aria-label': '이름 검색', value: state.filter });
    const list = el('div', { class: 'namelist', role: 'listbox' });
    const drawList = () => {
      const f = state.filter.trim();
      const items = state.workers.filter((w) => !f || w.name.includes(f));
      list.replaceChildren(...(items.length ? items.map((w) => el('button', {
        type: 'button', role: 'option', 'aria-selected': String(!!state.worker && state.worker.id === w.id),
        class: 'name' + (state.worker && state.worker.id === w.id ? ' on' : ''), onclick: () => { state.worker = w; drawList(); pin.focus(); }
      }, w.name)) : [el('p', { class: 'empty' }, state.workers.length ? '일치하는 이름이 없습니다' : '등록된 이름이 없습니다')]));
    };
    search.addEventListener('input', () => { state.filter = search.value; drawList(); });
    const pin = el('input', { type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: '●●●●', 'aria-label': 'PIN 4자리', class: 'pin' });
    const box = el('div', { class: 'err', role: 'alert', hidden: true });
    const showErr = (m) => { box.textContent = m; box.hidden = false; };
    const act = (action) => async () => {
      box.hidden = true;
      if (!state.worker) return showErr('먼저 목록에서 내 이름을 누르세요');
      if (!/^\d{4}$/.test(pin.value)) return showErr('PIN 숫자 4자리를 입력하세요');
      const { data, error } = await sb.rpc('coop_clock', { p_qr: QR, p_worker: state.worker.id, p_pin: pin.value, p_action: action });
      pin.value = '';
      if (error || !data) return showErr('처리하지 못했습니다. 잠시 후 다시 시도하세요');
      if (!data.ok) return showErr(data.code === 'bad_pin' ? `PIN이 맞지 않습니다. ${data.remaining}번 더 틀리면 잠깁니다` : (CLOCK_ERR[data.code] || '처리하지 못했습니다'));
      done(data);
    };
    const inBtn = el('button', { class: 'btn big in', type: 'button' }, '출근');
    const outBtn = el('button', { class: 'btn big out', type: 'button' }, '퇴근');
    inBtn.addEventListener('click', busy(inBtn, act('in'))); outBtn.addEventListener('click', busy(outBtn, act('out')));
    drawList();
    mount(el('main', { class: 'wrap' },
      el('div', { class: 'cclock' }, el('small', {}, nowDate()), clockEl),
      state.place.name ? el('p', { class: 'place' }, state.place.name) : null,
      el('div', { class: 'card' },
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '1. 내 이름을 누르세요'), search), list,
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '2. PIN 4자리'), pin),
        box,
        el('div', { class: 'f' }, el('span', { class: 'hint' }, '3. 버튼을 누르세요'), el('div', { class: 'two' }, inBtn, outBtn))),
      el('button', { class: 'linkbtn', type: 'button', onclick: join }, '명단에 이름이 없나요? 가입 신청')));
  }

  function done(d) {
    const out = d.action === 'out';
    mount(el('main', { class: 'wrap center' },
      el('div', { class: 'okmark' + (out ? ' out' : ''), 'aria-hidden': 'true' }, '✓'),
      el('h2', { class: 'title' }, `${d.name}님`),
      el('p', { class: 'bigmsg' }, out ? '퇴근 처리되었습니다' : '출근 처리되었습니다'),
      el('p', { class: 'lead' }, `${hhmm(d.at)}`),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => { state.worker = null; state.filter = ''; main(); } }, '처음으로')));
  }

  function join() {
    const name = el('input', { type: 'text', maxlength: '20', autocomplete: 'name', 'aria-label': '이름' });
    const p1 = el('input', { type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', 'aria-label': 'PIN 4자리', class: 'pin' });
    const p2 = el('input', { type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', 'aria-label': 'PIN 확인', class: 'pin' });
    const box = el('div', { class: 'err', role: 'alert', hidden: true });
    const go = el('button', { class: 'btn', type: 'submit' }, '가입 신청');
    const form = el('form', { novalidate: true },
      el('label', { class: 'f' }, el('span', {}, '이름'), name),
      el('label', { class: 'f' }, el('span', {}, '사용할 PIN (숫자 4자리)'), p1),
      el('label', { class: 'f' }, el('span', {}, 'PIN 한 번 더'), p2),
      el('p', { class: 'hint' }, 'PIN은 출퇴근할 때마다 입력합니다. 잊지 않는 번호로 정하세요.'), box, go);
    form.addEventListener('submit', busy(go, async () => {
      box.hidden = true;
      const show = (m) => { box.textContent = m; box.hidden = false; };
      if (name.value.trim().length < 2) return show('이름을 입력하세요');
      if (!/^\d{4}$/.test(p1.value)) return show('PIN은 숫자 4자리로 입력하세요');
      if (p1.value !== p2.value) return show('PIN이 서로 다릅니다');
      const { data, error } = await sb.rpc('coop_request_join', { p_qr: QR, p_name: name.value.trim(), p_pin: p1.value });
      if (error || !data) return show('신청하지 못했습니다. 잠시 후 다시 시도하세요');
      if (!data.ok) return show(JOIN_ERR[data.code] || '신청하지 못했습니다');
      mount(el('main', { class: 'wrap center' }, el('div', { class: 'okmark', 'aria-hidden': 'true' }, '✓'),
        el('h2', { class: 'title' }, '신청되었습니다'), el('p', { class: 'lead' }, '관리자가 승인하면 출퇴근할 수 있습니다'),
        el('button', { class: 'btn ghost', type: 'button', onclick: start }, '처음으로')));
    }));
    mount(el('main', { class: 'wrap' }, el('h2', { class: 'title' }, '가입 신청'), state.place.name ? el('p', { class: 'place' }, state.place.name) : null, el('div', { class: 'card' }, form),
      el('button', { class: 'linkbtn', type: 'button', onclick: main }, '← 돌아가기')));
  }

  start();
})();
