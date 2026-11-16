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
  groqKey:'', geminiKey:'', voice:true, wake:false, profile:'',
  cityKey:'tokyo', geo:null, fbConfig:'',
  models:{ gemini:'gemini-2.5-flash', llama:'llama-3.3-70b-versatile', gpt:'openai/gpt-oss-120b' }
};
O.defaults = defaults;
O.cfg = Object.assign({}, defaults, O.store.get('cfg', {}));
O.cfg.models = Object.assign({}, defaults.models, O.cfg.models || {});
O.saveCfg = () => O.store.set('cfg', O.cfg);
O.city = () => (O.cfg.cityKey === 'geo' && O.cfg.geo) ? O.cfg.geo : (O.CITIES[O.cfg.cityKey] || O.CITIES.tokyo);

O.AGENTS = {
  gemini:{ name:'Gemini',  provider:'gemini' },
  llama: { name:'Llama',   provider:'groq' },
  gpt:   { name:'GPT-OSS', provider:'groq' }
};
O.hasKey = p => p === 'groq' ? !!(O.cfg.groqKey || '').trim() : !!(O.cfg.geminiKey || '').trim();
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
/* コンソールからコピーした「JSの書き方のオブジェクト」も読めるようにする */
O.parseLooseJSON = function(t){
  if(!t) return null;
  const m = String(t).match(/\{[\s\S]*\}/);
  if(!m) return null;
  let s = m[0];
  try{ return JSON.parse(s); }catch(e){}
  s = s.replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1');
  try{ return JSON.parse(s); }catch(e){ return null; }
};

/* ---------- toast / log ---------- */
O.toast = function(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(O.toast._t); O.toast._t = setTimeout(() => t.classList.remove('show'), 3400);
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
async function callGroq(model, o){
  const msgs = []; if(o.system) msgs.push({ role:'system', content:o.system });
  msgs.push(...o.messages);
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + O.cfg.groqKey.trim() },
    body:JSON.stringify({ model, messages:msgs, temperature:o.temperature ?? 0.7 })
  });
  if(!r.ok) throw new Error('Groq: ' + await errText(r));
  const j = await r.json();
  const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if(!t) throw new Error('Groq: 空の応答');
  return { text:t, sources:[] };
}
async function callGemini(model, o){
  const body = {
    contents:o.messages.map(m => ({ role:m.role === 'assistant' ? 'model' : 'user', parts:[{ text:m.content }] })),
    generationConfig:{ temperature:o.temperature ?? 0.7 }
  };
  if(o.system) body.systemInstruction = { parts:[{ text:o.system }] };
  if(o.search) body.tools = [{ google_search:{} }];            // 検索連携とJSONモードは併用しない
  else if(o.json) body.generationConfig.responseMimeType = 'application/json';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(O.cfg.geminiKey.trim())}`;
  const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  if(!r.ok) throw new Error('Gemini: ' + await errText(r));
  const j = await r.json();
  const cand = j.candidates && j.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const text = (parts || []).map(p => p.text || '').join('');
  if(!text) throw new Error('Gemini: 空の応答（安全フィルタの可能性）');
  const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const sources = chunks.map(c => c.web).filter(Boolean).map(w => ({ title:w.title || w.uri, uri:w.uri }));
  return { text, sources };
}
O.callAI = async function(want, o){
  let id = O.resolve(want);
  if(o.search) id = O.hasKey('gemini') ? 'gemini' : null;      // Web検索つきの回答はGeminiだけ
  if(!id){
    await O.sleep(700 + Math.random() * 700);
    return { agent:want, text:O.demoText(want, o), demo:true, sources:[] };
  }
  const a = O.AGENTS[id], model = O.cfg.models[id];
  const r = a.provider === 'groq' ? await callGroq(model, o) : await callGemini(model, o);
  return { agent:id, text:r.text, demo:false, sources:r.sources };
};

/* ---------- demo mode ---------- */
O.demoText = function(want, o){
  const u = (o.user || '').slice(0, 40);
  switch(o.tag){
    case 'jarvis':
      return O.demoJarvis ? O.demoJarvis(o.user || '') : JSON.stringify({ reply:'いまはデモモードです。', actions:[] });
    case 'plan':
      return JSON.stringify({
        plan:'課題を「整理・調査」と「具体案・リスク」の2方向に分けて、並行で進めます。',
        tasks:[`「${u}」の前提・選択肢・比較軸を整理する`, `「${u}」の具体的な進め方とリスクを洗い出す`]
      });
    case 'work':
      return `【デモ出力 / ${O.AGENTS[want].name}】\n・観点: ${(o.user || '').slice(0, 60)}\n・ポイント1: 目的と制約を先に決める\n・ポイント2: 小さく試して結果を見て直す\n・ポイント3: 判断の材料を数字で残す`;
    case 'synth':
      return '【デモ統合】2つの観点をまとめると、先に目的と制約を決め、小さく試し、結果を数字で残しながら進めるのが良さそうです。\n\n次の一歩: 設定でAPIキーを入れて、同じ課題を実際のモデルで走らせてみてください。';
    case 'feed':
      return JSON.stringify({
        brief:'いまはデモ表示です。GeminiかGroqのキーを設定すると、天気・予定・タスクを見たうえで提案します。',
        cards:[
          { kind:'suggest', title:'朝の5分整理をしてみませんか？', body:'今日やることを3つに絞ると、午後が楽になります。', action:{ type:'set_timer', seconds:300, label:'5分整理' } },
          { kind:'suggest', title:'AIチームに今週の献立を考えてもらう', body:'LlamaとGPT-OSSが分担して案を出し、Geminiがまとめます。', action:{ type:'delegate', task:'一人暮らし向けに、今週の夕食の献立と買い物リストを作って' } },
          { kind:'note', title:'ひとこと', body:'キーを設定すると、ここにあなたの予定や天気に合わせた提案が並びます。' }
        ]
      });
  }
  return '…';
};
})();
