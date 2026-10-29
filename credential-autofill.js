/* Native credential fields bridge to the existing local password flows.
   No persistence, network requests, credential API calls or automatic submission. */
(function () {
  'use strict';
  function bind(fields) {
    const pairs = fields.map(field => ({...field, input:document.getElementById(field.id)})).filter(field => field.input);
    const forms = [...new Set(pairs.map(field => field.input.form).filter(Boolean))];
    let pointerHeld = false, restoreTimer;
    function sync() {
      for (const field of pairs) if (field.input.value !== field.get()) field.set(field.input.value);
    }
    function keyboard() {
      for (const form of forms) {
        const native = !!document.activeElement?.matches('input[data-credential-field]') &&
          document.activeElement.getClientRects().length > 0 && form.contains(document.activeElement);
        if (form.dataset.credentialNative !== String(native)) form.dataset.credentialNative = String(native);
      }
    }
    for (const field of pairs) {
      for (const name of ['input','change','animationstart']) field.input.addEventListener(name, sync);
    }
    for (const form of forms) {
      // Credential values are verified locally by the existing handlers.
      form.addEventListener('submit', event => { event.preventDefault(); sync(); }, true);
      form.addEventListener('pointerdown', () => { pointerHeld = true; sync(); }, true);
      form.addEventListener('click', () => {
        sync(); clearTimeout(restoreTimer);
        // Restore after activation, so a blur cannot move a button out from
        // under the finger between pointerdown and click.
        restoreTimer = setTimeout(keyboard, 0);
      }, true);
      form.addEventListener('focusin', () => {
        sync();
        if (!pointerHeld || document.activeElement?.matches('input[data-credential-field]')) keyboard();
      });
      form.addEventListener('focusout', () => queueMicrotask(() => { sync(); if (!pointerHeld) keyboard(); }));
    }
    for (const name of ['pointerup','pointercancel']) window.addEventListener(name, () => {
      pointerHeld = false; clearTimeout(restoreTimer); restoreTimer = setTimeout(keyboard, 350);
    }, {passive:true});
    // Some password managers update .value without emitting input/change.
    // Read only these visible access fields, and repaint only when a value changes.
    let timer;
    function resume() {
      clearInterval(timer);
      timer = setInterval(() => {
        if (!document.hidden && forms.some(form => form.getClientRects().length && !form.closest('.hidden'))) sync();
      }, 200);
      sync(); keyboard();
    }
    window.addEventListener('blur', () => { pointerHeld = false; });
    window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(restoreTimer); pointerHeld = false; });
    window.addEventListener('pageshow', resume);
    for (const field of pairs) field.input.disabled = false;
    resume();
    return Object.freeze({sync});
  }
  window.IdentityAutofill = Object.freeze({bind});
})();
