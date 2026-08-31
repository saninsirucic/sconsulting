const crypto = require('crypto');
const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const {
  PROMPT_VERSION,
  buildDraftInput,
  buildDraftInstructions
} = require('./promptPolicy');

const EmailDraft = z.object({
  subject: z.string().min(1).max(180),
  body_text: z.string().min(1).max(12000),
  body_html: z.string().min(1).max(20000),
  personalization_summary: z.string().max(2000),
  warnings: z.array(z.string().max(500)).max(10)
});

function configuration() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const model = String(process.env.OPENAI_MODEL || '').trim();
  if (!apiKey || !model) {
    throw Object.assign(new Error('OpenAI generisanje nije konfigurisano. Potrebni su OPENAI_API_KEY i eksplicitno odabrani OPENAI_MODEL.'), { status: 503 });
  }
  return { apiKey, model };
}

function findRefusal(response) {
  for (const output of response.output || []) {
    if (output.type !== 'message') continue;
    for (const item of output.content || []) {
      if (item.type === 'refusal') return item.refusal;
    }
  }
  return null;
}

async function generateEmailDraft({ campaign, contact, actorId, client }) {
  const { apiKey, model } = configuration();
  const openai = client || new OpenAI({ apiKey, timeout: 60000, maxRetries: 2 });
  const safetyIdentifier = crypto
    .createHash('sha256')
    .update(`sconsulting-ai-email:${actorId || 'system'}`)
    .digest('hex');

  const response = await openai.responses.parse({
    model,
    store: false,
    safety_identifier: safetyIdentifier,
    input: [
      { role: 'developer', content: buildDraftInstructions() },
      { role: 'user', content: buildDraftInput(campaign, contact) }
    ],
    text: {
      format: zodTextFormat(EmailDraft, 'sales_email_draft')
    }
  });

  const refusal = findRefusal(response);
  if (refusal) {
    throw Object.assign(new Error(`Model nije generisao nacrt: ${refusal}`), { status: 422 });
  }
  if (!response.output_parsed) {
    throw Object.assign(new Error('Model nije vratio ispravan strukturirani nacrt.'), { status: 502 });
  }

  return {
    ...response.output_parsed,
    ai_model: response.model || model,
    ai_response_id: response.id || null,
    prompt_version: PROMPT_VERSION
  };
}

module.exports = { EmailDraft, generateEmailDraft };
