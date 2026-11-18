/* team.js: AI Team。Qwen・GPT-OSS・Geminiが独立に答え、互いの誤りを指摘し合って修正する */
(function(){
'use strict';
const O = window.O;
const { $, log, toast } = O;
const SLOTS = ['llama', 'gpt', 'gemini'];
const NAME = s => O.AGENTS[s].name;
let running = false;
let lastRec = null;

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
const profileLine = () => (O.cfg.share.profile && O.cfg.profile.trim()) ? '\n依頼者について: ' + O.cfg.profile.trim() : '';

const ANSWER_SYS = () =>
  'あなたは3人のAIチームの一員です。課題に、日本語で具体的に答えてください（400字程度）。' +
  '根拠のない断定や、確かでない数字は書かないでください。分からない点は、分からないと書いてください。' + profileLine();

const REVIEW_SYS = () => `あなたは3人のAIチームの一員で、いまは相互レビューの時間です。課題に対する、あなた自身の回答と、他のAIの回答が渡されます。
次のJSONだけを返してください。前後に文章やコードブロックは付けません。
{"issues":[{"target":"指摘する相手の名前","point":"間違い・根拠のない主張・数字の誤り・抜け・矛盾を、具体的に1文で"}],"agree":"他の回答のうち、正しいと判断して取り入れた点(1文。無ければ空文字)","revised":"あなたの回答を直した完成版(400字程度。課題に答える文章だけを書き、指摘は含めない)"}
- 相手の回答に明らかな問題が無ければ、issuesは空の配列にします。無理に指摘しないでください。
- 事実・数字・手順の正しさを最優先で確認します。確信が持てない点は、確信が持てないと書いてください。
- 迎合して意見を変えないでください。自分が正しいと考える点は、根拠を添えて維持します。
- 他の回答の方が良い点は、素直に取り入れて直します。` + profileLine();

/* ---------- 画面 ---------- */
function newState(slot){ return { slot, agent:slot, demo:false, first:'', current:'', rounds:[], failed:false, note:'' }; }
function cardOf(slot){ return document.querySelector(`.tcard[data-slot="${slot}"]`); }

function buildTrio(states){
  const box = $('#trio'); box.textContent = '';
  SLOTS.forEach(slot => {
    const c = el('div', 'tcard'); c.dataset.slot = slot; c.dataset.state = 'idle';
    const h = el('div', 'tc-h');
    h.append(el('i', 'dot'));
    const nm = el('span', 'tc-name', NAME(slot)); nm.dataset.a = slot;
    h.append(nm, el('span', 'tc-step', '待機中'));
    const body = el('div', 'tc-body out idle', states ? '' : 'ここにこのAIの答えが出ます');
    const det = el('details', 'tc-log'); det.hidden = true;
    det.append(el('summary', '', 'やり取りを見る'), el('div', 'tc-log-body'));
    c.append(h, body, det); box.append(c);
  });
}
function setCard(s, state, step, text){
  const c = cardOf(s.slot); if(!c) return;
  c.dataset.state = state;
  c.querySelector('.tc-step').textContent = step;
  const nm = c.querySelector('.tc-name');
  nm.textContent = NAME(s.agent) + (s.agent !== s.slot ? `（${NAME(s.slot)}の代役）` : '') + (s.demo ? ' · デモ' : '');
  nm.dataset.a = s.agent;
  if(text !== undefined){
    const b = c.querySelector('.tc-body'); b.textContent = text; b.classList.toggle('idle', !text);
  }
}
function receivedBy(s, states){
  const out = [];
  states.forEach(o => {
    if(o.slot === s.slot) return;
    o.rounds.forEach((r, i) => r.issues.forEach(is => { if(is.target === NAME(s.slot)) out.push({ from:NAME(o.slot), round:i + 1, point:is.point }); }));
  });
  return out;
}
function renderLog(s, states){
  const c = cardOf(s.slot); if(!c) return;
  const det = c.querySelector('.tc-log'), body = c.querySelector('.tc-log-body');
  body.textContent = '';
  if(!s.rounds.length){ det.hidden = true; return; }
  det.hidden = false;
  const got = receivedBy(s, states), gave = s.rounds.reduce((n, r) => n + r.issues.length, 0);
  det.querySelector('summary').textContent = `やり取りを見る（指摘した ${gave} 件 ・ 指摘された ${got.length} 件）`;
  const sec = (title, node) => { const d = el('div', 'lg'); d.append(el('h5', '', title), node); body.append(d); };
  sec('最初の回答', el('p', '', s.first));
  s.rounds.forEach((r, i) => {
    const ul = el('ul');
    if(!r.issues.length) ul.append(el('li', '', '指摘なし（他の回答に明らかな問題は見つからなかった）'));
    r.issues.forEach(is => ul.append(el('li', '', `${is.target}へ: ${is.point}`)));
    if(r.agree) ul.append(el('li', 'ok', `取り入れた点: ${r.agree}`));
    sec(`ラウンド${i + 1}で、このAIが指摘したこと`, ul);
  });
  if(got.length){
    const ul = el('ul'); got.forEach(g => ul.append(el('li', '', `${g.from}から（ラウンド${g.round}）: ${g.point}`)));
    sec('他のAIから指摘されたこと', ul);
  }
  if(s.current !== s.first){ const b = el('span', 'badge', '修正あり'); c.querySelector('.tc-h').querySelector('.tc-step').append(b); }
}
const setPhase = t => { $('#teamPhase').textContent = t; };

/* ---------- AI呼び出し（レート制限は1回だけ待って再試行） ---------- */
async function ask(slot, opt){
  try{ return await O.callAI(slot, opt); }
  catch(e){
    if(!/429|rate|quota|resource/i.test(e.message)) throw e;
    await O.sleep(3500);
    return O.callAI(slot, opt);
  }
}
async function answer(s, task){
  s.agent = O.resolve(s.slot) || s.slot; s.demo = !O.resolve(s.slot);
  setCard(s, 'running', '回答中…', '');
  try{
    const r = await ask(s.slot, { system:ANSWER_SYS(), messages:[{ role:'user', content:`課題: ${task}` }], tag:'answer', user:task, temperature:.6 });
    s.agent = r.agent; s.demo = r.demo;
    s.first = s.current = r.text.trim();
    setCard(s, 'done', '回答しました', s.current);
    log(r.agent, `${NAME(s.slot)}枠: 最初の回答`);
  }catch(e){
    s.failed = true; s.note = e.message;
    setCard(s, 'error', '失敗', '失敗: ' + e.message);
    log('sys', `${NAME(s.slot)}枠が失敗: ${e.message}`);
  }
}
async function review(s, task, snapshot, round){
  const mine = snapshot.find(x => x.slot === s.slot);
  const others = snapshot.filter(x => x.slot !== s.slot);
  const peer = NAME(others[0].slot);
  setCard(s, 'running', `ラウンド${round}: 他の答えを読んで指摘中…`);
  try{
    const r = await ask(s.slot, {
      system:REVIEW_SYS(), json:true, tag:'critique', user:task, peer, temperature:.3,
      messages:[{ role:'user', content:`課題: ${task}\n\n[あなたの回答（${mine.name}）]\n${mine.text}\n\n[他のAIの回答]\n${others.map(o => `■ ${o.name}\n${o.text}`).join('\n\n')}` }]
    });
    s.agent = r.agent; s.demo = r.demo;
    const j = O.safeJSON(r.text);
    let rec;
    if(j && typeof j === 'object' && typeof j.revised === 'string' && j.revised.trim()){
      const valid = others.map(o => o.name);
      rec = {
        issues:(Array.isArray(j.issues) ? j.issues : [])
          .map(i => ({ target:String((i && i.target) || ''), point:String((i && i.point) || '').slice(0, 240) }))
          .filter(i => i.point).map(i => ({ target:valid.includes(i.target) ? i.target : valid[0], point:i.point })).slice(0, 4),
        agree:String(j.agree || '').slice(0, 200)
      };
      s.current = j.revised.trim();
    }else{
      rec = { issues:[], agree:'' };
      const raw = r.text.trim();
      if(raw && !raw.startsWith('{')) s.current = raw;     // 形式が崩れたときは、文章をそのまま修正版として扱う
      O.log('sys', `${NAME(s.slot)}枠の指摘が、決まった形式で返りませんでした`);
    }
    s.rounds.push(rec);
    setCard(s, 'done', `ラウンド${round}: 修正しました`, s.current);
  }catch(e){
    s.rounds.push({ issues:[], agree:'' });
    setCard(s, 'error', `ラウンド${round}: 失敗（前の回答を維持）`, s.current);
    log('sys', `${NAME(s.slot)}枠のレビューが失敗: ${e.message}`);
  }
}

/* ---------- 実行 ---------- */
async function runTeam(task, fromChat){
  task = (task || '').trim();
  if(!task || running) return null;
  running = true; $('#teamRun').disabled = true; $('#teamFoot').textContent = '';
  const rounds = Math.max(0, Math.min(2, parseInt($('#teamRounds').value, 10) || 0));
  const states = SLOTS.map(newState);
  buildTrio(states); lastRec = null;
  log('team', `開始（議論${rounds}回）: ` + task.slice(0, 60));
  try{
    setPhase(`1/${rounds + 1}  3つのAIが、それぞれ独立して回答しています`);
    await Promise.all(states.map(s => answer(s, task)));
    for(let r = 1; r <= rounds; r++){
      const alive = states.filter(s => !s.failed);
      if(alive.length < 2) break;
      setPhase(`${r + 1}/${rounds + 1}  互いの答えを読んで、間違いを指摘し合い、修正しています`);
      const snapshot = states.filter(s => !s.failed).map(s => ({ slot:s.slot, name:NAME(s.slot), text:s.current }));
      await Promise.all(alive.map(s => review(s, task, snapshot, r)));
    }
    states.forEach(s => { if(!s.failed) renderLog(s, states); });
    const ok = states.filter(s => !s.failed);
    if(!ok.length) throw new Error('3つとも失敗しました。キーや接続を確認してください');
    setPhase(rounds ? '完了  3つの答えは、互いの指摘を受けて修正済みです' : '完了  3つの答えを並べました（議論なし）');
    log('team', '完了');
    const names = s => `${NAME(s.agent)}${s.agent !== s.slot ? '（代役）' : ''}`;
    if(fromChat){
      const text = '【3つのAIの回答】\n\n' + ok.map(s => `■ ${NAME(s.slot)}\n${s.current}`).join('\n\n');
      O.ui.addMsg('ai', text, { agent:'team', demo:ok.every(s => s.demo) });
      O.ui.speak('チームの回答がそろいました。画面に表示します。');
    }else{
      lastRec = O.hist.record('team', task, [{ role:'user', text:task }].concat(ok.map(s => ({ role:'ai', agent:s.agent, demo:s.demo, text:`【${NAME(s.slot)}の回答】\n${s.current}` }))));
      toast('AIチームの回答がそろいました');
    }
    // 任意: 1つにまとめる
    const foot = $('#teamFoot');
    if(ok.length >= 2){
      const b = el('button', 'btn sm', '1つにまとめる（Gemini）'); b.type = 'button';
      b.onclick = () => synth(task, ok, b);
      foot.append(b, el('span', 'hint-inline', '必要なときだけ。3つの共通点と食い違いを整理します。'));
    }
    return ok.map(s => ({ slot:s.slot, agent:s.agent, text:s.current, name:names(s) }));
  }catch(e){
    setPhase('失敗'); log('sys', 'チーム失敗: ' + e.message); toast('チームの実行に失敗しました: ' + e.message);
    if(fromChat) O.ui.addMsg('err', 'チームの実行に失敗しました: ' + e.message);
    return null;
  }finally{
    running = false; $('#teamRun').disabled = false;
  }
}
async function synth(task, ok, btn){
  btn.disabled = true; btn.textContent = 'まとめています…';
  try{
    const r = await O.callAI('gemini', {
      system:'あなたは編集長です。3つの回答を比べ、(1)一致している点 (2)食い違う点と、どちらが妥当かの理由 (3)最終的なおすすめ、を日本語で簡潔にまとめてください。確かでない点は確かでないと書いてください。',
      messages:[{ role:'user', content:`課題: ${task}\n\n` + ok.map(s => `■ ${NAME(s.slot)}\n${s.current}`).join('\n\n') }],
      tag:'synth', user:task, temperature:.3
    });
    const box = el('div', 'tsynth'); box.append(el('h5', '', 'まとめ（Gemini）'), el('p', '', r.text.trim()));
    $('#teamFoot').append(box);
    if(lastRec) O.hist.append(lastRec.id, { role:'ai', agent:r.agent, demo:r.demo, text:'【まとめ】\n' + r.text.trim() });
    btn.remove();
  }catch(e){
    btn.disabled = false; btn.textContent = '1つにまとめる（Gemini）'; toast('まとめに失敗しました: ' + e.message);
  }
}

O.runTeam = runTeam;
$('#teamForm').addEventListener('submit', e => { e.preventDefault(); runTeam($('#teamTask').value, false); });
$('#teamTask').value = '一人暮らしを始める人向けに、1か月の予算プランと最初に買う物のリストを作って';
buildTrio();
})();
