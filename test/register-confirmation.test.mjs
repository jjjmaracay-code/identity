import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../register.html',import.meta.url),'utf8');
const start=source.indexOf('// =================== PASO 2 — VERIFICAR');
const end=source.indexOf('// =================== ENTRAR A LA APP',start);
const listenerSource=source.slice(start,end);
for(const failure of ['offline','server','invalid-response'])test(`registro ${failure}: no guarda identidad ni concede prueba sin confirmación del servidor`,async()=>{
 let handler;const writes=[],toasts=[];
 const button={disabled:false,textContent:'',addEventListener:(_,fn)=>{handler=fn;}};
 const context={pwd1Buffer:'same',pwd2Buffer:'same',step1Data:{name:'Fixture',email:'fixture@example.com'},codeBuffer:'123456',
  document:{getElementById:()=>button},getOrCreateDeviceId:()=>crypto.randomUUID(),
  localStorage:{setItem:(...args)=>writes.push(args)},t:k=>k,showToast:s=>toasts.push(s),checkStep2Ready(){},
  clearInterval(){throw new Error('Registration must stop before storing local identity');},
  fetch:async()=>{if(failure==='offline')throw new Error('Network');return{ok:failure!=='server',status:failure==='server'?503:200,json:async()=>({ok:true})};}
 };
 vm.createContext(context);vm.runInContext(listenerSource,context);
 await handler();assert.deepEqual(writes,[]);assert.equal(toasts.at(-1),'billing.error');
});
