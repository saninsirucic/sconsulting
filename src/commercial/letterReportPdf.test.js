import { createLetterReportPdf, letterReportFilename, letterReportPeriod } from './letterReportPdf';

test('kreira čitljiv PDF izvještaj sa programom, periodom i tabelom', () => {
  const doc = createLetterReportPdf({
    brandName: 'SAN Pest',
    sentFrom: '2026-07-01',
    sentTo: '2026-08-31',
    generatedAt: new Date('2026-08-23T10:00:00Z'),
    records: [{
      company_name: 'Čistoća Živinice d.o.o.',
      email: 'info@cistoca.ba',
      status: 'EMAIL_SENT',
      letter_sent_at: '2026-08-20T15:30:00',
    }],
  });

  expect(letterReportPeriod('2026-07-01', '2026-08-31')).toBe('01.07.2026. - 31.08.2026.');
  expect(letterReportFilename('SAN_PEST', '2026-07-01', '2026-08-31')).toBe('izvjestaj-poslanih-dopisa-san-pest-2026-07-01-2026-08-31.pdf');
  expect(doc.getNumberOfPages()).toBe(1);
  expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(10000);
});
