// Code node after Get Saved Callback. Rename it "Verify Callback".
// Mode: Run Once for All Items. A success response requires a stored row.
const expected = $('Decide Callback').first().json;
const matches = $input.all().map(item => item.json)
  .filter(row => row && row.request_id === expected.request_id);
if (matches.length !== 1 || matches[0].status !== 'saved' ||
    matches[0].callback_reference !== expected.callback_reference ||
    matches[0].name !== expected.name ||
    matches[0].callback_number !== expected.callback_number ||
    matches[0].administrative_reason !== expected.administrative_reason ||
    matches[0].consent_turn_id !== expected.consent_turn_id) {
  return [{json:{http_status:500, status:'error',
    error_code:'callback_not_committed',
    message:'The callback request could not be verified as saved.'}}];
}
return [{json:{
  http_status:200, status:'saved',
  callback_reference:matches[0].callback_reference, reused:false
}}];
