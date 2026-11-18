/* voicevox.js: PC上で動かしているVOICEVOXエンジン（http://localhost:50021）で読み上げる。使うかどうかは設定で選ぶ */
(function(){
'use strict';
const O = window.O;
let token = 0, audio = null, busy = false;
const base = () => (O.cfg.vvUrl || 'http://localhost:50021').trim().replace(/\/+$/, '');

async function synth(text){
  const sp = +O.cfg.vvSpeaker || 3;
  const q = await fetch(`${base()}/audio_query?speaker=${sp}&text=${encodeURIComponent(text)}`, { method:'POST' });
  if(!q.ok) throw new Error('audio_query HTTP ' + q.status);
  const query = await q.json();
  query.speedScale = +O.cfg.rate || 1;
  query.pitchScale = ((+O.cfg.pitch || 1) - 1) * 0.15;
  const r = await fetch(`${base()}/synthesis?speaker=${sp}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(query) });
  if(!r.ok) throw new Error('synthesis HTTP ' + r.status);
  return URL.createObjectURL(await r.blob());
}
function play(url, my){
  return new Promise(res => {
    if(my !== token){ URL.revokeObjectURL(url); return res(); }
    audio = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); res(); };
    audio.onended = audio.onerror = done;
    audio.play().catch(done);
  });
}
function stop(){ token++; busy = false; if(audio){ try{ audio.pause(); }catch(e){} audio = null; } }

/* 最初の1つが作れなければ例外（呼び出し側がブラウザの声に切り替える）。以降の失敗は、そこで読み上げを終える */
async function speak(chunks, cb){
  stop(); const my = token; busy = true;
  let next = synth(chunks[0]);
  try{
    for(let i = 0; i < chunks.length; i++){
      const url = await next;
      if(my !== token){ URL.revokeObjectURL(url); return; }
      if(i + 1 < chunks.length) next = synth(chunks[i + 1]);
      if(i === 0 && cb.onstart) cb.onstart();
      await play(url, my);
      if(my !== token) return;
    }
  }catch(e){
    if(my === token && cb.started !== false && chunks.length > 1){ busy = false; if(cb.onend) cb.onend(); return; }
    busy = false; throw e;
  }
  if(my === token){ busy = false; if(cb.onend) cb.onend(); }
}
async function speakers(){
  const r = await fetch(base() + '/speakers');
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const out = [];
  (await r.json()).forEach(s => (s.styles || []).forEach(st => out.push({ id:st.id, label:`${s.name}（${st.name}）` })));
  return out;
}
O.vv = { speak, stop, speakers, busy:() => busy };
})();
