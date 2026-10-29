/* Deliberate editing, independent of storage, validation, authentication and synchronisation.
   Fieldsets are disabled in HTML before JS loads. Unlocking only removes that inherited
   restriction; existing readonly/disabled/inert rules on individual fields remain intact. */
(function () {
  'use strict';
  const words={
    es:['Bloqueada','Editando','Desbloquear edición de la planilla','Bloquear edición de la planilla','Activar edición','La planilla está en modo lectura para evitar cambios involuntarios al desplazarte.','Activar edición','Seguir en lectura','Solo lectura. Usa el candado azul para editar.','Edición activada. Usa el candado para volver a bloquear.','Planilla bloqueada. Usa el candado azul para editar.','Bloquear conserva lo escrito y no provoca un guardado.','Espera a que termine la carga o verificación de tus datos.'],
    en:['Locked','Editing','Unlock form editing','Lock form editing','Enable editing','The form is in reading mode to prevent accidental changes while scrolling.','Enable editing','Keep reading','Read only. Use the blue lock to edit.','Editing enabled. Use the lock to protect the form again.','Form locked. Use the blue lock to edit.','Locking keeps your entries and does not trigger a save.','Wait until your data has finished loading or being verified.'],
    fr:['Verrouillé','Édition','Déverrouiller le formulaire','Verrouiller le formulaire','Activer la modification','Le formulaire est en lecture seule pour éviter les modifications involontaires pendant le défilement.','Activer la modification','Continuer la lecture','Lecture seule. Utilisez le cadenas bleu pour modifier.','Modification activée. Utilisez le cadenas pour verrouiller à nouveau.','Formulaire verrouillé. Utilisez le cadenas bleu pour modifier.','Le verrouillage conserve la saisie sans déclencher de sauvegarde.','Attendez la fin du chargement ou de la vérification des données.'],
    pt:['Bloqueada','A editar','Desbloquear edição do formulário','Bloquear edição do formulário','Ativar edição','O formulário está em modo de leitura para evitar alterações involuntárias ao percorrer.','Ativar edição','Continuar a ler','Só leitura. Use o cadeado azul para editar.','Edição ativada. Use o cadeado para voltar a bloquear.','Formulário bloqueado. Use o cadeado azul para editar.','Bloquear mantém o que escreveu sem iniciar uma gravação.','Aguarde o fim do carregamento ou da verificação dos dados.'],
    de:['Gesperrt','Bearbeiten','Formular zur Bearbeitung entsperren','Formular sperren','Bearbeitung aktivieren','Das Formular ist schreibgeschützt, um versehentliche Änderungen beim Scrollen zu vermeiden.','Bearbeitung aktivieren','Weiter lesen','Schreibgeschützt. Zum Bearbeiten das blaue Schloss verwenden.','Bearbeitung aktiv. Mit dem Schloss wieder sperren.','Formular gesperrt. Zum Bearbeiten das blaue Schloss verwenden.','Sperren erhält Ihre Eingaben und löst kein Speichern aus.','Warten Sie, bis die Daten geladen oder überprüft wurden.'],
    ca:['Bloquejada','Editant','Desbloquejar l’edició del formulari','Bloquejar l’edició del formulari','Activar l’edició','El formulari és en mode de lectura per evitar canvis involuntaris en desplaçar-te.','Activar l’edició','Continuar llegint','Només lectura. Fes servir el cadenat blau per editar.','Edició activada. Fes servir el cadenat per tornar a bloquejar.','Formulari bloquejat. Fes servir el cadenat blau per editar.','Bloquejar conserva el que has escrit sense desar-ho automàticament.','Espera que acabi la càrrega o verificació de les dades.'],
    gl:['Bloqueada','Editando','Desbloquear a edición do formulario','Bloquear a edición do formulario','Activar a edición','O formulario está en modo de lectura para evitar cambios involuntarios ao desprazarte.','Activar a edición','Seguir lendo','Só lectura. Usa o cadeado azul para editar.','Edición activada. Usa o cadeado para volver bloquear.','Formulario bloqueado. Usa o cadeado azul para editar.','Bloquear conserva o escrito sen provocar un gardado.','Agarda a que remate a carga ou verificación dos datos.'],
    eu:['Blokeatuta','Editatzen','Desblokeatu inprimakiaren edizioa','Blokeatu inprimakiaren edizioa','Aktibatu edizioa','Inprimakia irakurtzeko moduan dago, korritzean nahi gabeko aldaketak saihesteko.','Aktibatu edizioa','Jarraitu irakurtzen','Irakurtzeko soilik. Erabili giltzarrapo urdina editatzeko.','Edizioa aktibatuta. Erabili giltzarrapoa berriro blokeatzeko.','Inprimakia blokeatuta. Erabili giltzarrapo urdina editatzeko.','Blokeatzeak idatzitakoa gordetzen du, gorde eragiketa abiatu gabe.','Itxaron datuak kargatu edo egiaztatu arte.'],
    hi:['सुरक्षित','संपादन','फ़ॉर्म का संपादन खोलें','फ़ॉर्म का संपादन बंद करें','संपादन चालू करें','स्क्रॉल करते समय अनचाहे बदलाव रोकने के लिए फ़ॉर्म केवल पढ़ने के मोड में है।','संपादन चालू करें','पढ़ना जारी रखें','केवल पढ़ने के लिए। संपादन हेतु नीले ताले का उपयोग करें।','संपादन चालू है। दोबारा सुरक्षित करने के लिए ताले का उपयोग करें।','फ़ॉर्म सुरक्षित है। संपादन हेतु नीले ताले का उपयोग करें।','ताला लगाने से आपकी प्रविष्टियाँ बनी रहती हैं और सहेजना शुरू नहीं होता।','डेटा लोड या सत्यापित होने तक प्रतीक्षा करें।'],
    zh:['已锁定','编辑中','解锁表单编辑','锁定表单编辑','启用编辑','表单处于只读模式，以防滚动时意外更改。','启用编辑','继续阅读','只读。点击蓝色锁图标进行编辑。','编辑已启用。使用锁图标重新锁定。','表单已锁定。请使用蓝色锁图标进行编辑。','锁定会保留已输入的内容，不会触发保存。','请等待数据加载或验证完成。'],
    ru:['Закрыто','Правка','Разблокировать редактирование формы','Заблокировать редактирование формы','Разрешить правку','Форма доступна только для чтения, чтобы избежать случайных изменений при прокрутке.','Разрешить правку','Продолжить чтение','Только чтение. Для правки используйте синий замок.','Правка включена. Нажмите замок, чтобы снова защитить форму.','Форма заблокирована. Для правки используйте синий замок.','Блокировка сохраняет введённое, не запуская сохранение.','Дождитесь загрузки или проверки данных.'],
    ja:['ロック中','編集中','フォームの編集を解除','フォームの編集をロック','編集を有効にする','スクロール中の誤操作を防ぐため、フォームは閲覧モードになっています。','編集を有効にする','閲覧を続ける','閲覧専用です。編集には青い鍵を使ってください。','編集が有効です。鍵で再びロックできます。','フォームはロック中です。青い鍵で編集を有効にしてください。','ロックしても入力内容は消えず、保存処理も開始しません。','データの読み込みや確認が終わるまでお待ちください。'],
    ar:['مقفلة','تعديل','فتح تعديل النموذج','قفل تعديل النموذج','تفعيل التعديل','النموذج في وضع القراءة لمنع التغييرات غير المقصودة أثناء التمرير.','تفعيل التعديل','متابعة القراءة','للقراءة فقط. استخدم القفل الأزرق للتعديل.','التعديل مفعّل. استخدم القفل لحماية النموذج مجددًا.','النموذج مقفل. استخدم القفل الأزرق للتعديل.','القفل يحتفظ بما كتبته ولا يبدأ عملية حفظ.','انتظر حتى يكتمل تحميل البيانات أو التحقق منها.']
  };
  const text=i=>(words[String(document.documentElement.lang||'es').slice(0,2)]||words.es)[i];
  const make=(tag,attrs,children=[])=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else n.setAttribute(k,v);}n.append(...children);return n;};
  function icon(open){const n=make('span',{class:'fel-icon','aria-hidden':'true'});n.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="'+(open?'M8 10V7a4 4 0 0 1 7.5-2':'M8 10V7a4 4 0 0 1 8 0v3')+'"/><path d="M12 14v3"/></svg>';return n;}
  const contexts=[];
  let suppress=null,gesture=null;
  const now=()=>performance.now();
  function gestureStart(e){if(e.isPrimary===false)return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,scroll:false};suppress=null;}
  function gestureMove(e){if(gesture&&e.pointerId===gesture.id&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>9)gesture.moved=true;}
  function gestureEnd(e){if(gesture&&e.pointerId===gesture.id){if(gesture.moved||gesture.scroll)suppress={until:now()+500};gesture=null;}}
  function isGhost(e){return !!(suppress&&now()<suppress.until&&(e.detail>0||e.pointerType==='touch'||e.pointerType==='pen'));}
  function prevent(e){e.preventDefault();e.stopImmediatePropagation();}
  function ownerAvailable(c){
    if(c.surface.dataset.formEditProduct!=='atabey')return true;
    if(!window.MedicalOwner?.current())return false;
    return !c.surface.querySelector('#form .form-section[inert]');
  }
  function visible(c){const trigger=c.surface.dataset.formEditOpenClass;return !c.surface.hidden&&!c.surface.closest('[hidden]')&&(!trigger||c.surface.classList.contains(trigger));}
  function roots(c){return [...c.surface.querySelectorAll('[data-form-edit-root]')].filter(n=>n.closest('[data-form-edit-surface]')===c.surface);}
  function inRoot(c,target){return roots(c).some(root=>root.contains(target));}
  function scope(target){return contexts.find(c=>visible(c)&&(inRoot(c,target)||target.closest(c.surface.dataset.formEditActions||'[data-form-edit-action]')?.closest('[data-form-edit-surface]')===c.surface));}
  function syncCustom(c){
    for(const root of roots(c))for(const item of root.querySelectorAll('.chip,[data-form-edit-control]')){
      if(!c.saved.has(item))c.saved.set(item,{tab:item.getAttribute('tabindex'),aria:item.getAttribute('aria-disabled')});
      const original=c.saved.get(item);
      if(c.locked){if(item.getAttribute('aria-disabled')!=='true')item.setAttribute('aria-disabled','true');if(item.getAttribute('tabindex')!=='-1')item.setAttribute('tabindex','-1');}
      else if(c.customLocked.has(item)){
        if(original.tab===null)item.removeAttribute('tabindex');else item.setAttribute('tabindex',original.tab);
        if(item.closest('[inert],.chips-disabled'))item.setAttribute('aria-disabled','true');else if(original.aria===null)item.removeAttribute('aria-disabled');else item.setAttribute('aria-disabled',original.aria);
      }
      if(c.locked)c.customLocked.add(item);else c.customLocked.delete(item);
    }
    const actions=c.surface.dataset.formEditActions;
    if(actions)for(const item of c.surface.querySelectorAll(actions)){
      if(!c.actionAria.has(item))c.actionAria.set(item,item.getAttribute('aria-disabled'));
      if(c.locked){if(item.getAttribute('aria-disabled')!=='true')item.setAttribute('aria-disabled','true');}
      else {const original=c.actionAria.get(item);if(original===null){if(item.hasAttribute('aria-disabled'))item.removeAttribute('aria-disabled');}else if(item.getAttribute('aria-disabled')!==original)item.setAttribute('aria-disabled',original);}
    }
  }
  function language(c){
    c.label.textContent=text(c.locked?0:1);c.tab.setAttribute('aria-label',text(c.locked?2:3));c.tab.title=text(c.locked?2:3);
    c.bannerText.textContent=text(c.locked?8:9);c.heading.textContent=text(4);c.description.textContent=text(5);c.confirm.textContent=text(6);c.cancel.textContent=text(7);c.keep.textContent=text(11);
  }
  function apply(c,locked){
    const changed=c.locked!==locked;c.locked=locked;c.surface.dataset.formEditState=locked?'locked':'editing';
    for(const root of roots(c)){if(root.disabled!==locked)root.disabled=locked;root.dataset.formEditLocked=String(locked);}
    c.tab.dataset.state=locked?'locked':'editing';c.tab.setAttribute('aria-pressed',String(!locked));
    c.tab.replaceChildren(icon(!locked),c.label);c.bannerIcon.replaceChildren(icon(!locked));language(c);syncCustom(c);
    if(locked&&inRoot(c,document.activeElement))document.activeElement.blur();
    if(changed)window.dispatchEvent(new CustomEvent('form-edit-lock:change',{detail:{surface:c.surface.dataset.formEditSurface,locked}}));
  }
  function closeDialog(c){if(c.dialog.open)c.dialog.close();}
  function lock(c){closeDialog(c);apply(c,true);}
  function notice(c,index=10){c.toast.textContent=text(index);c.toast.hidden=false;clearTimeout(c.toastTimer);c.toastTimer=setTimeout(()=>{c.toast.hidden=true;},1900);}
  function request(c){
    if(!visible(c))return;
    if(!c.locked){lock(c);return;}
    if(!ownerAvailable(c)){notice(c,12);return;}
    language(c);c.beforeDialog=document.activeElement;c.dialog.showModal();c.cancel.focus();
  }
  function updateVisibility(c){const shown=visible(c);if(!shown||!c.shown)lock(c);c.shown=shown;c.tab.hidden=!shown;c.banner.hidden=!shown;}
  function mount(surface,index){
    const name=surface.dataset.formEditSurface||String(index),label=make('span',{class:'fel-tab-text'}),tab=make('button',{type:'button',class:'fel-tab',id:'form-edit-tab-'+name,'aria-haspopup':'dialog','aria-pressed':'false'});
    const bannerText=make('span'),bannerIcon=make('span',{'aria-hidden':'true'}),banner=make('aside',{class:'fel-banner',role:'status','aria-live':'polite'},[bannerIcon,bannerText]);
    const heading=make('h2',{id:'form-edit-title-'+name}),description=make('p'),keep=make('p',{class:'fel-keep'}),confirm=make('button',{type:'button',class:'fel-enable'}),cancel=make('button',{type:'button',class:'fel-cancel'});
    const dialog=make('dialog',{class:'fel-dialog','aria-labelledby':heading.id},[icon(false),heading,description,keep,make('div',{class:'fel-dialog-actions'},[confirm,cancel])]);
    const toast=make('div',{class:'fel-notice',role:'status','aria-live':'polite',hidden:''});
    const c={surface,locked:true,saved:new WeakMap(),customLocked:new WeakSet(),actionAria:new WeakMap(),label,tab,banner,bannerIcon,bannerText,heading,description,keep,confirm,cancel,dialog,toast,shown:false};contexts.push(c);
    // Keep the notice in its own planned row. The first protected root can be
    // the Save button inside the section carousel, rather than the form itself.
    const placeholders=[...surface.querySelectorAll('[data-form-edit-fallback]')];
    if(placeholders.length){placeholders[0].replaceWith(banner);placeholders.slice(1).forEach(item=>item.remove());}
    else {const first=roots(c).find(root=>!root.classList.contains('fel-action-root'))||roots(c)[0];if(first)(first.closest('.edit-tabs-bar')||first).before(banner);}
    surface.append(tab,dialog,toast);apply(c,true);updateVisibility(c);
    tab.addEventListener('click',e=>{if(isGhost(e)){prevent(e);return;}request(c);});
    cancel.addEventListener('click',()=>closeDialog(c));confirm.addEventListener('click',e=>{if(isGhost(e)){prevent(e);return;}if(!ownerAvailable(c)){closeDialog(c);notice(c,12);return;}apply(c,false);closeDialog(c);});
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});
    dialog.addEventListener('close',()=>{if(visible(c)&&c.beforeDialog?.isConnected)c.beforeDialog.focus({preventScroll:true});});
    const observer=new MutationObserver(records=>{
      if(records.some(r=>r.target===surface&&['class','hidden'].includes(r.attributeName)))updateVisibility(c);
      if(records.some(r=>r.type==='childList'||r.attributeName==='aria-disabled'||r.attributeName==='tabindex'))syncCustom(c);
      for(const root of roots(c)){if(root.disabled!==c.locked)root.disabled=c.locked;}
    });
    observer.observe(surface,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','disabled','aria-disabled','tabindex']});
    return c;
  }
  function initialise(){
    document.querySelectorAll('[data-form-edit-surface]').forEach(mount);
    const filter=e=>{
      const target=e.target instanceof Element?e.target:null;if(!target)return;
      if(target.closest('.fel-dialog,.fel-tab')){if(e.type==='click'&&isGhost(e))prevent(e);return;}
      const c=scope(target);if(!c)return;
      if(target.closest(c.surface.dataset.formEditPass||'[data-form-edit-pass]'))return;
      if(c.locked){prevent(e);if(e.type==='click')notice(c);return;}
      if(e.type==='click'&&isGhost(e)&&!target.matches('input[type="range"]'))prevent(e);
    };
    document.addEventListener('click',filter,true);
    document.addEventListener('beforeinput',filter,true);
    document.addEventListener('submit',filter,true);
    document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key))filter(e);},true);
    document.addEventListener('wheel',e=>{const t=e.target;if(t instanceof HTMLInputElement&&t.type==='number'&&t===document.activeElement&&scope(t))t.blur();},{capture:true,passive:true});
    document.addEventListener('pointerdown',gestureStart,{capture:true,passive:true});document.addEventListener('pointermove',gestureMove,{capture:true,passive:true});
    document.addEventListener('pointerup',gestureEnd,{capture:true,passive:true});document.addEventListener('pointercancel',gestureEnd,{capture:true,passive:true});
    document.addEventListener('scroll',()=>{if(gesture)gesture.scroll=true;},{capture:true,passive:true});
    function viewport(){const v=window.visualViewport,top=(v?v.offsetTop+v.height/2:innerHeight/2);for(const c of contexts)c.tab.style.setProperty('--fel-top',Math.max(96,top)+'px');}
    window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);viewport();
    window.addEventListener('pageshow',e=>{if(e.persisted)contexts.forEach(lock);});
    for(const event of ['pagehide','doctorqr:account-invalidated'])window.addEventListener(event,()=>contexts.forEach(lock));
    window.addEventListener('storage',e=>{if(e.key===null||['doctorqr_user','doctorqr_id','doctorqr_token','identity_registration','identity_auth_token'].includes(e.key))contexts.forEach(lock);});
    window.addEventListener('doctorqr:profile-published',e=>{if(!e.detail?.pendingDraft)contexts.filter(c=>c.surface.dataset.formEditProduct==='atabey').forEach(lock);});
    new MutationObserver(()=>contexts.forEach(language)).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    window.FormEditLock=Object.freeze({lockAll:()=>contexts.forEach(lock),isLocked:name=>contexts.find(c=>c.surface.dataset.formEditSurface===name)?.locked??true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise,{once:true});else initialise();
})();
