/* history.js: 会話履歴（このブラウザに保存。ログイン中はFirestoreにも同期）と、履歴画面 */
(function(){
'use strict';
const O = window.O;
const { $, store, pad } = O;
const MAX_CONVS = 60, MAX_MSGS = 200;
const KIND = { jarvis:'Jarvis', team:'AI Team', vision:'画像' };

let convs = store.get('convs', []);
const dirty = new Set();
let flushT = null, selected = null, query = '';

const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
const when = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const persist = () => store.set('convs', convs);
function trim(){
  convs.sort((a, b) => b.updatedAt - a.updatedAt);
  if(convs.length > MAX_CONVS) convs.length = MAX_CONVS;
}
function clip(c){
  const copy = Object.assign({}, c, { messages:c.messages.slice() });
  while(copy.messages.length > 2 && JSON.stringify(copy).length > 900000) copy.messages.shift();
  return copy;
}
function touch(c){
  trim(); persist(); dirty.add(c.id);
  clearTimeout(flushT); flushT = setTimeout(flush, 1500);
  if(!$('.history').hidden) H.render();
}
async function flush(){
  if(!O.user || !O.db) return;
  for(const id of Array.from(dirty)){
    const c = H.get(id); dirty.delete(id);
    if(!c) continue;
    try{ await O.db.doc(`users/${O.user.uid}/convs/${id}`).set(clip(c)); }
    catch(e){ O.log('sys', '履歴の同期に失敗: ' + (e.code || e.message)); dirty.add(id); break; }
  }
}

const H = O.hist = {
  current:null,
  all:() => convs,
  get:id => convs.find(c => c.id === id),
  /* いまの会話。まだ無ければ、最初の発言をタイトルにして作る */
  ensure(kind, title){
    let c = H.get(H.current);
    if(c) return c;
    c = { id:nid(), kind, title:String(title || '新しい会話').replace(/\s+/g, ' ').slice(0, 40), createdAt:Date.now(), updatedAt:Date.now(), messages:[] };
    convs.unshift(c); H.current = c.id;
    return c;
  },
  add(msg){
    const c = H.get(H.current); if(!c) return;
    H.append(c.id, msg);
  },
  append(id, msg){
    const c = H.get(id); if(!c) return;
    c.messages.push({ role:msg.role, text:String(msg.text || '').slice(0, 8000), agent:msg.agent || null, demo:!!msg.demo, at:Date.now(), att:(msg.att || []).slice(0, 8) });
    if(c.messages.length > MAX_MSGS) c.messages.splice(0, c.messages.length - MAX_MSGS);
    c.updatedAt = Date.now(); touch(c);
  },
  /* AI Teamや画像読み取りの結果を、1件の履歴として残す */
  record(kind, title, msgs){
    const c = { id:nid(), kind, title:String(title || '').replace(/\s+/g, ' ').slice(0, 40), createdAt:Date.now(), updatedAt:Date.now(),
      messages:msgs.map(m => ({ role:m.role, text:String(m.text || '').slice(0, 8000), agent:m.agent || null, demo:!!m.demo, at:Date.now(), att:(m.att || []).slice(0, 8) })) };
    convs.unshift(c); touch(c);
    return c;
  },
  newChat(){ H.current = null; },
  remove(id){
    convs = convs.filter(c => c.id !== id); dirty.delete(id);
    if(H.current === id) H.current = null;
    if(selected === id) selected = null;
    persist();
    if(O.user && O.db) O.db.doc(`users/${O.user.uid}/convs/${id}`).delete().catch(() => {});
    H.render();
  },
  /* タイトルと本文から探す。ヒットした箇所の前後を、一緒に返す */
  search(q){
    q = String(q || '').trim().toLowerCase();
    if(!q) return convs.map(c => ({ c, snip:'' }));
    const out = [];
    convs.forEach(c => {
      let snip = null;
      if(c.title.toLowerCase().includes(q)) snip = '';
      for(const m of c.messages){
        const i = m.text.toLowerCase().indexOf(q);
        if(i >= 0){ snip = (i > 20 ? '…' : '') + m.text.slice(Math.max(0, i - 20), i + q.length + 40).replace(/\s+/g, ' '); break; }
      }
      if(snip !== null) out.push({ c, snip });
    });
    return out;
  },
  /* ログイン後: クラウドの履歴と合流する（新しい方を採用） */
  async pull(){
    if(!O.user || !O.db) return;
    try{
      const snap = await O.db.collection(`users/${O.user.uid}/convs`).orderBy('updatedAt', 'desc').limit(MAX_CONVS).get();
      const remote = new Map(); snap.forEach(d => remote.set(d.id, d.data()));
      remote.forEach((r, id) => {
        const l = H.get(id);
        if(!l) convs.push(r);
        else if((r.updatedAt || 0) > l.updatedAt) Object.assign(l, r);
      });
      convs.forEach(c => { const r = remote.get(c.id); if(!r || (r.updatedAt || 0) < c.updatedAt) dirty.add(c.id); });
      trim(); persist(); H.render(); flush();
      if(remote.size) O.log('sys', `クラウドの会話履歴を${remote.size}件読み込みました`);
    }catch(e){
      O.log('sys', '履歴の同期に失敗: ' + (e.code || e.message));
    }
  }
};

/* ---------- 履歴画面 ---------- */
function renderList(){
  const box = $('#histList'); if(!box) return;
  box.textContent = '';
  const rows = H.search(query);
  $('#histMeta').textContent = query ? `${rows.length} / ${convs.length} 件` : `${convs.length} 件`;
  if(!rows.length){
    box.append(el('p', 'empty', query ? '見つかりませんでした。別の言葉で試してください。' : 'まだ会話がありません。JarvisやAI Teamで話すと、ここに残ります。'));
    return;
  }
  rows.forEach(({ c, snip }) => {
    const b = el('button', 'hist-item'); b.type = 'button';
    if(c.id === selected) b.setAttribute('aria-current', 'true');
    b.append(el('b', '', c.title || '(無題)'));
    b.append(el('small', '', `${KIND[c.kind] || c.kind} ・ ${when(c.updatedAt)} ・ ${c.messages.length}件`));
    if(snip) b.append(el('span', 'snip', snip));
    b.onclick = () => { selected = c.id; confirming = false; renderList(); renderView(); };
    box.append(b);
  });
}
let confirming = false;
function renderView(){
  const v = $('#histView'); if(!v) return;
  v.textContent = '';
  const c = H.get(selected);
  if(!c){ v.append(el('p', 'empty', '左の一覧から会話を選ぶと、ここに中身が出ます。')); return; }
  const head = el('div', 'hv-head');
  const t = el('div'); t.append(el('b', '', c.title), el('small', '', `${KIND[c.kind] || c.kind} ・ ${when(c.createdAt)} から`));
  head.append(t);
  const acts = el('div', 'hv-acts');
  if(c.kind === 'jarvis'){
    const go = el('button', 'btn primary sm', 'この会話を続ける'); go.type = 'button';
    go.onclick = () => O.ui && O.ui.resumeChat(c);
    acts.append(go);
  }
  if(!confirming){
    const del = el('button', 'btn sm', '削除'); del.type = 'button'; del.onclick = () => { confirming = true; renderView(); };
    acts.append(del);
  }else{
    acts.append(el('span', 'hv-warn', 'この会話を削除します（元に戻せません）'));
    const yes = el('button', 'btn sm danger', '削除する'); yes.type = 'button'; yes.onclick = () => { confirming = false; H.remove(c.id); };
    const no = el('button', 'btn sm', 'やめる'); no.type = 'button'; no.onclick = () => { confirming = false; renderView(); };
    acts.append(yes, no);
  }
  head.append(acts);
  v.append(head);
  const tr = el('div', 'hv-msgs');
  const q = query.trim().toLowerCase();
  c.messages.forEach(m => {
    const d = el('div', 'msg ' + (m.role === 'user' ? 'user' : m.role === 'err' ? 'err' : 'ai'));
    if(m.role === 'ai'){
      const nm = m.agent === 'team' ? 'TEAM' : (O.AGENTS[m.agent] ? O.AGENTS[m.agent].name.toUpperCase() : 'ORBIT');
      d.append(el('span', 'who', nm + (m.demo ? ' · DEMO' : '') + ' ・ ' + when(m.at)));
    }else if(m.role === 'user'){
      d.append(el('span', 'who', 'YOU ・ ' + when(m.at)));
    }
    d.append(document.createTextNode(m.text));
    if(m.att && m.att.length){
      const ch = el('div', 'chips'); m.att.forEach(n => ch.append(el('span', 'chip', n))); d.append(ch);
    }
    if(q && m.text.toLowerCase().includes(q)) d.classList.add('hit');
    tr.append(d);
  });
  v.append(tr);
}
H.render = function(){ renderList(); renderView(); };
$('#histSearch').addEventListener('input', e => { query = e.target.value; renderList(); renderView(); });
H.render();
})();
