/* services.js: 天気・Googleログイン・カレンダー・フォト・利用時間・Firestore同期 */
(function(){
'use strict';
const O = window.O;
O.state = { weather:null, events:null, news:null, photos:[] };

/* ---------- Weather (Open-Meteo, キー不要) ---------- */
function wxInfo(c){
  if(c === 0) return { label:'快晴', kind:'sun' };
  if(c <= 2)  return { label:'晴れ時々くもり', kind:'sun-cloud' };
  if(c === 3) return { label:'くもり', kind:'cloud' };
  if(c === 45 || c === 48) return { label:'霧', kind:'fog' };
  if(c >= 51 && c <= 57) return { label:'霧雨', kind:'rain' };
  if(c >= 61 && c <= 67) return { label:'雨', kind:'rain' };
  if(c >= 71 && c <= 77) return { label:'雪', kind:'snow' };
  if(c >= 80 && c <= 82) return { label:'にわか雨', kind:'rain' };
  if(c === 85 || c === 86) return { label:'雪', kind:'snow' };
  if(c >= 95) return { label:'雷雨', kind:'storm' };
  return { label:'—', kind:'cloud' };
}
const CLOUD = '<path d="M15 36a8 8 0 0 1 .8-15.9A10.5 10.5 0 0 1 36 19.5 8.3 8.3 0 0 1 36 36H15z"/>';
O.weatherIcon = function(kind){
  const body = {
    'sun': '<circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/>',
    'sun-cloud': '<circle cx="17" cy="16" r="6"/><path d="M17 4v3M5 16h3M8.5 7.5l2 2M25.5 7.5l-2 2"/><path d="M19 38a7 7 0 0 1 .7-13.9A9 9 0 0 1 37 26a7.2 7.2 0 0 1 0 12H19z"/>',
    'cloud': CLOUD,
    'rain': CLOUD + '<path d="M18 40l-2 5M26 40l-2 5M34 40l-2 5"/>',
    'snow': CLOUD + '<path d="M18 42h.01M26 44h.01M34 42h.01"/>',
    'storm': CLOUD + '<path d="M26 37l-5 6h6l-4 6"/>',
    'fog': '<path d="M8 16h32M12 24h28M8 32h32M14 40h22"/>'
  }[kind] || CLOUD;
  return `<svg viewBox="0 0 48 52" aria-hidden="true">${body}</svg>`;
};
O.fetchWeather = async function(){
  const c = O.city();
  const q = new URLSearchParams({
    latitude:c.lat, longitude:c.lon, timezone:'auto', forecast_days:'3',
    current:'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
  });
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
  if(!r.ok) throw new Error('天気の取得に失敗しました (HTTP ' + r.status + ')');
  const j = await r.json();
  const cur = j.current, d = j.daily;
  const info = wxInfo(cur.weather_code);
  return {
    now:{ temp:cur.temperature_2m, feels:cur.apparent_temperature, wind:cur.wind_speed_10m, label:info.label, kind:info.kind },
    days:d.time.map((t, i) => ({ date:t, max:d.temperature_2m_max[i], min:d.temperature_2m_min[i], pop:d.precipitation_probability_max[i] ?? 0, code:d.weather_code[i], ...wxInfo(d.weather_code[i]) }))
  };
};
O.geoLocate = () => new Promise((res, rej) => {
  if(!navigator.geolocation) return rej(new Error('このブラウザは位置情報に未対応です'));
  navigator.geolocation.getCurrentPosition(
    p => res({ name:'現在地', lat:p.coords.latitude, lon:p.coords.longitude }),
    e => rej(new Error('位置情報を取得できませんでした')),
    { timeout:8000 });
});

/* ---------- Firebase AI Logic（Geminiを鍵なしで使う） ----------
   AI LogicのSDKはモジュール形式だけなので、必要になった時点でgstatic(Google)から読み込む。
   Firebaseコンソールで AI Logic を有効にし、Gemini Developer API を選んであることが前提。 */
const FIREBASE_MODULAR = '12.14.0';
O.aiProblem = '';
O.initAI = async function(){
  const conf = window.FIREBASE_CONFIG;
  if(location.protocol === 'file:' || !conf || !conf.apiKey) return false;
  try{
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_MODULAR}/`;
    const [appM, aiM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-ai.js')]);
    const app = appM.getApps().find(a => a.name === 'orbit-ai') || appM.initializeApp(conf, 'orbit-ai');
    O._ai = { M:aiM, inst:aiM.getAI(app, { backend:new aiM.GoogleAIBackend() }) };
    O.aiReady = true;
    return true;
  }catch(e){
    console.error(e); O.aiProblem = 'Firebase AI Logicを読み込めませんでした: ' + (e.code || e.message);
    return false;
  }
};
O.aiGenerate = async function(model, o){
  const { M, inst } = O._ai;
  const gc = { temperature:o.temperature ?? 0.7 };
  const params = { model, generationConfig:gc };
  if(o.system) params.systemInstruction = o.system;
  if(o.search) params.tools = [{ googleSearch:{} }];            // 検索連携とJSONモードは併用しない
  else if(o.json) gc.responseMimeType = 'application/json';
  const m = M.getGenerativeModel(inst, params);
  let res;
  try{
    res = await m.generateContent({ contents:o.messages.map(x => ({ role:x.role === 'assistant' ? 'model' : 'user', parts:[{ text:x.content }] })) });
  }catch(e){
    throw new Error('Gemini(AI Logic): ' + String(e.message || e.code || e).slice(0, 240));
  }
  let text = '';
  try{ text = res.response.text(); }catch(e){ throw new Error('Gemini(AI Logic): ' + String(e.message || e).slice(0, 200)); }
  if(!text) throw new Error('Gemini(AI Logic): 空の応答（安全フィルタの可能性）');
  const gm = res.response.candidates && res.response.candidates[0] && res.response.candidates[0].groundingMetadata;
  const sources = ((gm && gm.groundingChunks) || []).map(c => c.web).filter(Boolean).map(w => ({ title:w.title || w.uri, uri:w.uri }));
  return { text, sources, suggest:(gm && gm.searchEntryPoint && gm.searchEntryPoint.renderedContent) || '' };
};

/* ---------- Google token ---------- */
O.SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
];
O.google = { token:null, exp:0, get valid(){ return !!this.token && Date.now() < this.exp; } };
(function loadToken(){
  try{
    const t = JSON.parse(sessionStorage.getItem('orbit.gtoken'));
    if(t && t.exp > Date.now()){ O.google.token = t.token; O.google.exp = t.exp; }
  }catch(e){}
})();
function saveToken(tok){
  O.google.token = tok; O.google.exp = Date.now() + 55 * 60 * 1000;
  try{ sessionStorage.setItem('orbit.gtoken', JSON.stringify({ token:tok, exp:O.google.exp })); }catch(e){}
}
function dropToken(){
  O.google.token = null; O.google.exp = 0;
  try{ sessionStorage.removeItem('orbit.gtoken'); }catch(e){}
}
O.dropToken = dropToken;

/* ---------- Firebase Auth ---------- */
O.fbReady = false; O.user = null; O.fbProblem = '';
O.initFirebase = function(){
  if(location.protocol === 'file:'){ O.fbProblem = 'ファイルとして開いているため、Googleログインは使えません。GitHub Pagesか http://localhost で開いてください'; return false; }
  if(typeof firebase === 'undefined'){ O.fbProblem = 'FirebaseのSDKを読み込めませんでした。通信状況を確認してください'; return false; }
  const conf = window.FIREBASE_CONFIG;
  if(!conf || !conf.apiKey){ O.fbProblem = 'js/firebase-config.js に firebaseConfig が入っていません'; return false; }
  try{
    if(!firebase.apps.length) firebase.initializeApp(conf);
    const rk = (O.cfg.recaptchaKey || window.RECAPTCHA_SITE_KEY || '').trim();
    if(rk && firebase.appCheck){
      try{ firebase.appCheck().activate(new firebase.appCheck.ReCaptchaV3Provider(rk), true); O.appCheckReady = true; }
      catch(e){ console.error(e); }
    }
    O.auth = firebase.auth(); O.db = firebase.firestore();
    O.fbReady = true;
    O.auth.onAuthStateChanged(u => { O.user = u; if(O.onAuth) O.onAuth(u); });
    return true;
  }catch(e){ console.error(e); O.fbProblem = 'Firebaseの初期化に失敗しました: ' + (e.code || e.message); return false; }
};
/* ログイン（名前とメールだけ。ここは機密性の高い権限を求めないので、設定が合っていれば通る） */
O.signIn = async function(){
  if(!O.fbReady) throw new Error(O.fbProblem || 'ログインの準備ができていません');
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt:'select_account' });
  return (await O.auth.signInWithPopup(p)).user;
};
/* ログイン済みのアカウントに、カレンダーとフォトの権限を追加で許可してもらう */
O.connectGoogle = async function(){
  if(!O.fbReady || !O.user) throw new Error('先にGoogleでログインしてください');
  const p = new firebase.auth.GoogleAuthProvider();
  O.SCOPES.forEach(s => p.addScope(s));
  const res = await O.user.reauthenticateWithPopup(p);
  const cred = res.credential;
  if(!(cred && cred.accessToken)) throw new Error('アクセス権のトークンを受け取れませんでした');
  saveToken(cred.accessToken);
  return res.user;
};
O.signOut = async function(){
  if(O.auth) await O.auth.signOut();
  dropToken(); O.state.events = null; O.state.photos = [];
};

/* ---------- Google Calendar ---------- */
async function gfetch(url, opts){
  if(!O.google.valid) throw new Error('AUTH');
  const o = Object.assign({}, opts);
  o.headers = Object.assign({ Authorization:'Bearer ' + O.google.token }, o.headers || {});
  const r = await fetch(url, o);
  if(r.status === 401){ dropToken(); throw new Error('AUTH'); }
  if(r.status === 403){
    let m = ''; try{ m = (await r.json()).error.message; }catch(e){}
    throw new Error('Googleが許可しませんでした: ' + (m || 'HTTP 403'));
  }
  if(!r.ok) throw new Error('Google API: HTTP ' + r.status);
  return r;
}
O.fetchEvents = async function(){
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const q = new URLSearchParams({ timeMin:start.toISOString(), timeMax:end.toISOString(), singleEvents:'true', orderBy:'startTime', maxResults:'25' });
  const r = await gfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q);
  const j = await r.json();
  return (j.items || []).filter(e => e.status !== 'cancelled').map(e => ({
    id:e.id, title:e.summary || '(無題)', allDay:!!(e.start && e.start.date),
    start:(e.start && (e.start.dateTime || e.start.date)) || '', end:(e.end && (e.end.dateTime || e.end.date)) || '',
    location:e.location || ''
  }));
};
O.createEvent = async function(ev){
  const s = new Date(ev.start), e = new Date(ev.end);
  if(isNaN(s) || isNaN(e) || e <= s) throw new Error('予定の日時が正しくありません');
  const r = await gfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ summary:String(ev.title).slice(0, 200), start:{ dateTime:s.toISOString() }, end:{ dateTime:e.toISOString() } })
  });
  return r.json();
};

/* ---------- Google Photos (Picker API: 選んだ写真だけ読める) ---------- */
O.pickPhotos = async function(onStatus){
  if(!O.google.valid) throw new Error('AUTH');
  const H = { Authorization:'Bearer ' + O.google.token, 'Content-Type':'application/json' };
  let r = await fetch('https://photospicker.googleapis.com/v1/sessions', { method:'POST', headers:H, body:JSON.stringify({ pickingConfig:{ maxItemCount:'6' } }) });
  if(r.status === 401){ dropToken(); throw new Error('AUTH'); }
  if(!r.ok) throw new Error('フォトの選択画面を開けませんでした (HTTP ' + r.status + ')');
  const s = await r.json();
  const w = window.open(s.pickerUri + '/autoclose', '_blank');
  if(onStatus) onStatus(w ? 'Googleフォトの画面で写真を選んでください…' : 'ポップアップが止められました。下のリンクから開いてください', s.pickerUri);
  const interval = Math.max(2000, (parseFloat(s.pollingConfig && s.pollingConfig.pollInterval) || 5) * 1000);
  const deadline = Date.now() + (parseFloat(s.pollingConfig && s.pollingConfig.timeoutIn) || 300) * 1000;
  let done = false;
  while(Date.now() < deadline){
    await O.sleep(interval);
    const p = await fetch('https://photospicker.googleapis.com/v1/sessions/' + encodeURIComponent(s.id), { headers:H });
    if(!p.ok) continue;
    const j = await p.json();
    if(j.mediaItemsSet){ done = true; break; }
  }
  if(!done) throw new Error('時間内に写真が選ばれませんでした');
  r = await fetch('https://photospicker.googleapis.com/v1/mediaItems?sessionId=' + encodeURIComponent(s.id) + '&pageSize=6', { headers:H });
  if(!r.ok) throw new Error('選んだ写真を読み込めませんでした (HTTP ' + r.status + ')');
  const items = (await r.json()).mediaItems || [];
  const out = [];
  for(const it of items){
    const f = it.mediaFile || {};
    if(!f.baseUrl || (f.mimeType && !/^image\//.test(f.mimeType))) continue;
    try{
      const ir = await fetch(f.baseUrl + '=w400-h400-c', { headers:{ Authorization:'Bearer ' + O.google.token } });
      if(!ir.ok) throw new Error('x');
      out.push({ id:it.id, name:f.filename || '', url:URL.createObjectURL(await ir.blob()) });
    }catch(e){ out.push({ id:it.id, name:f.filename || '写真', url:null }); }
  }
  fetch('https://photospicker.googleapis.com/v1/sessions/' + encodeURIComponent(s.id), { method:'DELETE', headers:H }).catch(() => {});
  return out;
};

/* ---------- Screen time (このアプリの利用時間 + 手入力の端末合計) ---------- */
O.usage = O.store.get('usage', {});
function pruneUsage(){
  const keys = Object.keys(O.usage).sort();
  while(keys.length > 14) delete O.usage[keys.shift()];
}
O.startUsageTracker = function(){
  let n = 0;
  setInterval(() => {
    if(document.hidden || !document.hasFocus()) return;
    const k = O.todayKey();
    const u = O.usage[k] || (O.usage[k] = { app:0, device:null });
    u.app += 5; n++;
    if(n % 6 === 0){ pruneUsage(); O.store.set('usage', O.usage); if(O.onUsage) O.onUsage(); }
    if(n % 60 === 0) O.touch();
  }, 5000);
};
O.setDeviceMinutes = function(min){
  const k = O.todayKey();
  const u = O.usage[k] || (O.usage[k] = { app:0, device:null });
  u.device = min; O.store.set('usage', O.usage); O.touch();
};

/* ---------- Firestore sync (ログイン中だけ。APIキーは含めない) ---------- */
O.getState = () => ({
  tasks:O.store.get('tasks', []), feed:O.store.get('feed', []), usage:O.usage, brief:O.store.get('brief', '')
});
O.touch = function(){
  O.store.set('updatedAt', Date.now());
  clearTimeout(O._pushT); O._pushT = setTimeout(O.push, 1800);
};
O.push = async function(){
  if(!O.user || !O.db) return;
  try{
    await O.db.doc(`users/${O.user.uid}/app/state`).set(Object.assign(O.getState(), { updatedAt:O.store.get('updatedAt', Date.now()) }));
  }catch(e){ O.log('sys', '同期に失敗: ' + (e.code || e.message)); }
};
O.afterLogin = async function(){
  if(!O.user || !O.db) return;
  try{
    const snap = await O.db.doc(`users/${O.user.uid}/app/state`).get();
    const local = O.store.get('updatedAt', 0);
    if(snap.exists && (snap.data().updatedAt || 0) > local){
      const d = snap.data();
      O.store.set('tasks', d.tasks || []); O.store.set('feed', d.feed || []); O.store.set('brief', d.brief || '');
      O.usage = d.usage || {}; O.store.set('usage', O.usage); O.store.set('updatedAt', d.updatedAt);
      if(O.onRemoteState) O.onRemoteState();
      O.log('sys', 'クラウドのデータを読み込みました');
    }else{
      O.touch();
    }
  }catch(e){
    O.log('sys', '同期に失敗: ' + (e.code || e.message));
    if(e.code === 'permission-denied') O.toast('Firestoreのルールが未設定です（READMEを参照）');
  }
};
})();
