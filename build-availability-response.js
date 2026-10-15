// Code node after Data Table Get; rename it "Build Availability Response".
// The prior validation node must be named "Validate Availability Request".
// Run Once for All Items. Data Table Get needs Always Output Data enabled.
const request = $('Validate Availability Request').first().json;
const now = Date.now();
const slots = $input.all().map(item => item.json)
  .filter(row => row && row.service === request.service &&
    row.local_date === request.date && row.status === 'available' &&
    typeof row.slot_id === 'string' && typeof row.starts_at === 'string' &&
    Number.isFinite(Date.parse(row.starts_at)) && Date.parse(row.starts_at) > now)
  .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  .map(row => ({slot_id:row.slot_id, starts_at:row.starts_at}));

return [{json:{
  status:'ok',
  service:request.service,
  date:request.date,
  timezone:'Asia/Riyadh',
  slots
}}];
