import {
  createCombinedLetterReportPdf,
  createLetterReportPdf,
  letterReportFilename,
  letterReportPeriod,
} from './letterReportPdf';

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

test('kreira zajednički PDF sa pregledom i odvojenim dijelom za svih 8 programa', () => {
  const sentRecord = {
    company_name: 'Čistoća Živinice d.o.o.',
    email: 'info@cistoca.ba',
    status: 'EMAIL_SENT',
    letter_sent_at: '2026-08-20T15:30:00',
  };
  const doc = createCombinedLetterReportPdf({
    sentFrom: '2026-07-01',
    sentTo: '2026-08-31',
    generatedAt: new Date('2026-08-23T10:00:00Z'),
    programs: [
      { brandCode: 'VISIOCAST', brandName: 'Visiocast', records: [sentRecord] },
      { brandCode: 'SAN_PEST', brandName: 'SAN Pest', records: [{ ...sentRecord, company_name: 'SAN Pest komitent' }] },
      { brandCode: 'FS_APP', brandName: 'FS App', records: [] },
      { brandCode: 'HACCP_PUBLIC', brandName: 'HACCP javni sektor', records: [{ ...sentRecord, company_name: 'Javna ustanova' }] },
      { brandCode: 'SAN_PEST_POLAND', brandName: 'SAN Pest Poljska', records: [{ ...sentRecord, company_name: 'Poljski DDD' }] },
      { brandCode: 'SAN_PEST_CZECH', brandName: 'SAN Pest Češka', records: [{ ...sentRecord, company_name: 'Češki DDD' }] },
      { brandCode: 'SAN_PEST_SAUDI', brandName: 'SAN Pest Saudijska Arabija', records: [{ ...sentRecord, company_name: 'Saudi DDD' }] },
      { brandCode: 'SAN_PEST_UAE', brandName: 'SAN Pest UAE', records: [{ ...sentRecord, company_name: 'UAE DDD' }] },
    ],
  });

  expect(doc.getNumberOfPages()).toBe(9);
  expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(10000);
  expect(letterReportFilename('sva-8-programa', '2026-07-01', '2026-08-31')).toBe('izvjestaj-poslanih-dopisa-sva-8-programa-2026-07-01-2026-08-31.pdf');
});
