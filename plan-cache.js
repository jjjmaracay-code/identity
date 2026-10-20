// Estado de acceso confirmado por el servidor. La gracia offline nunca
// prolonga una prueba con tarjeta más allá de su fecha real de finalización.
(function () {
  function read(maxAge) {
    try {
      var data = JSON.parse(localStorage.getItem('identity_plan_verified') || 'null');
      if (!data || !Number.isFinite(data.verifiedAt) || Date.now() - data.verifiedAt < 0 || Date.now() - data.verifiedAt >= maxAge) return null;
      if (data.trialActive && !(Date.now() < Date.parse(data.trialEndsAt))) return Object.assign({}, data, { bloqueado: true });
      return data;
    } catch (_) { return null; }
  }
  function write(data) {
    if (data?.ok !== true) return;
    localStorage.setItem('identity_plan_verified', JSON.stringify({
      bloqueado: data.bloqueado, plan: data.plan, verifiedAt: Date.now(),
      trialActive: !!data.trialActive, trialEndsAt: data.trialEndsAt || null,
      cardTrialRequired: !!data.cardTrialRequired, cancelAtPeriodEnd: !!data.cancelAtPeriodEnd,
      hasSubscription: !!data.hasSubscription,
    }));
    localStorage.setItem('identity_plan', data.plan);
    if (data.cardTrialRequired) {
      var reg = JSON.parse(localStorage.getItem('identity_registration') || '{}');
      reg.cardTrialRequired = true;
      localStorage.setItem('identity_registration', JSON.stringify(reg));
    }
  }
  window.identityPlanCache = { read: read, write: write };
})();
