/* Presentation only: larger application keyboards and minimal viewport alignment.
   Never reads entered values, changes focus, synthesizes keys or submits a form. */
(function(){
  'use strict';
  function start(){
    const selector='[data-keyboard]',seen=new WeakMap();let last=null,frame=0,held=false,pending=null,resizeTimer=0,manualBrowsing=false;
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    function visible(el){
      if(!el?.isConnected||!el.querySelector('button')||!el.getClientRects().length)return false;
      const s=getComputedStyle(el);if(s.visibility==='hidden'||s.pointerEvents==='none')return false;
      for(let p=el;p&&p!==document.body;p=p.parentElement)if(p.hidden||p.inert||p.getAttribute('aria-hidden')==='true')return false;
      return el.getBoundingClientRect().height>0;
    }
    function lookup(el,key){const sel=el.dataset[key];if(!sel)return null;try{return document.querySelector(sel);}catch(_){return null;}}
    function parents(el){const list=[];for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+1)list.push(p);}list.push(null);return list;}
    function viewport(parent){
      const v=window.visualViewport,top=v?.offsetTop||0,bottom=top+(v?.height||innerHeight),r=parent?.getBoundingClientRect();
      return {top:Math.max(top+12,r?r.top+parent.clientTop+8:top+12),bottom:Math.min(bottom-12,r?r.top+parent.clientTop+parent.clientHeight-8:bottom-12)};
    }
    function size(el){
      const ps=parents(el),view=viewport(ps[0]),height=Math.max(160,view.bottom-view.top),rows=el.dataset.keyboard==='num'?4:Math.max(1,el.querySelectorAll('.qwerty-row').length);
      const display=lookup(el,'keyboardDisplay'),r=el.getBoundingClientRect(),d=display?.getBoundingClientRect();
      const before=d&&d.height>0?Math.max(0,r.top-d.top):0,gap=el.dataset.keyboard==='num'?8:5;
      const ideal=el.dataset.keyboard==='num'?Math.min(92,Math.max(52,height*.12)):Math.min(70,Math.max(48,height*.092));
      const style=getComputedStyle(el),padding=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0);
      const fit=Math.floor((height-Math.min(before,height*.35)-(rows-1)*gap-padding-8)/rows),value=Math.max(44,Math.min(ideal,fit));
      const css=value.toFixed(2)+'px';if(el.style.getPropertyValue('--keyboard-key-height')!==css)el.style.setProperty('--keyboard-key-height',css);
    }
    function bounds(el,space){
      const r=el.getBoundingClientRect(),d=lookup(el,'keyboardDisplay'),a=lookup(el,'keyboardAction');let top=r.top,bottom=r.bottom;
      if(d&&d.getClientRects().length){const b=d.getBoundingClientRect();if(b.height&&bottom-Math.min(top,b.top)<=space)top=Math.min(top,b.top);}
      if(a&&a.getClientRects().length){const b=a.getBoundingClientRect();if(b.height&&Math.max(bottom,b.bottom)-top<=space)bottom=Math.max(bottom,b.bottom);}
      return {top,bottom};
    }
    function reveal(el){
      if(!visible(el)||document.hidden)return;
      if(held){pending=el;return;}size(el);last=el;
      // Inner modal/panel first, then the page. Move only the amount actually missing.
      for(const parent of parents(el)){
        const v=viewport(parent),b=bounds(el,v.bottom-v.top);let delta=0;
        if(b.bottom>v.bottom)delta=b.bottom-v.bottom;
        if(b.top-delta<v.top)delta=b.top-v.top;
        if(Math.abs(delta)<2)continue;
        const behavior=reduced()?'instant':'smooth';
        if(parent)parent.scrollBy({top:delta,behavior});else window.scrollBy({top:delta,behavior});
        // Smooth alignment has not moved yet. Its nearest scrollable ancestor owns it.
        if(!reduced())break;
      }
    }
    function queue(el){if(!el)return;pending=el;if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const target=pending;pending=null;if(target)reveal(target);});}
    function scan(){
      let first=null;
      for(const el of document.querySelectorAll(selector)){
        const on=visible(el),old=seen.get(el);seen.set(el,on);if(!on)continue;if(!held)size(el);
        if(!old&&el.dataset.keyboardAuto!=='interact'&&!first)first=el;
      }
      if(first){manualBrowsing=false;queue(first);}
      else if(last&&visible(last)&&!manualBrowsing&&!nativeEditing()){const r=last.getBoundingClientRect(),v=viewport(null);if(targetFor(document.activeElement)===last||r.bottom>v.top&&r.top<v.bottom)queue(last);}
    }
    let scanFrame=0;
    function schedule(){if(scanFrame)return;scanFrame=requestAnimationFrame(()=>{scanFrame=0;scan();});}
    function targetFor(node){
      if(!(node instanceof Element))return null;const direct=node.closest(selector);if(direct)return direct;
      for(const el of document.querySelectorAll(selector)){const d=lookup(el,'keyboardDisplay');if(d&&(d===node||d.contains(node)))return el;}
      return null;
    }
    document.addEventListener('pointerdown',e=>{held=true;const target=targetFor(e.target);if(target){last=target;pending=target;manualBrowsing=false;}else{manualBrowsing=true;pending=null;}},{capture:true,passive:true});
    const release=()=>{held=false;if(pending){const target=pending;pending=null;queue(target);}};
    document.addEventListener('pointerup',release,{capture:true,passive:true});document.addEventListener('pointercancel',release,{capture:true,passive:true});
    const manual=e=>{if(e.type==='wheel'||!targetFor(e.target)){manualBrowsing=true;pending=null;if(frame){cancelAnimationFrame(frame);frame=0;}}};document.addEventListener('wheel',manual,{capture:true,passive:true});document.addEventListener('touchmove',manual,{capture:true,passive:true});
    const nativeEditing=()=>document.activeElement?.matches('input,textarea,select,[contenteditable=true]')&&document.activeElement.getClientRects().length>0&&!(document.activeElement.matches('[inputmode="none"]')&&targetFor(document.activeElement));
    document.addEventListener('focusin',e=>{const target=targetFor(e.target);if(target){manualBrowsing=false;queue(target);}});
    // Changes in screens and keyboard modes are observed without reading entered text.
    new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','inert','aria-hidden']});
    const resize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{schedule();if(last&&visible(last)&&!nativeEditing()&&!manualBrowsing)queue(last);},120);};
    window.addEventListener('resize',resize,{passive:true});window.visualViewport?.addEventListener('resize',resize,{passive:true});
    window.addEventListener('orientationchange',resize,{passive:true});window.screen?.orientation?.addEventListener?.('change',resize);
    window.addEventListener('blur',()=>{held=false;pending=null;});
    window.addEventListener('pageshow',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    document.fonts?.ready.then(()=>{schedule();if(last&&visible(last)&&!nativeEditing()&&!manualBrowsing)queue(last);});schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
