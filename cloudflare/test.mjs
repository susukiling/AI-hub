import worker from './worker.js';
const PROJECT='demo-proj', ORIGIN='https://susukiling.github.io';
const kp = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey); jwk.kid='k1'; jwk.alg='RS256'; jwk.use='sig';
const b64=o=>Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64url');
async function token(over={}, kid='k1'){
  const now=Math.floor(Date.now()/1000);
  const p={iss:`https://securetoken.google.com/${PROJECT}`,aud:PROJECT,sub:'uid1',iat:now,exp:now+3600,email:'a@b.com',email_verified:true,...over};
  const h=b64({alg:'RS256',kid,typ:'JWT'}), pl=b64(p);
  const sig=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(h+'.'+pl))).toString('base64url');
  return `${h}.${pl}.${sig}`;
}
const calls=[];
globalThis.fetch = async (url,opts)=>{
  calls.push({url:String(url),opts});
  if(String(url).includes('securetoken')) return new Response(JSON.stringify({keys:[jwk]}));
  if(String(url).includes('groq.com')) return new Response(JSON.stringify({choices:[{message:{content:'hi'}}]}));
  if(String(url).includes('generativelanguage')) return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'hello'}]}}]}));
  return new Response('?',{status:404});
};
const store=new Map();
const env={FIREBASE_PROJECT_ID:PROJECT,ALLOWED_ORIGINS:ORIGIN,DAILY_LIMIT:'3',GROQ_API_KEY:'gsk_secret',GEMINI_API_KEY:'AIza_secret',RATE:{get:async k=>store.get(k)??null,put:async(k,v)=>{store.set(k,v)}}};
async function call(path,body,{tok,origin=ORIGIN,method='POST',extra={}}={}){
  const headers={'Content-Type':'application/json',...extra}; if(origin) headers.Origin=origin; if(tok) headers.Authorization='Bearer '+tok;
  const r=await worker.fetch(new Request('https://w.example'+path,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}),env);
  return {status:r.status,text:await r.text(),cors:r.headers.get('Access-Control-Allow-Origin')};
}
let fails=0; const t=(name,ok,info='')=>{console.log((ok?'PASS':'FAIL')+' '+name+(ok?'':'  '+info)); if(!ok) fails++;};
const good=await token();
const gbody={model:'llama-3.3-70b-versatile',messages:[{role:'user',content:'hi'}]};
let r=await call('/v1/groq',gbody,{tok:good}); t('groq ok',r.status===200&&r.text.includes('hi')&&r.cors===ORIGIN,r.text);
const gc=calls.filter(c=>c.url.includes('groq.com')).at(-1); t('groq key is added server-side',gc.opts.headers.Authorization==='Bearer gsk_secret');
r=await call('/v1/gemini',{model:'gemini-3.6-flash',body:{contents:[{role:'user',parts:[{text:'x'}]}],tools:[{google_search:{}}],generationConfig:{temperature:.3}}},{tok:good});
t('gemini ok',r.status===200&&r.text.includes('hello'),r.text);
const mc=calls.filter(c=>c.url.includes('generativelanguage')).at(-1); t('gemini key in header, not url',mc.opts.headers['x-goog-api-key']==='AIza_secret'&&!mc.url.includes('AIza'));
t('gemini search tool passed',JSON.parse(mc.opts.body).tools[0].google_search!==undefined);
r=await call('/v1/groq',gbody,{tok:good}); t('3rd call within limit',r.status===200,r.text);
r=await call('/v1/groq',gbody,{tok:good}); t('4th call blocked by daily limit',r.status===429,r.text);
r=await call('/v1/groq',gbody,{}); t('no token -> 401',r.status===401,r.text);
r=await call('/v1/groq',gbody,{tok:await token({exp:Math.floor(Date.now()/1000)-10})}); t('expired -> 401',r.status===401,r.text);
r=await call('/v1/groq',gbody,{tok:await token({aud:'other'})}); t('wrong project -> 401',r.status===401,r.text);
r=await call('/v1/groq',gbody,{tok:await token({sub:'uid2'},'nokid')}); t('unknown kid -> 401',r.status===401,r.text);
const tampered=(await token({sub:'uid3'})).split('.'); tampered[1]=b64({iss:`https://securetoken.google.com/${PROJECT}`,aud:PROJECT,sub:'evil',exp:9999999999});
r=await call('/v1/groq',gbody,{tok:tampered.join('.')}); t('tampered payload -> 401',r.status===401,r.text);
r=await call('/v1/groq',gbody,{tok:await token({sub:'uid4'}),origin:'https://evil.example'}); t('bad origin -> 403 and no CORS',r.status===403&&r.cors===null,r.text);
r=await call('/v1/groq',{...gbody,model:'some-expensive-model'},{tok:await token({sub:'uid5'})}); t('model not allowed -> 400',r.status===400,r.text);
r=await call('/v1/groq',gbody,{tok:good,method:'OPTIONS'}); t('preflight',r.status===204&&r.cors===ORIGIN,String(r.status));
env.ALLOWED_EMAILS='only@me.com';
r=await call('/v1/groq',gbody,{tok:await token({sub:'uid6'})}); t('email not in allow list -> 403',r.status===403,r.text);
console.log(fails?`\n${fails} FAILED`:'\nALL PASSED'); process.exit(fails?1:0);
