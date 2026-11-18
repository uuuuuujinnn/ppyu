/* 쀼 가계부 — Firebase 연결 (로그인, 가계부 고르기, 초대, 저장소, 백업)
   앱 본체는 claude.ai 아티팩트의 db 모양(doc/collection, onSnapshot, set, delete)으로 짜여 있어서,
   여기서 같은 모양의 얇은 껍데기를 Firestore 위에 씌워요.
   Firestore는 배열 안의 배열을 못 담아서, 문서 전체를 JSON 글자 하나(j)로 저장해요.

   데이터 구조
   - users/{uid}               { books: [가계부 id], current, email }
   - books/{id}                { owner, name, members: { uid: { email, name, role } } }
   - books/{id}/invites/{code} { by, expires, used, usedBy }
   - books/{id}/meta|tx|inbox  가계부 내용 (j 글자)
*/
(function () {
  const FB = {};
  window.FB = FB;
  let auth = null, fs = null, user = null, bookId = null, BASE = '';
  FB.book = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = () => document.getElementById('main');
  const TS = () => firebase.firestore.FieldValue.serverTimestamp();

  // 초대 링크(#join-가계부-코드)는 앱이 주소 뒤 # 을 쓰기 전에 먼저 읽어 둬요
  const JOIN = (() => { const m = location.hash.match(/^#join-([A-Za-z0-9_-]+)-([A-Za-z0-9]+)$/); return m ? { book: m[1], code: m[2] } : null; })();
  const clearHash = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} };

  // ---------- 문서 모양 맞추기 ----------
  const enc = (d) => ({ j: JSON.stringify(d), u: TS() });
  const dec = (raw) => { try { return raw && typeof raw.j === 'string' ? JSON.parse(raw.j) : {}; } catch (e) { return {}; } };
  const snap = (s) => ({ id: s.id, exists: s.exists, data: () => dec(s.data()) });
  const shim = {
    doc(p) {
      const r = fs.doc(BASE + p);
      return {
        set: (d) => r.set(enc(d)),
        update: async (d) => { const cur = await r.get(); return r.set(enc({ ...dec(cur.data()), ...d })); },
        delete: () => r.delete(),
        get: async () => snap(await r.get()),
        onSnapshot: (fn, err) => r.onSnapshot((s) => fn(snap(s)), err),
      };
    },
    collection(p) {
      const c = fs.collection(BASE + p);
      const wrap = (qs) => ({ docs: qs.docs.map(snap), docChanges: () => qs.docChanges().map((ch) => ({ type: ch.type, doc: snap(ch.doc) })) });
      return { onSnapshot: (fn, err) => c.onSnapshot((qs) => fn(wrap(qs)), err), get: async () => wrap(await c.get()) };
    },
  };

  // ---------- 파일 받기 ----------
  FB.downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };

  // ---------- 첫 화면들 ----------
  FB.email = () => (user && user.email) || '';
  const icon = '<img src="icon-192.png" alt="">';
  const wait = () => new Promise(() => {});
  function gate(html) { const m = main(); if (m) m.innerHTML = `<div class="fb-gate">${icon}${html}</div>`; }
  const GLOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  function showLogin(msg) {
    gate(`<h1>쀼 가계부</h1><p class="sub" style="margin:0">${JOIN ? '가계부에 초대받았어요.<br>구글 계정으로 로그인하면 참여할 수 있어요.' : '구글 계정으로 로그인하면<br>폰·태블릿 어디서나 같은 가계부를 써요.'}</p>
      <button class="fb-btn dark" id="fb-login">${GLOGO}구글 계정으로 로그인</button>
      ${msg ? `<p style="margin:0;color:var(--danger)">${esc(msg)}</p>` : ''}`);
    document.getElementById('fb-login').onclick = async () => {
      const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      try { await auth.signInWithPopup(p); location.reload(); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') { try { await auth.signInWithRedirect(p); } catch (e2) { showLogin('로그인하지 못했어요. (' + e2.code + ')'); } }
        else if (e.code === 'auth/unauthorized-domain') showLogin('이 주소가 Firebase 로그인 허용 도메인에 없어요.');
        else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') showLogin('로그인하지 못했어요. (' + e.code + ')');
      }
    };
  }
  const outBtn = '<button class="fb-btn" id="fb-out">다른 계정으로 로그인</button>';
  function bindOut() { const b = document.getElementById('fb-out'); if (b) b.onclick = () => auth.signOut().then(() => location.reload()); }
  function showError(title, msg) { gate(`<h1>${esc(title)}</h1><p class="sub" style="margin:0">${msg}</p>${outBtn}`); bindOut(); }

  // ---------- 가계부 고르기 ----------
  const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const meEntry = (role, extra) => ({ email: user.email || '', name: user.displayName || '', role, joined: TS(), ...(extra || {}) });
  async function createBook(id) {
    await fs.doc('books/' + id).set({ owner: user.uid, name: '쀼 가계부', members: { [user.uid]: meEntry('owner') }, createdAt: TS() });
  }
  async function remember(id) {
    await fs.doc('users/' + user.uid).set({ books: firebase.firestore.FieldValue.arrayUnion(id), current: id, email: user.email || '' }, { merge: true });
  }
  async function isLegacyOwner() {
    // 이메일을 공개 코드에 남기지 않으려고, 이메일의 해시값끼리 비교해요
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((user.email || '').trim().toLowerCase()));
      const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      return !!window.FB_LEGACY.ownerHash && hex === window.FB_LEGACY.ownerHash;
    } catch (e) { return false; }
  }
  async function ensureLegacy() {
    // 예전에 옮겨 온 가계부에 주인 정보가 없으면, 처음 만든 사람을 주인으로 등록해요
    const id = window.FB_LEGACY.book;
    const s = await fs.doc('books/' + id).get();
    if (!s.exists) await createBook(id);
    else if (!(s.data().members || {})[user.uid]) return null;
    await remember(id);
    return id;
  }
  function askJoin() {
    return new Promise((res) => {
      gate(`<h1>가계부 초대</h1><p class="sub" style="margin:0">초대받은 가계부에 참여할까요?<br>참여하면 내역을 함께 보고 적을 수 있어요.<br><b style="color:var(--ink)">${esc(user.email)}</b> 계정으로 참여해요.</p>
        <button class="fb-btn dark" id="fb-join">참여하기</button><button class="fb-btn" id="fb-join-no">다음에 할게요</button>`);
      document.getElementById('fb-join').onclick = () => res(true);
      document.getElementById('fb-join-no').onclick = () => res(false);
    });
  }
  async function join(j) {
    const b = fs.batch();
    b.update(fs.doc('books/' + j.book), { ['members.' + user.uid]: meEntry('member', { invite: j.code }) });
    b.update(fs.doc('books/' + j.book + '/invites/' + j.code), { used: true, usedBy: user.uid });
    b.set(fs.doc('users/' + user.uid), { books: firebase.firestore.FieldValue.arrayUnion(j.book), current: j.book, email: user.email || '' }, { merge: true });
    await b.commit();
  }
  function askCreate() {
    return new Promise((res) => {
      gate(`<h1>아직 가계부가 없어요</h1><p class="sub" style="margin:0">${esc(user.email)} 계정에 연결된 가계부가 없어요.<br>가족에게 초대 링크를 받았다면 그 링크로 다시 열어 주세요.</p>
        <button class="fb-btn dark" id="fb-new">새 가계부 만들기</button>${outBtn}`);
      bindOut();
      document.getElementById('fb-new').onclick = () => res(true);
    });
  }
  async function pickBook() {
    const us = await fs.doc('users/' + user.uid).get();
    const ud = us.exists ? us.data() : {};
    FB.prefs = ud;
    const books = ud.books || [];
    if (JOIN) {
      if (books.includes(JOIN.book)) { clearHash(); await remember(JOIN.book); return JOIN.book; }
      if (await askJoin()) {
        gate('<h1>참여하는 중이에요…</h1>');
        try { await join(JOIN); clearHash(); FB.justJoined = true; return JOIN.book; }
        catch (e) { clearHash(); showError('참여하지 못했어요', '초대 링크가 만료됐거나 이미 쓰인 링크예요.<br>가족에게 새 링크를 받아 주세요.'); return wait(); }
      }
      clearHash();
    }
    if (books.length) return ud.current && books.includes(ud.current) ? ud.current : books[0];
    if (await isLegacyOwner()) { const id = await ensureLegacy(); if (id) return id; }
    if (await askCreate()) {
      gate('<h1>가계부를 만드는 중이에요…</h1>');
      const id = newId(); await createBook(id); await remember(id);
      // 기본 분류와 자산 대분류를 넣어서 시작해요 (구성원은 다음 화면에서 내 이름으로 만들어요)
      await fs.doc('books/' + id + '/meta/config').set(enc(window.FB_DEFAULTS));
      await fs.doc('books/' + id + '/meta/assets').set(enc({ list: [] }));
      FB.justJoined = true;
      return id;
    }
    return wait();
  }

  // ---------- 처음 들어온 사람: 가계부에서 쓸 이름 고르기 ----------
  const COLORS = ['#0F766E', '#C2410C', '#6D28D9', '#B45309', '#BE185D', '#1D4ED8', '#4D7C0F', '#475569'];
  async function chooseName() {
    const ref = fs.doc(BASE + 'meta/config');
    const snap0 = await ref.get(); if (!snap0.exists) return;
    let cfg = dec(snap0.data());
    const accounts = cfg.accounts || {};
    if (accounts[user.uid]) return;
    const sps = cfg.spenders || [];
    const linked = new Set(Object.values(accounts));
    const free = sps.filter((m) => !linked.has(m.id));
    const nameOf = (m) => m.n || m.id;
    const hay = (user.displayName || '') + ' ' + (user.email || '').split('@')[0];
    const guess = free.find((m) => hay.includes(nameOf(m)));
    if (guess && !FB.justJoined) { cfg = { ...cfg, accounts: { ...accounts, [user.uid]: guess.id } }; await ref.set(enc(cfg)); return; }
    const picked = await new Promise((res) => {
      let sel = guess ? guess.id : '';
      const draw = () => {
        gate(`<h1>가계부에서 쓸 이름</h1><p class="sub" style="margin:0">내역의 '쓴 사람'에 보일 이름이에요.<br>나중에 설정 &gt; 구성원에서 이름과 사진을 바꿀 수 있어요.</p>
          ${free.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">${free.map((m) => `<button class="fb-btn${sel === m.id ? ' dark' : ''}" data-pick="${esc(m.id)}" aria-pressed="${sel === m.id}">${esc(nameOf(m))}</button>`).join('')}</div><span class="faint">이미 있는 이름이면 골라 주세요. 없으면 새로 적어요.</span>` : ''}
          <input id="fb-name" maxlength="10" placeholder="새 이름" value="" style="min-height:48px;width:min(280px,100%);border:1px solid var(--line2);border-radius:12px;padding:0 14px;background:var(--surface);text-align:center">
          <button class="fb-btn dark" id="fb-name-ok">이 이름으로 시작하기</button><p id="fb-name-msg" style="margin:0;color:var(--danger)"></p>`);
        document.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { sel = b.dataset.pick; draw(); }; });
        const inp = document.getElementById('fb-name');
        inp.oninput = () => { if (inp.value.trim() && sel) { sel = ''; document.querySelectorAll('[data-pick]').forEach((b) => { b.classList.remove('dark'); b.setAttribute('aria-pressed', 'false'); }); } };
        document.getElementById('fb-name-ok').onclick = () => {
          const typed = inp.value.trim();
          if (!sel && !typed) { document.getElementById('fb-name-msg').textContent = '이름을 고르거나 적어 주세요.'; return; }
          res(sel ? { id: sel } : { name: typed });
        };
      };
      draw();
    });
    const fresh = await ref.get(); cfg = dec(fresh.data());
    let id = picked.id;
    if (!id) {
      const exist = (cfg.spenders || []).find((m) => nameOf(m) === picked.name || m.id === picked.name);
      if (exist) id = exist.id;
      else { id = picked.name; cfg.spenders = [...(cfg.spenders || []), { id, color: COLORS[(cfg.spenders || []).length % COLORS.length] }]; }
    }
    cfg.accounts = { ...(cfg.accounts || {}), [user.uid]: id };
    gate('<h1>준비하는 중이에요…</h1>');
    await ref.set(enc(cfg));
  }

  FB.open = async function () {
    if (!window.firebase) { gate('<h1>불러오지 못했어요</h1><p class="sub" style="margin:0">처음 한 번은 인터넷이 연결되어 있어야 해요.</p>'); return wait(); }
    firebase.initializeApp(window.FB_CONFIG);
    auth = firebase.auth();
    fs = firebase.firestore();
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 다른 탭이 이미 켰거나 지원 안 함 */ }
    try { await auth.getRedirectResult(); } catch (e) { /* 리다이렉트 로그인이 아니었음 */ }
    user = await new Promise((res) => { const un = auth.onAuthStateChanged((u) => { un(); res(u); }); });
    if (!user) { showLogin(); return wait(); }
    try { bookId = await pickBook(); }
    catch (e) { showError('가계부를 열지 못했어요', '보안 규칙이 바뀌었는지 확인해 주세요.<br>(' + esc(e.code || e.message) + ')'); return wait(); }
    BASE = 'books/' + bookId + '/';
    try { await chooseName(); } catch (e) { /* 이름은 나중에 설정에서 고를 수 있어요 */ }
    fs.doc('books/' + bookId).onSnapshot((s) => {
      FB.book = s.exists ? s.data() : null;
      if (FB.book && !(FB.book.members || {})[user.uid]) return kicked();
      if (window.FB.render) window.FB.render();
    }, (e) => { if (e.code === 'permission-denied') kicked(); });
    return shim;
  };
  async function kicked() {
    try { await fs.doc('users/' + user.uid).set({ books: firebase.firestore.FieldValue.arrayRemove(bookId), current: null }, { merge: true }); } catch (e) {}
    showError('가계부에서 빠졌어요', '이 계정은 더 이상 이 가계부의 구성원이 아니에요.');
    const nav = document.getElementById('tabs'); if (nav) nav.innerHTML = '';
  }

  // ---------- 로그인 계정 ↔ 구성원(쓴 사람) ----------
  const spList = () => ((FB.state && FB.state.cfg && FB.state.cfg.spenders) || []);
  const spName = (m) => m.n || m.id;
  function guessSpender(acc) {
    const hay = ((acc && acc.name) || '') + ' ' + ((acc && acc.email) || '').split('@')[0];
    const hit = spList().find((m) => hay.includes(spName(m)));
    return hit ? hit.id : '';
  }
  function linkOf(uid) {
    const cfg = (FB.state && FB.state.cfg) || {};
    if (cfg.accounts && uid in cfg.accounts) return cfg.accounts[uid];
    return guessSpender(((FB.book || {}).members || {})[uid] || (uid === (user && user.uid) ? { name: user.displayName, email: user.email } : null));
  }
  // 켜고 끄기는 계정마다 따로 (users/{uid}.autoMe) — 내 폰·태블릿에는 같이 적용돼요
  FB.autoMe = () => !FB.prefs || FB.prefs.autoMe !== false;
  FB.mySpender = () => (user && FB.autoMe() ? linkOf(user.uid) || null : null);

  // ---------- 설정 > 구성원 (계정 정보) · 가족 초대 ----------
  FB.accountOf = function (spId) {
    const ms = (FB.book && FB.book.members) || {};
    for (const [uid, m] of Object.entries(ms)) if (linkOf(uid) === spId) return { uid, email: m.email, name: m.name, role: m.role, me: uid === user.uid };
    return null;
  };
  const isOwner = () => !!(FB.book && user && FB.book.owner === user.uid);
  FB.autoMeHtml = () => `<div class="card" style="padding:0 16px;margin-top:12px"><div class="row" style="min-height:64px;gap:12px">
      <span class="grow" style="display:flex;flex-direction:column;gap:2px"><span>쓴 사람을 나로 자동 선택</span><span class="faint">새 내역을 적을 때 내가 '쓴 사람'으로<br>미리 골라져요. 내 계정에만 적용돼요.</span></span>
      <button class="switch" role="switch" aria-checked="${FB.autoMe()}" aria-label="쓴 사람을 나로 자동 선택" data-act="fb-autome"></button></div></div>`;
  FB.inviteHtml = function () {
    if (!isOwner()) return '';
    return `<h2 class="sub" style="font-size:13px;margin:20px 4px 8px">가족 초대</h2>
    <div class="card" style="padding:0 16px"><button class="row" data-act="fb-invite" style="width:100%;border:0;background:transparent;min-height:56px;padding:8px 0;text-align:left;gap:12px;color:var(--ink)"><span style="color:var(--sub);display:flex"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6"/></svg></span><span class="grow">가족 초대하기</span></button></div>
    <p class="faint" style="margin:8px 4px 0;line-height:1.6">구글 계정으로 로그인해서 같이 쓸 가족을 불러요.<br>초대받은 사람은 내역을 함께 보고 적을 수 있어요.<br>초대 링크는 24시간 동안 한 명만 쓸 수 있어요.</p>`;
  };
  FB.memberAccountHtml = function (spId) {
    const a = FB.accountOf(spId); if (!a) return '';
    const btn = a.me ? (a.role === 'owner' ? '' : `<button class="btn" style="width:100%;color:var(--danger);margin-top:4px" data-act="fb-leave">이 가계부에서 나가기</button><p class="faint" style="margin:0;line-height:1.6">나가면 이 계정으로 가계부를 열 수 없어요.<br>적어 둔 내역은 그대로 남아요.</p>`)
      : (isOwner() ? `<button class="btn" style="width:100%;color:var(--danger);margin-top:4px" data-act="fb-kick" data-v="${esc(a.uid)}" data-n="${esc(a.name || a.email)}">가계부에서 빼기</button><p class="faint" style="margin:0;line-height:1.6">이 계정은 더 이상 가계부를 열 수 없어요.<br>적어 둔 내역과 '${esc((spList().find((x) => x.id === spId) || { id: spId }).n || spId)}' 이름표는 그대로 남아요.</p>` : '');
    return `<div class="card" style="padding:12px 16px;display:flex;flex-direction:column;gap:4px"><span class="sub">로그인 계정</span><span style="overflow-wrap:anywhere">${esc(a.email)}${a.role === 'owner' ? ' <span class="tag">주인</span>' : ''}</span></div>${btn}`;
  };

  // ---------- 아래에서 올라오는 확인 창 ----------
  function bar(html) { closeBar(); const b = document.createElement('div'); b.className = 'fb-bar'; b.id = 'fb-bar'; b.setAttribute('role', 'dialog'); b.innerHTML = html; document.body.appendChild(b); return b; }
  function closeBar() { const b = document.getElementById('fb-bar'); if (b) b.remove(); }
  function note(msg) { const b = bar(`<div>${msg}</div><div class="fb-row"><button class="fb-btn" data-fb="close">닫기</button></div>`); setTimeout(() => { if (document.getElementById('fb-bar') === b) b.remove(); }, 6000); }

  // ---------- 백업 ----------
  function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
  function makeBackup() {
    const S = FB.state; const docs = {};
    if (S.cfg) docs['meta/config'] = S.cfg;
    docs['meta/assets'] = { list: S.assets || [] };
    docs['meta/learn'] = { map: S.learn || {} };
    docs['meta/profiles'] = { list: S.profiles || [] };
    Object.keys(S.raw || {}).forEach((ym) => { docs['tx/' + ym] = { rows: S.raw[ym] }; });
    Object.keys(S.inbox || {}).forEach((id) => { docs['inbox/' + id] = S.inbox[id]; });
    return { app: 'ppyu', version: 1, savedAt: new Date().toISOString(), docs };
  }
  async function restore(data) {
    const keys = Object.keys(data.docs);
    const del = [];
    for (const col of ['tx', 'inbox']) { const qs = await fs.collection(BASE + col).get(); qs.docs.forEach((d) => { if (!data.docs[col + '/' + d.id]) del.push(col + '/' + d.id); }); }
    const ops = keys.map((k) => ['set', k]).concat(del.map((k) => ['del', k]));
    const apply = (b, [op, k]) => { const r = fs.doc(BASE + k); if (op === 'set') b.set(r, enc(data.docs[k])); else b.delete(r); };
    for (let i = 0; i < ops.length; i += 100) {
      const part = ops.slice(i, i + 100);
      try { const b = fs.batch(); part.forEach((o) => apply(b, o)); await b.commit(); }
      catch (e) { for (const o of part) { const b = fs.batch(); apply(b, o); await b.commit(); } }
    }
    return { set: keys.length, del: del.length };
  }

  // ---------- 버튼 ----------
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-act^="fb-"], [data-fb]'); if (!t) return;
    const act = t.dataset.act || t.dataset.fb;
    if (act === 'close') { closeBar(); return; }
    if (act === 'fb-autome') {
      const on = !FB.autoMe(); FB.prefs = { ...(FB.prefs || {}), autoMe: on }; t.setAttribute('aria-checked', String(on));
      fs.doc('users/' + user.uid).set({ autoMe: on }, { merge: true }).catch(() => note('저장하지 못했어요.'));
      return;
    }
    if (act === 'fb-logout') {
      bar(`<div><b>로그아웃할까요?</b><br>다시 쓰려면 구글 계정으로 로그인하면 돼요.</div><div class="fb-row"><button class="fb-btn" data-fb="close">취소</button><button class="fb-btn dark" data-fb="logout-ok">로그아웃</button></div>`);
      return;
    }
    if (act === 'logout-ok') { await auth.signOut(); try { await fs.clearPersistence(); } catch (e) {} location.reload(); return; }

    if (act === 'fb-invite') {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 55]).join('');
      bar('<div><b>초대 링크를 만드는 중이에요…</b></div>');
      try {
        await fs.doc('books/' + bookId + '/invites/' + code).set({ by: user.uid, used: false, expires: firebase.firestore.Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000), createdAt: TS() });
      } catch (e) { note('초대 링크를 만들지 못했어요. (' + esc(e.code || e.message) + ')'); return; }
      const link = location.origin + location.pathname + '#join-' + bookId + '-' + code;
      FB.lastLink = link;
      bar(`<div><b>초대 링크가 만들어졌어요</b><br>카톡이나 문자로 보내 주세요. 24시간 동안 한 명만 쓸 수 있어요.</div>
        <div style="background:var(--soft);border-radius:10px;padding:10px 12px;font-size:13px;overflow-wrap:anywhere;user-select:all;-webkit-user-select:all">${esc(link)}</div>
        <div class="fb-row"><button class="fb-btn" data-fb="close">닫기</button><button class="fb-btn" data-fb="copy">복사</button>${navigator.share ? '<button class="fb-btn dark" data-fb="share">보내기</button>' : ''}</div>`);
      return;
    }
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(FB.lastLink); t.textContent = '복사했어요'; }
      catch (e) { const box = document.querySelector('#fb-bar [style*="user-select"]'); if (box) { const r = document.createRange(); r.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } t.textContent = '길게 눌러 복사'; }
      return;
    }
    if (act === 'share') { try { await navigator.share({ title: '쀼 가계부 초대', text: '쀼 가계부에 초대할게요. 링크를 열고 구글 계정으로 로그인해 주세요.', url: FB.lastLink }); } catch (e) {} return; }

    if (act === 'fb-kick') {
      FB.kick = t.dataset.v;
      bar(`<div><b>${esc(t.dataset.n)} 님을 뺄까요?</b><br>빠진 사람은 이 가계부를 더 볼 수 없어요. 적어 둔 내역은 남아요.</div><div class="fb-row"><button class="fb-btn" data-fb="close">취소</button><button class="fb-btn danger" data-fb="kick-ok">빼기</button></div>`);
      return;
    }
    if (act === 'kick-ok') {
      try { await fs.doc('books/' + bookId).update({ ['members.' + FB.kick]: firebase.firestore.FieldValue.delete() }); note('구성원에서 뺐어요.'); }
      catch (e) { note('빼지 못했어요. (' + esc(e.code || e.message) + ')'); }
      return;
    }
    if (act === 'fb-leave') {
      bar(`<div><b>이 가계부에서 나갈까요?</b><br>다시 들어오려면 주인에게 새 초대 링크를 받아야 해요.</div><div class="fb-row"><button class="fb-btn" data-fb="close">취소</button><button class="fb-btn danger" data-fb="leave-ok">나가기</button></div>`);
      return;
    }
    if (act === 'leave-ok') {
      try {
        await fs.doc('books/' + bookId).update({ ['members.' + user.uid]: firebase.firestore.FieldValue.delete() });
        await fs.doc('users/' + user.uid).set({ books: firebase.firestore.FieldValue.arrayRemove(bookId), current: null }, { merge: true });
        location.reload();
      } catch (e) { note('나가지 못했어요. (' + esc(e.code || e.message) + ')'); }
      return;
    }

    if (act === 'fb-backup') {
      const data = makeBackup(); const n = Object.values(FB.state.raw || {}).reduce((s, a) => s + a.length, 0);
      await FB.downloads.save({ filename: `쀼가계부_백업_${stamp()}.json`, data: new Blob([JSON.stringify(data)], { type: 'application/json' }) });
      note(`백업 파일을 저장했어요. (내역 ${n.toLocaleString('ko-KR')}건)`); return;
    }
    if (act === 'fb-restore') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        let data; try { data = JSON.parse(await f.text()); } catch (e) { note('백업 파일을 읽지 못했어요.'); return; }
        if (!data || data.app !== 'ppyu' || !data.docs) { note('쀼 가계부 백업 파일이 아니에요.'); return; }
        FB.pending = data;
        const n = Object.keys(data.docs).filter((k) => k.startsWith('tx/')).reduce((s, k) => s + ((data.docs[k].rows || []).length), 0);
        const nb = Object.keys(data.docs).filter((k) => k.startsWith('inbox/')).length;
        const when = data.savedAt ? new Date(data.savedAt).toLocaleString('ko-KR') : '';
        bar(`<div><b>백업을 불러올까요?</b><br>${when ? esc(when) + '에 만든 백업 · ' : ''}내역 ${n.toLocaleString('ko-KR')}건, 알림함 ${nb}묶음<br><span style="color:var(--danger)">지금 가계부 데이터는 모두 이 백업 내용으로 바뀌어요.</span></div>
          <div class="fb-row"><button class="fb-btn" data-fb="close">취소</button><button class="fb-btn dark" data-fb="restore-ok">불러오기</button></div>`);
      };
      inp.click(); return;
    }
    if (act === 'restore-ok') {
      const data = FB.pending; if (!data) return;
      bar('<div><b>불러오는 중이에요…</b><br>창을 닫지 말고 잠시만 기다려 주세요.</div>');
      try { const r = await restore(data); FB.pending = null; note(`다 불러왔어요. 문서 ${r.set}개를 옮겼어요.`); }
      catch (e) { note('불러오지 못했어요. (' + esc(e.code || e.message) + ')'); }
    }
  });

  // ---------- 오프라인 실행, 새 버전 받기 ----------
  if ('serviceWorker' in navigator) window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || location.hash.startsWith('#join-') || document.querySelector('.screen, .sheet-wrap, #fb-bar, .fb-gate')) return; // 입력 중이면 새로고침하지 않아요
      reloaded = true; location.reload();
    });
  });
})();
