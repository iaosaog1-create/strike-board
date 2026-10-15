/* 협정인력 출퇴근 화면 (로그인 없음): QR 스캔 → 이름 · 협정사 · 전화번호 뒤 6자리 → 출근 / 퇴근 (시각 + 이름 서명 기록) */
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
  const store = {
    get(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 저장 안 됨 */ } }
  };
  const state = { place: null, vendors: [], name: store.get('coop_name'), vendor: store.get('coop_vendor'), phone: '' };

  const CLOCK_ERR = {
    invalid_qr: 'QR 코드가 올바르지 않습니다. 관리자에게 문의하세요',
    bad_name: '이름을 2~20자로 입력하세요',
    bad_phone: '전화번호 뒤 6자리를 숫자로 입력하세요',
    need_vendor: '협정사를 선택하세요',
    bad_vendor: '협정사를 다시 선택하세요',
    already_in: '이미 출근 처리되었습니다 (같은 시간대에 한 번만 가능합니다)',
    already_out: '이미 퇴근 처리되었습니다',
    not_clocked_in: '출근 기록을 찾을 수 없습니다. 이름과 협정사, 전화번호가 출근할 때와 같은지 확인하세요',
    bad_action: '처리할 수 없습니다. 다시 시도하세요'
  };

  async function start() {
    mount(el('main', { class: 'wrap center' }, el('p', { class: 'lead' }, '불러오는 중…')));
    if (!QR) return fail('QR 코드로 접속해야 합니다');
    try {
      const { data, error } = await sb.rpc('coop_place_info', { p_qr: QR });
      if (error || !data || data.error) return fail('QR 코드가 올바르지 않습니다. 관리자에게 문의하세요');
      state.place = data;
      const v = await sb.rpc('coop_vendor_list');
      state.vendors = (v && v.data) || [];
    } catch (e) { return fail('연결할 수 없습니다. 잠시 후 다시 시도하세요'); }
    main();
  }
  function fail(msg) { mount(el('main', { class: 'wrap center' }, el('h2', { class: 'title' }, '이용할 수 없습니다'), el('div', { class: 'err' }, msg))); }

  function main() {
    const name = el('input', { type: 'text', maxlength: '20', autocomplete: 'name', placeholder: '예) 홍길동', 'aria-label': '이름', value: state.name });
    const vSel = el('select', { 'aria-label': '협정사' }, el('option', { value: '' }, '협정사를 선택하세요'),
      ...state.vendors.map((v) => el('option', { value: v.id }, v.name)));
    vSel.value = state.vendor;
    const phone = el('input', { type: 'text', inputmode: 'numeric', maxlength: '7', autocomplete: 'off', placeholder: '00-0000', 'aria-label': '전화번호 뒤 6자리', class: 'phone6' });
    phone.addEventListener('input', () => {
      const d = phone.value.replace(/\D/g, '').slice(0, 6);
      phone.value = d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
    });
    const box = el('div', { class: 'err', role: 'alert', hidden: true });
    const showErr = (m) => { box.textContent = m; box.hidden = false; };
    const act = (action) => async () => {
      box.hidden = true;
      const nm = name.value.trim(); const ph = phone.value.replace(/\D/g, '');
      if (nm.replace(/\s/g, '').length < 2) return showErr('이름을 입력하세요');
      if (state.vendors.length && !vSel.value) return showErr('협정사를 선택하세요');
      if (!/^\d{6}$/.test(ph)) return showErr('전화번호 뒤 6자리를 입력하세요');
      const { data, error } = await sb.rpc('coop_clock', { p_qr: QR, p_name: nm, p_phone: ph, p_vendor: vSel.value ? Number(vSel.value) : null, p_action: action });
      phone.value = '';
      if (error || !data) return showErr('처리하지 못했습니다. 잠시 후 다시 시도하세요');
      if (!data.ok) return showErr(CLOCK_ERR[data.code] || '처리하지 못했습니다');
      state.name = data.name || nm; state.vendor = vSel.value; store.set('coop_name', nm); store.set('coop_vendor', vSel.value);
      done(data);
    };
    const inBtn = el('button', { class: 'btn big in', type: 'button' }, '출근');
    const outBtn = el('button', { class: 'btn big out', type: 'button' }, '퇴근');
    inBtn.addEventListener('click', busy(inBtn, act('in'))); outBtn.addEventListener('click', busy(outBtn, act('out')));
    mount(el('main', { class: 'wrap' },
      el('div', { class: 'cclock' }, el('small', {}, nowDate()), clockEl),
      state.place.name ? el('p', { class: 'place' }, state.place.name) : null,
      el('div', { class: 'card' },
        el('label', { class: 'f' }, el('span', { class: 'hint' }, '1. 이름'), name),
        state.vendors.length ? el('label', { class: 'f' }, el('span', { class: 'hint' }, '2. 협정사'), vSel) : null,
        el('div', { class: 'f' }, el('span', { class: 'hint' }, `${state.vendors.length ? 3 : 2}. 전화번호 뒤 6자리`),
          el('div', { class: 'phonebox' }, el('span', { class: 'mask', 'aria-hidden': 'true' }, '***-**'), phone),
          el('small', { class: 'hint ex' }, '예) 010-1234-5678 이면 ***-**34-5678 → 345678 을 입력')),
        box,
        el('div', { class: 'f' }, el('span', { class: 'hint' }, `${state.vendors.length ? 4 : 3}. 버튼을 누르세요 (퇴근할 때도 같은 방법)`), el('div', { class: 'two' }, inBtn, outBtn)))));
  }

  function done(d) {
    const out = d.action === 'out';
    mount(el('main', { class: 'wrap center' },
      el('div', { class: 'okmark' + (out ? ' out' : ''), 'aria-hidden': 'true' }, '✓'),
      el('h2', { class: 'title' }, `${d.name}님`),
      el('p', { class: 'bigmsg' }, out ? '퇴근 처리되었습니다' : '출근 처리되었습니다'),
      el('p', { class: 'lead' }, `${d.session} · ${hhmm(d.at)}`),
      el('div', { class: 'signbox' }, el('small', {}, '서명'), el('b', {}, d.sign || d.name)),
      el('p', { class: 'hint' }, '총괄팀장이 확인하면 완료됩니다.'),
      el('button', { class: 'btn ghost', type: 'button', onclick: main }, '처음으로')));
  }

  start();
})();
