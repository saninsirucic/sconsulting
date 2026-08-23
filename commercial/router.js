const express = require('express');
const { allowRoles } = require('../aiEmail/auth');
const {
  getAutomationState,
  importApprovedDailyAssignments,
  pauseAutomation,
  prepareAutomationQueue,
  reviewAutomationCandidates,
  scheduleSelectedMails,
  sendImmediateAccountMail,
  sendNextAutomatedMail,
  sendSelectedMails,
  updateCandidateRecipients,
  updateAutomationSettings
} = require('./automation');
const {
  accountWithBrand,
  addManualActivity,
  approveDailyAssignments,
  archiveAccount,
  createAccount,
  dashboard,
  ensureDailyAssignments,
  httpError,
  listAccessibleBrands,
  listAccounts,
  listActivities,
  readDailyAssignments,
  resolveBrand,
  setAdminCallRequested,
  transferAccount,
  updateAccount,
  updateDailyAssignment
} = require('./service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createCommercialRouter({ db, outlookService }) {
  const router = express.Router();
  router.use(allowRoles('direktor', 'komercijala'));

  const getBrand = (req, write = false) => resolveBrand(
    db,
    req.user,
    req.params.code || req.query.brand,
    { write }
  );

  const getAccount = async (req, write = false) => {
    const account = await accountWithBrand(db, req.params.id);
    if (!account) throw httpError(404, 'Komitent nije pronađen.', 'ACCOUNT_NOT_FOUND');
    await resolveBrand(db, req.user, account.brand_code, { write });
    return account;
  };

  const requireDirector = (req) => {
    if (req.user.role !== 'direktor') {
      throw httpError(403, 'Samo direktor može mijenjati automatsko slanje.', 'DIRECTOR_REQUIRED');
    }
  };

  const listRecords = async (req, res) => {
    const brand = await getBrand(req);
    res.json(await listAccounts(db, brand, req.query));
  };

  const createRecord = async (req, res) => {
    const brand = await getBrand(req, true);
    res.status(201).json(await createAccount(db, brand, req.user, req.body || {}));
  };

  const editRecord = async (req, res) => {
    const account = await getAccount(req, true);
    res.json(await updateAccount(db, account, req.user, req.body || {}));
  };

  const removeRecord = async (req, res) => {
    const account = await getAccount(req, true);
    res.json(await archiveAccount(db, account, req.user));
  };

  const transferRecord = async (req, res) => {
    const account = await getAccount(req, true);
    const body = req.body || {};
    const targetCode = body.target_brand_code || body.targetBrandCode || body.target_brand;
    if (!targetCode) throw httpError(400, 'Ciljna baza je obavezna.', 'TARGET_BRAND_REQUIRED');
    const targetBrand = await resolveBrand(db, req.user, targetCode, { write: true });
    res.json(await transferAccount(db, account, targetBrand, req.user));
  };

  const readDailyList = async (req, res) => {
    const brand = await getBrand(req);
    res.json(await readDailyAssignments(db, req.user, brand));
  };

  const prepareDailyList = async (req, res) => {
    const brand = await getBrand(req, true);
    res.json(await ensureDailyAssignments(db, req.user, brand));
  };

  const editAssignment = async (req, res) => {
    const assignment = await db('crm_daily_assignments').where({ id: req.params.id }).first();
    if (!assignment) throw httpError(404, 'Dnevni zadatak nije pronađen.', 'ASSIGNMENT_NOT_FOUND');
    if (req.user.role !== 'direktor' && assignment.user_id !== req.user.id) {
      throw httpError(403, 'Ne možete mijenjati dnevni zadatak drugog korisnika.');
    }
    const account = await accountWithBrand(db, assignment.account_id);
    if (!account) throw httpError(404, 'Komitent dnevnog zadatka više ne postoji.');
    await resolveBrand(db, req.user, account.brand_code, { write: true });
    const updated = await updateDailyAssignment(db, assignment, account, req.user, req.body || {});
    res.json({ ...updated, assignment_id: updated.id });
  };

  router.get('/brands', asyncRoute(async (req, res) => {
    const items = await listAccessibleBrands(db, req.user);
    res.json({ items, brands: items });
  }));

  router.get('/brands/:code/dashboard', asyncRoute(async (req, res) => {
    const brand = await getBrand(req);
    res.json(await dashboard(db, brand, req.user));
  }));

  router.get('/brands/:code/records', asyncRoute(listRecords));
  router.post('/brands/:code/records', asyncRoute(createRecord));
  router.put('/records/:id', asyncRoute(editRecord));
  router.patch('/records/:id', asyncRoute(editRecord));
  router.patch('/records/:id/admin-call-request', asyncRoute(async (req, res) => {
    const account = await getAccount(req, true);
    res.json(await setAdminCallRequested(db, account, req.user, req.body && req.body.requested));
  }));
  router.post('/records/:id/transfer', asyncRoute(transferRecord));
  router.post('/records/:id/send-letter', asyncRoute(async (req, res) => {
    if (!req.body || req.body.confirm !== true) {
      throw httpError(400, 'Potvrdite stvarno slanje sa confirm: true.', 'SEND_CONFIRMATION_REQUIRED');
    }
    const account = await getAccount(req, true);
    const brand = await resolveBrand(db, req.user, account.brand_code, { write: true });
    res.json(await sendImmediateAccountMail(db, brand, account.id, {
      actor: req.user,
      confirmed: true,
      outlookService
    }));
  }));
  router.delete('/records/:id', asyncRoute(removeRecord));

  router.get('/records/:id/activities', asyncRoute(async (req, res) => {
    const account = await getAccount(req);
    res.json({ items: await listActivities(db, account.id) });
  }));
  router.post('/records/:id/activities', asyncRoute(async (req, res) => {
    const account = await getAccount(req, true);
    res.status(201).json(await addManualActivity(db, account, req.user, req.body || {}));
  }));

  router.get('/brands/:code/daily-list', asyncRoute(readDailyList));
  router.post('/brands/:code/daily-list', asyncRoute(prepareDailyList));
  router.patch('/brands/:code/daily-assignments/approval', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    const body = req.body || {};
    res.json(await approveDailyAssignments(
      db,
      req.user,
      brand,
      body.assignment_ids || body.assignmentIds,
      body.decision
    ));
  }));
  router.put('/daily-assignments/:id', asyncRoute(editAssignment));
  router.patch('/daily-assignments/:id', asyncRoute(editAssignment));

  router.get('/brands/:code/mail-automation', asyncRoute(async (req, res) => {
    const brand = await getBrand(req);
    res.json(await getAutomationState(db, brand));
  }));
  router.put('/brands/:code/mail-automation', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    res.json(await updateAutomationSettings(db, brand, req.user, req.body || {}));
  }));
  router.post('/brands/:code/mail-automation/prepare', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    res.json(await prepareAutomationQueue(db, brand, req.user));
  }));
  router.patch('/brands/:code/mail-automation/candidates', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    const body = req.body || {};
    res.json(await reviewAutomationCandidates(
      db,
      brand,
      body.account_ids || body.accountIds || body.candidate_ids || body.ids,
      body.decision
    ));
  }));
  router.patch('/brands/:code/mail-automation/candidates/:accountId/recipients', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    res.json(await updateCandidateRecipients(
      db,
      brand,
      req.params.accountId,
      req.user,
      req.body || {}
    ));
  }));
  router.post('/brands/:code/mail-automation/import-daily-approved', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    const body = req.body || {};
    res.json(await importApprovedDailyAssignments(
      db,
      brand,
      req.user,
      body.assignment_ids || body.assignmentIds,
      {
        confirmed: body.confirm === true,
        includeLegacyCompleted: body.include_legacy_completed === true
      }
    ));
  }));
  router.post('/brands/:code/mail-automation/send-selected', asyncRoute(async (req, res) => {
    if (!req.body || req.body.confirm !== true) {
      throw httpError(400, 'Potvrdite stvarno slanje sa confirm: true.', 'SEND_CONFIRMATION_REQUIRED');
    }
    const brand = await getBrand(req, true);
    res.json(await sendSelectedMails(
      db,
      brand,
      req.body && (req.body.account_ids || req.body.accountIds || req.body.ids),
      {
        actor: req.user,
        confirmed: req.body.confirm === true,
        outlookService
      }
    ));
  }));
  router.post('/brands/:code/mail-automation/schedule-selected', asyncRoute(async (req, res) => {
    if (!req.body || req.body.confirm !== true) {
      throw httpError(400, 'Potvrdite zakazivanje sa confirm: true.', 'SCHEDULE_CONFIRMATION_REQUIRED');
    }
    const brand = await getBrand(req, true);
    res.json(await scheduleSelectedMails(
      db,
      brand,
      req.body.account_ids || req.body.accountIds || req.body.ids,
      {
        actor: req.user,
        confirmed: true
      }
    ));
  }));
  router.post('/brands/:code/mail-automation/pause', asyncRoute(async (req, res) => {
    const brand = await getBrand(req, true);
    res.json(await pauseAutomation(db, brand, req.user));
  }));
  router.post('/brands/:code/mail-automation/send-next', asyncRoute(async (req, res) => {
    requireDirector(req);
    if (!req.body || req.body.confirm !== true) {
      throw httpError(400, 'Potvrdite stvarno slanje sa confirm: true.', 'SEND_CONFIRMATION_REQUIRED');
    }
    const brand = await getBrand(req, true);
    res.json(await sendNextAutomatedMail(db, brand, {
      actor: req.user,
      ignoreInterval: true
    }));
  }));

  // Compatibility aliases for clients built against the initial CRM API draft.
  router.get('/accounts', asyncRoute(listRecords));
  router.post('/accounts', asyncRoute(createRecord));
  router.put('/accounts/:id', asyncRoute(editRecord));
  router.patch('/accounts/:id', asyncRoute(editRecord));
  router.post('/accounts/:id/transfer', asyncRoute(transferRecord));
  router.delete('/accounts/:id', asyncRoute(removeRecord));
  router.get('/dashboard', asyncRoute(async (req, res) => {
    const brand = await getBrand(req);
    res.json(await dashboard(db, brand, req.user));
  }));
  router.get('/daily', asyncRoute(readDailyList));
  router.post('/daily', asyncRoute(prepareDailyList));
  router.put('/daily/:id', asyncRoute(editAssignment));
  router.patch('/daily/:id', asyncRoute(editAssignment));

  return router;
}

module.exports = { createCommercialRouter };
