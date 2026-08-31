const express = require('express');
const { allowRoles } = require('../aiEmail/auth');
const { OutlookError, createOutlookConfig } = require('./graphClient');
const { createOutlookService } = require('./service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireWriteEnabled(service) {
  return (req, res, next) => {
    if (!service.config.writeEnabled) {
      return res.status(503).json({
        error: 'Outlook izmjene su trenutno isključene na serveru.',
        code: 'OUTLOOK_WRITES_DISABLED'
      });
    }
    return next();
  };
}

function createOutlookRouter(options = {}) {
  const router = express.Router();
  const config = options.config || createOutlookConfig(options.env);
  const service = options.service || createOutlookService({ ...options, config });
  const jsonParser = express.json({ limit: options.jsonLimit || '8mb', strict: true });
  const writeGuard = requireWriteEnabled(service);

  router.use(allowRoles('direktor', 'komercijala'));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/status', (req, res) => res.json(service.status()));
  router.get('/account', asyncRoute(async (req, res) => res.json(await service.getAccount())));
  router.get('/folders', asyncRoute(async (req, res) => res.json(await service.listFolders())));
  router.get('/messages', asyncRoute(async (req, res) => res.json(await service.listMessages(req.query))));
  router.get('/messages/:id', asyncRoute(async (req, res) => res.json(await service.getMessage(req.params.id))));
  router.get('/messages/:id/attachments/:attachmentId', asyncRoute(async (req, res) => {
    const attachment = await service.downloadAttachment(req.params.id, req.params.attachmentId);
    const encodedFilename = encodeURIComponent(attachment.filename).replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.set({
      'Content-Type': attachment.contentType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodedFilename}`,
      'X-Content-Type-Options': 'nosniff'
    });
    return res.send(attachment.data);
  }));

  router.patch('/messages/:id', writeGuard, jsonParser, asyncRoute(async (req, res) => {
    res.json(await service.markRead(req.params.id, req.body && req.body.isRead));
  }));
  router.post('/messages/:id/move', writeGuard, jsonParser, asyncRoute(async (req, res) => {
    res.json(await service.moveMessage(req.params.id, req.body && req.body.destination));
  }));
  router.post('/messages/:id/archive', writeGuard, asyncRoute(async (req, res) => {
    res.json(await service.moveMessage(req.params.id, 'archive'));
  }));
  router.delete('/messages/:id', writeGuard, asyncRoute(async (req, res) => {
    res.json(await service.deleteMessage(req.params.id));
  }));
  router.post('/send', writeGuard, jsonParser, asyncRoute(async (req, res) => {
    res.status(202).json(await service.send(req.body));
  }));
  router.post('/messages/:id/reply', writeGuard, jsonParser, asyncRoute(async (req, res) => {
    res.status(202).json(await service.reply(req.params.id, req.body));
  }));
  router.post('/messages/:id/reply-all', writeGuard, jsonParser, asyncRoute(async (req, res) => {
    res.status(202).json(await service.replyAll(req.params.id, req.body));
  }));
  router.post('/messages/:id/forward', writeGuard, jsonParser, asyncRoute(async (req, res) => {
    res.status(202).json(await service.forward(req.params.id, req.body));
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = Number(error.status || 500);
    let code = error.code || 'OUTLOOK_INTERNAL_ERROR';
    let message = error.message || 'Outlook zahtjev nije uspio.';
    if (error.type === 'entity.too.large') {
      status = 413;
      code = 'OUTLOOK_PAYLOAD_TOO_LARGE';
      message = 'Outlook zahtjev je prevelik.';
    } else if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      status = 400;
      code = 'OUTLOOK_INVALID_JSON';
      message = 'JSON zahtjev nije važeći.';
    } else if (!(error instanceof OutlookError) && status >= 500) {
      message = 'Došlo je do interne Outlook greške.';
    }
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    if (status >= 500 && !(error instanceof OutlookError)) console.error('Outlook API greška:', error.message);
    return res.status(status).json({ error: message, code });
  });

  return router;
}

module.exports = { createOutlookRouter, requireWriteEnabled };
