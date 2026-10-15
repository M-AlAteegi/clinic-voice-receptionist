// Code node after Get All Callbacks. Rename it "Decide Callback".
// Mode: Run Once for All Items. Use only synthetic details for this POC.
const crypto = require('crypto');
const incoming = $('Webhook').first().json;
let body = incoming.body ?? incoming;
if (typeof body === 'string') {
  try { body = JSON.parse(body); }
  catch { body = null; }
}
const rows = $input.all().map(item => item.json)
  .filter(row => row && typeof row === 'object' && row.request_id);

function reply(httpStatus, status, errorCode, message, extra = {}) {
  return [{json:{action:'respond', http_status:httpStatus, status,
    ...(errorCode ? {error_code:errorCode} : {}), message, ...extra}}];
}
function field(name) {
  return typeof body?.[name] === 'string' ? body[name].trim() : '';
}

const requestId = field('request_id');
const name = field('name');
const callbackNumber = field('callback_number');
const administrativeReason = field('administrative_reason');
const consentTurnId = field('consent_turn_id');
const allowedReasons = new Set([
  'fee_question', 'insurance_question', 'other_service',
  'cancellation_request', 'rescheduling_request', 'medical_question'
]);
if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId) ||
    name.length < 2 || name.length > 80 ||
    !/^[+0-9 -]{7,20}$/.test(callbackNumber) ||
    !allowedReasons.has(administrativeReason) ||
    !/^T[1-9]\d*$/.test(consentTurnId)) {
  return reply(400, 'invalid_request', 'invalid_callback_fields',
    'Provide a valid request_id, demo name, callback number, administrative_reason, and consent_turn_id.');
}

const sameRequest = rows.filter(row => row.request_id === requestId);
if (sameRequest.length > 1) {
  return reply(409, 'error', 'duplicate_request_rows',
    'Multiple callback rows have the same request_id; staff review is needed.');
}
if (sameRequest.length === 1) {
  const existing = sameRequest[0];
  if (existing.name === name && existing.callback_number === callbackNumber &&
      existing.administrative_reason === administrativeReason &&
      existing.consent_turn_id === consentTurnId &&
      existing.status === 'saved' && existing.callback_reference) {
    return reply(200, 'saved', '', 'Existing callback request returned for this request_id.', {
      callback_reference:existing.callback_reference, reused:true
    });
  }
  return reply(409, 'error', 'request_id_conflict',
    'This request_id was already used with different callback details.');
}

const callbackReference = 'CB-' + crypto.createHash('sha256')
  .update(requestId).digest('hex').slice(0, 16).toUpperCase();
if (rows.some(row => row.callback_reference === callbackReference)) {
  return reply(409, 'error', 'reference_conflict',
    'Callback reference collision; use a new request_id.');
}

return [{json:{
  action:'insert', http_status:200,
  request_id:requestId, callback_reference:callbackReference,
  name, callback_number:callbackNumber,
  administrative_reason:administrativeReason,
  consent_turn_id:consentTurnId,
  created_at:new Date().toISOString(), status:'saved'
}}];
