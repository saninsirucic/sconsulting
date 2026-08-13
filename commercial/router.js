const express = require('express');
const { allowRoles } = require('../aiEmail/auth');
const {
  accountWithBrand,
  addManualActivity,
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
  updateAccount,
  updateDailyAssignment
} = require('./service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createCommercialRouter({ db }) {
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
  router.put('/daily-assignments/:id', asyncRoute(editAssignment));
  router.patch('/daily-assignments/:id', asyncRoute(editAssignment));

  // Compatibility aliases for clients built against the initial CRM API draft.
  router.get('/accounts', asyncRoute(listRecords));
  router.post('/accounts', asyncRoute(createRecord));
  router.put('/accounts/:id', asyncRoute(editRecord));
  router.patch('/accounts/:id', asyncRoute(editRecord));
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
