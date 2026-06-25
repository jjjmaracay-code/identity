export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { template, to_email, to_name, code, app_name, subject, alert, intro, message_title, message } = body;

    if (!to_email || !code) {
      return new Response(JSON.stringify({ error: 'Faltan to_email o code' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Defensa en profundidad: bloquear re-registro de emails ya registrados.
    // Solo aplica a 'verification' (flujo de registro nuevo).
    // 'backup' y templates de recovery se usan cuando el email YA está registrado — no bloquear.
    if (template === 'verification') {
      const existing = await env.PLANS_KV.get('reg:' + to_email.toLowerCase());
      if (existing) {
        return new Response(JSON.stringify({ error: 'already_registered' }), {
          status: 409, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    let html, finalSubject;

    if (template === 'verification') {
      finalSubject = `Tu código IDENTIFLY: ${code}`;
      html = `
<div style="background:#080808;padding:40px 24px;font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #AAFF00;border-radius:16px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="font-size:22px;font-weight:900;letter-spacing:10px;color:#AAFF00;text-transform:uppercase;text-shadow:0 0 10px #AAFF00,0 0 25px rgba(170,255,0,0.6);">IDENTIFLY</div>
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.3);margin-top:4px;">IDENTIDAD DIGITAL SEGURA</div>
  </div>
  <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:8px;">Hola <strong style="color:#fff;">${to_name}</strong>,</p>
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
        <p style="color:#ccc;font-size:15px;margin:0 0 8px;">Hola, <strong style="color:#fff;">${to_name}</strong></p>
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
