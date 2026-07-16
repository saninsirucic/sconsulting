const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const { FIELD_DEFINITIONS, normalizeComparable, suggestMapping } = require('./contactUtils');

const AUXILIARY_SHEET_PATTERN = /(sazetak|duplikat|provjeri|rucno)/i;

function assertExcelFile(file) {
  if (!file || !file.buffer) throw Object.assign(new Error('Excel fajl nije dostavljen.'), { status: 400 });
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (extension !== '.xlsx') {
    throw Object.assign(new Error('Dozvoljeni su samo sigurnije podržani .xlsx fajlovi.'), { status: 400 });
  }
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function detectHeaderRow(rows) {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 15).forEach((row, index) => {
    const filledCells = row.filter((value) => value !== null && String(value).trim() !== '').length;
    const textCells = row.filter((value) => typeof value === 'string' && value.trim() !== '').length;
    const score = filledCells * 2 + textCells;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function headersForRow(row) {
  return (row || []).map((value, index) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return { index, column: columnName(index), label: String(value).trim() };
  }).filter(Boolean);
}

function headerSignature(headers) {
  const canonical = headers.map((header) => `${header.index}:${normalizeComparable(header.label)}`).join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function worksheetRows(worksheet) {
  const rows = [];
  const columnCount = Math.max(worksheet.columnCount, 1);
  for (let rowNumber = 1; rowNumber <= Math.max(worksheet.rowCount, 1); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = [];
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      const isMergedFollower = cell.isMerged && cell.master && cell.master.address !== cell.address;
      const text = isMergedFollower ? '' : cell.text;
      values.push(text === undefined || text === null || text === '' ? null : String(text));
    }
    rows.push(values);
  }
  return rows;
}

function previewRows(rows, headerIndex, headers) {
  const preview = [];
  for (let index = headerIndex + 1; index < rows.length && preview.length < 20; index += 1) {
    const row = rows[index] || [];
    if (!row.some((value) => value !== null && String(value).trim() !== '')) continue;
    const values = {};
    headers.forEach((header) => { values[header.column] = row[header.index]; });
    preview.push({ rowNumber: index + 1, values });
  }
  return preview;
}

async function readWorkbook(buffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer, {
      ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst']
    });
    return workbook;
  } catch (error) {
    throw Object.assign(new Error('Excel fajl nije moguće pročitati.'), { status: 400 });
  }
}

async function analyzeExcel(file) {
  assertExcelFile(file);
  const workbook = await readWorkbook(file.buffer);
  const sheets = workbook.worksheets.map((worksheet) => {
    const rows = worksheetRows(worksheet);
    const headerIndex = detectHeaderRow(rows);
    const headers = headersForRow(rows[headerIndex]);
    return {
      name: worksheet.name,
      rowCount: Math.max(0, worksheet.rowCount - headerIndex - 1),
      columnCount: worksheet.columnCount,
      detectedHeaderRow: headerIndex + 1,
      auxiliary: AUXILIARY_SHEET_PATTERN.test(normalizeComparable(worksheet.name)),
      headers,
      suggestedMapping: suggestMapping(headers),
      headerSignature: headerSignature(headers),
      preview: previewRows(rows, headerIndex, headers)
    };
  });

  return { fileName: file.originalname, fileSize: file.size, fields: FIELD_DEFINITIONS, sheets };
}

async function getImportData(file, sheetName, headerRow) {
  assertExcelFile(file);
  const workbook = await readWorkbook(file.buffer);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw Object.assign(new Error('Odabrani sheet ne postoji.'), { status: 400 });
  const rows = worksheetRows(worksheet);
  const headerIndex = Number(headerRow) - 1;
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= rows.length) {
    throw Object.assign(new Error('Red zaglavlja nije ispravan.'), { status: 400 });
  }
  const headers = headersForRow(rows[headerIndex]);
  return {
    headers,
    headerSignature: headerSignature(headers),
    rows: rows.slice(headerIndex + 1).map((row, index) => ({
      rowNumber: headerIndex + index + 2,
      values: row || []
    })).filter(({ values }) => values.some((value) => value !== null && String(value).trim() !== ''))
  };
}

module.exports = {
  analyzeExcel,
  assertExcelFile,
  columnName,
  detectHeaderRow,
  getImportData,
  headerSignature,
  headersForRow
};
