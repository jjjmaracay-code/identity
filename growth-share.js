// Public recommendation only: this module never reads profile or account data.
(function () {
  'use strict';

  var PUBLIC_URL = 'https://www.identifly.app/';
  var fallbackText = {
    'growth.share_title': 'IDENTIFLY',
    'growth.share_text': 'Crea tu tarjeta digital con IDENTIFLY y comparte tus datos de contacto fácilmente.',
    'growth.link_copied': 'Enlace copiado',
    'growth.copy_manually': 'Selecciona y copia este enlace para compartirlo.'
  };

  function translated(key) {
    var value = typeof window.t === 'function' ? window.t(key) : key;
    return value && value !== key ? value : fallbackText[key];
  }

  function bindRecommendation() {
    var trigger = document.getElementById('btn-recommend');
    var panel = document.getElementById('growth-share-fallback');
    var link = document.getElementById('growth-share-url');
    var status = document.getElementById('growth-share-status');
    var copy = document.getElementById('growth-copy-link');
    var close = document.getElementById('growth-share-close');
    if (!trigger || !panel || !link || !status || !copy || !close) return;

    var sharing = false;
    var copying = false;
    link.value = PUBLIC_URL;

    function setStatus(key) {
      status.textContent = key ? translated(key) : '';
      if (key) status.setAttribute('data-i18n', key);
      else status.removeAttribute('data-i18n');
    }

    function selectLink() {
      link.focus();
      link.select();
      if (typeof link.setSelectionRange === 'function') {
        link.setSelectionRange(0, link.value.length);
      }
    }

    function showFallback() {
      link.value = PUBLIC_URL;
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      setStatus(null);
      selectLink();
    }

    function closeFallback(restoreFocus) {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }

    trigger.addEventListener('click', async function () {
      if (sharing) return;
      sharing = true;
      try {
        // Keep the native share call directly within this user gesture. Never
        // append location.search/hash, contact details, a token or tracking id.
        if (typeof navigator.share === 'function') {
          try {
            await navigator.share({
              title: translated('growth.share_title'),
              text: translated('growth.share_text'),
              url: PUBLIC_URL
            });
            closeFallback(false);
            return;
          } catch (error) {
            if (error && error.name === 'AbortError') return;
          }
        }
        showFallback();
      } finally {
        sharing = false;
      }
    });

    copy.addEventListener('click', async function () {
      if (copying) return;
      copying = true;
      copy.disabled = true;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            await navigator.clipboard.writeText(PUBLIC_URL);
            setStatus('growth.link_copied');
            return;
          } catch (error) {
            // Denied/unavailable clipboard: keep a visible, selectable link.
          }
        }
        selectLink();
        try {
          if (typeof document.execCommand === 'function' && document.execCommand('copy')) {
            setStatus('growth.link_copied');
            return;
          }
        } catch (error) {
          // Legacy copy is optional; manual selection remains available.
        }
        setStatus('growth.copy_manually');
      } finally {
        copying = false;
        copy.disabled = false;
      }
    });

    close.addEventListener('click', function () { closeFallback(true); });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFallback(true);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindRecommendation, { once: true });
  } else {
    bindRecommendation();
  }
})();
