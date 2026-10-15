import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 3000;
const origin = `http://${host}:${port}`;
const pagePath = fileURLToPath(new URL('./index.html', import.meta.url));

function send(response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

async function readBody(request, maxLength) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxLength) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function riyadhDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function checkAvailability(request, response) {
  if (request.headers['content-type'] !== 'application/json') {
    sendJson(response, 415, {status:'error', error_code:'expected_json'});
    return;
  }
  let body;
  try { body = JSON.parse(await readBody(request, 8192)); }
  catch {
    sendJson(response, 400, {status:'error', error_code:'invalid_json'});
    return;
  }
  if (body?.service !== 'general_consultation' || !validDate(body?.date)) {
    sendJson(response, 400, {status:'error', error_code:'invalid_availability_request'});
    return;
  }
  if (!process.env.N8N_AVAILABILITY_URL || !process.env.N8N_WEBHOOK_TOKEN) {
    sendJson(response, 503, {status:'error', error_code:'availability_not_configured'});
    return;
  }
  try {
    const upstream = await fetch(process.env.N8N_AVAILABILITY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clinic-Tool-Key': process.env.N8N_WEBHOOK_TOKEN,
      },
      body: JSON.stringify({service:body.service, date:body.date}),
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.error(`n8n availability failed: HTTP ${upstream.status}`);
      sendJson(response, 502, {
        status:'error', error_code:'availability_upstream_failed',
        upstream_http_status:upstream.status
      });
      return;
    }
    const result = await upstream.json();
    if (result?.status !== 'ok' || result.service !== body.service ||
        result.date !== body.date || result.timezone !== 'Asia/Riyadh' ||
        !Array.isArray(result.slots) ||
        !result.slots.every(slot => typeof slot.slot_id === 'string' &&
          typeof slot.starts_at === 'string' && !Number.isNaN(Date.parse(slot.starts_at)))) {
      sendJson(response, 502, {status:'error', error_code:'invalid_availability_response'});
      return;
    }
    sendJson(response, 200, {
      status:'ok', service:result.service, date:result.date,
      timezone:result.timezone,
      slots:result.slots.map(slot => ({slot_id:slot.slot_id, starts_at:slot.starts_at}))
    });
  } catch (error) {
    console.error('n8n availability request failed:', error);
    sendJson(response, 502, {status:'error', error_code:'availability_unreachable'});
  }
}

