/* core.js: 共通の道具（保存・設定・ログ・AI呼び出し・デモ） */
(function(){
'use strict';
const O = window.O = window.O || {};
const $ = O.$ = s => document.querySelector(s);
O.$$ = s => Array.from(document.querySelectorAll(s));
O.sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = O.pad = n => String(n).padStart(2, '0');

/* ---------- storage ---------- */
O.store = {
  get(k, d){ try{ const v = localStorage.getItem('orbit.' + k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('orbit.' + k, JSON.stringify(v)); }catch(e){} }
};

/* ---------- settings ---------- */
O.CITIES = {
  tokyo:  { name:'東京',   lat:35.6762, lon:139.6503 },
  osaka:  { name:'大阪',   lat:34.6937, lon:135.5023 },
  nagoya: { name:'名古屋', lat:35.1815, lon:136.9066 },
  sapporo:{ name:'札幌',   lat:43.0618, lon:141.3545 },
  fukuoka:{ name:'福岡',   lat:33.5902, lon:130.4017 },
  naha:   { name:'那覇',   lat:26.2124, lon:127.6809 }
};
const defaults = {
  groqKey:'', geminiKey:'', rememberKeys:true, proxyUrl:'', recaptchaKey:'',
  voice:true, wake:false, profile:'', voiceName:'', rate:1, pitch:1, ttsEngine:'browser', vvUrl:'http://localhost:50021', vvSpeaker:3,
  cityKey:'tokyo', geo:null,
  // AIの「状況まとめ」に含める情報（コネクタ画面で切り替える）
  share:{ events:true, tasks:true, weather:true, news:true, screen:true, profile:true, drive:true, write:true },
  models:{ gemini:'gemini-3.6-flash', llama:'qwen/qwen3.8-27b', gpt:'openai/gpt-oss-120b' }
};
O.defaults = defaults;
O.cfg = Object.assign({}, defaults, O.store.get('cfg', {}));
O.cfg.models = Object.assign({}, defaults.models, O.cfg.models || {});
O.cfg.share = Object.assign({}, defaults.share, O.cfg.share || {});
O.cfg.ext = Object.assign({ gmail:false, chat:false }, O.cfg.ext || {});   // 読み取り専用の追加権限。使うと決めたときだけ許可を求める
// 以前に保存された古いGeminiのモデル名（2.0/2.5系は終了）は、新しい既定に自動で置き換える
if(/^gemini-2\.[05]/.test(O.cfg.models.gemini || '')) O.cfg.models.gemini = defaults.models.gemini;
// Groqで終了したLlamaは、後継の既定に置き換える（無料・開発者アカウントは2026/8/16に利用不可）
if(/^(meta-llama\/)?llama-|qwen3\.6/.test(O.cfg.models.llama || '')) O.cfg.models.llama = defaults.models.llama;
delete O.cfg.fbConfig;   // firebaseConfigは js/firebase-config.js だけに書く（以前の設定画面の値は使わない）
/* APIキーは設定本体とは別の入れ物に保存する。
   「このブラウザに保存する」をオフにすると、タブを閉じるまでしか残さない。 */
function readKeys(){
  for(const st of [localStorage, sessionStorage]){
    try{ const v = st.getItem('orbit.keys'); if(v) return JSON.parse(v); }catch(e){}
  }
  return {};
}
const savedKeys = readKeys();
O.cfg.groqKey = savedKeys.groqKey || O.cfg.groqKey || '';
O.cfg.geminiKey = savedKeys.geminiKey || O.cfg.geminiKey || '';
O.saveCfg = function(){
  const { groqKey, geminiKey, ...rest } = O.cfg;
  O.store.set('cfg', rest);
  try{ localStorage.removeItem('orbit.keys'); sessionStorage.removeItem('orbit.keys'); }catch(e){}
  try{ (O.cfg.rememberKeys !== false ? localStorage : sessionStorage).setItem('orbit.keys', JSON.stringify({ groqKey, geminiKey })); }catch(e){}
};
O.city = () => (O.cfg.cityKey === 'geo' && O.cfg.geo) ? O.cfg.geo : (O.CITIES[O.cfg.cityKey] || O.CITIES.tokyo);

O.AGENTS = {
  gemini:{ name:'Gemini',  provider:'gemini' },
  llama: { name:'Qwen',    provider:'groq' },     // 内部IDは古いまま（llama）。以前のLlamaがGroqで終了したため、Qwenに変更
  gpt:   { name:'GPT-OSS', provider:'groq' }
};
O.ownKey = p => p === 'groq' ? !!(O.cfg.groqKey || '').trim() : !!(O.cfg.geminiKey || '').trim();
/* 共有プロキシ（Cloudflare Workers）: 自分のキーが無くても、Googleログイン中なら使える */
O.proxyUrl = () => (O.cfg.proxyUrl || window.ORBIT_PROXY_URL || '').trim().replace(/\/+$/, '');
O.proxyOn = () => !!O.proxyUrl() && !!O.user;
/* Gemini は、Firebase AI Logic が使えるなら鍵なしで呼べる（鍵はFirebase側が持つ）。services.js が準備する */
O.aiReady = false;
O.hasKey = p => O.ownKey(p) || O.proxyOn() || (p === 'gemini' && O.aiReady);
O.anyKey = () => O.hasKey('groq') || O.hasKey('gemini');
/* キーが無いプロバイダのエージェントは、キーのある別のエージェントが代わりに動く */
O.resolve = id => {
  if(O.hasKey(O.AGENTS[id].provider)) return id;
  return ['llama','gpt','gemini'].find(k => O.hasKey(O.AGENTS[k].provider)) || null;
};

/* ---------- small helpers ---------- */
O.todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
O.fmtTime = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
O.fmtMin = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m/60)}時間${m%60}分` : `${m}分`; };

O.safeJSON = function(t){
  if(!t) return null;
  t = String(t).replace(/```json|```/gi, '').trim();
  try{ return JSON.parse(t); }catch(e){}
  const m = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if(m){ try{ return JSON.parse(m[1]); }catch(e){} }
  return null;
};
/* ---------- toast / log ---------- */
O.toast = function(msg, ms){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(O.toast._t); O.toast._t = setTimeout(() => t.classList.remove('show'), ms || 3400);
};
O.log = function(tag, text){
  const box = $('#logbox'); if(!box) return;
  const d = new Date();
  const row = document.createElement('div'); row.className = 'logline';
  const tm = document.createElement('time'); tm.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const tg = document.createElement('span'); tg.className = 'tag ' + tag;
  tg.textContent = tag === 'sys' ? 'system' : tag === 'team' ? 'team' : (O.AGENTS[tag] ? O.AGENTS[tag].name : tag);
  const tx = document.createElement('span'); tx.className = 'txt'; tx.textContent = text;
  row.append(tm, tg, tx); box.prepend(row);
  while(box.children.length > 80) box.lastChild.remove();
};

/* ---------- AI calls ---------- */
async function errText(r){
  let m = ''; try{ const j = await r.json(); m = (j.error && j.error.message) || JSON.stringify(j); }catch(e){ m = await r.text().catch(() => ''); }
  return `HTTP ${r.status} ${String(m).slice(0, 220)}`;
}
/* メッセージ → Geminiのcontents。m.media があれば、画像・PDFを inlineData として付ける */
O.toGeminiContents = messages => messages.map(m => ({
  role:m.role === 'assistant' ? 'model' : 'user',
  parts:[{ text:m.content || '(添付を参照)' }, ...(m.media || []).map(x => ({ inlineData:{ mimeType:x.mime, data:x.data } }))]
}));
async function proxyFetch(path, payload){
  const tok = await O.user.getIdToken();
  const h = { 'Content-Type':'application/json', 'Authorization':'Bearer ' + tok };
  if(O.appCheckReady){
    try{ const t = await firebase.appCheck().getToken(); if(t && t.token) h['X-Firebase-AppCheck'] = t.token; }catch(e){}
  }
  return fetch(O.proxyUrl() + path, { method:'POST', headers:h, body:JSON.stringify(payload) });
}
const GROQ_FALLBACK = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
async function callGroq(model, o){
  const cands = [model, ...GROQ_FALLBACK.filter(m => m !== model)];
  let last;
  for(const m of cands){
    try{
      const r = await callGroqOnce(m, o);
      if(m !== model){
        const k = Object.keys(O.AGENTS).find(x => O.AGENTS[x].provider === 'groq' && O.cfg.models[x] === model);
        if(k){ O.cfg.models[k] = m; O.saveCfg(); }
        O.log('sys', `Groqのモデルを ${model} から ${m} に切り替えました`);
      }
      return r;
    }catch(e){
      last = e;
      if(!/404|does not exist|decommission|no longer|not found/i.test(e.message)) throw e;
    }
  }
  throw last;
}
async function callGroqOnce(model, o){
  // 分類・安全確認・音声用のモデルは、会話には使えない。会話用の既定モデルに置き換える
  if(/guard|safeguard|whisper|tts|orpheus|embed|classif/i.test(model)){
    const d = O.defaults.models[Object.keys(O.AGENTS).find(k => O.AGENTS[k].provider === 'groq' && O.cfg.models[k] === model)] || 'openai/gpt-oss-120b';
    O.log('sys', `${model} は会話用のモデルではないため、${d} を使います。設定のモデル名を直してください`);
    model = d;
  }
  const msgs = []; if(o.system) msgs.push({ role:'system', content:o.system });
  msgs.push(...o.messages.map(m => ({ role:m.role, content:m.content })));   // 画像・PDFはGroqでは送らない
  const payload = { model, messages:msgs, temperature:o.temperature ?? 0.7 };
  const r = O.ownKey('groq')
    ? await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + O.cfg.groqKey.trim() },
        body:JSON.stringify(payload)
      })
    : await proxyFetch('/v1/groq', payload);
  if(!r.ok) throw new Error('Groq: ' + await errText(r));
  const j = await r.json();
  const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const clean = t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();   // 推論モデルの考え中の部分は表示しない
  if(!clean) throw new Error('Groq: 空の応答');
  return { text:clean, sources:[] };
}
async function callGemini(model, o){
  // 呼び出しの優先順: 自分のキー → Firebase AI Logic（鍵なし） → 共有プロキシ
  if(!O.ownKey('gemini') && O.aiReady) return O.aiGenerate(model, o);
  const body = {
    contents:O.toGeminiContents(o.messages),
    generationConfig:Object.assign({ temperature:o.temperature ?? 0.7 }, o.maxTokens ? { maxOutputTokens:o.maxTokens } : {})
  };
  if(o.system) body.systemInstruction = { parts:[{ text:o.system }] };
  if(o.search) body.tools = [{ google_search:{} }];            // 検索連携とJSONモードは併用しない
  else if(o.json) body.generationConfig.responseMimeType = 'application/json';
  const r = O.ownKey('gemini')
    ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(O.cfg.geminiKey.trim())}`,
        { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) })
    : await proxyFetch('/v1/gemini', { model, body });
  if(!r.ok) throw new Error('Gemini: ' + await errText(r));
  const j = await r.json();
  const cand = j.candidates && j.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const text = (parts || []).map(p => p.text || '').join('');
  if(!text) throw new Error('Gemini: 空の応答（安全フィルタの可能性）');
  const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const sources = chunks.map(c => c.web).filter(Boolean).map(w => ({ title:w.title || w.uri, uri:w.uri }));
  const suggest = (cand.groundingMetadata && cand.groundingMetadata.searchEntryPoint && cand.groundingMetadata.searchEntryPoint.renderedContent) || '';
  return { text, sources, suggest };
}
/* Geminiのモデル名が終了・未提供（404など）のときは、次の候補を試し、通ったものを設定に覚える */
O.GEMINI_FALLBACK = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
async function callGeminiWithFallback(model, o){
  const cands = [model, ...O.GEMINI_FALLBACK.filter(m => m !== model)].slice(0, 4);
  const QUOTA = /429|quota|exceeded|resource.?exhausted/i;
  let lastErr, quotaHit = false;
  for(const m of cands){
    try{
      const r = await callGemini(m, o);
      if(m !== model && !quotaHit){
        O.cfg.models.gemini = m; O.saveCfg();
        O.log('sys', `Geminiのモデルを ${model} から ${m} に切り替えました`);
      }
      return r;
    }catch(e){
      if(QUOTA.test(e.message)){            // 無料枠はモデルごとに数えるので、別のモデルを試す（設定は書き換えない）
        lastErr = e; quotaHit = true; continue;
      }
      lastErr = e;
      if(!/404|no longer available|not found|not supported|is not available/i.test(e.message)) throw e;
    }
  }
  if(quotaHit) throw new Error('Geminiの無料枠の上限に達しました（どのモデルでも）。しばらく待つか、Google AI StudioのAPIキーを設定に入れるか、請求を有効にしてください。Qwen/GPT-OSS（Groq）は引き続き使えます');
  throw lastErr;
}
O.callAI = async function(want, o){
  let id = O.resolve(want);
  if(o.search) id = O.hasKey('gemini') ? 'gemini' : null;      // Web検索つきの回答はGeminiだけ
  if((o.messages || []).some(m => m.media && m.media.length)) id = O.hasKey('gemini') ? 'gemini' : null;   // 画像・PDFの読み取りもGeminiだけ
  if(!id){
    await O.sleep(700 + Math.random() * 700);
    return { agent:want, text:O.demoText(want, o), demo:true, sources:[], suggest:'' };
  }
  const a = O.AGENTS[id], model = O.cfg.models[id];
  const r = a.provider === 'groq' ? await callGroq(model, o) : await callGeminiWithFallback(model, o);
  return { agent:id, text:r.text, demo:false, sources:r.sources, suggest:r.suggest || '' };
};

