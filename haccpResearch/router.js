const express = require('express');
const { allowRoles } = require('../aiEmail/auth');
const { resolveBrand } = require('../commercial/service');
const { claimRun, executeRun, getState, listLeads, updateLead, updateSettings } = require('./service');

function createHaccpResearchRouter({ db, provider, config }) {
  const router = express.Router();
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.use(allowRoles('direktor', 'komercijala'));
  router.use((req, res, next) => {
    resolveBrand(db, req.user, 'FS_APP', { write: req.method !== 'GET' }).then(() => next(), next);
  });
  router.get('/state', route(async (req, res) => res.json(await getState(db, config))));
  router.get('/leads', route(async (req, res) => res.json(await listLeads(db, req.query))));
  router.patch('/leads/:id', route(async (req, res) => res.json(await updateLead(db, req.params.id, req.body || {}))));
  router.put('/settings', allowRoles('direktor'), route(async (req, res) => res.json(await updateSettings(db, req.body || {}, req.user, config))));
  router.post('/runs', allowRoles('direktor'), route(async (req, res) => {
    const run = await claimRun(db, { manual: true, actor: req.user, config });
    // Reply before web research: Heroku HTTP requests must not wait for the AI request.
    res.status(202).json({ id: run.id, status: 'RUNNING' });
    void executeRun(db, run, { provider }).catch(() => console.error('HACCP istraživanje: rezultat nije upisan; oporavak slijedi po isteku zaključavanja.'));
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    return res.status(status).json({ error: status < 500 || error.code === 'MIGRATION_REQUIRED'
      ? error.message : 'Istraživanje trenutno nije dostupno. Provjerite server i migracije.' });
  });
  return router;
}

module.exports = { createHaccpResearchRouter };
