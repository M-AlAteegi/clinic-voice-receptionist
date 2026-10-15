// First Code node after Webhook; rename it "Validate Availability Request".
// Run Once for All Items. Accept one JSON request per webhook call.
const incoming = $input.first().json;
let body = incoming.body ?? incoming;
if (typeof body === 'string') {
  try { body = JSON.parse(body); }
  catch { body = null; }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const service = typeof body?.service === 'string' ? body.service.trim() : '';
const date = typeof body?.date === 'string' ? body.date.trim() : '';
let errorCode = '';
let message = '';
if (service !== 'general_consultation') {
  errorCode = 'unsupported_service';
  message = 'This demo checks general consultation appointments only.';
} else if (!validDate(date)) {
  errorCode = 'invalid_date';
  message = 'date must be a real calendar date in YYYY-MM-DD format.';
}

return [{json:{
  valid: !errorCode,
  service,
  date,
  ...(errorCode ? {status:'invalid_request', error_code:errorCode, message} : {})
}}];