/* ---------- demo mode ---------- */
O.demoText = function(want, o){
  const u = (o.user || '').slice(0, 40);
  switch(o.tag){
    case 'jarvis':
      return O.demoJarvis ? O.demoJarvis(o.user || '') : JSON.stringify({ reply:'いまはデモモードです。', actions:[] });
    case 'answer':
      return `【デモ回答 / ${O.AGENTS[want].name}】\n課題「${u}」について:\n・まず目的と期限を決める\n・小さく試して、結果を見て直す\n・判断に使う数字を記録しておく`;
    case 'web': return '（デモ表示）ネットの検索には、Geminiが使える状態（Googleログイン、またはGeminiのキー）が必要です。';
    case 'critique':
      return JSON.stringify({
        issues:[{ target:o.peer || 'Gemini', point:'デモ表示です。実際のモデルなら、ここに具体的な誤りの指摘が入ります。' }],
        agree:'デモ表示です。',
        revised:`【デモ修正版 / ${O.AGENTS[want].name}】\n課題「${u}」について、他のAIの答えを見て直しました。\n・目的と期限を最初に決める\n・小さく試して結果を見て直す\n・数字を記録し、次の判断に使う`
      });
    case 'synth':
      return '【デモ統合】3つの回答に大きな食い違いはありません。目的と期限を決め、小さく試し、結果を数字で残しながら進めるのが良さそうです。\n\n次の一歩: 設定でAPIキーを入れて、同じ課題を実際のモデルで走らせてみてください。';
    case 'vision':
      return JSON.stringify(O.demoVision ? O.demoVision(o.mode) : {});
    case 'feed':
      return JSON.stringify({
        brief:'いまはデモ表示です。GeminiかGroqのキーを設定すると、天気・予定・タスクを見たうえで提案します。',
        cards:[
          { kind:'suggest', title:'朝の5分整理をしてみませんか？', body:'今日やることを3つに絞ると、午後が楽になります。', action:{ type:'set_timer', seconds:300, label:'5分整理' } },
          { kind:'suggest', title:'AIチームに今週の献立を考えてもらう', body:'QwenとGPT-OSSが分担して案を出し、Geminiがまとめます。', action:{ type:'delegate', task:'一人暮らし向けに、今週の夕食の献立と買い物リストを作って' } },
          { kind:'note', title:'ひとこと', body:'キーを設定すると、ここにあなたの予定や天気に合わせた提案が並びます。' }
        ]
      });
  }
  return '…';
};
})();
