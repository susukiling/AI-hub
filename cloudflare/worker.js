/**
 * Orbit proxy (Cloudflare Workers)
 *
 * ブラウザ → このWorker → Groq / Gemini
 * APIキーはWorkerの暗号化された変数にだけ置き、ブラウザには渡さない。
 * 通すのは「Firebaseでログインした人」だけ。1人あたりの1日の回数にも上限を付ける。
 *
 * POST /v1/groq    { model, messages, temperature?, max_tokens? }
 * POST /v1/gemini  { model, body: { contents, systemInstruction?, generationConfig?, tools? } }
 * GET  /v1/health
 */

const SECURETOKEN_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const APPCHECK_JWKS = 'https://firebaseappcheck.googleapis.com/v1/jwks';
const DEFAULT_GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const DEFAULT_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

class HttpError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}
const list = (v, d) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : d);
const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function reply(status, obj, cors){
  return new Response(JSON.stringify(obj), { status, headers:{ 'Content-Type':'application/json; charset=utf-8', ...cors } });
}
const fail = (status, message, cors) => reply(status, { error:{ message } }, cors);

export default {
  async fetch(req, env){
    const origin = req.headers.get('Origin') || '';
    const allowed = list(env.ALLOWED_ORIGINS, []);
    const okOrigin = allowed.includes(origin);
    const cors = okOrigin ? {
      'Access-Control-Allow-Origin':origin, 'Vary':'Origin',
      'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Firebase-AppCheck',
      'Access-Control-Allow-Methods':'POST, GET, OPTIONS', 'Access-Control-Max-Age':'86400'
    } : { 'Vary':'Origin' };

    if(req.method === 'OPTIONS') return new Response(null, { status:okOrigin ? 204 : 403, headers:cors });
    const url = new URL(req.url);
    if(url.pathname === '/v1/health') return reply(200, { ok:true }, cors);
    if(req.method !== 'POST') return fail(405, 'POSTだけ使えます', cors);
    if(!okOrigin) return fail(403, 'このサイトからの利用は許可されていません', cors);

    try{
      const user = await authenticate(req, env);
      await rateLimit(user.uid, env);
      const raw = await req.text();
      // 画像・PDFを付けたGeminiの呼び出しは大きくなるので、Geminiだけ上限を広げる
      if(raw.length > (url.pathname === '/v1/gemini' ? 8000000 : 200000)) throw new HttpError(413, '送信内容が大きすぎます');
      let body; try{ body = JSON.parse(raw); }catch(e){ throw new HttpError(400, 'JSONを読み取れません'); }
      if(url.pathname === '/v1/groq') return await groq(body, env, cors);
      if(url.pathname === '/v1/gemini') return await gemini(body, env, cors);
      return fail(404, '見つかりません', cors);
    }catch(e){
      if(e instanceof HttpError) return fail(e.status, e.message, cors);
      return fail(500, 'サーバーでエラーが起きました', cors);
    }
  }
};

