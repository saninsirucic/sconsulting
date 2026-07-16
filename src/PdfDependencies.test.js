import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

test('postojeći jsPDF i autoTable API ostaje kompatibilan', () => {
  const document = new jsPDF();
  autoTable(document, {
    head: [['Kolona']],
    body: [['Vrijednost']]
  });
  const output = document.output('arraybuffer');
  expect(output.byteLength).toBeGreaterThan(100);
});
