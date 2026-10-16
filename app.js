/* 비정상상황 앱 - 로그인 · 가입 · 비밀번호 변경 · 가입 승인 */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  const TEAMS = ['오전', '오후', '야간', '일근', '운영'];
  const PLAN_TEAMS = [...Array.from({ length: 12 }, (_, i) => `${i + 1}팀`), '행정'];   // 휴무계획의 팀
  const ROLE_LABEL = { master: '최고관리자', admin: '관리자', chief: '총괄팀장', leader: '팀장' };
  const TITLE_TO_ROLE = { '관리': 'admin', '팀장': 'leader', '총괄팀장': 'chief' };
  const ROLE_OPTIONS = [['leader', '팀장'], ['chief', '총괄팀장'], ['admin', '관리자']];
  const ROLE_DESC = {
    leader: '자기 사업부 · 자기 팀 인원만 입력',
    chief: '자기 사업부의 협정·지원 인원 배치, 사업부 현황 확인',
    admin: '전체 조회와 설정 (가입 승인은 불가)'
  };
  const STATUS_LABEL = { pending: '대기', approved: '승인', rejected: '반려' };
  const INITIAL_PW = '000000';
  const NONE = 'none';

  const root = document.getElementById('app');
  const state = { me: null, menu: 'home', tab: 'pending', members: [], counts: {}, selected: null, divisions: [], timers: [], setup: { tab: 'quota', div: null, shifts: [], quota: [], zones: [], tasks: [] } };

  /* ---------- 작은 도구 ---------- */
  // 화면에 그릴 때는 항상 textContent 로만 넣어서 입력값이 코드로 해석되지 않게 함
  /* replaceChildren 에 배열·빈 값을 넘겨도 안전하게 */
  const _rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...k) { return _rc.apply(this, k.flat(Infinity).filter((x) => x != null && x !== false)); };
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v; /* CSP 허용(CSSOM) */
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  function mount(...nodes) { root.replaceChildren(...nodes); window.scrollTo(0, 0); }
  function toast(msg, kind) {
    const t = el('div', { class: 'toast' + (kind === 'err' ? ' err' : ''), role: 'status', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), 3200);
  }
  function seg(options, value, onChange, tone) {
    const wrap = el('div', { class: 'seg', role: 'group' });
    const draw = () => wrap.replaceChildren(...options.map(([val, label]) =>
      el('button', {
        type: 'button', class: [val === value ? 'on' : '', tone ? tone(val) : ''].filter(Boolean).join(' '), 'aria-pressed': String(val === value),
        onclick: () => { value = val; draw(); onChange(val); }
      }, label)));
    draw();
    return wrap;
  }
  // 버튼 누르는 동안 중복 클릭 막기
  function busy(btn, fn) {
    return async (ev) => {
      ev && ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      try { await fn(); } finally { btn.disabled = false; }
    };
  }
  const emailOf = (empNo) => `${empNo.toLowerCase()}@${CFG.EMAIL_DOMAIN}`;
  /* 사업부 색: T1 녹색 · T2 파랑 · 부대 주황 (파스텔) */
  const divTone = (id) => { const n = (state.divisions.find((d) => String(d.id) === String(id)) || {}).name || ''; return n.startsWith('T1') ? 'dv-t1' : n.startsWith('T2') ? 'dv-t2' : n.includes('부대') ? 'dv-bd' : ''; };
  const divName = (id) => (state.divisions.find((d) => d.id === id) || {}).name || '';
  const shortDiv = (name) => (name || '').replace('환경미화사업부', '').replace('건물', '') || name || '';
  function errBox() { return el('div', { class: 'err', role: 'alert', hidden: true }); }
  function showErr(box, msg) { box.textContent = msg; box.hidden = false; }

  function topbar(right) {
    return el('header', { class: 'top' }, el('img', { class: 'lg', src: 'icon-192.png', alt: '' }),
      el('div', { class: 'tt' }, el('h1', {}, 'IAOS 비정상상황'), el('small', {}, '인천공항운영서비스')), el('div', { class: 'sp' }), right);
  }

  /* ---------- 로그인 ---------- */
  function loginView() {
    const empIn = el('input', { type: 'text', inputmode: 'text', autocomplete: 'username', autocapitalize: 'off', 'aria-label': '사번' });
    const pwIn = el('input', { type: 'password', autocomplete: 'current-password', 'aria-label': '비밀번호' });
    const box = errBox();
    const go = el('button', { class: 'btn', type: 'submit' }, '로그인');
    const form = el('form', { novalidate: true },
      el('label', { class: 'f' }, el('span', {}, '사번'), empIn),
      el('label', { class: 'f' }, el('span', {}, '비밀번호'), pwIn),
      box, go);
    form.addEventListener('submit', busy(go, async () => {
      box.hidden = true;
      const emp = empIn.value.trim();
      if (!/^[A-Za-z0-9]{2,20}$/.test(emp)) return showErr(box, '사번을 확인하세요 (영문·숫자)');
      if (!pwIn.value) return showErr(box, '비밀번호를 입력하세요');
      const { error } = await sb.auth.signInWithPassword({ email: emailOf(emp), password: pwIn.value });
      if (error) return showErr(box, loginMessage(error));
      await enter();
    }));
    mount(topbar(), el('main', { class: 'wrap' },
      el('h2', { class: 'title' }, '로그인'),
      el('p', { class: 'lead' }, '사번과 비밀번호를 입력하세요'),
      el('div', { class: 'card' }, form),
      el('p', { class: 'note' }, '계정이 없으신가요?'),
      el('button', { class: 'btn ghost', type: 'button', onclick: signupView }, '가입 신청'),
      el('p', { class: 'note' }, '가입 후 관리자 승인이 필요합니다')));
    empIn.focus();
  }
  function loginMessage(error) {
    const m = (error.message || '').toLowerCase();
    if (m.includes('invalid login')) return '사번 또는 비밀번호가 맞지 않습니다';
    if (m.includes('not confirmed')) return '이메일 확인 설정이 켜져 있습니다. 관리자에게 문의하세요';
    if (m.includes('rate') || error.status === 429) return '시도가 많습니다. 잠시 후 다시 시도하세요';
    return '로그인할 수 없습니다. 잠시 후 다시 시도하세요';
  }

  /* ---------- 가입 신청 ---------- */
  async function signupView() {
    const f = { div: '', emp: '', name: '', title: '팀장', team: '' };
    let divisions = [];
    try {
      const { data, error } = await sb.from('divisions').select('id,name,kind').order('sort');
      if (error) throw error;
      divisions = data || [];
    } catch (e) { /* 아래에서 안내 */ }

    const box = errBox();
    const divSel = el('select', { 'aria-label': '소속' });
    divSel.addEventListener('change', () => { f.div = divSel.value; });
    /* 팀장·총괄팀장은 사업부만, 관리는 모든 소속 + 소속 없음 */
    const drawDivs = () => {
      const all = f.title === '관리';
      const list = all ? divisions : divisions.filter((d) => d.kind === '사업부');
      if (!list.some((d) => String(d.id) === f.div) && f.div !== NONE) f.div = '';
      divSel.replaceChildren(el('option', { value: '' }, '선택하세요'),
        ...list.map((d) => el('option', { value: d.id }, d.name)),
        ...(all ? [el('option', { value: NONE }, '소속 없음')] : []));
      divSel.value = f.div;
    };
    const empIn = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', 'aria-label': '사번' });
    const nameIn = el('input', { type: 'text', autocomplete: 'name', maxlength: '20', 'aria-label': '이름' });
    const teamField = el('label', { class: 'f' });
    const drawTeam = () => {
      teamField.hidden = f.title !== '팀장';
      teamField.replaceChildren(el('span', {}, '소속 팀'),
        seg(PLAN_TEAMS.map((t) => [t, t]), f.team, (v) => { f.team = v; }));
    };
    const titleSeg = seg([['관리', '관리'], ['팀장', '팀장'], ['총괄팀장', '총괄팀장']], f.title, (v) => {
      f.title = v; if (v !== '팀장') f.team = ''; drawTeam(); drawDivs();
    });
    drawTeam(); drawDivs();
    const go = el('button', { class: 'btn', type: 'submit' }, '가입 신청');
    const form = el('form', { novalidate: true },
      el('div', { class: 'f' }, el('span', { class: 'hint' }, '직책'), titleSeg),
      el('label', { class: 'f' }, el('span', {}, '소속'), divSel),
      teamField,
      el('label', { class: 'f' }, el('span', {}, '사번'), empIn),
      el('label', { class: 'f' }, el('span', {}, '이름'), nameIn),
      el('p', { class: 'hint' }, `초기 비밀번호 ${INITIAL_PW} · 첫 로그인 때 변경`),
      box, go);
    form.addEventListener('submit', busy(go, async () => {
      box.hidden = true;
      f.emp = empIn.value.trim(); f.name = nameIn.value.trim();
      if (!f.div) return showErr(box, '소속을 선택하세요');
      if (!/^[A-Za-z0-9]{2,20}$/.test(f.emp)) return showErr(box, '사번을 확인하세요 (영문·숫자)');
      if (f.name.length < 2) return showErr(box, '이름을 입력하세요');
      if (f.title === '팀장' && !f.team) return showErr(box, '팀장은 소속 팀을 선택하세요');
      const { error } = await sb.auth.signUp({
        email: emailOf(f.emp), password: INITIAL_PW,
        options: { data: { emp_no: f.emp, name: f.name, division_id: f.div === NONE ? null : Number(f.div), req_title: f.title, plan_team: f.team || null } }
      });
      if (error) return showErr(box, signupMessage(error));
      await sb.auth.signOut().catch(() => {});
      waitView({ division: f.div === NONE ? '소속 없음' : divName2(divisions, f.div), emp: f.emp, name: f.name, title: f.title, team: f.team });
    }));
    mount(topbar(el('button', { class: 'btn-out', type: 'button', onclick: loginView }, '로그인으로')),
      el('main', { class: 'wrap' },
        el('h2', { class: 'title' }, '가입 신청'),
        divisions.length ? null : el('div', { class: 'err' }, '소속 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요'),
        el('div', { class: 'card' }, form),
        el('p', { class: 'note' }, '관리자 승인 후 사용할 수 있습니다')));
  }
  const divName2 = (list, id) => (list.find((d) => String(d.id) === String(id)) || {}).name || '';
  function signupMessage(error) {
    const m = (error.message || '').toLowerCase();
    if (m.includes('already')) return '이미 가입된 사번입니다. 로그인하거나 관리자에게 문의하세요';
    if (m.includes('database error')) return '가입 정보를 확인하세요 (소속·직책·팀)';
    if (m.includes('invalid') && m.includes('email')) return '계정 형식 오류입니다. 관리자에게 문의하세요 (config.js 의 EMAIL_DOMAIN)';
    if (m.includes('rate') || error.status === 429) return '시도가 많습니다. 잠시 후 다시 시도하세요';
    return '가입할 수 없습니다. 잠시 후 다시 시도하세요';
  }

  /* ---------- 승인 대기 안내 ---------- */
  function waitView(s, rejected) {
    mount(topbar(), el('main', { class: 'wrap center' },
      rejected ? null : el('div', { class: 'clock', 'aria-hidden': 'true' }, el('i')),
      el('h2', { class: 'title' }, rejected ? '가입이 반려되었습니다' : '승인을 기다리는 중입니다'),
      el('p', { class: 'lead' }, rejected ? '관리자에게 문의하세요' : '승인되면 로그인할 수 있습니다'),
      el('div', { class: 'card' }, el('div', { class: 'rows' },
        row('소속', s.division), row('사번', s.emp), row('이름', s.name),
        row('직책', s.title), s.team ? row('소속 팀', s.team) : null)),
      el('p', { class: 'note' }, '최종 권한은 관리자가 승인할 때 정해집니다'),
      el('button', { class: 'btn ghost', type: 'button', onclick: logoutThenLogin }, '처음 화면으로')));
  }
  const row = (k, v) => el('div', {}, el('span', {}, k), el('b', {}, v || '-'));

  /* ---------- 첫 로그인 비밀번호 변경 ---------- */
  function pwView() {
    const p1 = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '새 비밀번호' });
    const p2 = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '새 비밀번호 확인' });
    const box = errBox();
    const go = el('button', { class: 'btn', type: 'submit' }, '변경하고 시작');
    const form = el('form', { novalidate: true },
      el('div', { class: 'info' }, el('b', {}, '첫 로그인입니다'), '새 비밀번호로 바꿔야 사용할 수 있습니다'),
      el('label', { class: 'f' }, el('span', {}, '새 비밀번호'), p1),
      el('label', { class: 'f' }, el('span', {}, '새 비밀번호 확인'), p2),
      el('p', { class: 'hint' }, '· 6자 이상', el('br'), `· ${INITIAL_PW} 은 사용할 수 없음`),
      box, go);
    form.addEventListener('submit', busy(go, async () => {
      box.hidden = true;
      if (p1.value.length < 6) return showErr(box, '비밀번호는 6자 이상이어야 합니다');
      if (p1.value === INITIAL_PW) return showErr(box, `${INITIAL_PW} 은 사용할 수 없습니다`);
      if (p1.value !== p2.value) return showErr(box, '두 비밀번호가 서로 다릅니다');
      const up = await sb.auth.updateUser({ password: p1.value });
      if (up.error) return showErr(box, '비밀번호를 바꿀 수 없습니다. 다른 비밀번호로 시도하세요');
      const done = await sb.rpc('complete_password_change');
      if (done.error) return showErr(box, '처리 중 오류가 발생했습니다. 다시 시도하세요');
      await enter();
    }));
    mount(topbar(el('button', { class: 'btn-out', type: 'button', onclick: logoutThenLogin }, '로그아웃')),
      el('main', { class: 'wrap' }, el('h2', { class: 'title' }, '비밀번호 변경'), el('div', { class: 'card' }, form)));
  }

  /* ---------- 로그인 후 공통 화면 ---------- */
  async function loadDivisions() {
    const { data } = await sb.from('divisions').select('id,name,kind').order('sort');
    state.divisions = data || [];
  }
  /* 화면 등록: 각 기능 파일이 register() 로 자기 화면을 추가합니다 */
  const SCREENS = [];
  const MENU_ORDER = ['home', 'check', 'place', 'att', 'incident', 'status', 'setup', 'coop', 'leave', 'report', 'approve'];
  const ALL_ROLES = ['leader', 'chief', 'admin', 'master'];
  function register(key, label, roles, render, desc) { SCREENS.push({ key, label, roles, render, desc }); }
  const stopTimers = () => { (state.timers || []).forEach(clearInterval); state.timers = []; };

  function mainView() {
    stopTimers();
    const me = state.me;
    const menus = SCREENS.filter((s) => s.roles.includes(me.role) && !(s.key === 'status' && s.roles.includes(me.role)))
      .sort((a, b) => MENU_ORDER.indexOf(a.key) - MENU_ORDER.indexOf(b.key));
    if (me.role === 'leader') { menus.length = 0; menus.push(SCREENS.find((s) => s.key === 'check')); menus.push(SCREENS.find((s) => s.key === 'incident')); if (state.menu !== 'incident') state.menu = 'check'; }   // 팀장은 내 팀 화면 하나만
    if (!menus.some((s) => s.key === state.menu)) state.menu = 'home';
    if (state.menu === 'status') state.menu = 'home';
    const ICONS = {
      home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
      check: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 14l2 2 4-4"/>',
      input: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
      place: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
      att: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14c3 0 5 2 5 5"/>',
      setup: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
      coop: '<circle cx="10" cy="8" r="3.2"/><path d="M4 20c0-3.6 2.7-6 6-6"/><path d="M14 17l2.5 2.5L21 14"/>',
      leave: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
      report: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
      incident: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18v.5"/>',
      approve: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'
    };
    const icon = (k) => { const sp = el('span', { class: 'ic', 'aria-hidden': 'true' }); sp.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.home}</svg>`; return sp; };
    const nav = el('nav', { class: 'menu' + (menus.length < 2 ? ' solo' : ''), 'aria-label': '메뉴', 'data-n': String(menus.length) }, ...menus.map((s) =>
      el('button', { type: 'button', class: state.menu === s.key ? 'on' : '', onclick: () => { state.menu = s.key; mainView(); } },
        icon(s.key), el('span', { class: 'lb' }, s.label), s.key === 'approve' && state.counts.pending ? el('span', { class: 'cnt' }, state.counts.pending) : null)));
    const who = el('div', { class: 'who' }, el('b', {}, me.name), [ROLE_LABEL[me.role], shortDiv(divName(me.division_id)), me.plan_team || ''].filter(Boolean).join(' · '));
    const body = el('div', {});
    mount(topbar(el('div', { class: 'top-right', style: null }, who)), el('main', { class: 'shell' }, nav, body));
    root.querySelector('.top').append(el('button', { class: 'btn-out', type: 'button', onclick: logoutThenLogin }, '로그아웃'));
    const cur = menus.find((s) => s.key === state.menu);
    Promise.resolve(cur.render(body)).catch((e) => {
      console.error(e);
      body.replaceChildren(el('p', { class: 'empty' }, '화면을 불러오지 못했습니다. 새로고침 해 주세요'));
    });
  }
  function homeView(body) {
    const me = state.me;
    const st = SCREENS.find((s) => s.key === 'status');
    if (st && st.roles.includes(me.role)) return st.render(body);   // 로그인하면 현황이 첫 화면
    const mine = SCREENS.filter((s) => s.key !== 'home' && s.roles.includes(me.role) && s.desc)
      .sort((a, b) => MENU_ORDER.indexOf(a.key) - MENU_ORDER.indexOf(b.key));
    body.append(el('div', { class: 'card' },
      el('h2', {}, `${me.name}님, 안녕하세요`),
      el('p', { class: 'hint' }, '아래에서 사용할 기능을 선택하세요.'),
      el('div', { class: 'tiles' }, ...mine.map((s) =>
        el('button', { type: 'button', class: 'tile', onclick: () => { state.menu = s.key; mainView(); } },
          el('b', {}, s.label), el('span', {}, s.desc))))));
  }

  /* ---------- 가입 승인 (최고관리자 전용) ---------- */
  async function refreshApprovals() {
    const sel = 'id,emp_no,name,division_id,role,status,req_title,team,plan_team,created_at';
    const [list, p, a, r] = await Promise.all([
      sb.from('profiles').select(sel).eq('status', state.tab).neq('role', 'master').order('created_at', { ascending: true }),
      ...['pending', 'approved', 'rejected'].map((s) => sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', s).neq('role', 'master'))
    ]);
    if (list.error) { toast('목록을 불러오지 못했습니다', 'err'); return; }
    state.members = list.data || [];
    state.counts = { pending: p.count || 0, approved: a.count || 0, rejected: r.count || 0 };
  }
  async function approveView(body) {
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    await refreshApprovals();
    drawApprove(body);
  }
  function drawApprove(body) {
    const tabs = el('div', { class: 'seg' }, ...['pending', 'approved', 'rejected'].map((s) =>
      el('button', {
        type: 'button', class: state.tab === s ? 'on' : '',
        onclick: async () => { state.tab = s; state.selected = null; await approveView(body); }
      }, `${STATUS_LABEL[s]} ${state.counts[s] || 0}`)));
    const list = el('div', {}, ...(state.members.length ? state.members.map((m) =>
      el('button', {
        type: 'button', class: 'list-item' + (state.selected && state.selected.id === m.id ? ' sel' : ''),
        onclick: () => { state.selected = m; drawApprove(body); }
      },
        el('b', {}, `${m.name} `, el('small', {}, m.emp_no)),
        el('span', { class: 'badge ' + (m.status === 'pending' ? 'wait' : m.status === 'approved' ? 'ok' : 'no') }, STATUS_LABEL[m.status]),
        el('small', {}, [shortDiv(divName(m.division_id)) || '소속 없음', m.status === 'approved' ? ROLE_LABEL[m.role] : m.req_title, m.plan_team || (m.team ? m.team + '팀' : '')].join(' · ')),
        el('span', {}))) : [el('p', { class: 'empty' }, '해당하는 가입자가 없습니다')]));
    body.replaceChildren(el('div', { class: 'split' }, el('div', {}, tabs, list), detailPanel(body)));
  }
  function detailPanel(body) {
    const m = state.selected;
    const wrap = el('div', { class: 'detail-wrap' + (m ? ' open' : '') });
    if (!m) { wrap.append(el('div', { class: 'card empty' }, '왼쪽에서 가입자를 선택하세요')); return wrap; }
    const TITLES = [['관리', '관리'], ['팀장', '팀장'], ['총괄팀장', '총괄팀장']];
    const pick = { div: m.division_id, title: ['관리', '팀장', '총괄팀장'].includes(m.req_title) ? m.req_title : '팀장', role: null, team: m.plan_team || '' };
    const isBiz = () => (state.divisions.find((d) => d.id === pick.div) || {}).kind === '사업부';
    pick.role = isBiz() ? (m.status === 'approved' ? m.role : (TITLE_TO_ROLE[m.req_title] || 'leader')) : 'admin';
    const card = el('div', { class: 'card' });
    let delBtn = null; let uv = null;   // uv: 노조현황 열람 허용자 id 목록 (20 SQL 실행 전에는 null)
    const ok = el('button', { class: 'btn', type: 'button' }, m.status === 'approved' ? '변경 저장' : '승인');
    const no = el('button', { class: 'btn danger', type: 'button' }, '반려');
    const draw = () => {
      const inBiz = isBiz();
      if (!inBiz) pick.role = 'admin';
      const roleOpts = inBiz ? ROLE_OPTIONS : ROLE_OPTIONS.filter(([k]) => k === 'admin');
      const desc = el('div', { class: 'info' }, el('b', {}, ROLE_LABEL[pick.role] + ' 권한'), ROLE_DESC[pick.role]);
      const divSel = el('select', { 'aria-label': '소속' }, ...state.divisions.map((d) => el('option', { value: d.id }, d.name)), el('option', { value: '' }, '소속 없음'));
      divSel.value = pick.div == null ? '' : String(pick.div);
      divSel.addEventListener('change', () => { pick.div = divSel.value === '' ? null : Number(divSel.value); draw(); });
      card.replaceChildren(
        el('div', { class: 'rows' }, row('이름', `${m.name} (${m.emp_no})`),
          row('신청 소속', divName(m.division_id) || '소속 없음'), row('신청 직책', m.req_title), row('신청 팀', m.plan_team || (m.team ? m.team + '팀' : '-')),
          row('현재 상태', STATUS_LABEL[m.status] + (m.status === 'approved' ? ' · ' + ROLE_LABEL[m.role] : ''))),
        el('div', { class: 'f' }, el('p', { class: 'hint' }, '소속 (master 수정)'), divSel),
        el('div', { class: 'f' }, el('p', { class: 'hint' }, '직책 (master 수정)'),
          seg(TITLES, pick.title, (v) => { pick.title = v; pick.role = isBiz() ? (TITLE_TO_ROLE[v] || 'leader') : 'admin'; draw(); })),
        el('div', { class: 'f' }, el('p', { class: 'hint' }, '최종 권한'), seg(roleOpts, pick.role, (v) => { pick.role = v; draw(); })),
        inBiz ? null : el('p', { class: 'hint' }, '사업부 소속이 아니어서 관리자 권한만 줄 수 있습니다'),
        el('div', { class: 'f' }, el('span', { class: 'hint' }, pick.role === 'leader' ? '소속 팀 (필수 · 행정 포함)' : '소속 팀 (선택 · 행정 포함)'),
          seg([...(pick.role === 'leader' ? [] : [['', '없음']]), ...PLAN_TEAMS.map((t) => [t, t])], pick.team, (v) => { pick.team = v; draw(); })),
        pick.team === '행정' ? el('p', { class: 'hint' }, '행정 팀 출근 인원은 현황 총계에서 "지원"으로 집계됩니다') : null,
        (uv && m.status === 'approved' && m.role !== 'master') ? el('div', { class: 'f' }, el('p', { class: 'hint' }, '노조현황 열람 (즉시 적용)'),
          seg([['0', '차단'], ['1', '허용']], uv.has(m.id) ? '1' : '0', async (v) => {
            const { error } = await sb.rpc('set_union_viewer', { p_user: m.id, p_on: v === '1' });
            if (error) return toast('변경하지 못했습니다: ' + (error.message || ''), 'err');
            if (v === '1') uv.add(m.id); else uv.delete(m.id);
            toast(v === '1' ? `${m.name}님의 노조현황 열람을 허용했습니다` : `${m.name}님의 노조현황 열람을 차단했습니다`); draw();
          })) : null,
        desc, el('div', { class: 'actions' }, ok, no), delBtn ? el('div', { class: 'actions' }, delBtn) : null);
    };
    draw();
    sb.rpc('union_viewer_ids').then((r) => { if (!r.error && Array.isArray(r.data)) { uv = new Set(r.data); draw(); } }, () => {});
    const run = (approve) => async () => {
      if (approve && pick.role === 'leader' && !pick.team) return toast('팀장은 소속 팀을 선택하세요', 'err');
      const { error } = await sb.rpc('review_member', { p_user: m.id, p_approve: approve, p_role: pick.role, p_team: null, p_plan_team: pick.role === 'leader' ? pick.team || null : (pick.team || null), p_division: pick.div, p_title: pick.title });
      if (error) return toast('처리하지 못했습니다: ' + (error.message || '권한을 확인하세요'), 'err');
      toast(approve ? `${m.name}님을 ${ROLE_LABEL[pick.role]}(으)로 승인했습니다` : `${m.name}님을 반려했습니다`);
      state.selected = null;
      await approveView(body);
    };
    ok.addEventListener('click', busy(ok, run(true)));
    no.addEventListener('click', busy(no, run(false)));
    const del = el('button', { class: 'btn danger ghost', type: 'button' }, '계정 삭제');
    if (m.role === 'master') del.hidden = true;
    del.addEventListener('click', busy(del, async () => {
      if (!window.confirm(`${m.name}(${m.emp_no}) 계정을 완전히 삭제합니다.\n삭제하면 되돌릴 수 없습니다. 계속할까요?`)) return;
      const { error } = await sb.rpc('delete_member', { p_user: m.id });
      if (error) return toast('삭제하지 못했습니다: ' + (error.message || '권한을 확인하세요'), 'err');
      toast(`${m.name}님 계정을 삭제했습니다`);
      state.selected = null;
      await approveView(body);
    }));
    delBtn = del; draw();
    wrap.append(el('button', { class: 'back', type: 'button', onclick: () => { state.selected = null; drawApprove(body); } }, '← 목록으로'), card);
    return wrap;
  }

  /* ---------- 구역·정원 설정 (최고관리자·관리자) ---------- */
  const SIDES = [['L/S', 'L/S'], ['A/S', 'A/S'], ['기타', '기타']];
  const AREAS = [['전체', '전체'], ['동편', '동편'], ['서편', '서편']];
  const SET_TABS = [['quota', '정원'], ['zones', '구역'], ['tasks', '업무 종류'], ['auto', '자동 출근']];
  const numIn = (v, label) => el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label, value: v == null ? '' : String(v) });
  const toInt = (t) => { const x = String(t).trim(); if (x === '') return null; return /^\d{1,5}$/.test(x) ? Number(x) : NaN; };
  const bizDivs = () => state.divisions.filter((d) => d.kind === '사업부');

  async function setupView(body) {
    body.replaceChildren(el('p', { class: 'empty' }, '불러오는 중…'));
    const todayKst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const [sh, qu, zo, tk, tsr, lt, rt] = await Promise.all([
      sb.from('shift_defs').select('code,sort').order('sort'),
      sb.from('staffing_quota').select('division_id,shift,daily_quota,full_quota'),
      sb.from('zones').select('id,division_id,side,floor,area,team,label,task,required,sort,active').order('sort'),
      sb.from('task_types').select('name,sort,active').order('sort'),
      sb.from('team_shift').select('division_id,team').then((r) => (r.error ? { data: [] } : r), () => ({ data: [] })),
      sb.rpc('leave_team', { p_date: todayKst }).then((r) => (r.error ? { data: [] } : r), () => ({ data: [] })),
      sb.from('settings').select('key,value').eq('key', 'daily_ratio').then((r) => (r.error ? { data: [] } : r), () => ({ data: [] }))
    ]);
    if (sh.error || qu.error || zo.error || tk.error) {
      body.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 새로고침 해 주세요'));
      return;
    }
    const rosterBy = {};
    for (const r of (lt.data || [])) { if (/^행정/.test(String(r.team || '').trim())) continue; const k = `${r.division_id}|${r.shift}`; rosterBy[k] = (rosterBy[k] || 0) + (r.roster || 0); }
    const pctV = rt.data && rt.data[0] && rt.data[0].value && Number(rt.data[0].value.pct) > 0 ? Number(rt.data[0].value.pct) : 65;
    Object.assign(state.setup, { shifts: sh.data || [], quota: qu.data || [], zones: zo.data || [], tasks: tk.data || [], teams: tsr.data || [], rosterBy, pct: pctV });
    if (!state.setup.div) state.setup.div = (bizDivs()[0] || {}).id || null;
    drawSetup(body);
  }
  function drawSetup(body) {
    const S = state.setup;
    const tabList = SET_TABS.filter((t) => t[0] !== 'auto' || (state.me && state.me.role === 'master'));
    if (!tabList.some((t) => t[0] === S.tab)) S.tab = 'quota';
    const tabs = seg(tabList, S.tab, (v) => { S.tab = v; drawSetup(body); });
    const pane = S.tab === 'quota' ? quotaPane(body) : S.tab === 'zones' ? zonesPane(body) : S.tab === 'auto' ? autoPane(body) : tasksPane(body);
    body.replaceChildren(tabs, pane);
  }

  function quotaPane(body) {
    const S = state.setup, inputs = {}, rosterBy = S.rosterBy || {};
    const pctIn = numIn(S.pct || 65, '일일근무 정원 비율(%)');
    const pctOf = () => { const p = toInt(pctIn.value); return p && p >= 1 && p <= 100 ? p : 65; };
    const autoDaily = (full) => Math.round((full * pctOf()) / 100);
    const cards = bizDivs().map((d) => {
      const sumA = el('b', {}), sumB = el('b', {});
      const rows = S.shifts.map((s) => {
        const q = S.quota.find((x) => x.division_id === d.id && x.shift === s.code);
        const ros = rosterBy[`${d.id}|${s.code}`] || 0;
        const fullV = q ? q.full_quota : (ros || '');
        const dailyV = q ? q.daily_quota : (ros ? autoDaily(ros) : '');
        const a = numIn(dailyV, `${d.name} ${s.code} 일일근무정원`);
        const b = numIn(fullV, `${d.name} ${s.code} 상근 정원`);
        inputs[`${d.id}|${s.code}`] = [a, b, !!q];
        return { s, a, b, ros };
      });
      const calc = () => {
        sumA.textContent = String(rows.reduce((t, r) => t + (toInt(r.a.value) || 0), 0));
        sumB.textContent = String(rows.reduce((t, r) => t + (toInt(r.b.value) || 0), 0));
      };
      rows.forEach((r) => { r.a.addEventListener('input', calc); r.b.addEventListener('input', calc); });
      calc();
      d._rows = rows; d._calc = calc;
      return el('div', { class: 'card qcard' },
        el('h2', {}, d.name),
        el('div', { class: 'qrow hd' }, el('span', {}, '근무조'), el('span', {}, '일일근무정원'), el('span', {}, '상근 정원')),
        rows.map((r) => el('div', { class: 'qrow' }, el('b', {}, r.s.code, r.ros ? el('small', { class: 'qros' }, ` 휴무계획 ${r.ros}명`) : null), r.a, r.b)),
        el('div', { class: 'qrow sum' }, el('b', {}, '합계'), sumA, sumB));
    });
    const fill = el('button', { class: 'btn ghost sm', type: 'button' }, '휴무계획 인원으로 자동 채우기');
    fill.addEventListener('click', () => {
      for (const d of bizDivs()) { for (const r of d._rows || []) { if (r.ros) { r.b.value = String(r.ros); r.a.value = String(autoDaily(r.ros)); } } d._calc && d._calc(); }
      toast('휴무계획 인원으로 채웠습니다. 저장해야 반영됩니다');
    });
    const go = el('button', { class: 'btn', type: 'button' }, '정원 저장');
    go.addEventListener('click', busy(go, async () => {
      const rows = [];
      for (const [k, [a, b, had]] of Object.entries(inputs)) {
        const x = toInt(a.value), y = toInt(b.value);
        if (Number.isNaN(x) || Number.isNaN(y)) return toast('정원은 숫자만 입력하세요', 'err');
        if (x == null && y == null && !had) continue;
        const [div, shift] = k.split('|');
        rows.push({ division_id: Number(div), shift, daily_quota: x || 0, full_quota: y || 0, updated_by: state.me.id, updated_at: new Date().toISOString() });
      }
      if (!rows.length) return toast('입력된 정원이 없습니다', 'err');
      const { error } = await sb.from('staffing_quota').upsert(rows, { onConflict: 'division_id,shift' });
      if (error) return toast('저장하지 못했습니다. 권한을 확인하세요', 'err');
      await sb.from('settings').upsert({ key: 'daily_ratio', value: { pct: pctOf() }, note: '일일근무 정원 비율(%)' }, { onConflict: 'key' });
      toast('정원을 저장했습니다. 현황 "집계 기준 변경"에서 정원 기준을 고르면 반영됩니다');
      await setupView(body);
    }));
    return el('div', {},
      el('p', { class: 'hint pad' }, '상근 정원 = 휴무계획 인원(행정 제외), 일일근무 정원 = 상근 정원 × 아래 비율로 자동 채웁니다. 숫자를 직접 고치면 그 값이 저장됩니다. 해당 없는 근무조는 비워 두세요.'),
      el('div', { class: 'card qratio' }, el('label', { class: 'f' }, el('span', {}, '일일근무 정원 비율 (%)'), pctIn), fill),
      cards, go,
      el('div', { class: 'card qwhere' }, el('h2', {}, '저장하면 바뀌는 곳'),
        el('ul', { class: 'qlist' },
          el('li', {}, '현황 화면 "집계 기준 변경"에서 "일일근무정원" 또는 "상근정원"을 고르면, 정원·투입 비율·결근·"일일정원 / 상근 대비"가 여기서 저장한 정원으로 계산됩니다'),
          el('li', {}, '지금 기본값은 "사업부 전체 인원"(휴무계획 명단)이라, 기준을 바꾸기 전에는 저장해도 현황 숫자가 그대로입니다'),
          el('li', {}, '시각별 저장·보고서: 저장 이후에 만든 보고서부터 반영됩니다 (이전 보고서는 그대로)'),
          el('li', {}, '구역별 부족·충족(필요 인원)과 노조현황은 바뀌지 않습니다'))));
  }

  function zonesPane(body) {
    const S = state.setup;
    const divSel = el('select', { 'aria-label': '사업부' }, ...bizDivs().map((d) => el('option', { value: d.id }, d.name)));
    divSel.value = String(S.div);
    divSel.addEventListener('change', () => { S.div = Number(divSel.value); drawSetup(body); });

    const f = S.zf || (S.zf = { side: 'L/S', area: '전체', kind: 'floor' });
    const divTeams = [...new Set(S.teams.filter((x) => x.division_id === S.div && /^\d{1,2}팀$/.test(x.team)).map((x) => x.team))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    const teamSel = el('select', { 'aria-label': '담당 팀' }, el('option', { value: '' }, '공통 (모든 팀에 보임)'), ...divTeams.map((t) => el('option', { value: t }, t)));
    teamSel.value = S.zteamNew || '';
    teamSel.addEventListener('change', () => { S.zteamNew = teamSel.value; });
    const taskSel = el('select', { 'aria-label': '업무' }, ...S.tasks.filter((t) => t.active).map((t) => el('option', { value: t.name }, t.name)));
    const floorIn = el('input', { type: 'text', maxlength: '10', autocomplete: 'off', placeholder: f.kind === 'work' ? '예: 카페트, 석재, 집하장, 고소유리세척' : '예: 3층, B1', 'aria-label': f.kind === 'work' ? '업무 이름' : '층' });
    const labelIn = el('input', { type: 'text', maxlength: '30', autocomplete: 'off', placeholder: '예: 탑승동 (없으면 비움)', 'aria-label': '구역 이름' });
    const reqIn = numIn('', '필요 인원');
    const add = el('button', { class: 'btn', type: 'button' }, '구역 추가');
    add.addEventListener('click', busy(add, async () => {
      const floor = floorIn.value.trim(), req = toInt(reqIn.value);
      if (!floor) return toast(f.kind === 'work' ? '업무 이름을 입력하세요' : '층을 입력하세요', 'err');
      if (!taskSel.value) return toast('업무 종류를 먼저 등록하세요', 'err');
      if (Number.isNaN(req)) return toast('필요 인원은 숫자만 입력하세요', 'err');
      const { error } = await sb.from('zones').insert({
        division_id: S.div, side: f.side, floor, area: f.kind === 'work' ? '전체' : f.area, task: taskSel.value, team: teamSel.value || null,
        label: labelIn.value.trim() || null, required: req || 0, sort: 0
      });
      if (error) return toast(error.code === '23505' ? '같은 구역이 이미 있습니다' : '추가하지 못했습니다. 권한을 확인하세요', 'err');
      toast('구역을 추가했습니다');
      await setupView(body);
    }));
    const form = el('div', { class: 'card' },
      el('h2', {}, '구역 추가'),
      el('div', { class: 'f' }, el('span', { class: 'hint' }, '구역 종류'), seg([['floor', '층별'], ['work', '업무별 (화장실·수거·기타 등)']], f.kind, (v) => { f.kind = v; drawSetup(body); })),
      el('label', { class: 'f' }, el('span', {}, '담당 팀'), teamSel),
      el('div', { class: 'f' }, el('span', { class: 'hint' }, '구분'), seg(SIDES, f.side, (v) => { f.side = v; })),
      el('label', { class: 'f' }, el('span', {}, f.kind === 'work' ? '업무 이름 (기타는 직접 작성)' : '층'), floorIn),
      f.kind === 'work' ? null : el('div', { class: 'f' }, el('span', { class: 'hint' }, '동편 / 서편'), seg(AREAS, f.area, (v) => { f.area = v; })),
      el('label', { class: 'f' }, el('span', {}, '업무'), taskSel),
      el('label', { class: 'f' }, el('span', {}, '구역 이름 (선택)'), labelIn),
      el('label', { class: 'f' }, el('span', {}, '필요 인원'), reqIn),
      add);

    const tf = S.zteam || '';
    const teamBar = el('div', { class: 'f' }, el('span', { class: 'hint' }, '팀별 보기'), seg([['', '전체'], ...divTeams.map((t) => [t, t])], tf, (v) => { S.zteam = v; drawSetup(body); }));
    const zs = S.zones.filter((z) => z.division_id === S.div && (!tf || z.team === tf))
      .sort((a, b) => String(a.team || '').localeCompare(String(b.team || ''), 'ko', { numeric: true }) || SIDES.findIndex(([k]) => k === a.side) - SIDES.findIndex(([k]) => k === b.side)
        || a.floor.localeCompare(b.floor, 'ko', { numeric: true }) || a.area.localeCompare(b.area, 'ko') || a.task.localeCompare(b.task, 'ko'));
    const total = zs.filter((z) => z.active).reduce((t, z) => t + z.required, 0);
    const rows = zs.map((z) => {
      const rq = numIn(z.required, '필요 인원');
      const zt = el('select', { 'aria-label': '담당 팀' }, el('option', { value: '' }, '공통'), ...divTeams.map((t) => el('option', { value: t }, t))); zt.value = z.team || '';
      const save = el('button', { class: 'btn ghost sm', type: 'button' }, '저장');
      const tog = el('button', { class: 'btn ghost sm', type: 'button' }, z.active ? '사용 중지' : '다시 사용');
      save.addEventListener('click', busy(save, async () => {
        const v = toInt(rq.value);
        if (v == null || Number.isNaN(v)) return toast('필요 인원은 숫자만 입력하세요', 'err');
        const { error } = await sb.from('zones').update({ required: v, team: zt.value || null }).eq('id', z.id);
        if (error) return toast('저장하지 못했습니다', 'err');
        toast('저장했습니다'); await setupView(body);
      }));
      tog.addEventListener('click', busy(tog, async () => {
        const { error } = await sb.from('zones').update({ active: !z.active }).eq('id', z.id);
        if (error) return toast('처리하지 못했습니다', 'err');
        await setupView(body);
      }));
      return el('div', { class: 'zrow' + (z.active ? '' : ' off') },
        el('div', {}, el('b', {}, `${z.team ? z.team + ' · ' : ''}${z.side} · ${z.floor} · ${z.area} · ${z.task}`), z.label ? el('small', {}, z.label) : null, z.active ? null : el('small', {}, '사용 중지됨')),
        el('div', { class: 'zact' }, zt, rq, el('span', {}, '명'), save, tog));
    });
    const list = el('div', { class: 'card' },
      el('h2', {}, `등록된 구역 ${zs.length}개`, el('small', { class: 'sumtxt' }, `필요 인원 합계 ${total}명`)),
      rows.length ? rows : el('p', { class: 'empty' }, '아직 등록된 구역이 없습니다. 위에서 추가하세요'));
    return el('div', {}, el('div', { class: 'f top0' }, el('span', { class: 'hint' }, '사업부'), divSel), form, el('div', { class: 'card' }, teamBar), list);
  }

  function tasksPane(body) {
    const S = state.setup;
    const nameIn = el('input', { type: 'text', maxlength: '20', autocomplete: 'off', placeholder: '예: 특수업무', 'aria-label': '업무 이름' });
    const add = el('button', { class: 'btn', type: 'button' }, '업무 추가');
    add.addEventListener('click', busy(add, async () => {
      const name = nameIn.value.trim();
      if (!name) return toast('업무 이름을 입력하세요', 'err');
      const { error } = await sb.from('task_types').insert({ name, sort: S.tasks.reduce((m, t) => Math.max(m, t.sort), 0) + 1 });
      if (error) return toast(error.code === '23505' ? '이미 있는 업무입니다' : '추가하지 못했습니다. 권한을 확인하세요', 'err');
      toast('업무를 추가했습니다'); await setupView(body);
    }));
    const rows = S.tasks.map((t) => {
      const tog = el('button', { class: 'btn ghost sm', type: 'button' }, t.active ? '사용 중지' : '다시 사용');
      tog.addEventListener('click', busy(tog, async () => {
        const { error } = await sb.from('task_types').update({ active: !t.active }).eq('name', t.name);
        if (error) return toast('처리하지 못했습니다', 'err');
        await setupView(body);
      }));
      return el('div', { class: 'zrow' + (t.active ? '' : ' off') }, el('div', {}, el('b', {}, t.name), t.active ? null : el('small', {}, '사용 중지됨')), el('div', { class: 'zact' }, tog));
    });
    return el('div', {},
      el('div', { class: 'card' }, el('h2', {}, '업무 추가'), el('label', { class: 'f' }, el('span', {}, '업무 이름'), nameIn), add),
      el('div', { class: 'card' }, el('h2', {}, '업무 종류'), rows.length ? rows : el('p', { class: 'empty' }, '등록된 업무가 없습니다'),
        el('p', { class: 'hint' }, '이미 구역에 쓰인 업무는 삭제하지 않고 "사용 중지"로 숨깁니다.')));
  }

  /* ---------- 자동 출근 설정 (master) ---------- */
  const numF = (v) => { const x = Number(String(v).trim()); return Number.isFinite(x) ? x : NaN; };
  const DEF_T1 = { lat: 37.4492, lng: 126.451 }, DEF_T2 = { lat: 37.4691, lng: 126.4318 };
  const ROLE_KO = { master: '최고관리자', admin: '관리자', chief: '총괄팀장', leader: '팀장' };
  function autoPane(body) {
    const box = el('div', {}, el('p', { class: 'empty' }, '불러오는 중…'));
    (async () => {
      const [cf, ls] = await Promise.all([
        sb.from('settings').select('key,value').eq('key', 'auto_checkin').then((r) => (r.error ? { data: [] } : r), () => ({ data: [] })),
        sb.rpc('list_staff_work_time').then((r) => r, () => ({ error: true }))]);
      if (ls.error) { box.replaceChildren(el('p', { class: 'empty' }, '불러오지 못했습니다. 28_auto_checkin.sql 실행 여부를 확인하세요')); return; }
      const cfg = (cf.data && cf.data[0] && cf.data[0].value) || {};
      const mk = (p) => ({ lat: numIn(p && p.lat != null ? p.lat : '', '위도'), lng: numIn(p && p.lng != null ? p.lng : '', '경도') });
      const t1 = mk(cfg.t1 || DEF_T1), t2 = mk(cfg.t2 || DEF_T2);
      const rad = numIn(cfg.radius_km != null ? cfg.radius_km : 2, '반경(km)');
      const win = numIn(cfg.window_min != null ? Math.round(cfg.window_min / 60 * 10) / 10 : 2, '출근시간 전후(시간)');
      const here = (t) => el('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
        if (!navigator.geolocation) return toast('이 기기에서는 위치를 읽을 수 없습니다', 'err');
        navigator.geolocation.getCurrentPosition((pos) => { t.lat.value = pos.coords.latitude.toFixed(6); t.lng.value = pos.coords.longitude.toFixed(6); toast('현재 위치를 채웠습니다. 저장해야 반영됩니다'); },
          () => toast('위치를 읽지 못했습니다. 위치 허용을 확인하세요', 'err'), { enableHighAccuracy: true, timeout: 10000 });
      } }, '현재 위치로 채우기');
      const pt = (title, t) => el('div', { class: 'card' }, el('h2', {}, title),
        el('div', { class: 'agrid' }, el('label', { class: 'f' }, el('span', {}, '위도'), t.lat), el('label', { class: 'f' }, el('span', {}, '경도'), t.lng)), here(t));
      const times = (ls.data || []).map((u) => { const i = el('input', { type: 'time', value: u.work_time ? String(u.work_time).slice(0, 5) : '', 'aria-label': `${u.name} 출근시간` }); return { u, i }; });
      const ts = await sb.from('team_shift').select('division_id,team,shift,start_time,end_time').then((r) => (r.error ? { data: [] } : r), () => ({ data: [] }));
      const tsAll = ts.data || [];
      const hm = (t) => (t ? String(t).slice(0, 5) : '');
      const tmEd = {}; // `${division_id}|${team}` -> { s, e, o }
      tsAll.forEach((r) => { tmEd[`${r.division_id}|${r.team}`] = { s: hm(r.start_time), e: hm(r.end_time), o: `${hm(r.start_time)}|${hm(r.end_time)}`, r }; });
      const bd = (bizDivs() || []).filter((d) => d.kind === '사업부');
      let tdiv = bd.length ? bd[0].id : null;
      const tbox = el('div', {});
      const drawTeams = () => {
        const rows = tsAll.filter((r) => r.division_id === tdiv).sort((a, b) => String(a.team).localeCompare(String(b.team), 'ko', { numeric: true }));
        tbox.replaceChildren(
          seg(bd.map((d) => [String(d.id), shortDiv(d.name)]), String(tdiv), (v) => { tdiv = Number(v); drawTeams(); }),
          ...rows.map((r) => {
            const e = tmEd[`${r.division_id}|${r.team}`];
            const si = el('input', { type: 'time', value: e.s, 'aria-label': `${r.team} 출근시간` }); si.addEventListener('input', () => { e.s = si.value; });
            const ei = el('input', { type: 'time', value: e.e, 'aria-label': `${r.team} 퇴근시간` }); ei.addEventListener('input', () => { e.e = ei.value; });
            return el('div', { class: 'qrow' }, el('b', {}, r.team, el('small', { class: 'qros' }, ` ${r.shift || ''}`)),
              el('div', { class: 'tmtime' }, el('label', {}, el('span', {}, '출근'), si), el('label', {}, el('span', {}, '퇴근'), ei)));
          }),
          rows.length ? null : el('p', { class: 'empty' }, '이 사업부에 등록된 팀이 없습니다. 휴무 업로드의 팀 구성에서 팀을 먼저 지정하세요'));
      };
      drawTeams();
      const save = el('button', { class: 'btn', type: 'button' }, '자동 출근 설정 저장');
      save.addEventListener('click', busy(save, async () => {
        const rd = numF(rad.value), wn = numF(win.value);
        if (!(rd > 0 && rd <= 20)) return toast('반경은 0보다 크고 20km 이하로 입력하세요', 'err');
        if (!(wn > 0 && wn <= 12)) return toast('출근시간 전후는 0보다 크고 12시간 이하로 입력하세요', 'err');
        const one = (t, label) => {
          if (t.lat.value.trim() === '' && t.lng.value.trim() === '') return null;
          const la = numF(t.lat.value), ln = numF(t.lng.value);
          if (!(la >= 30 && la <= 45 && ln >= 120 && ln <= 135)) { toast(`${label} 위도·경도를 확인하세요`, 'err'); return false; }
          return { lat: la, lng: ln };
        };
        const p1 = one(t1, '제1여객터미널'); if (p1 === false) return;
        const p2 = one(t2, '제2여객터미널'); if (p2 === false) return;
        const val = { radius_km: rd, window_min: Math.round(wn * 60) };
        if (p1) val.t1 = p1; if (p2) val.t2 = p2;
        const { error } = await sb.from('settings').upsert({ key: 'auto_checkin', value: val, note: '관리자 자동 출근 설정' }, { onConflict: 'key' });
        if (error) return toast('저장하지 못했습니다. master 권한을 확인하세요', 'err');
        for (const { u, i } of times) {
          const nv = i.value || null; const ov = u.work_time ? String(u.work_time).slice(0, 5) : null;
          if (nv === ov) continue;
          const r = await sb.rpc('set_staff_work_time', { p_user: u.user_id, p_time: nv });
          if (r.error) return toast(`${u.name} 출근시간을 저장하지 못했습니다`, 'err');
        }
        for (const k of Object.keys(tmEd)) {
          const e = tmEd[k]; if (`${e.s}|${e.e}` === e.o) continue;
          const { error: te } = await sb.from('team_shift').update({ start_time: e.s || null, end_time: e.e || null }).eq('division_id', e.r.division_id).eq('team', e.r.team);
          if (te) return toast(`${e.r.team} 출근시간을 저장하지 못했습니다`, 'err');
        }
        toast('자동 출근 설정을 저장했습니다');
        await setupView(body);
      }));
      box.replaceChildren(
        el('p', { class: 'hint pad' }, '관리자·팀장이 앱을 열었을 때, 소속 터미널 반경 안이고 출근시간 전후 안이면 그날 출근으로 자동 기록합니다. 관리자는 아래 "관리자별 출근시간", 팀장은 "팀별 출근시간"을 기준으로 하며, 팀장은 팀 출근 체크 명단의 본인 칸에 기록되고 휴무·근태가 있는 날은 기록하지 않습니다. 좌표 기본값은 대략적인 값이므로 터미널 안에서 "현재 위치로 채우기"로 맞추세요. 위치(좌표)는 저장하지 않고 결과만 기록합니다. 출근시간을 지정하지 않은 계정은 자동 출근이 되지 않습니다.'),
        pt('제1여객터미널 기준 위치 (T1·부대 사업부)', t1), pt('제2여객터미널 기준 위치 (T2 사업부)', t2),
        el('div', { class: 'card' }, el('h2', {}, '범위'),
          el('div', { class: 'agrid' }, el('label', { class: 'f' }, el('span', {}, '반경 (km)'), rad), el('label', { class: 'f' }, el('span', {}, '출근시간 전후 (시간)'), win)),
          el('p', { class: 'hint' }, '환경미화운영그룹 소속은 제1·제2여객터미널 중 한 곳이라도 반경 안이면 가까운 터미널의 사업부(T1 또는 T2)로 기록합니다.')),
        el('div', { class: 'card' }, el('h2', {}, '팀별 출근시간 (팀장 기준)'),
          el('p', { class: 'hint' }, '휴무 업로드의 팀 구성과 같은 값입니다. 여기서 고쳐도 팀 구성에 반영되고, 팀장은 소속 팀의 출근시간 전후에 자동 출근됩니다. 비워 두면 근무조 기본 시작시간을 씁니다.'), tbox),
        el('div', { class: 'card' }, el('h2', {}, '관리자별 출근시간'),
          ...times.map(({ u, i }) => el('div', { class: 'qrow' }, el('b', {}, u.name, el('small', { class: 'qros' }, ` ${u.division || ''}`)), i, el('span', {}))),
          times.length ? null : el('p', { class: 'empty' }, '관리자 계정이 없습니다')),
        save);
    })();
    return box;
  }

  /* ---------- 관리자 자동 출근 (앱을 열 때 현재 위치 확인) ---------- */
  const AUTO = { at: 0, done: '' };
  function autoCheckin() {
    const me = state.me;
    if (!me || !['admin', 'chief', 'master', 'leader'].includes(me.role) || !navigator.geolocation) return;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    if (AUTO.done === today || Date.now() - AUTO.at < 600000) return;
    AUTO.at = Date.now();
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { data, error } = await sb.rpc('auto_staff_checkin', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
        if (error || !data) return;
        if (data.status === 'done') { AUTO.done = today; toast(`자동 출근 완료 (${data.place} 반경)`); if (state.menu === 'check' || state.menu === 'home') mainView(); }
        else if (data.status === 'already' || data.status === 'leave' || data.status === 'notime' || data.status === 'noconfig' || data.status === 'na') AUTO.done = today;
      } catch (e) { /* 다음에 다시 시도 */ }
    }, () => { /* 위치 허용 안 함: 직접 체크 */ }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoCheckin(); });

  /* ---------- 진입 / 로그아웃 ---------- */
  async function loadMe() {
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return null;
    const { data, error } = await sb.from('profiles')
      .select('id,emp_no,name,division_id,role,status,must_change_pw,req_title,team,plan_team').eq('id', u.user.id).maybeSingle();
    if (error || !data) return null;
    return data;
  }
  async function enter() {
    const me = await loadMe();
    if (!me) { await sb.auth.signOut().catch(() => {}); loginView(); toast('계정 정보를 불러올 수 없습니다', 'err'); return; }
    state.me = me;
    await loadDivisions();
    if (me.status !== 'approved') {
      const summary = { division: divName(me.division_id), emp: me.emp_no, name: me.name, title: me.req_title, team: me.plan_team };
      await sb.auth.signOut().catch(() => {});
      return waitView(summary, me.status === 'rejected');
    }
    if (me.must_change_pw) return pwView();
    if (me.role === 'master') { state.tab = 'pending'; refreshApprovals().then(() => { if (state.me && state.menu !== 'approve') mainView(); }); }
    state.menu = 'home';
    mainView();
    autoCheckin();
  }
  async function logoutThenLogin() {
    await sb.auth.signOut().catch(() => {});
    state.me = null; state.selected = null; state.counts = {};
    loginView();
  }

  /* ---------- 화면 등록 + 다른 기능 파일에 공유할 도구 ---------- */
  register('home', '현황', ALL_ROLES, homeView);
  register('setup', '구역·정원 설정', ['master', 'admin'], setupView, '구역·정원·업무 종류를 직접 입력');
  register('approve', '가입 승인', ['master'], approveView, '가입 신청을 확인하고 권한 지정');

  /* 인쇄(PDF 저장): 화면의 내용을 인쇄 전용 영역에 담아 브라우저 인쇄창을 엽니다 */
  function printNode(node) {
    const area = document.getElementById('print-area');
    area.replaceChildren(node);
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); area.replaceChildren(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 60);
  }

  window.APP = {
    sb, CFG, state, el, seg, busy, toast, mount, register, numIn, toInt, bizDivs, divName, divTone, shortDiv, ROLE_LABEL, printNode,
    reload: () => mainView(),
    start: async function start() {
      try {
        const { data } = await sb.auth.getSession();
        if (data && data.session) return await enter();
      } catch (e) { /* 로그인 화면으로 */ }
      loginView();
    }
  };
})();
