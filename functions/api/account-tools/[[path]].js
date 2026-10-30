// Fixed upstream and allowlist: this is not a general HTTP proxy. Credentials
// stay out of URLs, caches and logs. The backend verifies Identity independently.
const allowed=new Set(['passkeys/list','passkeys/register/options','passkeys/register/verify','passkeys/login/options','passkeys/login/verify','passkeys/remove','wallet/status','wallet/apple','wallet/google']);
export async function onRequestPost({request,params}) {
 const path=Array.isArray(params.path)?params.path.join('/'):String(params.path||'');
 if(!allowed.has(path))return new Response(null,{status:404});
 const origin=new URL(request.url).origin;
 if(!['https://www.identifly.app','https://identifly.app'].includes(origin))return new Response(null,{status:403});
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==origin)return new Response(null,{status:403});
 const raw=await request.text();if(raw.length>50000)return new Response(null,{status:413});
 const [kind,...rest]=path.split('/');
 try {
  const upstream=await fetch('https://doctorqr-backend-production.up.railway.app/api/'+kind+'/identity/'+rest.join('/'),{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json','Origin':origin},body:raw});
  // Workers supports manual/follow, not redirect:error. Reject redirects
  // explicitly so account tokens can never be forwarded to another origin.
  if(upstream.status>=300&&upstream.status<400)throw Error('upstream_redirect');
  const headers={'Content-Type':upstream.headers.get('Content-Type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(upstream.headers.has('Content-Disposition'))headers['Content-Disposition']=upstream.headers.get('Content-Disposition');
  return new Response(upstream.body,{status:upstream.status,headers});
 }catch(_){return new Response(JSON.stringify({code:'service_unavailable',error:'unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
}