async function createBooking(request, response) {
  if (request.headers['content-type'] !== 'application/json') {
    sendJson(response, 415, {status:'error', error_code:'expected_json'});
    return;
  }
  let body;
  try { body = JSON.parse(await readBody(request, 8192)); }
  catch {
    sendJson(response, 400, {status:'error', error_code:'invalid_json'});
    return;
  }
  const text = key => typeof body?.[key] === 'string' ? body[key].trim() : '';
  const slotId = text('slot_id');
  const patientName = text('patient_name');
  const callbackNumber = text('callback_number');
  const confirmationTurnId = text('confirmation_turn_id');
  const requestId = text('request_id');
  if (!/^[A-Za-z0-9_-]{2,50}$/.test(slotId) ||
      patientName.length < 2 || patientName.length > 80 ||
      !/^[+0-9 -]{7,20}$/.test(callbackNumber) ||
      !/^T[1-9]\d*$/.test(confirmationTurnId) ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
    sendJson(response, 400, {status:'error', error_code:'invalid_booking_fields'});
    return;
  }
  if (!process.env.N8N_BOOKING_URL || !process.env.N8N_WEBHOOK_TOKEN) {
    sendJson(response, 503, {status:'error', error_code:'booking_not_configured'});
    return;
  }
  try {
    const upstream = await fetch(process.env.N8N_BOOKING_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json',
        'X-Clinic-Tool-Key':process.env.N8N_WEBHOOK_TOKEN},
      body:JSON.stringify({slot_id:slotId, patient_name:patientName,
        callback_number:callbackNumber, confirmation_turn_id:confirmationTurnId,
        request_id:requestId}),
      signal:AbortSignal.timeout(15000),
    });
    let result;
    try { result = await upstream.json(); }
    catch {
      sendJson(response, 502, {status:'error', error_code:'invalid_booking_response'});
      return;
    }
    if (upstream.ok && result?.status === 'confirmed' &&
        result.slot_id === slotId &&
        typeof result.booking_reference === 'string' && result.booking_reference &&
        typeof result.starts_at === 'string' && !Number.isNaN(Date.parse(result.starts_at)) &&
        result.service === 'general_consultation' && result.timezone === 'Asia/Riyadh') {
      sendJson(response, 200, {status:'confirmed', slot_id:slotId,
        booking_reference:result.booking_reference, starts_at:result.starts_at,
        service:result.service, timezone:result.timezone, reused:result.reused === true});
      return;
    }
    if (upstream.status >= 400 && upstream.status < 500 &&
        typeof result?.error_code === 'string') {
      sendJson(response, upstream.status, {status:result.status ?? 'error',
        error_code:result.error_code});
      return;
    }
    console.error(`n8n booking returned an unexpected response: HTTP ${upstream.status}`);
    sendJson(response, 502, {status:'error', error_code:'invalid_booking_response'});
  } catch (error) {
    console.error('n8n booking request failed:', error);
    sendJson(response, 502, {status:'error', error_code:'booking_unreachable'});
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    send(response, 200, await readFile(pagePath), 'text/html; charset=utf-8');
    return;
  }
  if (request.method === 'POST' && request.url === '/tool/check-availability') {
    if (request.headers.origin !== origin) {
      sendJson(response, 403, {status:'error', error_code:'unexpected_origin'});
      return;
    }
    await checkAvailability(request, response);
    return;
  }
  if (request.method === 'POST' && request.url === '/tool/create-booking') {
    if (request.headers.origin !== origin) {
      sendJson(response, 403, {status:'error', error_code:'unexpected_origin'});
      return;
    }
    await createBooking(request, response);
    return;
  }
  if (request.method !== 'POST' || request.url !== '/session') {
    send(response, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  if (request.headers.origin !== origin) {
    send(response, 403, 'Unexpected origin', 'text/plain; charset=utf-8');
    return;
  }
  if (request.headers['content-type'] !== 'application/sdp') {
    send(response, 415, 'Expected application/sdp', 'text/plain; charset=utf-8');
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    send(response, 503, 'OPENAI_API_KEY is missing on the local server', 'text/plain; charset=utf-8');
    return;
  }
  let offer;
  try { offer = await readBody(request, 65536); }
  catch {
    send(response, 413, 'SDP offer too large', 'text/plain; charset=utf-8');
    return;
  }
  if (!offer.trim()) {
    send(response, 400, 'SDP offer is missing', 'text/plain; charset=utf-8');
    return;
  }

  const form = new FormData();
  form.set('sdp', offer);
  form.set('session', JSON.stringify({
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    audio: { output: { voice: 'marin' } },
    instructions: [
      'You are the virtual receptionist for a fictional Demo Clinic.',
      `Today in Asia/Riyadh is ${riyadhDate()}.`,
      'Greet briefly in the caller\'s language, Arabic or English. Ask one question at a time.',
      'General consultation is the only available service in this demo.',
      'If the requested date or year is unclear, ask the caller to clarify it; never silently substitute another year.',
      'For any availability question, call check_availability for the requested date.',
      'Use only slots returned by that tool. If it fails, say you could not check availability.',
      'Booking is connected. Before booking, collect a fictional patient name and callback number.',
      'Repeat the exact selected slot, full date including year, time, name, and number, then ask for a clear yes or no.',
      'Never treat silence, an unclear reply, or any form of no as yes.',
      'Call create_booking only after the caller explicitly confirms those details in their most recent reply.',
      'Announce a confirmed booking and reference only when create_booking returns status confirmed.',
      'If create_booking returns clear_confirmation_needed, say no booking was made and ask for a clear yes or no again.',
      'If booking fails or is unavailable for another reason, say it was not booked and explain the known reason briefly.',
      'Callback requests are not connected yet. Do not claim to have saved one.',
      'Do not give medical advice, prices, insurance coverage, or invented clinic facts.'
    ].join(' '),
    tools: [{
      type:'function', name:'check_availability',
      description:'Look up live general-consultation demo slots for one Riyadh calendar date. Call this before offering times.',
      parameters:{
        type:'object',
        properties:{
          service:{type:'string', enum:['general_consultation']},
          date:{type:'string', description:'Requested date in YYYY-MM-DD format, Asia/Riyadh.'}
        },
        required:['service','date'], additionalProperties:false
      }
    }, {
      type:'function', name:'create_booking',
      description:'Save a fictional general-consultation appointment. Only call after checking availability, collecting a demo name and number, repeating all details, and receiving explicit confirmation.',
      parameters:{
        type:'object',
        properties:{
          slot_id:{type:'string', description:'Exact slot_id returned by check_availability.'},
          patient_name:{type:'string', description:'Fictional patient name confirmed by caller.'},
          callback_number:{type:'string', description:'Fictional phone number confirmed by caller.'}
        },
        required:['slot_id','patient_name','callback_number'],
        additionalProperties:false
      }
    }],
    tool_choice:'auto',
  }));
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!upstream.ok) {
      console.error(`OpenAI Realtime session failed: HTTP ${upstream.status}; request ID: ${upstream.headers.get('x-request-id') ?? 'unavailable'}`);
      send(response, 502, `OpenAI session failed (HTTP ${upstream.status})`, 'text/plain; charset=utf-8');
      return;
    }
    send(response, 200, await upstream.text(), 'application/sdp');
  } catch (error) {
    console.error('OpenAI Realtime request failed:', error);
    send(response, 502, 'Could not connect to OpenAI', 'text/plain; charset=utf-8');
  }
});

server.listen(port, host, () => {
  console.log(`Voice probe ready: ${origin}`);
});
