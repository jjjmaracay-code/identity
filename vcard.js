// ============================================================
//  IDENTIFLY — Construcción de vCard a partir del perfil local
// ============================================================
// Compartido entre index.html (QR de la tarjeta, compartir por enlace)
// y paywall.html (botón "Exportar mi tarjeta (vCard)", visible cuando
// la prueba terminó sin plan -- ver punto 2 del lote). d es el objeto
// profileData/identity_data tal cual vive en localStorage.
function buildVCardFromProfile(d) {
  d = d || {};
  const t = d.toggles || {};

  let vc = 'BEGIN:VCARD\nVERSION:3.0\n';
  if (d.name) {
    const parts = d.name.trim().split(' ');
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    vc += `N:${lastName};${firstName};;;\n`;
    vc += `FN:${d.name}\n`;
  }
  if (d.job && t.job !== false)   vc += `TITLE:${d.job}\n`;
  if (d.phoneNumber && t.phone !== false) {
    const fullPhone = (d.phoneCountryCode ? d.phoneCountryCode + ' ' : '') + d.phoneNumber;
    vc += `TEL:${fullPhone}\n`;
  }
  if (d.mobileNumber && t.mobile !== false) {
    const fullMobile = (d.mobileCountryCode ? d.mobileCountryCode + ' ' : '') + d.mobileNumber;
    vc += `TEL;type=CELL:${fullMobile}\n`;
  }
  if (d.landlineNumber && t.landline) {
    const fullLandline = (d.landlineCountryCode ? d.landlineCountryCode + ' ' : '') + d.landlineNumber;
    vc += `TEL;type=HOME:${fullLandline}\n`;
  }
  if (d.email  && t.email  !== false) vc += `EMAIL:${d.email}\n`;
  if (d.email2    && t.email2)            vc += `EMAIL;type=HOME:${d.email2}\n`;
  if (d.emailWork && t.emailWork)         vc += `EMAIL;type=WORK:${d.emailWork}\n`;
  if (d.company   && t.company !== false) vc += `ORG:${d.company}\n`;
  if (d.address && t.address)         vc += `ADR:;;${d.address};;;;\n`;
  if (d.linkedin && t.linkedin !== false) vc += `URL;type=LinkedIn:${d.linkedin}\n`;
  if (d.github   && t.github   !== false) vc += `URL;type=GitHub:${d.github}\n`;
  if (d.web      && t.web      !== false) vc += `URL;type=Web:${d.web}\n`;
  if (d.twitter   && t.twitter   !== false) vc += `URL;type=Twitter:${d.twitter}\n`;
  if (d.instagram && t.instagram !== false) vc += `URL;type=Instagram:${d.instagram}\n`;
  if (d.youtube   && t.youtube   !== false) vc += `URL;type=YouTube:${d.youtube}\n`;
  if (d.tiktok    && t.tiktok    !== false) vc += `URL;type=TikTok:${d.tiktok}\n`;
  vc += 'END:VCARD';
  return vc;
}

// Descarga el .vcf en el dispositivo -- mismo patrón estándar de Blob +
// <a download> que usa el resto de descargas de la app (p.ej. exportar
// el QR como imagen).
function downloadVCardFile(vcardText, filename) {
  const blob = new Blob([vcardText], { type: 'text/vcard' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'contacto.vcf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
