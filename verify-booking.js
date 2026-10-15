// Code node after Get Booked Slot. Rename it "Verify Booking".
// Run Once for All Items. A confirmation is returned only after reading the row.
const expected = $('Decide Booking').first().json;
const matches = $input.all().map(item => item.json)
  .filter(row => row && row.slot_id === expected.slot_id);
if (matches.length !== 1 || matches[0].status !== 'booked' ||
    matches[0].request_id !== expected.request_id ||
    matches[0].booking_reference !== expected.booking_reference) {
  return [{json:{http_status:409, status:'unavailable',
    error_code:'booking_not_committed',
    message:'The booking could not be verified. Check availability again.'}}];
}
const slot = matches[0];
return [{json:{
  http_status:200, status:'confirmed',
  booking_reference:slot.booking_reference,
  slot_id:slot.slot_id, starts_at:slot.starts_at,
  service:slot.service, timezone:'Asia/Riyadh', reused:false
}}];
