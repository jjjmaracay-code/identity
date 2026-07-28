function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { template, to_email, to_name, app_name, subject, alert, intro, message_title, message } = body;
    let code = body.code;
    const safeName = escapeHtml(to_name);

    if (!to_email) {
      return new Response(JSON.stringify({ error: 'Falta to_email' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    // 'verification' genera y guarda su propio código más abajo — no lo
    // acepta del cliente (ver nota junto a la generación). El resto de
    // templates (p.ej. 'backup', un código permanente que no se valida
    // contra ninguna acción posterior) siguen recibiéndolo del cliente,
    // sin cambios.
    if (template !== 'verification' && !code) {
      return new Response(JSON.stringify({ error: 'Falta code' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Rate limiting por email — máx 3 envíos/10min y 10 envíos/24h, vía PLANS_KV
    const rlKey = 'ratelimit:' + to_email.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const SHORT_WINDOW = 600, SHORT_LIMIT = 3;
    const LONG_WINDOW = 86400, LONG_LIMIT = 10;

    const rlRaw = await env.PLANS_KV.get(rlKey);
    const rl = rlRaw ? JSON.parse(rlRaw) : { count: 0, windowStart: now, dayCount: 0, dayStart: now };

    if (now - rl.windowStart >= SHORT_WINDOW) { rl.count = 0; rl.windowStart = now; }
    if (now - rl.dayStart >= LONG_WINDOW) { rl.dayCount = 0; rl.dayStart = now; }

    if (rl.count >= SHORT_LIMIT) {
      return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: SHORT_WINDOW - (now - rl.windowStart) }), {
        status: 429, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (rl.dayCount >= LONG_LIMIT) {
      return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: LONG_WINDOW - (now - rl.dayStart) }), {
        status: 429, headers: { 'Content-Type': 'application/json' }
      });
    }

    rl.count++; rl.dayCount++;
    await env.PLANS_KV.put(rlKey, JSON.stringify(rl), { expirationTtl: LONG_WINDOW });

    // Ya NO se bloquea el re-registro de emails ya existentes aquí. Antes
    // esta era la única barrera real contra reclamar una cuenta ajena;
    // ahora que register-complete.js exige y valida un código real de
    // verificación (ver más abajo y register-complete.js), esta barrera
    // adicional es redundante y solo le cerraba la puerta a usuarios
    // legítimos que perdieron su dispositivo — recovery.html no tiene
    // ningún camino real para ese caso, así que dejar completar un
    // registro nuevo (con verificación real de código) es la única forma
    // de recuperar acceso.

    // El código de verificación se genera y se guarda AQUÍ, en el
    // servidor — nunca lo decide el cliente. register-complete.js lo lee
    // de esta misma clave ('verify:' + email) para validar de verdad que
    // quien completa el registro es quien recibió este correo, en vez de
    // confiar en una comparación que antes se hacía solo en el navegador
    // (ver register-complete.js para el porqué). Caduca a los 10 minutos,
    // igual que ya prometía el propio texto del correo de abajo.
    if (template === 'verification') {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      await env.PLANS_KV.put(
        'verify:' + to_email.toLowerCase(),
        JSON.stringify({ code, createdAt: Date.now() }),
        { expirationTtl: 600 }
      );
    }

    let html, finalSubject;

    if (template === 'verification') {
      finalSubject = `Tu código de verificación IDENTIFLY está listo`;
      html = `
<div style="background:#080808;padding:40px 24px;font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #AAFF00;border-radius:16px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:22px;font-weight:900;letter-spacing:10px;color:#AAFF00;text-transform:uppercase;text-shadow:0 0 10px #AAFF00,0 0 25px rgba(170,255,0,0.6);">IDENTIFLY</div>
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.3);margin-top:4px;">IDENTIDAD DIGITAL SEGURA</div>
  </div>
  <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:8px;">Hola <strong style="color:#fff;">${safeName}</strong>,</p>
  <p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:24px;">Tu código de verificación IDENTIFLY es:</p>
  <div style="background:#111;border:2px solid #AAFF00;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
    <span style="font-size:36px;font-weight:900;letter-spacing:12px;color:#AAFF00;font-family:monospace;">${code}</span>
  </div>
  <div style="background:#0f0f0f;border:1px solid rgba(170,255,0,0.2);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:3px;color:#AAFF00;margin-bottom:12px;text-transform:uppercase;">Normas de seguridad</div>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;line-height:1.6;">— Este código es válido durante <strong style="color:#fff;">10 minutos</strong> desde su emisión. Pasado ese tiempo quedará invalidado automáticamente.</p>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;line-height:1.6;">— No compartas este código con nadie. IDENTIFLY <strong style="color:#fff;">nunca te lo pedirá</strong> por teléfono, chat ni correo.</p>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;line-height:1.6;">— Úsalo únicamente en la pantalla de verificación de la app. No lo introduzcas en ningún otro sitio.</p>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;line-height:1.6;">— Si no has solicitado este código, ignora este correo. Tu cuenta permanece segura.</p>
  </div>
  <p style="color:rgba(255,255,255,0.2);font-size:10px;text-align:center;line-height:1.6;">Este correo es generado automáticamente · No respondas a este mensaje<br>Tus datos se almacenan exclusivamente en tu dispositivo · RGPD Art. 5</p>
</div>`;
    } else {
      finalSubject = subject || `IDENTIFLY — Código`;
      html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;font-family:Arial,sans-serif;">
  <tr><td align="center">
    <table width="500" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #f0a500;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#1a0f00;padding:30px;text-align:center;border-bottom:2px solid #f0a500;">
        <div style="font-size:22px;font-weight:900;letter-spacing:10px;color:#f0a500;text-transform:uppercase;">IDENTIFLY</div>
        <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.3);margin-top:6px;">IDENTIDAD DIGITAL SEGURA</div>
        <div style="font-size:11px;color:#888;letter-spacing:2px;margin-top:4px;">${app_name || ''}</div>
      </td></tr>
      <tr><td style="background:#1a0f00;padding:16px 30px;text-align:center;border-bottom:1px solid #333;">
        <div style="background:#f0a500;color:#000;font-size:12px;font-weight:900;letter-spacing:2px;padding:8px 16px;border-radius:6px;display:inline-block;">${alert || ''}</div>
      </td></tr>
      <tr><td style="padding:40px 30px;text-align:center;">
        <p style="color:#ccc;font-size:15px;margin:0 0 8px;">Hola, <strong style="color:#fff;">${safeName}</strong></p>
        <p style="color:#999;font-size:13px;margin:0 0 30px;">${intro || ''}</p>
        <div style="background:#1a0f00;border:2px solid #f0a500;border-radius:12px;padding:24px;display:inline-block;margin:0 auto;">
          <div style="font-size:42px;font-weight:900;color:#f0a500;letter-spacing:12px;">${code}</div>
        </div>
        <p style="color:#f0a500;font-size:13px;margin:24px 0 8px;font-weight:bold;">${message_title || ''}</p>
        <p style="color:#999;font-size:12px;margin:0 0 16px;">${message || ''}</p>
        <div style="background:#0f0f0f;border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:18px 20px;margin:16px 0;text-align:left;">
          <div style="font-size:10px;font-weight:700;letter-spacing:3px;color:#f0a500;margin-bottom:12px;text-transform:uppercase;">Normas de seguridad</div>
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;line-height:1.6;">— Este código de respaldo es permanente. Guárdalo en un lugar seguro y no lo pierdas. Sin él no podrás recuperar tu cuenta.</p>
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;line-height:1.6;">— Los códigos temporales de verificación caducan en <strong style="color:#fff;">10 minutos</strong> desde su emisión.</p>
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 8px;line-height:1.6;">— No compartas ningún código con nadie. IDENTIFLY <strong style="color:#fff;">nunca te lo pedirá</strong> por teléfono, chat ni correo.</p>
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;line-height:1.6;">— Si no has solicitado este código, ignora este correo. Tu cuenta permanece segura.</p>
        </div>
      </td></tr>
      <tr><td style="background:#0a0a0a;padding:20px;text-align:center;border-top:1px solid #222;">
        <p style="color:#444;font-size:11px;margin:0;">IDENTIFLY · Identidad digital segura</p>
        <p style="color:#333;font-size:10px;margin:4px 0 0;">Este correo es generado automáticamente · No respondas a este mensaje · RGPD Art. 5</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'IDENTIFLY <noreply@identifly.app>',
        to: [to_email],
        subject: finalSubject,
        html
      })
    });

    const result = await resendRes.json();

    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: result.message || 'Error de Resend' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
