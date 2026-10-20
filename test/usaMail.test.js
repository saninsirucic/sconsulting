const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignBodyForBrand, campaignSignatureForBrand } = require('../commercial/automation');
const { DISCLOSURE, UNSUBSCRIBE, POSTAL_ADDRESS } = require('../commercial/usaMail');

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

test('complete USA template is not duplicated and other markets retain their body', () => {
  const complete = `${DISCLOSURE}\n\nOffer\n\n${UNSUBSCRIBE}\n\n${POSTAL_ADDRESS}`;
  const body = campaignBodyForBrand({code:'SAN_PEST_USA'}, complete).body;
  assert.equal(body.split(DISCLOSURE).length - 1, 1);
  assert.equal(body.split('Unsubscribe:').length - 1, 1);
  assert.equal(body.split('Tvornička 3').length - 1, 1);
  assert.deepEqual(campaignBodyForBrand({code:'VISIOCAST'}, 'Other offer'), {body:'Other offer',bodyType:'text'});
});
