/* app.js: 画面（ホーム・提案フィード・Jarvis・AI Team・メニュー・設定）と起動 */
(function(){
'use strict';
const O = window.O;
const { $, $$, pad, sleep, store, toast, log } = O;
const AGENTS = O.AGENTS;
const WD = ['日','月','火','水','木','金','土'];

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
function cta(text, label, fn){
  const d = el('div', 'cta');
  d.append(el('p', 'empty', text));
  const b = el('button', 'btn sm', label); b.type = 'button'; b.onclick = fn; d.append(b);
  return d;
}

/* =========================================================
   状況まとめ（Jarvisと提案フィードに渡す）
   ========================================================= */
function contextText(){
  const d = new Date();
  const L = [`現在: ${d.toLocaleString('ja-JP', { dateStyle:'full', timeStyle:'short' })}`];
  const sh = O.cfg.share;
  const w = O.state.weather;
  if(sh.weather && w) L.push(`天気(${O.city().name}): いま${w.now.label} ${Math.round(w.now.temp)}度 / 今日 最高${Math.round(w.days[0].max)}度 最低${Math.round(w.days[0].min)}度 降水確率${w.days[0].pop}%`);
  const ev = O.state.events;
  if(!sh.events) L.push('今日の予定: (共有オフ)');
  else if(ev && ev.length) L.push('今日の予定: ' + ev.map(e => `${e.allDay ? '終日' : O.fmtTime(e.start) + '-' + O.fmtTime(e.end)} ${e.title}`).join(' / '));
  else if(ev) L.push('今日の予定: なし');
  else L.push('今日の予定: (カレンダー未接続)');
  const open = tasks.filter(t => !t.done).map(t => t.text);
  if(sh.tasks) L.push('未完了のタスク: ' + (open.length ? open.slice(0, 8).join(' / ') : 'なし'));
  const u = O.usage[O.todayKey()];
  if(sh.screen && u) L.push(`スクリーンタイム: このアプリ${Math.round(u.app / 60)}分` + (u.device != null ? ` / 端末合計${u.device}分` : ''));
  const n = O.state.news;
  if(sh.news && n && n.items.length && !n.demo) L.push('主要ニュース: ' + n.items.slice(0, 3).map(i => i.title).join(' / '));
  if(sh.profile && O.cfg.profile.trim()) L.push('ユーザーについて: ' + O.cfg.profile.trim());
  return L.join('\n');
}

/* AIが返したactionを検査して、使える形だけ通す */
function cleanAction(a){
  if(!a || typeof a !== 'object') return null;
  if(a.type === 'add_task' && typeof a.text === 'string' && a.text.trim()) return { type:'add_task', text:a.text.trim().slice(0, 200) };
  if(a.type === 'set_timer'){
    const s = Math.round(+a.seconds);
    if(s >= 10 && s <= 86400) return { type:'set_timer', seconds:s, label:String(a.label || 'タイマー').slice(0, 30) };
  }
  if(a.type === 'delegate' && typeof a.task === 'string' && a.task.trim()) return { type:'delegate', task:a.task.trim().slice(0, 600) };
  if(a.type === 'add_event' && a.title && a.start && a.end){
    const s = new Date(a.start), e = new Date(a.end);
    if(!isNaN(s) && !isNaN(e) && e > s) return { type:'add_event', title:String(a.title).slice(0, 120), start:s.toISOString(), end:e.toISOString() };
  }
  return null;
}
function actionLabel(a){
  return ({
    add_task:'タスクに追加',
    set_timer:`${Math.max(1, Math.round(a.seconds / 60))}分タイマーを開始`,
    delegate:'AIチームに任せる',
    add_event:'予定に入れる'
  })[a.type] || '実行';
}

/* =========================================================
   Orb / 音声
   ========================================================= */
const ORB_LABEL = { idle:'待機中', listening:'聞いています', thinking:'考え中', speaking:'話しています' };
function updateJarvisMeta(){
  const s = $('#orb').dataset.state;
  $('#jarvisMeta').textContent = `頭脳 ${AGENTS[$('#brain').value].name} ・ ${ORB_LABEL[s] || ''}`;
}
function setOrb(s){ $('#orb').dataset.state = s; $('#orbState').textContent = ORB_LABEL[s] || ''; updateJarvisMeta(); }
function speak(t){
  if(!O.cfg.voice || !('speechSynthesis' in window)){ setOrb('idle'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(t).slice(0, 260)); u.lang = 'ja-JP';
  u.onstart = () => setOrb('speaking'); u.onend = u.onerror = () => setOrb('idle');
  speechSynthesis.speak(u);
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wakeRec = null;
function setMicUI(on){ $$('.mic').forEach(m => m.classList.toggle('on', on)); }
function handleVoice(text){ setView('jarvis'); sendChat(text); }
function stopWake(){ if(wakeRec){ const w = wakeRec; wakeRec = null; w.onend = null; try{ w.abort(); }catch(e){} } }
function startWake(){
  if(!SR || !O.cfg.wake || wakeRec || listening) return;
  const w = new SR(); w.lang = 'ja-JP'; w.continuous = true; w.interimResults = false; wakeRec = w;
  w.onresult = e => {
    for(let i = e.resultIndex; i < e.results.length; i++){
      if(!e.results[i].isFinal) continue;
      const m = e.results[i][0].transcript.match(/(ジャービス|ジャーヴィス|オービット|jarvis|orbit)[、,。\s]*(.*)/i);
      if(!m) continue;
      const rest = (m[2] || '').trim();
      if(rest) handleVoice(rest); else { stopWake(); listenOnce(); }
    }
  };
  w.onerror = () => {};
  w.onend = () => { if(wakeRec === w){ wakeRec = null; if(O.cfg.wake && !listening) setTimeout(startWake, 1000); } };
  try{ w.start(); }catch(e){ wakeRec = null; }
}
function listenOnce(){
  stopWake();
  rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.onstart = () => { listening = true; setMicUI(true); setOrb('listening'); };
  rec.onresult = e => {
    let t = ''; for(const r of e.results) t += r[0].transcript;
    $('#chatInput').value = t; $('#briefInput').value = t;
    if(e.results[e.results.length - 1].isFinal){ $('#chatInput').value = ''; $('#briefInput').value = ''; handleVoice(t); }
  };
  rec.onerror = e => { if(e.error !== 'no-speech' && e.error !== 'aborted') toast('音声入力エラー: ' + e.error); };
  rec.onend = () => { listening = false; setMicUI(false); if($('#orb').dataset.state === 'listening') setOrb('idle'); startWake(); };
  try{ rec.start(); }catch(e){ listening = false; setMicUI(false); }
}
$$('.mic').forEach(m => m.addEventListener('click', () => {
  if(!SR){ toast('このブラウザは音声入力に未対応です（Chrome か Edge で開いてください）'); return; }
  if(listening && rec){ rec.stop(); return; }
  listenOnce();
}));

/* =========================================================
   Tasks / Timers
   ========================================================= */
let tasks = store.get('tasks', [{ id:1, text:'APIキーを設定する', done:false }, { id:2, text:'チームに課題を投げてみる', done:false }]);
function saveTasks(){ store.set('tasks', tasks); O.touch(); }
function addTask(text){
  text = text.trim(); if(!text) return;
  tasks.unshift({ id:Date.now() + Math.random(), text, done:false }); saveTasks(); renderTasks();
  log('sys', 'タスク追加: ' + text.slice(0, 40));
}
function renderTasks(){
  const ul = $('#taskList'); ul.textContent = '';
  if(!tasks.length) ul.append(el('li', 'empty', 'タスクはありません。下の欄かJarvisに頼んで追加できます。'));
  tasks.forEach(t => {
    const li = el('li', 'task' + (t.done ? ' done' : ''));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = t.done; cb.setAttribute('aria-label', '完了にする');
    cb.onchange = () => { t.done = cb.checked; saveTasks(); renderTasks(); };
    const sp = el('span', '', t.text);
    const del = el('button', 'icon-btn', '×'); del.type = 'button'; del.setAttribute('aria-label', '削除');
    del.onclick = () => { tasks = tasks.filter(x => x !== t); saveTasks(); renderTasks(); };
    li.append(cb, sp, del); ul.append(li);
  });
  $('#taskCount').textContent = tasks.filter(t => !t.done).length + ' 件';
}
$('#taskForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#taskInput'); addTask(i.value); i.value = ''; });

let timers = [];
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`; };
function addTimer(sec, label){
  timers.push({ id:Date.now() + Math.random(), end:Date.now() + sec * 1000, total:sec * 1000, label });
  renderTimers(); log('sys', `タイマー開始: ${label} (${mmss(sec * 1000)})`);
}
function renderTimers(){
  const ul = $('#timerList'); ul.textContent = '';
  $('#timerCount').textContent = timers.length;
  if(!timers.length){ ul.append(el('li', 'empty', '動いているタイマーはありません。下のボタン、またはJarvisに頼んでください。')); return; }
  timers.forEach(t => {
    const li = el('li', 'timer-item'); li.dataset.id = t.id;
    const row = el('div', 'timer-row');
    const x = el('button', 'icon-btn', '×'); x.type = 'button'; x.setAttribute('aria-label', '取り消す');
    x.onclick = () => { timers = timers.filter(y => y !== t); renderTimers(); };
    row.append(el('span', 'lbl', t.label), el('span', 't', mmss(t.end - Date.now())), x);
    const bar = el('div', 'bar'); bar.append(el('i'));
    li.append(row, bar); ul.append(li);
  });
}
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .22, .44].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(.0001, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(.25, ctx.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d + .18);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .2);
    });
  }catch(e){}
}
function tick(){
  const now = Date.now(); const finished = [];
  timers.forEach(t => {
    const li = document.querySelector(`.timer-item[data-id="${t.id}"]`); const rem = t.end - now;
    if(rem <= 0){ finished.push(t); return; }
    if(li){ li.querySelector('.t').textContent = mmss(rem); li.querySelector('.bar i').style.width = (rem / t.total * 100) + '%'; }
  });
  if(finished.length){
    timers = timers.filter(t => !finished.includes(t)); renderTimers();
    finished.forEach(t => { log('sys', 'タイマー終了: ' + t.label); toast(`${t.label} の時間です`); addMsg('ai', `${t.label}が終わりました。`, { nosave:true }); });
    beep(); speak(`${finished[0].label}の時間です`);
  }
}
$$('.quick .btn').forEach(b => b.addEventListener('click', () => { const m = +b.dataset.min; addTimer(m * 60, `${m}分タイマー`); }));

/* =========================================================
   Weather
   ========================================================= */
function renderWeather(err){
  const b = $('#wxBody'); b.textContent = ''; $('#wxCity').textContent = O.city().name;
  const w = O.state.weather;
  if(!w){ b.append(el('p', 'empty', err || '天気を読み込み中…')); return; }
  const now = el('div', 'wx-now');
  const ico = el('div', 'wx-ico'); ico.dataset.k = w.now.kind; ico.innerHTML = O.weatherIcon(w.now.kind);
  const tx = el('div');
  const tp = el('div', 'wx-temp', String(Math.round(w.now.temp))); tp.append(el('small', '', '°C'));
  tx.append(tp, el('div', 'wx-label', `${w.now.label} ・ 体感${Math.round(w.now.feels)}°`));
  now.append(ico, tx);
  const days = el('div', 'wx-days'); const names = ['今日', '明日', '明後日'];
  w.days.slice(0, 3).forEach((d, i) => {
    const c = el('div', 'wx-day');
    c.append(document.createTextNode(`${names[i]} ${d.label}`), el('b', '', `${Math.round(d.max)}° / ${Math.round(d.min)}°`), document.createTextNode(`降水 ${d.pop}%`));
    days.append(c);
  });
  b.append(now, days);
}
async function loadWeather(){
  try{ O.state.weather = await O.fetchWeather(); renderWeather(); log('sys', `天気を取得: ${O.city().name}`); }
  catch(e){ O.state.weather = null; renderWeather(e.message); log('sys', '天気の取得に失敗: ' + e.message); }
}

/* =========================================================
   Calendar / Account
   ========================================================= */
function renderEvents(mode, msg){
  const box = $('#eventList'); box.textContent = ''; const meta = $('#eventMeta');
  if(!O.user){
    meta.textContent = '未ログイン';
    const c = cta('Googleでログインすると、今日の予定がここに並びます。', 'Googleでログイン', doLogin);
    const why = O.state.authError || (!O.fbReady && O.fbProblem);
    if(why) c.insertBefore(el('p', 'empty err-note', why), c.lastChild);
    box.append(c); return;
  }
  if(mode === 'error'){ meta.textContent = 'エラー'; box.append(cta(msg || '予定を読み込めませんでした。', '再読み込み', loadEvents)); return; }
  if(mode === 'expired' || (!O.google.valid && !O.state.events)){
    meta.textContent = '未連携';
    const c = cta('カレンダーと連携すると、今日の予定が表示されます。連携は約1時間で切れるので、切れたらもう一度押してください。', 'カレンダーと連携', doConnect);
    if(O.state.authError) c.insertBefore(el('p', 'empty err-note', O.state.authError), c.lastChild);
    box.append(c); return;
  }
  const ev = O.state.events || [];
  meta.textContent = ev.length + ' 件';
  if(!ev.length){ box.append(el('p', 'empty', '今日の予定はありません。')); return; }
  ev.forEach(e => {
    const r = el('div', 'ev');
    r.append(el('time', '', e.allDay ? '終日' : `${O.fmtTime(e.start)}-${O.fmtTime(e.end)}`), el('span', '', e.title));
    box.append(r);
  });
}
async function loadEvents(){
  if(!O.user){ O.state.events = null; renderEvents(); return; }
  if(!O.google.valid){ O.state.events = null; renderEvents('expired'); return; }
  try{
    O.state.events = await O.fetchEvents(); renderEvents();
    log('sys', `今日の予定を${O.state.events.length}件取得`);
  }catch(e){
    O.state.events = null;
    if(e.message === 'AUTH') renderEvents('expired'); else renderEvents('error', e.message);
  }
}
function authMessage(e){
  const c = e.code || '';
  const host = location.hostname || 'このサイト';
  const map = {
    'auth/unauthorized-domain':`このサイトのドメイン（${host}）がFirebaseの承認済みドメインにありません。Firebaseコンソール → Authentication → 設定 → 承認済みドメイン に追加してください`,
    'auth/operation-not-allowed':'FirebaseでGoogleログインが有効になっていません。Authentication → Sign-in method で Google を有効にしてください',
    'auth/popup-blocked':'ポップアップがブロックされました。アドレスバーの表示から、このサイトのポップアップを許可してください',
    'auth/popup-closed-by-user':'ログインの画面が閉じられました。Googleの画面にエラーが出ていた場合は、その文言を確認してください（テストユーザーに入っていない、など）',
    'auth/network-request-failed':'通信に失敗しました。ネットワークを確認してください',
    'auth/operation-not-supported-in-this-environment':'この開き方ではログインできません。GitHub Pagesか http://localhost で開いてください',
    'auth/invalid-api-key':'firebaseConfigのapiKeyが正しくありません。js/firebase-config.js を確認してください',
    'auth/user-mismatch':'ログイン中とは別のGoogleアカウントが選ばれました。同じアカウントを選んでください',
    'auth/credential-already-in-use':'このGoogleアカウントは別のユーザーで使われています。いったんログアウトしてください'
  };
  return map[c] || ('ログインできませんでした（' + (c || e.message) + '）');
}
function showAuthError(msg){
  O.state.authError = msg; toast(msg, 10000); log('sys', msg);
  renderEvents(); renderPhotos(); updateAccount();
}
async function doLogin(){
  if(!O.fbReady){ showAuthError(O.fbProblem || 'ログインの準備ができていません'); return; }
  O.state.authError = '';
  try{
    await O.signIn();
    toast('ログインしました。カレンダーとフォトは「連携」から許可してください');
  }catch(e){
    if(e.code === 'auth/cancelled-popup-request') return;
    showAuthError(authMessage(e));
  }
}
async function doConnect(){
  if(!O.fbReady){ showAuthError(O.fbProblem || 'ログインの準備ができていません'); return; }
  if(!O.user){ doLogin(); return; }
  O.state.authError = '';
  try{
    await O.connectGoogle();
    await loadEvents(); renderPhotos(); updateAccount();
    toast('カレンダーとフォトの権限を許可しました');
  }catch(e){
    if(e.code === 'auth/cancelled-popup-request') return;
    showAuthError(authMessage(e));
  }
}
function updateAccount(){
  const u = O.user;
  $('#loginBtn').hidden = !!u; $('#userChip').hidden = !u;
  const chip = $('#userChip'); chip.textContent = '';
  const pill = $('#pillGoogle');
  pill.classList.toggle('on', !!u);
  pill.textContent = u ? (O.google.valid ? 'Google 連携中' : 'Google ログイン済み') : 'Google 未ログイン';
  const box = $('#acctBox'); box.textContent = '';
  if(u){
    const first = (u.displayName || u.email || '').split(' ')[0];
    const mk = () => { const im = el('img', 'avatar'); im.src = u.photoURL; im.alt = ''; im.referrerPolicy = 'no-referrer'; return im; };
    if(u.photoURL) chip.append(mk());
    chip.append(document.createTextNode(first));
    const a = el('div', 'acct');
    if(u.photoURL) a.append(mk());
    const info = el('div'); info.append(el('b', '', u.displayName || 'ログイン中'), el('small', '', u.email || ''));
    a.append(info); box.append(a);
    const row = el('div', 'row');
    const re = el('button', 'btn', O.google.valid ? '連携を更新' : 'カレンダー・フォトを連携'); re.type = 'button'; re.onclick = () => { toggleDrawer(false); doConnect(); };
    const out = el('button', 'btn', 'ログアウト'); out.type = 'button';
    out.onclick = async () => { await O.signOut(); toggleDrawer(false); toast('ログアウトしました'); };
    row.append(re, out); box.append(row);
  }else{
    const b = el('button', 'btn primary', 'Googleでログイン'); b.type = 'button'; b.style.width = '100%';
    b.onclick = () => { toggleDrawer(false); doLogin(); };
    box.append(b);
    if(!O.fbReady && O.fbProblem) box.append(el('p', 'hint', 'ログインできません: ' + O.fbProblem));
  }
  updateHello();
}
let aiWas = O.anyKey();
O.onAuth = u => {
  updateAccount(); refreshPills();
  if(u){
    O.state.authError = '';
    log('sys', 'ログイン: ' + (u.email || u.displayName)); O.afterLogin(); O.hist.pull(); loadEvents(); renderPhotos();
    if(!aiWas && O.anyKey()){ log('sys', '共有プロキシ経由でAIが使えるようになりました'); loadNews(true); loadFeed(); }
  }else{ O.state.events = null; renderEvents(); renderPhotos(); }
  aiWas = O.anyKey();
};
O.onRemoteState = () => {
  tasks = store.get('tasks', []); feed = store.get('feed', []);
  renderTasks(); renderFeed(); renderScreen();
  const b = store.get('brief', ''); if(b) $('#briefLine').textContent = b;
};

/* =========================================================
   News (Gemini + Google検索)
   ========================================================= */
const DEMO_NEWS = [
  { title:'サンプル: ここに今日の主要ニュースが並びます', summary:'Geminiのキーを設定すると、Google検索を使った最新の見出しに置き換わります。' },
  { title:'サンプル: 見出しと一文の要約を表示', summary:'出典リンクも下に付きます。' },
  { title:'サンプル: 1日に数回だけ自動で更新', summary:'「更新」ボタンでいつでも取り直せます。' }
];
async function loadNews(force){
  const hasG = O.hasKey('gemini'); const c = store.get('news', null);
  if(!force && c && Date.now() - c.at < 3 * 3600e3 && !!c.demo === !hasG){ O.state.news = c; renderNews(); return; }
  if(!hasG){ O.state.news = { at:Date.now(), demo:true, items:DEMO_NEWS, sources:[] }; store.set('news', O.state.news); renderNews(); return; }
  renderNews('loading'); $('#newsRefresh').disabled = true;
  try{
    const today = new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' });
    const r = await O.callAI('gemini', {
      search:true, tag:'news', user:'news', temperature:.2,
      system:'あなたは落ち着いたニュース編集者です。事実だけを簡潔に伝え、憶測は書きません。',
      messages:[{ role:'user', content:`${today}の日本の主要ニュースをGoogle検索で調べ、重要度の高い順に5件。各行を「見出し｜一文の要約（40字以内）」の形式で出力。番号・記号・前置き・URLは書かない。` }]
    });
    let items = r.text.split('\n').map(l => l.replace(/^[\s\-*・\d.)]+/, '').trim()).filter(Boolean).map(l => {
      const m = l.split(/[｜|]/); return { title:(m[0] || '').trim(), summary:m.slice(1).join(' ').trim() };
    }).filter(i => i.title).slice(0, 6);
    if(!items.length) items = [{ title:r.text.trim().slice(0, 120), summary:'' }];
    const seen = new Set(); const sources = [];
    r.sources.forEach(s => { if(s.uri && !seen.has(s.uri) && sources.length < 5){ seen.add(s.uri); sources.push(s); } });
    O.state.news = { at:Date.now(), demo:false, items, sources, suggest:r.suggest || '' }; store.set('news', O.state.news);
    renderNews(); log('gemini', `ニュースを${items.length}件取得`);
  }catch(e){ renderNews('error', e.message); log('sys', 'ニュース取得失敗: ' + e.message); }
  finally{ $('#newsRefresh').disabled = false; }
}
function renderNews(mode, msg){
  const box = $('#newsList'); box.textContent = ''; const meta = $('#newsMeta');
  if(mode === 'loading'){ meta.textContent = ''; box.append(el('p', 'empty', 'Geminiが検索しています…')); return; }
  if(mode === 'error'){ meta.textContent = ''; box.append(el('p', 'empty', 'ニュースを取得できませんでした。' + (msg || ''))); return; }
  const n = O.state.news; if(!n){ box.append(el('p', 'empty', 'まだ取得していません。')); return; }
  meta.textContent = n.demo ? 'サンプル表示' : `更新 ${O.fmtTime(n.at)}`;
  n.items.forEach(i => {
    const d = el('div', 'news-item'); d.append(el('h4', '', i.title));
    if(i.summary) d.append(el('p', '', i.summary));
    box.append(d);
  });
  if(n.sources && n.sources.length){
    const s = el('div', 'srcs');
    n.sources.forEach(x => { const a = el('a', '', x.title); a.href = x.uri; a.target = '_blank'; a.rel = 'noopener noreferrer'; s.append(a); });
    box.append(s);
  }
  // Google検索の利用条件で、検索候補（Googleが返すHTML）の表示が必須。外部のHTMLなので、隔離したiframeに入れる
  if(n.suggest){
    const f = el('iframe', 'sg'); f.title = 'Google検索の候補';
    f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox'); f.srcdoc = n.suggest;
    box.append(f);
  }
}
$('#newsRefresh').addEventListener('click', () => loadNews(true));

/* =========================================================
   Screen time
   ========================================================= */
function renderScreen(){
  const b = $('#screenBody'); b.textContent = '';
  const k = O.todayKey(); const u = O.usage[k] || { app:0, device:null };
  const total = u.device != null ? u.device : u.app / 60;
  b.append(el('div', 'st-total', O.fmtMin(total)), el('div', 'st-cap', u.device != null ? '今日の端末合計（入力した値）' : '今日このアプリを開いていた時間'));
  const days = []; const base = new Date();
  for(let i = 6; i >= 0; i--){
    const d = new Date(base); d.setDate(base.getDate() - i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const x = O.usage[key]; days.push({ wd:WD[d.getDay()], v:x ? (x.device != null ? x.device : x.app / 60) : 0, today:i === 0 });
  }
  const max = Math.max(30, ...days.map(d => d.v));
  const bars = el('div', 'bars');
  days.forEach(d => {
    const c = el('div', d.today ? 'today' : ''); const i = el('i'); i.style.height = Math.max(3, d.v / max * 100) + '%'; i.title = O.fmtMin(d.v);
    c.append(i, document.createTextNode(d.wd)); bars.append(c);
  });
  b.append(bars);
  const f = el('form', 'st-form'); f.autocomplete = 'off';
  const inp = el('input', 'field'); inp.id = 'dvInput'; inp.type = 'number'; inp.min = '0'; inp.max = '1440'; inp.placeholder = '端末の合計(分)'; inp.setAttribute('aria-label', '端末の今日の合計（分）');
  if(u.device != null) inp.value = u.device;
  const sv = el('button', 'btn sm', '保存'); sv.type = 'submit';
  f.append(inp, sv);
  f.onsubmit = e => {
    e.preventDefault(); const v = Math.round(+inp.value);
    if(!(v >= 0 && v <= 1440)){ toast('0〜1440の分で入力してください'); return; }
    O.setDeviceMinutes(v); renderScreen(); toast('保存しました');
  };
  b.append(f, el('p', 'note-s', 'ブラウザからは端末全体の利用時間を読めません。iPhoneやAndroidの設定にある「今日の合計」を入力してください。自動取得はネイティブアプリ版で対応します。'));
}
O.onUsage = () => { if(document.activeElement && document.activeElement.id === 'dvInput') return; renderScreen(); };

/* =========================================================
   Photos
   ========================================================= */
let picking = false;
function renderPhotos(status, link){
  const b = $('#photoBody'); b.textContent = '';
  if(!O.user){ b.append(cta('Googleでログインすると、Googleフォトから写真を選んで表示できます。', 'Googleでログイン', doLogin)); return; }
  if(!O.google.valid){ b.append(cta('Googleフォトから選ぶには、先にカレンダー・フォトの権限を許可してください。', '権限を許可', doConnect)); return; }
  const ph = O.state.photos;
  if(ph.length){
    const g = el('div', 'ph-grid');
    ph.forEach(p => {
      if(p.url){ const im = el('img'); im.src = p.url; im.alt = p.name; g.append(im); }
      else g.append(el('div', 'ph-empty', p.name));
    });
    b.append(g);
  }else{
    b.append(el('p', 'empty', status || 'まだ写真を選んでいません。'));
  }
  if(link){ const a = el('a', '', '選択画面を開く'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.style.color = 'var(--sky)'; a.style.fontSize = '12.5px'; b.append(a); }
  const btn = el('button', 'btn sm', ph.length ? '選び直す' : '写真を選ぶ'); btn.type = 'button'; btn.disabled = picking; btn.style.marginTop = 'auto'; btn.style.alignSelf = 'flex-start';
  btn.onclick = pickPhotos; b.append(btn);
  b.append(el('p', 'note-s', 'Googleの仕様で、アプリが読めるのは、その場で選んだ写真だけです。'));
}
async function pickPhotos(){
  if(picking) return; picking = true; renderPhotos('準備しています…');
  try{
    O.state.photos = await O.pickPhotos((s, link) => renderPhotos(s, link));
    log('sys', `写真を${O.state.photos.length}枚選択`);
  }catch(e){
    if(e.message === 'AUTH'){ renderPhotos('接続が切れています。再接続してください。'); toast('Googleの接続が切れました。再接続してください'); }
    else{ toast(e.message); log('sys', 'フォト: ' + e.message); }
  }finally{ picking = false; renderPhotos(); }
}

/* =========================================================
   Agent Feed（Geminiが自由に情報を置き、提案する）
   ========================================================= */
let feed = store.get('feed', []);
let feedBusy = false;
function saveFeed(){ store.set('feed', feed); O.touch(); }
function pushCard(c){
  feed.unshift(Object.assign({ id:Date.now() + Math.random(), state:'new', at:Date.now() }, c));
  feed = feed.slice(0, 30); saveFeed(); renderFeed();
}
function renderFeed(){
  const box = $('#cards'); box.textContent = '';
  const vis = feed.filter(c => c.state !== 'dismissed');
  const at = store.get('feedAt', 0);
  $('#feedMeta').textContent = at ? `更新 ${O.fmtTime(at)}` : '';
  if(!vis.length){ box.append(el('p', 'empty', 'まだ提案がありません。「提案を更新」を押すと、Orbitが今日の状況を見て考えます。')); return; }
  vis.forEach(c => {
    const d = el('div', 'card' + (c.state === 'done' ? ' done' : '')); d.dataset.kind = c.kind;
    d.append(el('span', 'k', ({ suggest:'Suggestion', note:'Note', alert:'Heads up' })[c.kind] || c.kind), el('h3', '', c.title), el('p', '', c.body));
    if(c.state !== 'done'){
      const acts = el('div', 'acts');
      if(c.action){ const go = el('button', 'btn primary sm', actionLabel(c.action)); go.type = 'button'; go.onclick = () => execAction(c); acts.append(go); }
      const x = el('button', 'btn sm', c.action ? 'あとで' : 'OK'); x.type = 'button';
      x.onclick = () => { c.state = 'dismissed'; saveFeed(); renderFeed(); };
      acts.append(x); d.append(acts);
    }
    box.append(d);
  });
}
async function execAction(c){
  const a = c.action; if(!a) return;
  try{
    if(a.type === 'add_task') addTask(a.text);
    else if(a.type === 'set_timer') addTimer(a.seconds, a.label);
    else if(a.type === 'delegate'){ $('#teamTask').value = a.task; setView('team'); runTeam(a.task, false); }
    else if(a.type === 'add_event'){
      if(!O.google.valid){ toast('カレンダーと連携すると予定を追加できます'); doConnect(); return; }
      await O.createEvent(a); toast('Googleカレンダーに予定を追加しました'); log('sys', '予定を追加: ' + a.title); loadEvents();
    }
    c.state = 'done'; saveFeed(); renderFeed();
  }catch(e){
    if(e.message === 'AUTH'){ toast('Googleの接続が切れました。再接続してください'); renderEvents('expired'); }
    else toast('実行できませんでした: ' + e.message);
  }
}
function feedPrompt(){
  return `あなたはユーザー専属のマネージャー兼エージェント「Orbit」です。以下の状況を見て、いまやると良いことを提案してください。
JSONだけを返します。前後に文章やコードブロックは付けません。
{"brief":"今日の一言ブリーフ(2文以内。具体的で親しみやすく)","cards":[{"kind":"suggest","title":"短い見出し","body":"1〜2文","action":{}}]}
- cardsは3〜4件。kindは suggest(提案) / note(情報や気づきの共有) / alert(注意) のどれか。
- actionは任意。使えるのは次の4種類だけ。
  {"type":"add_task","text":"..."}
  {"type":"set_timer","seconds":600,"label":"..."}
  {"type":"delegate","task":"AIチームに任せる課題を具体的に"}
  {"type":"add_event","title":"...","start":"ISO8601(+09:00)","end":"ISO8601(+09:00)"}
- noteにはactionを付けない。押しつけず「〜してみませんか？」の口調で。
- 状況に書かれていない事実は作らない。予定が未接続ならその前提で。`;
}
function setBrief(t){ store.set('brief', t); $('#briefLine').textContent = t; O.touch(); }
async function loadFeed(){
  if(feedBusy) return; feedBusy = true; $('#feedRefresh').disabled = true; $('#feedMeta').textContent = '考え中…';
  try{
    const r = await O.callAI('gemini', { system:feedPrompt(), messages:[{ role:'user', content:contextText() }], json:true, tag:'feed', user:'feed', temperature:.7 });
    const j = O.safeJSON(r.text) || {};
    const arr = Array.isArray(j) ? j : (j.cards || []);
    const fresh = arr.slice(0, 5).map(c => ({
      id:Date.now() + Math.random(),
      kind:['suggest', 'note', 'alert'].includes(c.kind) ? c.kind : 'note',
      title:String(c.title || '').slice(0, 80), body:String(c.body || '').slice(0, 240),
      action:c.kind === 'note' ? null : cleanAction(c.action), state:'new', at:Date.now()
    })).filter(c => c.title);
    if(!fresh.length) throw new Error('提案を読み取れませんでした');
    feed = fresh.concat(feed.filter(c => c.state === 'done').slice(0, 6));
    if(typeof j.brief === 'string' && j.brief.trim()) setBrief(j.brief.trim().slice(0, 200));
    store.set('feedAt', Date.now()); saveFeed(); renderFeed();
    log(r.agent, `提案を${fresh.length}件作成${r.demo ? '（デモ）' : ''}`);
  }catch(e){ toast('提案の作成に失敗: ' + e.message); log('sys', '提案の作成に失敗: ' + e.message); renderFeed(); }
  finally{ feedBusy = false; $('#feedRefresh').disabled = false; }
}
$('#feedRefresh').addEventListener('click', loadFeed);

/* =========================================================
   Jarvis
   ========================================================= */
let chatHist = [];
function jarvisPrompt(){
  return `あなたは「Orbit」、映画のジャービスのように落ち着いて有能な日本語のマネージャー型AIアシスタントです。依頼に簡潔に答え、必要なら操作を実行します。
下の「状況」に書かれている予定・天気・タスクを根拠に答えてください。書かれていないことは分からないと伝えます。
必ず次の形式のJSONだけを返してください。前後に文章やコードブロックは付けません。
{"reply":"ユーザーへの返答(1〜3文)","actions":[]}
actionsには必要なものだけ入れます。
- {"type":"add_task","text":"タスク内容"}
- {"type":"set_timer","seconds":300,"label":"ラベル"}
- {"type":"delegate","task":"複数のAIに取り組ませる課題を具体的に"}  調査・企画・比較・文章作成など時間のかかる依頼に使う
- {"type":"add_event","title":"予定名","start":"ISO8601(+09:00)","end":"ISO8601(+09:00)"}  日時が明確なときだけ。実行前にユーザーの確認カードが出ます

状況:
${contextText()}`;
}
function parseJarvis(t){
  const j = O.safeJSON(t);
  if(j && typeof j.reply === 'string') return { reply:j.reply, actions:Array.isArray(j.actions) ? j.actions : [] };
  return { reply:(t || '').trim() || '…', actions:[] };
}
function addMsg(kind, text, opt = {}){
  const c = $('#chat'); const d = el('div', 'msg ' + kind);
  if(kind === 'ai'){
    const nm = opt.agent === 'team' ? 'TEAM' : (AGENTS[opt.agent] ? AGENTS[opt.agent].name.toUpperCase() : 'ORBIT');
    d.append(el('span', 'who', nm + (opt.demo ? ' · DEMO' : '')));
  }
  if(opt.thumbs && opt.thumbs.length){
    const row = el('div', 'thumbs');
    opt.thumbs.forEach(u => { const im = el('img'); im.src = u; im.alt = '添付画像'; row.append(im); });
    d.append(row);
  }
  d.append(document.createTextNode(text));
  const chips = (opt.chips || []).concat(opt.att || []);
  if(chips.length){
    const ch = el('div', 'chips'); chips.forEach(x => ch.append(el('span', 'chip', x))); d.append(ch);
  }
  c.append(d); c.scrollTop = c.scrollHeight;
  if(!opt.nosave && (kind === 'ai' || kind === 'err')) O.hist.add({ role:kind, text, agent:opt.agent, demo:opt.demo });
}
function newChat(){
  O.hist.newChat(); chatHist = []; $('#chat').textContent = '';
  addMsg('ai', '新しい会話を始めます。ご用件をどうぞ。', { nosave:true });
}
function resumeChat(c){
  O.hist.current = c.id; chatHist = []; $('#chat').textContent = '';
  c.messages.forEach(m => {
    if(m.role === 'user'){ addMsg('user', m.text, { att:m.att, nosave:true }); chatHist.push({ role:'user', content:m.text }); }
    else{ addMsg(m.role === 'err' ? 'err' : 'ai', m.text, { agent:m.agent, demo:m.demo, nosave:true }); if(m.role === 'ai') chatHist.push({ role:'assistant', content:m.text }); }
  });
  setView('jarvis'); toast('会話を再開しました');
}
async function sendChat(text){
  const att = O.attach.take();
  text = (text || '').trim();
  if(!text && !att.media.length && !att.texts.length) return;
  if(!text) text = att.media.length ? 'この添付の内容を教えて' : 'この添付の内容を見て';
  if('speechSynthesis' in window) speechSynthesis.cancel();
  let content = text;
  att.texts.forEach(t => { content += `\n\n[添付ファイル: ${t.name}]\n${t.text}`; });
  addMsg('user', text, { att:att.names, thumbs:att.thumbs, nosave:true });
  O.hist.ensure('jarvis', text); O.hist.add({ role:'user', text, att:att.names });
  const um = { role:'user', content }; if(att.media.length) um.media = att.media;
  chatHist.push(um); setOrb('thinking');
  const sent = chatHist.slice(-12).map(m => m === um ? m : { role:m.role, content:m.content });
  try{
    const res = await O.callAI(att.media.length ? 'gemini' : $('#brain').value, { system:jarvisPrompt(), messages:sent, json:true, tag:'jarvis', user:text, temperature:.5, maxTokens:att.media.length ? 3000 : undefined });
    const out = parseJarvis(res.text);
    delete um.media;
    chatHist.push({ role:'assistant', content:res.text });
    const acts = out.actions.slice(0, 4).map(cleanAction).filter(Boolean);
    log(res.agent, 'Jarvis: ' + out.reply.slice(0, 70));
    addMsg('ai', out.reply, { agent:res.agent, demo:res.demo, chips:acts.map(a => ({ add_task:'タスク追加', set_timer:'タイマー', delegate:'チームへ依頼', add_event:'予定の確認カード' })[a.type]) });
    runActions(acts); speak(out.reply);
  }catch(e){
    delete um.media;
    addMsg('err', e.message); log('sys', 'エラー: ' + e.message); setOrb('idle');
  }
}
function runActions(list){
  list.forEach(a => {
    if(a.type === 'add_task') addTask(a.text);
    else if(a.type === 'set_timer') addTimer(a.seconds, a.label);
    else if(a.type === 'delegate'){ $('#teamTask').value = a.task; runTeam(a.task, true); }
    else if(a.type === 'add_event'){
      pushCard({ kind:'suggest', title:`予定を追加: ${a.title}`, body:`${new Date(a.start).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })} から ${O.fmtTime(a.end)}。よければ「予定に入れる」を押してください。`, action:a });
      toast('予定の確認カードをフィードに出しました');
    }
  });
}
O.demoJarvis = function(text){
  const acts = []; let reply = '';
  const tm = text.match(/(\d+)\s*(時間|分|秒)/);
  if(tm && /タイマー|計って|後に|あとで/.test(text)){
    const n = +tm[1]; const s = tm[2] === '時間' ? n * 3600 : tm[2] === '分' ? n * 60 : n;
    acts.push({ type:'set_timer', seconds:s, label:`${tm[1]}${tm[2]}タイマー` });
    reply = `${tm[1]}${tm[2]}のタイマーをセットしました。`;
  }else if(/タスク|todo|やること/i.test(text)){
    const t = text.replace(/(を|に|へ)?(タスク|todo|やること).*$/i, '').trim() || text;
    acts.push({ type:'add_task', text:t }); reply = `「${t}」をタスクに追加しました。`;
  }else if(/予定/.test(text)){
    const ev = O.state.events;
    reply = ev && ev.length ? '今日の予定は、' + ev.map(e => `${e.allDay ? '終日' : O.fmtTime(e.start)}から${e.title}`).join('、') + 'です。'
      : ev ? '今日の予定はありません。' : 'カレンダーはまだ接続されていません。右上からGoogleでログインしてください。';
  }else if(/天気|気温|傘/.test(text)){
    const w = O.state.weather;
    reply = w ? `${O.city().name}は${w.now.label}、いま${Math.round(w.now.temp)}度です。今日は最高${Math.round(w.days[0].max)}度、降水確率は${w.days[0].pop}%です。` : '天気をまだ取得できていません。';
  }else if(/考えて|調べ|企画|比較|まとめ|計画|アイデア/.test(text)){
    acts.push({ type:'delegate', task:text }); reply = '承知しました。AIチームに振り分けます。';
  }else{
    reply = 'いまはデモモードです。メニューの設定でGroqかGeminiのAPIキーを入れると、実際のモデルが答えます。';
  }
  return JSON.stringify({ reply, actions:acts });
};
$('#composer').addEventListener('submit', e => { e.preventDefault(); const i = $('#chatInput'); const v = i.value; i.value = ''; sendChat(v); });
$('#briefForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#briefInput'); const v = i.value; i.value = ''; if(v.trim()) handleVoice(v); });
$$('#suggest button').forEach(b => b.addEventListener('click', () => sendChat(b.textContent)));

/* AI Teamの本体は js/team.js */
const runTeam = (t, fromChat) => O.runTeam(t, !!fromChat);

/* =========================================================
   メニュー（ハンバーガー）と画面切り替え
   ========================================================= */
const TILE = { brief:'.brief', weather:'.weather', feed:'.feed', events:'.events', tasks:'.tasks', news:'.news', screen:'.screen', photos:'.photos', timers:'.timers', jarvis:'.jarvis', team:'.team', history:'.history', vision:'.vision', log:'.log' };
const HOME = ['brief', 'weather', 'feed', 'events', 'tasks', 'news', 'screen', 'photos', 'timers'];
function setView(v){
  const single = v !== 'home' && TILE[v] ? v : null;
  $('#bento').classList.toggle('single', !!single);
  Object.keys(TILE).forEach(k => { $(TILE[k]).hidden = single ? k !== single : !HOME.includes(k); });
  $$('.nav-item').forEach(n => n.setAttribute('aria-current', String(n.dataset.view === (single || 'home'))));
  store.set('view', single || 'home'); window.scrollTo({ top:0 });
  if(single === 'history') O.hist.render();
}
const drawer = $('#drawer'), scrim = $('#scrim'), burger = $('#burger');
function toggleDrawer(open){
  drawer.classList.toggle('open', open); scrim.classList.toggle('show', open);
  burger.setAttribute('aria-expanded', String(open)); drawer.setAttribute('aria-hidden', String(!open));
  burger.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  if(open){ const cur = drawer.querySelector('.nav-item[aria-current="true"]'); if(cur) cur.focus(); } else burger.focus();
}
burger.addEventListener('click', () => toggleDrawer(!drawer.classList.contains('open')));
scrim.addEventListener('click', () => toggleDrawer(false));
$('#closeDrawer').addEventListener('click', () => toggleDrawer(false));
document.addEventListener('keydown', e => { if(e.key === 'Escape' && drawer.classList.contains('open')) toggleDrawer(false); });
$$('.nav-item').forEach(n => n.addEventListener('click', () => { setView(n.dataset.view); toggleDrawer(false); }));
$('#brain').addEventListener('change', () => { updateJarvisMeta(); toast('Jarvisの頭脳: ' + AGENTS[$('#brain').value].name); log('sys', '頭脳を切り替え: ' + AGENTS[$('#brain').value].name); });
$('#userChip').addEventListener('click', () => toggleDrawer(true));
$('#loginBtn').addEventListener('click', doLogin);
$('#drawerSettings').addEventListener('click', () => { toggleDrawer(false); openSettings(); });
$('#drawerConnectors').addEventListener('click', () => { toggleDrawer(false); O.connectors.open(); });
$('#newChatBtn').addEventListener('click', newChat);
$('#histBtn').addEventListener('click', () => setView('history'));
O.ui = { addMsg, speak, setView, addTask, sendChat, resumeChat, loadEvents, doConnect, doLogin, toggleDrawer, openConnectors:() => O.connectors.open() };

/* =========================================================
   設定
   ========================================================= */
function refreshPills(){
  const g = $('#pillGroq'), m = $('#pillGemini');
  const st = p => O.ownKey(p) ? '自分のキー' : (p === 'gemini' && O.aiReady) ? 'AI Logic' : O.proxyOn() ? '共有' : '未設定';
  g.classList.toggle('on', O.hasKey('groq')); m.classList.toggle('on', O.hasKey('gemini'));
  g.textContent = 'Groq ' + st('groq');
  m.textContent = 'Gemini ' + st('gemini');
  $('#pillDemo').style.display = O.anyKey() ? 'none' : '';
}
function pickBrain(){
  const sel = $('#brain');
  if(O.hasKey('gemini')) sel.value = 'gemini'; else if(O.hasKey('groq')) sel.value = 'llama';
  updateJarvisMeta();
}
const dlg = $('#settings');
function openSettings(){
  const c = O.cfg;
  $('#groqKey').value = c.groqKey; $('#geminiKey').value = c.geminiKey;
  $('#mGemini').value = c.models.gemini; $('#mLlama').value = c.models.llama; $('#mGpt').value = c.models.gpt;
  $('#profile').value = c.profile; $('#cityKey').value = c.cityKey;
  $('#rememberKeys').checked = c.rememberKeys !== false; $('#proxyUrl').value = c.proxyUrl; $('#recaptchaKey').value = c.recaptchaKey;
  $('#voiceOn').checked = !!c.voice; $('#wakeOn').checked = !!c.wake;
  dlg.showModal();
}
$('#cancelSettings').addEventListener('click', () => dlg.close());
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const c = O.cfg; const hadKey = O.anyKey(); const oldCity = c.cityKey; const oldRk = c.recaptchaKey;
  c.rememberKeys = $('#rememberKeys').checked; c.proxyUrl = $('#proxyUrl').value.trim(); c.recaptchaKey = $('#recaptchaKey').value.trim();
  c.groqKey = $('#groqKey').value.trim(); c.geminiKey = $('#geminiKey').value.trim();
  c.models = { gemini:$('#mGemini').value.trim() || O.defaults.models.gemini, llama:$('#mLlama').value.trim() || O.defaults.models.llama, gpt:$('#mGpt').value.trim() || O.defaults.models.gpt };
  c.profile = $('#profile').value.trim(); c.cityKey = $('#cityKey').value;
  c.voice = $('#voiceOn').checked; c.wake = $('#wakeOn').checked;
  if(c.cityKey === 'geo'){
    try{ c.geo = await O.geoLocate(); }catch(err){ toast(err.message); c.cityKey = 'tokyo'; }
  }
  O.saveCfg(); dlg.close(); refreshPills(); pickBrain(); log('sys', '設定を保存');
  if(c.wake) startWake(); else stopWake();
  if(c.recaptchaKey !== oldRk){ toast('reCAPTCHAの設定を反映するため再読み込みします'); setTimeout(() => location.reload(), 1100); return; }
  if(c.cityKey !== oldCity || c.cityKey === 'geo') loadWeather();
  if(!hadKey && O.anyKey()){ toast('保存しました。実際のモデルで動きます'); await loadNews(true); loadFeed(); }
  else toast(O.anyKey() ? '保存しました' : '保存しました（キー未設定のためデモモード）');
});

/* =========================================================
   Hello / 日付
   ========================================================= */
function updateHello(){
  const d = new Date(), h = d.getHours();
  const w = h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは';
  const name = O.user && (O.user.displayName || '').split(' ')[0];
  $('#hello').textContent = name ? `${w}、${name}さん` : w;
  $('#briefDate').textContent = `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}） ${pad(h)}:${pad(d.getMinutes())}`;
}

/* =========================================================
   起動
   ========================================================= */
(function boot(){
  refreshPills(); pickBrain();
  renderTasks(); renderTimers(); renderFeed(); renderScreen(); renderPhotos(); renderWeather(); renderEvents();
  setOrb('idle'); updateHello(); updateAccount();
  $('#briefLine').textContent = store.get('brief', '') || '「提案を更新」を押すと、今日の状況を見てまとめます。';
  setView(store.get('view', 'home'));
  O.startUsageTracker();
  setInterval(tick, 300); setInterval(updateHello, 30000);

  const fb = O.initFirebase();
  if(!fb) updateAccount();
  if(O.cfg.wake) startWake();

  log('sys', '起動');
  loadWeather();
  // Gemini用のFirebase AI Logic（鍵なし）を先に準備してから、AIを使う処理を始める
  O.initAI().catch(() => false).then(() => {
    refreshPills(); pickBrain(); aiWas = O.anyKey();
    if(O.aiReady) log('gemini', 'Firebase AI Logic に接続しました（鍵なしでGeminiが使えます）');
    else if(O.aiProblem) log('sys', O.aiProblem);
    addMsg('ai', O.anyKey() ? 'Orbit、起動しました。ご用件をどうぞ。' : 'Orbit、起動しました。いまはデモモードです。メニューの設定にGroqかGeminiのAPIキーを入れると、実際のAIが動きます。', { agent:null, nosave:true });
    return Promise.allSettled([loadNews(false), O.user ? loadEvents() : Promise.resolve()]);
  }).then(() => {
    const at = store.get('feedAt', 0);
    const stale = !at || Date.now() - at > 6 * 3600e3 || new Date(at).toDateString() !== new Date().toDateString();
    if(!feed.length || (O.anyKey() && stale)) loadFeed();
  });
})();
})();
