// Bilingual interface chrome (English / Hindi), as expected on public-sector portals.
const DICT = {
  hi: {
    skip: 'मुख्य सामग्री पर जाएं', skipShort: 'मुख्य सामग्री पर जाएं', screenReader: 'स्क्रीन रीडर एक्सेस',
    org: 'एसएम इंजीनियर्स', digital: 'डिजिटल पहल',
    title: 'मशीन टेलीमेट्री एवं पूर्वानुमानित रखरखाव पोर्टल', titleAlt: 'Machine Telemetry & Predictive Maintenance Portal',
    subtitle: 'एसएम इंजीनियर्स · परिशुद्ध विनिर्माण · डिजिटल पहल',
    menu: 'मेनू', home: 'मुखपृष्ठ', about: 'हमारे बारे में', project: 'परियोजना ▾', overview: 'अवलोकन',
    architecture: 'सिस्टम संरचना', technology: 'प्रौद्योगिकी', access: 'भूमिकाएँ एवं अभिगम नियंत्रण', apiDocs: 'एपीआई दस्तावेज़ ↗',
    sitemap: 'साइटमैप', help: 'सहायता', feedback: 'प्रतिक्रिया', whatsNew: 'नया क्या है',
    policies: 'वेबसाइट नीतियाँ', privacy: 'गोपनीयता नीति', terms: 'नियम एवं शर्तें', contact: 'संपर्क / प्रतिक्रिया',
    aboutPortal: 'इस पोर्टल के बारे में', quickLinks: 'त्वरित लिंक', contactUs: 'संपर्क',
    login: 'स्टाफ लॉगिन', portal: 'मेरा डैशबोर्ड', logout: 'लॉग आउट',
    heroKicker: 'उद्योग 4.0 · शॉप-फ्लोर डिजिटलीकरण', heroTitle: 'मशीन खराब होने से पहले चेतावनी',
    heroText: 'सीएनसी और वीएमसी मशीनों के तापमान, कंपन और लोड की लाइव निगरानी, स्मार्ट अलर्ट, हेल्थ स्कोर और रखरखाव टिकट — एक ही पोर्टल पर।',
    learnMore: 'परियोजना जानें', liveFigures: 'लाइव आँकड़े',
    stMachines: 'मशीनें', stRunning: 'चालू', stReadings: 'रीडिंग (24 घं.)', stAlerts: 'अलर्ट (24 घं.)',
    services: 'सेवाएँ एवं त्वरित लिंक', notices: 'सूचना पट्ट', keyFeatures: 'मुख्य विशेषताएँ',
  },
};

let lang = 'en';
const originals = new WeakMap();

export function getLang() { return lang; }

export function t(key, fallback) {
  return (lang !== 'en' && DICT[lang]?.[key]) || fallback;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    if (!originals.has(el)) originals.set(el, el.innerHTML);
    const key = el.dataset.i18n;
    const tr = lang !== 'en' ? DICT[lang]?.[key] : null;
    if (tr) el.textContent = tr; else el.innerHTML = originals.get(el);
  });
  document.documentElement.lang = lang;
}

export function setLang(l) {
  lang = DICT[l] || l === 'en' ? l : 'en';
  try { localStorage.setItem('sm_lang', lang); } catch { /* storage unavailable */ }
  applyI18n();
}

export function initLang() {
  try { lang = localStorage.getItem('sm_lang') || 'en'; } catch { lang = 'en'; }
  if (lang !== 'en' && !DICT[lang]) lang = 'en';
  return lang;
}
