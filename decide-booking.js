// Code node after Get All Slots. Rename it "Decide Booking".
// Run Once for All Items. This sequential POC stores a booking on its slot row.
const crypto = require('crypto');
const incoming = $('Webhook').first().json;
let body = incoming.body ?? incoming;
if (typeof body === 'string') {
  try { body = JSON.parse(body); }
  catch { body = null; }
}
const rows = $input.all().map(item => item.json)
  .filter(row => row && typeof row === 'object' && row.slot_id);

function reply(httpStatus, status, errorCode, message, extra = {}) {
  return [{json:{action:'respond', http_status:httpStatus, status,
    ...(errorCode ? {error_code:errorCode} : {}), message, ...extra}}];
}
function field(name) {
  return typeof body?.[name] === 'string' ? body[name].trim() : '';
}

const slotId = field('slot_id');
const patientName = field('patient_name');
const callbackNumber = field('callback_number');
const confirmationTurnId = field('confirmation_turn_id');
const requestId = field('request_id');
if (!/^[A-Za-z0-9_-]{2,50}$/.test(slotId) ||
    patientName.length < 2 || patientName.length > 80 ||
    !/^[+0-9 -]{7,20}$/.test(callbackNumber) ||
    !/^T[1-9]\d*$/.test(confirmationTurnId) ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
  return reply(400, 'invalid_request', 'invalid_booking_fields',
    'Provide a valid slot_id, demo name, callback number, confirmation_turn_id, and request_id.');
}

const sameRequest = rows.filter(row => row.request_id === requestId);
if (sameRequest.length > 1) {
  return reply(409, 'error', 'duplicate_request_rows',
    'Multiple slot rows have the same request_id; staff review is needed.');
}
if (sameRequest.length === 1) {
  const existing = sameRequest[0];
  if (existing.slot_id === slotId && existing.patient_name === patientName &&
      existing.callback_number === callbackNumber &&
      existing.confirmation_turn_id === confirmationTurnId &&
      existing.status === 'booked' && existing.booking_reference) {
    return reply(200, 'confirmed', '', 'Existing booking returned for this request_id.', {
      booking_reference:existing.booking_reference,
      slot_id:existing.slot_id, starts_at:existing.starts_at,
      service:existing.service, timezone:'Asia/Riyadh', reused:true
    });
  }
  return reply(409, 'error', 'request_id_conflict',
    'This request_id was already used with different booking details.');
}

const matchingSlots = rows.filter(row => row.slot_id === slotId);
if (matchingSlots.length !== 1) {
  return reply(409, 'unavailable', 'slot_not_available',
    'The requested slot is unavailable. Check availability again.');
}
const slot = matchingSlots[0];
if (slot.status !== 'available' || slot.service !== 'general_consultation' ||
    !Number.isFinite(Date.parse(slot.starts_at)) || Date.parse(slot.starts_at) <= Date.now()) {
  return reply(409, 'unavailable', 'slot_not_available',
    'The requested slot is unavailable. Check availability again.');
}

const bookingReference = 'CL-' + crypto.createHash('sha256')
  .update(requestId).digest('hex').slice(0, 16).toUpperCase();
if (rows.some(row => row.booking_reference === bookingReference)) {
  return reply(409, 'error', 'reference_conflict',
    'Booking reference collision; use a new request_id.');
}

return [{json:{
  action:'update', http_status:200,
  slot_id:slotId, patient_name:patientName,
  callback_number:callbackNumber,
  confirmation_turn_id:confirmationTurnId,
  request_id:requestId,
  booking_reference:bookingReference,
  booked_at:new Date().toISOString()
}}];
