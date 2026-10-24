(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const reg = JSON.parse(localStorage.getItem('identity_registration') || '{}');
  const token = localStorage.getItem('identity_access_token');
  const cred = { email: reg.email, token };
  let status = null, currentPlan = null, busy = false;
  const txt = key => t('billing.' + key);
  const salesOpen = () => status?.checkoutEnabled === true;
  const pausedMessages = {
    es: 'Las contrataciones estarán disponibles próximamente.',
    en: 'New purchases and card trials are temporarily unavailable.',
    ca: 'Les noves compres i proves amb targeta no estan disponibles temporalment.',
    eu: 'Erosketa berriak eta txartel bidezko probak ez daude erabilgarri aldi baterako.',
    gl: 'As novas compras e probas con tarxeta non están dispoñibles temporalmente.',
    fr: 'Les nouveaux achats et essais avec carte sont temporairement indisponibles.',
    de: 'Neue Käufe und Testangebote mit Karte sind vorübergehend nicht verfügbar.',
    pt: 'Novas compras e testes com cartão estão temporariamente indisponíveis.',
    hi: 'नई खरीदारी और कार्ड से परीक्षण अस्थायी रूप से उपलब्ध नहीं हैं।',
    zh: '新购买和绑卡试用暂时不可用。',
    ru: 'Новые покупки и пробные периоды с картой временно недоступны.',
    ja: '新規購入とカード登録によるトライアルは一時的にご利用いただけません。',
    ar: 'عمليات الشراء الجديدة والفترات التجريبية بالبطاقة غير متاحة مؤقتًا.'
  };
  const pausedText = () => pausedMessages[document.documentElement.lang] || pausedMessages.es;
  const trialOffered = () => status?.trialEligible === true;
  const isTrial = () => currentPlan === 'pro' && trialOffered();
  function canSubmit() { return salesOpen() && $('waiver-check').checked && (!isTrial() || $('trial-check').checked); }
  async function post(path, body = {}) {
    const res = await fetch('/api/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...cred }),
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error), { code: data.error });
    return data;
  }
  function render() {
    const offered = trialOffered();
    $('trial-offer').hidden = !offered || !salesOpen();
    $('btn-pro').textContent = offered ? txt('start_trial') : t('index.plans.pro_button');
    const active = status && !status.bloqueado;
    $('btn-back-app').hidden = !active;
    $('btn-cancel-subscription').hidden = !status?.hasSubscription || status?.cancelAtPeriodEnd;
    $('btn-pro').disabled = !salesOpen() || !!(active && ['pro', 'lifetime'].includes(status.plan));
    $('btn-lifetime').disabled = $('btn-pro').disabled;
    if (status?.cancelAtPeriodEnd) $('billing-status').textContent = txt('cancelled');
    else if (status?.trialActive) $('billing-status').textContent = txt('trial_remaining').replace('{n}', status.diasRestantes);
    else if (offered) $('billing-status').textContent = txt('card_required');
    else if (active && status.plan !== 'free') $('billing-status').textContent = txt('active');
    $('checkout-notice').hidden = salesOpen();
    $('checkout-notice').textContent = pausedText();
    if (status?.bloqueado && !offered) $('trial-info').textContent = t('index.edit.trial_expired');
  }
  async function refresh() {
    if (!cred.email || !cred.token) return;
    const data = await post('check-plan');
    if (data.ok) { status = data; identityPlanCache.write(data); render(); }
  }
  function openModal(plan) {
    if (!salesOpen()) { alert(pausedText()); return; }
    if (!cred.email || !cred.token) { alert(txt('need_auth')); return; }
    currentPlan = plan;
    $('modal-title').textContent = isTrial() ? txt('start_trial') : plan === 'pro' ? 'Pro — €2.99' : 'Lifetime — €14.99';
    $('notify-email').value = reg.email;
    $('waiver-check').checked = false;
    $('trial-check').checked = false;
    $('trial-consent-label').hidden = !isTrial();
    $('btn-checkout').disabled = true;
    $('modal').classList.add('open');
  }
  async function checkout() {
    if (busy || !canSubmit()) return;
    busy = true; $('btn-checkout').disabled = true; $('btn-checkout').textContent = txt('connecting');
    try {
      const data = await post('create-checkout', { plan: currentPlan, waiverAccepted: true, trialAccepted: isTrial() && $('trial-check').checked });
      if (!data.url || new URL(data.url).origin !== 'https://checkout.stripe.com') throw new Error('invalid_checkout');
      window.location.href = data.url;
    } catch (err) {
      if (err.code === 'checkout_paused') {
        status = { ...status, checkoutEnabled: false }; render(); $('modal').classList.remove('open');
      }
      alert(err.code === 'checkout_paused' ? pausedText() : txt(err.code === 'activation_pending' ? 'pending' : err.code === 'no_verificado' ? 'need_auth' : 'error'));
      busy = false; $('btn-checkout').disabled = !canSubmit(); $('btn-checkout').textContent = txt('checkout');
    }
  }
  async function cancel() {
    if (!confirm(txt('cancel_confirm'))) return;
    const btn = $('btn-cancel-subscription'); btn.disabled = true;
    try {
      const data = await post('cancel-subscription');
      if (!data.ok) throw new Error('unconfirmed');
      $('billing-status').textContent = txt('cancelled');
      btn.hidden = true;
      await refresh().catch(() => {});
    } catch { alert(txt('cancel_error')); }
    finally { btn.disabled = false; }
  }
  function exportCard() {
    const profile = JSON.parse(localStorage.getItem('identity_data') || 'null');
    if (!profile?.name) { alert(txt('no_card')); return; }
    const url = URL.createObjectURL(new Blob([buildVCardFromProfile(profile)], { type: 'text/vcard' }));
    const a = document.createElement('a'); a.href = url; a.download = (profile.name || 'identifly') + '.vcf';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  async function deleteAccount() {
    const warning = document.createElement('div');
    warning.innerHTML = t('index.delete_confirm.text_html').replace(/<br\s*\/?\s*>/gi, '\n');
    if (!confirm(warning.textContent)) return;
    const btn = $('btn-delete-account-paywall');
    if (reg.email && !navigator.onLine) { alert(t('index.delete_confirm.offline_toast')); return; }
    btn.disabled = true;
    try {
      if (reg.email) {
        // El servidor confirma la baja y la cancelación antes del borrado local.
        await post('delete-account');
      }
      await borrarTodoElAlmacenamiento(); window.location.replace('/index.html');
    } catch (err) {
      if (err.code === 'no_verificado' && confirm(t('index.delete_confirm.delete_local_only_button'))) {
        await borrarTodoElAlmacenamiento(); window.location.replace('/index.html');
      } else alert(t('index.delete_confirm.server_error_toast'));
    } finally { btn.disabled = false; }
  }
  window.i18nReady.then(async () => {
    $('btn-pro').addEventListener('click', () => openModal('pro'));
    $('btn-lifetime').addEventListener('click', () => openModal('lifetime'));
    $('btn-close-modal').addEventListener('click', () => $('modal').classList.remove('open'));
    for (const id of ['waiver-check', 'trial-check']) $(id).addEventListener('change', () => { $('btn-checkout').disabled = busy || !canSubmit(); });
    $('btn-checkout').addEventListener('click', checkout);
    $('btn-cancel-subscription').addEventListener('click', cancel);
    $('btn-export-vcard-paywall').addEventListener('click', exportCard);
    $('btn-delete-account-paywall').addEventListener('click', deleteAccount);
    $('btn-back-app').addEventListener('click', () => { window.location.href = '/index.html'; });
    $('link-vincular-compra-paywall').addEventListener('click', () => {
      if (!navigator.onLine) { alert(t('index.recover_access.offline_notice')); return; }
      window.location.href = '/?vincular=1';
    });
    const url = new URL(window.location.href), sessionId = url.searchParams.get('session_id');
    if (sessionId) {
      url.searchParams.delete('session_id'); url.searchParams.delete('plan');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      try {
        const result = await post('check-session', { sessionId });
        if (result.active) { await refresh(); window.location.href = '/index.html'; return; }
        $('billing-status').textContent = txt('pending');
      } catch { $('billing-status').textContent = txt('pending'); }
    }
    try { await refresh(); } catch { $('billing-status').textContent = txt('error'); }
  });
})();
