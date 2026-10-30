(function(){'use strict';
document.addEventListener('DOMContentLoaded',()=>{
 const A=window.AccountTools,root=document.getElementById('account-wallet-tools');if(!A||!root)return;
 const app=window.IdentityAccountBridge?'identity':'atabey',panel=root.closest('details');let checking=false,created=false;
 const stamp=()=>app==='identity'?IdentityAccountBridge.stamp():JSON.stringify(['doctorqr_id','doctorqr_token','doctorqr_user'].map(k=>localStorage.getItem(k)));
 const active=()=>app==='identity'?IdentityAccountBridge.unlocked():!window.WebSession&&window.MedicalOwner?.current();
 const account=()=>app==='identity'?{email:A.read('identity_registration')?.email,token:localStorage.getItem('identity_access_token'),deviceId:getOrCreateDeviceId()}:{};
 root.hidden=true;
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
 async function refresh(){
  if(checking||!active()||created)return;checking=true;const initial=stamp();
  try{
   const available=await A.request(app,'status',account(),'wallet');if(initial!==stamp()||!active())return;
   if(!available.apple&&!available.google){root.hidden=true;return;}
   root.hidden=false;
   for(const kind of ['apple','google'])if(available[kind]){
    const button=document.createElement('button');button.type='button';button.id='wallet-'+kind;
    // Wallet provider labels are preserved; no invented payment or NFC claim.
    button.dataset.toolsText=kind==='apple'?'walletApple':'walletGoogle';button.textContent=A.t(button.dataset.toolsText);root.prepend(button);
    button.onclick=()=>A.run(button,status,async()=>{
     if(!active())return;const current=stamp();const data=await A.request(app,kind,account(),'wallet');
     if(current!==stamp()||!active())throw Object.assign(Error('account_changed'),{code:'context_changed'});
     const target=kind==='apple'?data.download_url:data.save_url;
     const pattern=kind==='apple'?/^https:\/\/doctorqr-backend-production\.up\.railway\.app\/api\/wallet\/download\/[A-Za-z0-9_-]{43}$/:/^https:\/\/pay\.google\.com\/gp\/v\/save\/[A-Za-z0-9_.-]+$/;
     if(!pattern.test(target||''))throw Error('wallet_url_invalid');window.location.assign(target);
    });
   }
   created=true;status.textContent='';
  }catch(_){root.hidden=true;}finally{checking=false;}
 }
 panel?.addEventListener('toggle',()=>{if(panel.open)refresh();});
 window.addEventListener('doctorqr:account-invalidated',()=>{root.hidden=true;root.replaceChildren();});
 window.addEventListener('storage',e=>{if(e.key===null||['doctorqr_id','doctorqr_token','doctorqr_user','identity_registration','identity_access_token'].includes(e.key)){root.hidden=true;root.replaceChildren();created=true;}});
});
})();
