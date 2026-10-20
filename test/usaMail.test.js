const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignBodyForBrand, campaignSignatureForBrand, campaignAttachmentsForBrand } = require('../commercial/automation');
const { DISCLOSURE, UNSUBSCRIBE, POSTAL_ADDRESS, BANNER_CID } = require('../commercial/usaMail');
const { createOutlookService, normalizeAttachments } = require('../outlookMail/service');
const { createOutlookConfig } = require('../outlookMail/graphClient');
const { SIGNATURE_MARKER } = require('../outlookMail/signature');

test('USA offers retain disclosure, full opt-out and address after editing, escaping contact HTML', () => {
  const output = campaignBodyForBrand({code:'SAN_PEST_USA'}, 'Dear <script>unsafe</script> team,\nA short offer.');
  assert.equal(output.bodyType, 'html');
  assert.ok(!output.body.includes('<script>'));
  assert.ok(output.body.includes(DISCLOSURE));
  assert.ok(output.body.includes('stop all marketing emails'));
  assert.ok(output.body.includes('mailto:sales@s-consulting.ba?subject=Unsubscribe'));
  assert.ok(output.body.includes('Tvornička 3, Sarajevo, Bosnia and Herzegovina'));
  const signature = campaignSignatureForBrand({code:'SAN_PEST_USA'});
  assert.equal(signature.name, 'Sanin Siručić');
  assert.equal(signature.email, 'sales@s-consulting.ba');
});

test('USA send embeds the exact provided banner, retains safe layout and includes one signature and opt-out', async () => {
  const brand = { code: 'SAN_PEST_USA' };
  const attachments = campaignAttachmentsForBrand(brand);
  const calls = [];
  const config = { ...createOutlookConfig({}), writeEnabled: true };
  const service = createOutlookService({
    config,
    graphClient: {
      mailboxPath: (value) => value,
      async request(url, options) {
        calls.push({ url, options });
        return { data: url === '/messages' ? { id: 'usa-layout-draft' } : null };
      }
    }
  });
  const { BODY } = require('../migrations/20261020170000_style_usa_campaign_email');
  const body = campaignBodyForBrand(brand, BODY.replaceAll('{{KOMITENT}}', '<script>unsafe</script>'));
  await service.send({
    to: ['test@example.com'], subject: 'USA layout test', ...body,
    signature: campaignSignatureForBrand(brand), attachments
  });
  assert.equal(calls.length, 3);
  const html = calls[0].options.body.body.content;
  assert.match(html, new RegExp(`src="cid:${BANNER_CID}"`));
  assert.match(html, /max-width:720px/);
  assert.match(html, /<ul style=/);
  assert.doesNotMatch(html, /<script/);
  assert.equal(html.split(SIGNATURE_MARKER).length - 1, 1);
  assert.equal(html.split('Unsubscribe:').length - 1, 1);
  assert.ok(html.indexOf('Unsubscribe:') > html.indexOf(SIGNATURE_MARKER));
  assert.equal(calls[1].url, '/messages/usa-layout-draft/attachments');
  assert.equal(calls[1].options.body.isInline, true);
  assert.equal(calls[1].options.body.contentId, BANNER_CID);
  assert.equal(calls[1].options.body.contentBytes, attachments[0].contentBytes);
  assert.equal(calls[2].url, '/messages/usa-layout-draft/send');
  assert.equal(require('node:crypto').createHash('sha256').update(Buffer.from(attachments[0].contentBytes, 'base64')).digest('hex'),
    '1b1e47295a2d9809894deb4ec63ce8fee0266f5344bee351e87188bcb36c865d');
});

test('missing banner and invalid inline metadata are rejected before sending', async () => {
  const config = { ...createOutlookConfig({}), writeEnabled: true };
  const attachment = campaignAttachmentsForBrand({ code: 'SAN_PEST_USA' })[0];
  for (const invalid of [
    { ...attachment, contentId: 'bad"><script>' },
    { ...attachment, contentType: 'text/html' },
    { ...attachment, isInline: false },
    { ...attachment, isInline: 'true' }
  ]) assert.throws(() => normalizeAttachments([invalid], config), { code: 'OUTLOOK_INVALID_ATTACHMENT' });
  assert.throws(() => normalizeAttachments([attachment, attachment], config), { code: 'OUTLOOK_INVALID_ATTACHMENT' });
  const service = createOutlookService({
    config,
    graphClient: { request() { assert.fail('Invalid layout must not call Graph'); } }
  });
  await assert.rejects(service.send({
    to: ['test@example.com'], subject: 'Test', body: 'Offer', bodyType: 'html', layout: 'sanpest-usa'
  }), { code: 'OUTLOOK_INVALID_LAYOUT' });
});

test('complete USA template is not duplicated and other markets retain their body', () => {
  const complete = `${DISCLOSURE}\n\nOffer\n\n${UNSUBSCRIBE}\n\n${POSTAL_ADDRESS}`;
  const body = campaignBodyForBrand({code:'SAN_PEST_USA'}, complete).body;
  assert.equal(body.split(DISCLOSURE).length - 1, 1);
  assert.equal(body.split('Unsubscribe:').length - 1, 1);
  assert.equal(body.split('Tvornička 3').length - 1, 1);
  assert.deepEqual(campaignBodyForBrand({code:'VISIOCAST'}, 'Other offer'), {body:'Other offer',bodyType:'text'});
});
