const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const migration = require('../migrations/20261026190000_create_classic_haccp_brand');
const { assertCampaignMailboxAccess, userMailbox } = require('../outlookMail/mailboxScope');
const { resolveBrand, listAccessibleBrands } = require('../commercial/service');
const { sendImmediateAccountMail, updateAutomationSettings } = require('../commercial/automation');

async function setup(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  for (const name of ['20260813120000_create_commercial_crm','20260813130000_add_app_user_token_version','20260815120000_add_commercial_mail_automation','20260817130000_add_manual_commercial_mail_campaigns','20260818100000_add_commercial_mail_schedule_reports','20260818130000_add_commercial_recipient_cc','20260818150000_set_commercial_mail_interval_five','20260827170000_add_account_ownership_type','20261024120000_add_public_institutions_profile']) await require('../migrations/'+name).up(db);
  const now=new Date();
  await db('app_user_brand_access').insert({id:'old-access',user_id:'commercial',brand_id:'brand-fs-app',can_read:true,can_write:true,created_at:now,updated_at:now});
  await migration.up(db);
  return db;
}
const actor={id:'commercial',username:'commercial',role:'komercijala'};

test('classic HACCP has an independent paused register and explicit existing-profile access',async t=>{
  const db=await setup(t), brand=await resolveBrand(db,actor,'HACCP_CLASSIC',{write:true});
  assert.equal(brand.name,'HACCP');assert.equal(brand.mailbox_address,'prodaja@s-consulting.ba');
  assert.ok((await listAccessibleBrands(db,actor)).some(b=>b.code==='HACCP_CLASSIC'));
  await assert.rejects(resolveBrand(db,{...actor,id:'unassigned'},'HACCP_CLASSIC'),{code:'BRAND_ACCESS_DENIED'});
  const settings=await db('crm_mail_automation_settings').where({brand_id:brand.id}).first();
  assert.equal(Boolean(settings.enabled),false);assert.equal(Boolean(settings.paused),true);assert.equal(Boolean(settings.auto_send),false);
  assert.equal((await db('crm_accounts').where({brand_id:brand.id})).length,0);
  assert.equal((await db('crm_mail_queue').where({brand_id:brand.id})).length,0);
});

test('classic HACCP sender is scoped to register write permission and does not expose another Outlook mailbox',async t=>{
  const db=await setup(t),brand=await db('crm_brands').where({code:'HACCP_CLASSIC'}).first();
  await assertCampaignMailboxAccess(db,brand,actor);
  assert.equal(userMailbox(actor),'sales@s-consulting.ba');
  await assert.rejects(assertCampaignMailboxAccess(db,brand,{...actor,id:'unassigned'}),{code:'BRAND_MAILBOX_ACCESS_DENIED'});
  await db('app_user_brand_access').where({user_id:actor.id,brand_id:brand.id}).update({can_write:false});
  await assert.rejects(assertCampaignMailboxAccess(db,brand,actor),{code:'BRAND_MAILBOX_ACCESS_DENIED'});
  await assert.rejects(assertCampaignMailboxAccess(db,{...brand,code:'JAVNE_USTANOVE'},actor),{code:'BRAND_MAILBOX_ACCESS_DENIED'});
});

test('classic HACCP manual sending uses the saved letter and team signature, and rejects a repeated send',async t=>{
  const db=await setup(t),brand=await resolveBrand(db,actor,'HACCP_CLASSIC',{write:true}),now=new Date();
  await db('crm_accounts').insert({id:'classic-contact',brand_id:brand.id,source_key:'classic:1',source_data_json:'{}',company_name:'Test',email:'test@example.org',status:'NEW',priority:'MEDIUM',currency:'BAM',created_at:now,updated_at:now});
  await updateAutomationSettings(db,brand,actor,{subject:'HACCP dopis',body:'Implementacija i održavanje HACCP sistema.'});
  const sent=[];const outlook={config:{mailbox:'prodaja@s-consulting.ba',writeEnabled:true},async send(payload){sent.push(payload);return {id:'sent-id',accepted:true};}};
  await sendImmediateAccountMail(db,brand,'classic-contact',{confirmed:true,actor,outlookService:outlook});
  assert.equal(sent.length,1);assert.match(sent[0].body,/Implementacija i održavanje HACCP sistema\./);
  assert.equal(sent[0].bodyType,'html');assert.ok(sent[0].body.includes('href="'+require('../commercial/haccpMail').HACCP_UNSUBSCRIBE_URL+'"'));
  assert.equal(sent[0].signature.name,'Tim S-Consultinga');assert.equal(sent[0].signature.mobile,'');assert.equal(sent[0].signature.email,'prodaja@s-consulting.ba');
  await assert.rejects(sendImmediateAccountMail(db,brand,'classic-contact',{confirmed:true,actor,outlookService:outlook}));
  assert.equal(sent.length,1);
});