/* ---------- 認証 ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
function b64u(s){
  s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
const jwksCache = {};
async function getJwks(url){
  const c = jwksCache[url];
  if(c && c.exp > Date.now()) return c.keys;
  const r = await fetch(url);
  if(!r.ok) throw new HttpError(503, '認証用の公開鍵を取得できません');
  const j = await r.json();
  jwksCache[url] = { keys:j.keys, exp:Date.now() + 3600e3 };
  return j.keys;
}
async function verifyJwt(token, jwksUrl){
  const parts = token.split('.');
  if(parts.length !== 3) throw new HttpError(401, 'トークンが正しくありません');
  let header, payload;
  try{ header = JSON.parse(dec.decode(b64u(parts[0]))); payload = JSON.parse(dec.decode(b64u(parts[1]))); }
  catch(e){ throw new HttpError(401, 'トークンが正しくありません'); }
  if(header.alg !== 'RS256') throw new HttpError(401, 'トークンの形式が違います');
  const jwk = (await getJwks(jwksUrl)).find(k => k.kid === header.kid);
  if(!jwk) throw new HttpError(401, 'トークンの鍵が見つかりません');
  const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if(!ok) throw new HttpError(401, 'トークンの署名が正しくありません');
  const now = Math.floor(Date.now() / 1000);
  if(!payload.exp || payload.exp < now) throw new HttpError(401, 'ログインの有効期限が切れています。もう一度開き直してください');
  if(payload.iat && payload.iat > now + 300) throw new HttpError(401, 'トークンの時刻が正しくありません');
  return payload;
}
async function authenticate(req, env){
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if(!m) throw new HttpError(401, 'Googleでログインしてください');
  if(!env.FIREBASE_PROJECT_ID) throw new HttpError(500, 'FIREBASE_PROJECT_ID が未設定です');
  const p = await verifyJwt(m[1], SECURETOKEN_JWKS);
  if(p.aud !== env.FIREBASE_PROJECT_ID || p.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` || !p.sub)
    throw new HttpError(401, 'このプロジェクトのログインではありません');
  const emails = list(env.ALLOWED_EMAILS, []);
  if(emails.length && !(p.email_verified && emails.includes(String(p.email).toLowerCase())))
    throw new HttpError(403, 'このアカウントは許可されていません');
  if(env.APPCHECK_PROJECT_NUMBER){
    const t = req.headers.get('X-Firebase-AppCheck');
    if(!t) throw new HttpError(401, 'App Checkの確認ができませんでした');
    const a = await verifyJwt(t, APPCHECK_JWKS), n = env.APPCHECK_PROJECT_NUMBER;
    if(a.iss !== `https://firebaseappcheck.googleapis.com/${n}` || ![].concat(a.aud || []).includes(`projects/${n}`))
      throw new HttpError(401, 'App Checkの確認に失敗しました');
  }
  return { uid:p.sub, email:p.email };
}

/* ---------- 1日あたりの回数上限（KV） ---------- */
async function rateLimit(uid, env){
  if(!env.RATE) return;
  const limit = parseInt(env.DAILY_LIMIT || '200', 10);
  const key = `rl:${uid}:${new Date().toISOString().slice(0, 10)}`;
  const n = parseInt((await env.RATE.get(key)) || '0', 10);
  if(n >= limit) throw new HttpError(429, `1日の利用上限（${limit}回）に達しました。明日また使えます`);
  await env.RATE.put(key, String(n + 1), { expirationTtl:172800 });
}

/* ---------- Groq ---------- */
async function groq(b, env, cors){
  if(!env.GROQ_API_KEY) throw new HttpError(500, 'GROQ_API_KEY が未設定です');
  if(!list(env.GROQ_MODELS, DEFAULT_GROQ_MODELS).includes(b.model)) throw new HttpError(400, `このモデルは許可されていません: ${b.model}`);
  if(!Array.isArray(b.messages) || !b.messages.length || b.messages.length > 40) throw new HttpError(400, 'messagesが正しくありません');
  const messages = b.messages.map(m => {
    if(!['system', 'user', 'assistant'].includes(m && m.role)) throw new HttpError(400, 'roleが正しくありません');
    return { role:m.role, content:String(m.content).slice(0, 30000) };
  });
  const payload = { model:b.model, messages, temperature:clamp(b.temperature, 0, 2, 0.7), max_tokens:clamp(b.max_tokens, 1, 4096, 2048) };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + env.GROQ_API_KEY }, body:JSON.stringify(payload)
  });
  return new Response(r.body, { status:r.status, headers:{ 'Content-Type':'application/json; charset=utf-8', ...cors } });
}

/* ---------- Gemini ---------- */
async function gemini(b, env, cors){
  if(!env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY が未設定です');
  if(!list(env.GEMINI_MODELS, DEFAULT_GEMINI_MODELS).includes(b.model)) throw new HttpError(400, `このモデルは許可されていません: ${b.model}`);
  const s = b.body || {};
  if(!Array.isArray(s.contents) || !s.contents.length || s.contents.length > 40) throw new HttpError(400, 'contentsが正しくありません');
  const payload = { contents:s.contents };
  if(s.systemInstruction) payload.systemInstruction = s.systemInstruction;
  const g = s.generationConfig || {};
  payload.generationConfig = { temperature:clamp(g.temperature, 0, 2, 0.7), maxOutputTokens:clamp(g.maxOutputTokens, 1, 4096, 2048) };
  if(g.responseMimeType === 'application/json') payload.generationConfig.responseMimeType = 'application/json';
  if(Array.isArray(s.tools) && s.tools.length && s.tools.every(t => t && Object.keys(t).length === 1 && t.google_search)) payload.tools = [{ google_search:{} }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(b.model)}:generateContent`, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-goog-api-key':env.GEMINI_API_KEY }, body:JSON.stringify(payload)
  });
  return new Response(r.body, { status:r.status, headers:{ 'Content-Type':'application/json; charset=utf-8', ...cors } });
}
