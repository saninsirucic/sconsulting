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

export function emailSignatureForBrand(brandCode) {
  return String(brandCode || '').trim().toUpperCase() === 'SAN_PEST_GERMANY'
    ? GERMAN_EMAIL_SIGNATURE
    : DEFAULT_EMAIL_SIGNATURE;
}
