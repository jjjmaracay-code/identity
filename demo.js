// Demostración independiente: datos ficticios en memoria, sin cuenta,
// almacenamiento del usuario, llamadas a la API ni enlaces de un solo uso.
(function () {
  'use strict';

  function startDemo() {
    var qr = document.getElementById('demo-qr');
    var qrError = document.getElementById('demo-qr-error');
    var download = document.getElementById('demo-download');
    var language = document.getElementById('demo-language');

    function exampleVCard() {
      return buildVCardFromProfile({
        name: 'Alex Demo',
        job: window.t('growth.demo_role'),
        company: window.t('growth.demo_company'),
        email: 'alex.demo@example.com'
      });
    }

    function renderQR() {
      qr.textContent = '';
      qrError.hidden = true;
      try {
        new QRCodeStyling({
          type: 'svg', data: exampleVCard(), width: 220, height: 220,
          margin: 20, qrOptions: { errorCorrectionLevel: 'M' },
          dotsOptions: { type: 'square', color: '#000000' },
          backgroundOptions: { color: '#ffffff' }
        }).append(qr);
      } catch (error) {
        qrError.hidden = false;
      }
    }

    download.disabled = false;
    download.addEventListener('click', function () {
      downloadVCardFile(exampleVCard(), 'identifly-demo.vcf');
    });

    language.value = window.currentLanguage;
    language.addEventListener('change', async function () {
      language.disabled = true;
      try {
        await window.setLanguage(language.value);
        renderQR();
      } finally {
        language.disabled = false;
      }
    });
    renderQR();
  }

  window.i18nReady.finally(startDemo);
})();
