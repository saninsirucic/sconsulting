import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import RobotoRegular from '../fonts/roboto-regular.base64';
import { displayStatus, recordValue } from './schema';

function reportDate(value, includeTime = false) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return String(value);
  return `${match[3]}.${match[2]}.${match[1]}.${includeTime && match[4] ? ` ${match[4]}:${match[5]}` : ''}`;
}

export function letterReportPeriod(sentFrom, sentTo) {
  if (sentFrom && sentTo) return `${reportDate(sentFrom)} - ${reportDate(sentTo)}`;
  if (sentFrom) return `Od ${reportDate(sentFrom)}`;
  if (sentTo) return `Do ${reportDate(sentTo)}`;
  return 'Cijela evidencija';
}

export function letterReportFilename(brandCode, sentFrom, sentTo) {
  const safeBrand = String(brandCode || 'program').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `izvjestaj-poslanih-dopisa-${safeBrand}-${sentFrom || 'pocetak'}-${sentTo || 'danas'}.pdf`;
}

export function createLetterReportPdf({ brandName, records, sentFrom, sentTo, generatedAt = new Date() }) {
  const rows = Array.isArray(records) ? records : [];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const totalPagesToken = '{total_pages_count_string}';

  doc.addFileToVFS('Roboto-Regular.ttf', RobotoRegular);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.setFont('Roboto', 'normal');

  doc.setFillColor(246, 139, 31);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.text('Izvještaj poslanih dopisa', 14, 11);
  doc.setFontSize(10);
  doc.text(String(brandName || 'Komercijalni program'), 14, 18);

  doc.setTextColor(24, 39, 63);
  doc.setFontSize(10);
  doc.text(`Period: ${letterReportPeriod(sentFrom, sentTo)}`, 14, 33);
  doc.text(`Ukupno dopisa: ${rows.length}`, 14, 39);
  doc.setFontSize(8.5);
  doc.setTextColor(90, 101, 117);
  doc.text(`Izvještaj kreiran: ${generatedAt.toLocaleString('bs-BA')}`, pageWidth - 14, 33, { align: 'right' });

  autoTable(doc, {
    startY: 46,
    margin: { top: 18, right: 14, bottom: 15, left: 14 },
    head: [['R.br.', 'Komitent', 'E-mail', 'CRM status', 'Dopis poslan']],
    body: rows.map((record, index) => [
      index + 1,
      recordValue(record, 'company_name', 'companyName', 'name', 'komitent') || '—',
      recordValue(record, 'email', 'raw_mail', 'rawMail', 'mail') || '—',
      displayStatus(recordValue(record, 'status', 'crm_status') || 'NEW'),
      reportDate(recordValue(record, 'letter_sent_at', 'letterSentAt'), true) || 'Datum nije evidentiran',
    ]),
    styles: {
      font: 'Roboto',
      fontSize: 8.4,
      cellPadding: 2.4,
      valign: 'middle',
      lineColor: [218, 223, 230],
      lineWidth: 0.15,
      textColor: [24, 39, 63],
      overflow: 'linebreak',
    },
    headStyles: {
      font: 'Roboto',
      fillColor: [32, 116, 176],
      textColor: [255, 255, 255],
      fontStyle: 'normal',
      minCellHeight: 9,
    },
    alternateRowStyles: { fillColor: [246, 249, 252] },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 82 },
      2: { cellWidth: 76 },
      3: { cellWidth: 52 },
      4: { cellWidth: 45 },
    },
    didDrawPage: (data) => {
      doc.setFont('Roboto', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 110, 124);
      doc.text('S Consulting - Komercijalni CRM', 14, pageHeight - 7);
      doc.text(`Stranica ${data.pageNumber} od ${totalPagesToken}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
    },
  });

  if (typeof doc.putTotalPages === 'function') doc.putTotalPages(totalPagesToken);
  return doc;
}

export function downloadLetterReportPdf(options) {
  const doc = createLetterReportPdf(options);
  doc.save(letterReportFilename(options.brandCode, options.sentFrom, options.sentTo));
}
