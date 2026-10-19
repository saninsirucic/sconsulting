export const EMAIL_SIGNATURE_LOGO_URL = 'https://www.s-consulting.ba/logo-wordmark.png';

export const DEFAULT_EMAIL_SIGNATURE = Object.freeze({
  greeting: 'Lijep pozdrav,',
  name: 'Ermina Siručić',
  title: 'Direktor | S-Consulting Group',
  mobile: '+387 62 528 870 | +387 62 366 515',
  phone: '+387 33 848 871',
  email: 'info@s-consulting.ba',
  website: 'www.s-consulting.ba',
  address: 'Tvornička 3, Sarajevo',
});

export const GERMAN_EMAIL_SIGNATURE = Object.freeze({
  ...DEFAULT_EMAIL_SIGNATURE,
  greeting: 'Mit freundlichen Grüßen',
  title: 'Geschäftsführerin | S-Consulting Group',
  website: 'www.s-consulting.ba/de',
  address: 'Tvornička 3, Sarajevo, Bosnien und Herzegowina',
});

const SANIN_ENGLISH_EMAIL_SIGNATURE = Object.freeze({
  ...DEFAULT_EMAIL_SIGNATURE,
  greeting: 'Kind regards,',
  name: 'Sanin Siručić',
  title: 'CEO | S-Consulting Group',
  mobile: '+387 62 366 515 (Viber / WhatsApp)',
  address: 'Tvornička 3, Sarajevo, Bosnia and Herzegovina',
});

export function emailSignatureForBrand(brandCode) {
  const code = String(brandCode || '').trim().toUpperCase();
  if (code === 'SAN_PEST_SINGAPORE_MALAYSIA') return SANIN_ENGLISH_EMAIL_SIGNATURE;
  return ['SAN_PEST_GERMANY', 'SAN_PEST_AUSTRIA'].includes(code)
    ? GERMAN_EMAIL_SIGNATURE
    : DEFAULT_EMAIL_SIGNATURE;
}
