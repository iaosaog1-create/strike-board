/* 비정상상황 앱 - 로그인 · 가입 · 비밀번호 변경 · 가입 승인 */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  const TEAMS = ['오전', '오후', '야간', '일근', '운영'];
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
  const state = { me: null, menu: 'home', tab: 'pending', members: [], counts: {}, selected: null, divisions: [] };

  /* ---------- 작은 도구 ---------- */
  // 화면에 그릴 때는 항상 textContent 로만 넣어서 입력값이 코드로 해석되지 않게 함
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
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
  function seg(options, value, onChange) {
    const wrap = el('div', { class: 'seg', role: 'group' });
    const draw = () => wrap.replaceChildren(...options.map(([val, label]) =>
      el('button', {
        type: 'button', class: val === value ? 'on' : '', 'aria-pressed': String(val === value),
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
  const divName = (id) => (state.divisions.find((d) => d.id === id) || {}).name || '';
  const shortDiv = (name) => (name || '').replace('환경미화사업부', '').replace('건물', '') || name || '';
  function errBox() { return el('div', { class: 'err', role: 'alert', hidden: true }); }
  function showErr(box, msg) { box.textContent = msg; box.hidden = false; }

  function topbar(right) {
    return el('header', { class: 'top' }, el('h1', {}, 'IAOS 비정상상황'), el('div', { class: 'sp' }), right);
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
        seg(TEAMS.map((t) => [t, t + '팀']), f.team, (v) => { f.team = v; }));
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
        options: { data: { emp_no: f.emp, name: f.name, division_id: f.div === NONE ? null : Number(f.div), req_title: f.title, team: f.team || null } }
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
        row('직책', s.title), s.team ? row('소속 팀', s.team + '팀') : null)),
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
  function mainView() {
    const me = state.me;
    const menus = [['home', '홈']];
    if (me.role === 'master') menus.push(['approve', '가입 승인']);
    if (!menus.some(([k]) => k === state.menu)) state.menu = 'home';
    const nav = el('nav', { class: 'menu', 'aria-label': '메뉴' }, ...menus.map(([k, label]) =>
      el('button', { type: 'button', class: state.menu === k ? 'on' : '', onclick: () => { state.menu = k; mainView(); } },
        label, k === 'approve' && state.counts.pending ? el('span', { class: 'cnt' }, state.counts.pending) : null)));
    const who = el('div', { class: 'who' }, el('b', {}, me.name), [ROLE_LABEL[me.role], shortDiv(divName(me.division_id)), me.team ? me.team + '팀' : ''].filter(Boolean).join(' · '));
    const body = el('div', {});
    mount(topbar(el('div', { class: 'top-right', style: null }, who)), el('main', { class: 'shell' }, nav, body));
    root.querySelector('.top').append(el('button', { class: 'btn-out', type: 'button', onclick: logoutThenLogin }, '로그아웃'));
    if (state.menu === 'approve') approveView(body); else homeView(body);
  }
  function homeView(body) {
    const me = state.me;
    const items = {
      leader: [['인력 입력', '자기 팀 인원을 구역별로 입력'], ['출근 현황', '출근·휴무·연차 등 입력'], ['구역 현황', '내 사업부 구역별 인원 확인']],
      chief: [['협정·지원 배치', '출근한 협정 인원을 구역에 배치'], ['출근 현황', '사업부 합계 확인'], ['구역 현황', '구역별 인원 확인']],
      admin: [['구역 현황', '전체 사업부 확인'], ['구역·정원 설정', '구역·정원·협정사 업체 관리'], ['시각별 저장·보고서', '시각별 저장과 엑셀/PDF 출력']],
      master: [['구역 현황', '전체 사업부 확인'], ['구역·정원 설정', '구역·정원·협정사 업체 관리'], ['협정인력 관리', '명단·PIN·QR 장소 관리'], ['시각별 저장·보고서', '시각별 저장과 엑셀/PDF 출력']]
    }[me.role] || [];
    body.append(el('div', { class: 'card' },
      el('h2', {}, `${me.name}님, 안녕하세요`),
      el('p', { class: 'hint' }, '로그인이 완료되었습니다. 아래 기능은 순서대로 추가됩니다.'),
      el('div', { class: 'soon' }, ...items.map(([t, d]) => el('div', {}, el('b', {}, t), el('span', {}, d + ' · 준비 중'))))));
  }

  /* ---------- 가입 승인 (최고관리자 전용) ---------- */
  async function refreshApprovals() {
    const sel = 'id,emp_no,name,division_id,role,status,req_title,team,created_at';
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
        el('small', {}, [shortDiv(divName(m.division_id)) || '소속 없음', m.status === 'approved' ? ROLE_LABEL[m.role] : m.req_title, m.team ? m.team + '팀' : ''].join(' · ')),
        el('span', {}))) : [el('p', { class: 'empty' }, '해당하는 가입자가 없습니다')]));
    body.replaceChildren(el('div', { class: 'split' }, el('div', {}, tabs, list), detailPanel(body)));
  }
  function detailPanel(body) {
    const m = state.selected;
    const wrap = el('div', { class: 'detail-wrap' + (m ? ' open' : '') });
    if (!m) { wrap.append(el('div', { class: 'card empty' }, '왼쪽에서 가입자를 선택하세요')); return wrap; }
    const inBiz = (state.divisions.find((d) => d.id === m.division_id) || {}).kind === '사업부';
    const roleOpts = inBiz ? ROLE_OPTIONS : ROLE_OPTIONS.filter(([k]) => k === 'admin');
    const pick = { role: inBiz ? (m.status === 'approved' ? m.role : (TITLE_TO_ROLE[m.req_title] || 'leader')) : 'admin', team: m.team || '' };
    const desc = el('div', { class: 'info' });
    const drawDesc = () => desc.replaceChildren(el('b', {}, ROLE_LABEL[pick.role] + ' 권한'), ROLE_DESC[pick.role]);
    drawDesc();
    const teamBox = el('div', { class: 'f' });
    const drawTeam = () => teamBox.replaceChildren(
      el('span', { class: 'hint' }, pick.role === 'leader' ? '소속 팀 (필수)' : '소속 팀 (선택)'),
      seg([...(pick.role === 'leader' ? [] : [['', '없음']]), ...TEAMS.map((t) => [t, t])], pick.team, (v) => { pick.team = v; }));
    drawTeam();
    const roleSeg = seg(roleOpts, pick.role, (v) => { pick.role = v; drawDesc(); drawTeam(); });
    const ok = el('button', { class: 'btn', type: 'button' }, m.status === 'approved' ? '변경 저장' : '승인');
    const no = el('button', { class: 'btn danger', type: 'button' }, '반려');
    const run = (approve) => async () => {
      if (approve && pick.role === 'leader' && !pick.team) return toast('팀장은 소속 팀을 선택하세요', 'err');
      const { error } = await sb.rpc('review_member', { p_user: m.id, p_approve: approve, p_role: pick.role, p_team: pick.team || null });
      if (error) return toast('처리하지 못했습니다. 권한을 확인하세요', 'err');
      toast(approve ? `${m.name}님을 ${ROLE_LABEL[pick.role]}(으)로 승인했습니다` : `${m.name}님을 반려했습니다`);
      state.selected = null;
      await approveView(body);
    };
    ok.addEventListener('click', busy(ok, run(true)));
    no.addEventListener('click', busy(no, run(false)));
    wrap.append(
      el('button', { class: 'back', type: 'button', onclick: () => { state.selected = null; drawApprove(body); } }, '← 목록으로'),
      el('div', { class: 'card' },
        el('div', { class: 'rows' }, row('이름', `${m.name} (${m.emp_no})`), row('소속', divName(m.division_id) || '소속 없음'),
          row('신청 직책', m.req_title), row('신청 팀', m.team ? m.team + '팀' : '-'),
          row('현재 상태', STATUS_LABEL[m.status] + (m.status === 'approved' ? ' · ' + ROLE_LABEL[m.role] : ''))),
        el('div', { class: 'f', style: null }, el('p', { class: 'hint' }, '최종 권한'), roleSeg),
        inBiz ? null : el('p', { class: 'hint' }, '사업부 소속이 아니어서 관리자 권한만 줄 수 있습니다'), teamBox, desc,
        el('div', { class: 'actions' }, ok, no)));
    return wrap;
  }

  /* ---------- 진입 / 로그아웃 ---------- */
  async function loadMe() {
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return null;
    const { data, error } = await sb.from('profiles')
      .select('id,emp_no,name,division_id,role,status,must_change_pw,req_title,team').eq('id', u.user.id).maybeSingle();
    if (error || !data) return null;
    return data;
  }
  async function enter() {
    const me = await loadMe();
    if (!me) { await sb.auth.signOut().catch(() => {}); loginView(); toast('계정 정보를 불러올 수 없습니다', 'err'); return; }
    state.me = me;
    await loadDivisions();
    if (me.status !== 'approved') {
      const summary = { division: divName(me.division_id), emp: me.emp_no, name: me.name, title: me.req_title, team: me.team };
      await sb.auth.signOut().catch(() => {});
      return waitView(summary, me.status === 'rejected');
    }
    if (me.must_change_pw) return pwView();
    if (me.role === 'master') { state.tab = 'pending'; refreshApprovals().then(() => { if (state.me && state.menu !== 'approve') mainView(); }); }
    state.menu = 'home';
    mainView();
  }
  async function logoutThenLogin() {
    await sb.auth.signOut().catch(() => {});
    state.me = null; state.selected = null; state.counts = {};
    loginView();
  }

  (async function start() {
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) return await enter();
    } catch (e) { /* 로그인 화면으로 */ }
    loginView();
  })();
})();
