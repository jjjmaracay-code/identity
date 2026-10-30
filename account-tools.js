(function(){'use strict';
const API='https://doctorqr-backend-production.up.railway.app/api';
const pending=new Set();let promptDialog=null;
const t=key=>window.AccountToolsText?.(key)||key;
const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}};
const b64=buffer=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),x=>x.charCodeAt(0));
const digest=async value=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const text=key=>document.querySelectorAll('[data-tools-text="'+key+'"]').forEach(el=>el.textContent=t(key));
function translate(){document.querySelectorAll('[data-tools-text]').forEach(el=>el.textContent=t(el.dataset.toolsText));}
function message(el,key){if(el)el.textContent=t(key);}
async function request(app,path,body={},type='passkeys',signal){
 if(!navigator.onLine)throw Object.assign(Error(t('offline')),{code:'offline'});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);pending.add(controller);
 const abort=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});
 try {
  const url=app==='identity'?'/api/account-tools/'+type+'/'+path:API+'/'+type+'/'+app+'/'+path;
  const response=await fetch(url,{method:'POST',cache:'no-store',credentials:'omit',signal:controller.signal,
   headers:{'Content-Type':'application/json',...(app==='atabey'&&localStorage.getItem('doctorqr_token')?{Authorization:'Bearer '+localStorage.getItem('doctorqr_token')}: {})},body:JSON.stringify(body)});
  if(response.ok&&response.headers.get('Content-Type')?.includes('application/vnd.apple.pkpass'))return response.blob();
  const result=await response.json();if(!response.ok||result.error)throw Object.assign(Error(t('failure')),{code:result.code,status:response.status});return result;
 }finally{clearTimeout(timer);pending.delete(controller);signal?.removeEventListener('abort',abort);}
}
function prompt(key,type){
 if(promptDialog)return Promise.resolve(null);
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='account-tools-dialog';dialog.id='account-tools-dialog';
  const form=document.createElement('form');form.method='dialog';
  const label=document.createElement('label');label.textContent=t(key);label.id='account-tools-prompt';dialog.setAttribute('aria-labelledby',label.id);form.append(label);
  let input;if(type){input=document.createElement('input');input.id='account-tools-confirm-input';label.htmlFor=input.id;input.type=type==='password'?'password':'text';input.autocomplete=type==='password'?'current-password':'one-time-code';if(type==='totp'){input.inputMode='numeric';input.maxLength=6;}input.required=true;form.append(input);}
  const actions=document.createElement('div');actions.className='account-tools-actions';
  const yes=document.createElement('button');yes.type='submit';yes.textContent=t('confirm');yes.id='account-tools-confirm';
  const no=document.createElement('button');no.type='button';no.textContent=t('cancel');actions.append(yes,no);form.append(actions);dialog.append(form);document.body.append(dialog);
  let settled=false;const finish=value=>{if(settled)return;settled=true;if(input)input.value='';dialog.close();dialog.remove();promptDialog=null;resolve(value);};
  promptDialog={dialog,cancel:()=>finish(null)};no.onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null);};form.onsubmit=event=>{event.preventDefault();finish(input?input.value:true);};dialog.showModal();(input||no).focus();
 });
}
function invalidate(){for(const p of pending)p.abort();pending.clear();promptDialog?.cancel();window.SimpleWebAuthnBrowser?.WebAuthnAbortService?.cancelCeremony();}
window.addEventListener('doctorqr:account-invalidated',invalidate);window.addEventListener('pagehide',invalidate);
window.addEventListener('storage',e=>{if(e.key===null||['doctorqr_id','doctorqr_token','doctorqr_user','identity_registration','identity_access_token','identity_pin'].includes(e.key))invalidate();});
window.addEventListener('doctorqr:language-changed',translate);window.addEventListener('i18n:changed',translate);document.addEventListener('DOMContentLoaded',translate);new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
window.AccountTools={t,read,b64,bytes,digest,request,prompt,message,translate,invalidate,
 supported:()=>!!(isSecureContext&&window.PublicKeyCredential&&navigator.credentials&&window.SimpleWebAuthnBrowser),
 button:(key,id)=>{const b=document.createElement('button');b.type='button';b.id=id;b.dataset.toolsText=key;b.textContent=t(key);return b;},
 async run(button,status,fn){if(button.disabled)return;button.disabled=true;button.setAttribute('aria-busy','true');message(status,'wait');try{await fn();}catch(e){message(status,e?.code==='reauth_required'?'totp':e?.code==='context_changed'?'changed':e?.code==='unsupported'?'unsupported':e?.code==='offline'?'offline':e?.code==='public_card_required'?'publicCard':'failure');}finally{button.disabled=false;button.removeAttribute('aria-busy');if(status?.textContent===t('wait'))status.textContent='';}}
};
})();
