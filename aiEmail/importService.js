const { v4: uuidv4 } = require('uuid');
const { buildContactFromRow } = require('./contactUtils');
const { getImportData } = require('./excelService');

const DUPLICATE_STRATEGIES = new Set(['skip', 'update', 'create']);

function parseMapping(value) {
  let mapping = value;
  if (typeof value === 'string') {
    try {
      mapping = JSON.parse(value);
    } catch (error) {
      throw Object.assign(new Error('Mapiranje kolona nije ispravan JSON.'), { status: 400 });
    }
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw Object.assign(new Error('Mapiranje kolona nije ispravno.'), { status: 400 });
  }
  if (!Number.isInteger(Number(mapping.company_name)) || !Number.isInteger(Number(mapping.email))) {
    throw Object.assign(new Error('Naziv firme i e-mail moraju biti mapirani.'), { status: 400 });
  }
  return mapping;
}

function nonEmptyUpdate(contact) {
  return Object.fromEntries(
    Object.entries(contact).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

async function writeImportError(trx, jobId, rowNumber, error, rawData) {
  await trx('email_import_errors').insert({
    id: uuidv4(),
    import_job_id: jobId,
    row_number: rowNumber,
    error_code: error.code,
    error_message: error.message,
    raw_data_json: JSON.stringify(rawData)
  });
}

async function saveMapping(trx, userId, name, sheetName, signature, mapping) {
  const now = new Date();
  const existing = await trx('email_import_mappings')
    .where({ created_by: userId, header_signature: signature })
    .first();
  if (existing) {
    await trx('email_import_mappings').where({ id: existing.id }).update({
      name,
      sheet_name: sheetName,
      mapping_json: JSON.stringify(mapping),
      updated_at: now
    });
    return existing.id;
  }
  const id = uuidv4();
  await trx('email_import_mappings').insert({
    id,
    created_by: userId,
    name,
    sheet_name: sheetName,
    header_signature: signature,
    mapping_json: JSON.stringify(mapping),
    is_default: false,
    created_at: now,
    updated_at: now
  });
  return id;
}

async function importContacts({ db, file, user, sheetName, headerRow, mapping: rawMapping, duplicateStrategy, mappingName }) {
  const mapping = parseMapping(rawMapping);
  const strategy = String(duplicateStrategy || 'skip').toLowerCase();
  if (!DUPLICATE_STRATEGIES.has(strategy)) {
    throw Object.assign(new Error('Strategija duplikata nije podržana.'), { status: 400 });
  }

  const importData = await getImportData(file, sheetName, headerRow);
  const jobId = uuidv4();
  const report = {
    jobId,
    total: importData.rows.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    duplicates: 0,
    errors: []
  };

  await db.transaction(async (trx) => {
    const now = new Date();
    await trx('email_import_jobs').insert({
      id: jobId,
      created_by: user.id,
      file_name: file.originalname,
      file_size: file.size,
      sheet_name: sheetName,
      header_row: Number(headerRow),
      mapping_json: JSON.stringify(mapping),
      duplicate_strategy: strategy,
      status: 'PROCESSING',
      total_rows: report.total,
      created_at: now,
      updated_at: now
    });

    const existingContacts = await trx('email_contacts')
      .select('id', 'email_normalized', 'company_name_normalized');
    const byEmail = new Map(existingContacts.filter((row) => row.email_normalized)
      .map((row) => [row.email_normalized, row]));
    const byCompany = new Map(existingContacts.filter((row) => row.company_name_normalized)
      .map((row) => [row.company_name_normalized, row]));
    const suppressedEmails = new Set((await trx('email_suppression_list').select('email_normalized'))
      .map((row) => row.email_normalized));

    for (const row of importData.rows) {
      const { contact, errors } = buildContactFromRow(row.values, mapping, `${file.originalname} / ${sheetName}`);
      if (errors.length) {
        report.invalid += 1;
        for (const error of errors) {
          await writeImportError(trx, jobId, row.rowNumber, error, row.values);
          if (report.errors.length < 50) report.errors.push({ rowNumber: row.rowNumber, ...error });
        }
        continue;
      }

      const emailDuplicate = byEmail.get(contact.email_normalized);
      const companyDuplicate = byCompany.get(contact.company_name_normalized);
      const duplicate = emailDuplicate || companyDuplicate;
      const companyOnlyDuplicate = !emailDuplicate && companyDuplicate;

      if (duplicate) {
        report.duplicates += 1;
        if (strategy === 'update') {
          const updateData = {
            ...nonEmptyUpdate(contact),
            updated_at: now
          };
          if (suppressedEmails.has(contact.email_normalized)) {
            updateData.sending_allowed = false;
            updateData.suppression_reason = 'SUPPRESSION_LIST';
          }
          await trx('email_contacts').where({ id: duplicate.id }).update({
            ...updateData
          });
          report.updated += 1;
          byEmail.set(contact.email_normalized, { id: duplicate.id, ...contact });
          byCompany.set(contact.company_name_normalized, { id: duplicate.id, ...contact });
          continue;
        }

        if (!(strategy === 'create' && companyOnlyDuplicate)) {
          report.skipped += 1;
          const error = {
            code: 'DUPLICATE',
            message: emailDuplicate
              ? 'Kontakt sa ovom e-mail adresom već postoji.'
              : 'Kontakt sa ovim nazivom firme već postoji.'
          };
          await writeImportError(trx, jobId, row.rowNumber, error, row.values);
          continue;
        }
      }

      const id = uuidv4();
      const inserted = {
        id,
        ...contact,
        sending_allowed: !suppressedEmails.has(contact.email_normalized),
        suppression_reason: suppressedEmails.has(contact.email_normalized) ? 'SUPPRESSION_LIST' : null,
        created_at: now,
        updated_at: now
      };
      await trx('email_contacts').insert(inserted);
      report.imported += 1;
      byEmail.set(contact.email_normalized, inserted);
      byCompany.set(contact.company_name_normalized, inserted);
    }

    await saveMapping(
      trx,
      user.id,
      String(mappingName || `${sheetName} mapiranje`).trim().slice(0, 120),
      sheetName,
      importData.headerSignature,
      mapping
    );

    await trx('email_import_jobs').where({ id: jobId }).update({
      status: 'COMPLETED',
      imported_count: report.imported,
      updated_count: report.updated,
      skipped_count: report.skipped,
      invalid_count: report.invalid,
      duplicate_count: report.duplicates,
      completed_at: now,
      updated_at: now
    });

    await trx('email_activity_logs').insert({
      id: uuidv4(),
      actor_id: user.id,
      action: 'CONTACT_IMPORT_COMPLETED',
      entity_type: 'email_import_job',
      entity_id: jobId,
      metadata_json: JSON.stringify({
        sheetName,
        total: report.total,
        imported: report.imported,
        updated: report.updated,
        skipped: report.skipped,
        invalid: report.invalid,
        duplicates: report.duplicates
      }),
      created_at: now
    });
  });

  return report;
}

module.exports = {
  DUPLICATE_STRATEGIES,
  importContacts,
  parseMapping
};
