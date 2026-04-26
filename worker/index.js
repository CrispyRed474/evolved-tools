const GHL_WEBHOOKS = {
  seq: 'https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049',
  bb:  'https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/r8LHqAk94GcHqg7lS9wY'
};
const R2_PUBLIC_URL = 'https://pub-61c7414b67fe47a7a09a2ee34c989477.r2.dev';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function formatRooms(rooms, p) {
  if (!rooms || typeof rooms !== 'object') return '';
  const labels = {
    bedroom_1: 'Bedroom 1', bedroom_2: 'Bedroom 2', bedroom_3: 'Bedroom 3',
    bedroom_4: 'Bedroom 4', living_dining: 'Living/Dining', kitchen: 'Kitchen',
    hallway_entry: 'Hallway/Entry', other_sqm: 'Other'
  };
  const lines = Object.entries(rooms)
    .filter(([k, v]) => v && parseFloat(v) > 0 && k !== 'other_name')
    .map(([k, v]) => {
      const label = k === 'other_sqm' && rooms.other_name ? rooms.other_name : (labels[k] || k);
      return `${label}: ${v}m²`;
    });
  // Add stairs if any
  const straight = parseFloat(p.stairs_straight) || 0;
  const winder = parseFloat(p.stairs_winder) || 0;
  const risers = parseFloat(p.stair_risers) || 0;
  if (straight > 0 || winder > 0 || risers > 0) {
    lines.push('---');
    if (straight > 0) lines.push(`Straight stairs: ${straight}`);
    if (winder > 0) lines.push(`Winder stairs: ${winder}`);
    if (risers > 0) lines.push(`Risers: ${risers}`);
  }
  return lines.join('\n');
}

function formatTrims(p) {
  const items = [
    ['Scotia', p.scotia_lm], ['L-Trim', p.ltrim_lm], ['T-Trim', p.ttrim_lm],
    ['U-Trim', p.utrim_lm], ['Skirting (existing)', p.skirting_existing_lm],
    ['Skirting (new)', p.skirting_new_lm]
  ];
  return items.filter(([,v]) => v && parseFloat(v) > 0)
    .map(([k,v]) => `${k}: ${v}lm`).join('\n') || 'None';
}

function formatPrep(p) {
  const items = [
    ['Carpet removal', p.prep_carpet_sqm], ['Hybrid removal', p.prep_hybrid_sqm],
    ['Tile removal', p.prep_tiles_sqm], ['Glued removal', p.prep_glued_sqm],
    ['Grind', p.prep_grind_sqm], ['Flood levelling', p.prep_flood_sqm],
    ['Ply', p.prep_ply_sqm], ['Smooth edge', p.prep_smoothedge_sqm]
  ];
  return items.filter(([,v]) => v && parseFloat(v) > 0)
    .map(([k,v]) => `${k}: ${v}m²`).join('\n') || 'None';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Dashboard data endpoint
    if (request.method === 'GET' && url.pathname === '/dashboard-data') {
      try {
        const ghlKey = env.GHL_KEY;
        if (!ghlKey) {
          return new Response(JSON.stringify({ error: 'GHL_KEY not configured', updated: new Date().toISOString() }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          });
        }
        // Get active opps + pipeline value
        const oppsRes = await fetch(
          'https://services.msgsndr.com/opportunities/search?location_id=1cvFdmlQAU5WpfaQwhB9&limit=100&status=open',
          { headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28' } }
        );
        const oppsData = await oppsRes.json();
        const opps = oppsData.opportunities || [];
        const pipeline_value = opps.reduce((s, o) => s + (o.monetaryValue || 0), 0);
        // Get leads last 7 days
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const leadsRes = await fetch(
          `https://services.msgsndr.com/contacts/?locationId=1cvFdmlQAU5WpfaQwhB9&startAfter=${since}&limit=100`,
          { headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28' } }
        );
        const leadsData = await leadsRes.json();
        const leads_7d = (leadsData.contacts || []).length;
        return new Response(JSON.stringify({
          leads_7d,
          active_opps: opps.length,
          pipeline_value: Math.round(pipeline_value),
          updated: new Date().toISOString()
        }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, updated: new Date().toISOString() }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS });
    }

    // Format summary fields for GHL custom fields
    payload.rooms_summary = formatRooms(payload.rooms, payload);
    payload.trims_summary = formatTrims(payload);
    payload.prep_summary = formatPrep(payload);
    const herringbone = payload.is_herringbone ? ' — HERRINGBONE' : '';
    payload.product_summary = `${payload.product_name || ''} / ${payload.product_colour || ''}${herringbone}`.trim().replace(/^\/|\/$/g, '').trim();

    // Process photos — upload to R2
    const photoUrls = {};
    const photos = payload.photos || {};
    const customerSlug = (payload.customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
    const timestamp = Date.now();

    for (const [key, value] of Object.entries(photos)) {
      if (!value || typeof value !== 'string' || !value.startsWith('data:')) continue;
      try {
        const base64Data = value.split(',')[1];
        if (!base64Data) continue;
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const filename = `${timestamp}-${customerSlug}-${key}.jpg`;
        await env.PHOTOS_BUCKET.put(filename, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
        photoUrls[key] = `${R2_PUBLIC_URL}/${filename}`;
      } catch (err) {
        photoUrls[key] = `upload-error: ${err.message}`;
      }
    }

    payload.photos = photoUrls;
    payload.photos_summary = Object.entries(photoUrls).map(([k,v]) => `${k}: ${v}`).join('\n') || '';

    // Store full line items JSON in R2 so Pam can build proper Xero quotes
    const lineItems = payload.line_items || [];
    if (lineItems.length > 0) {
      const linesFilename = `quotes/${timestamp}-${customerSlug}-lines.json`;
      const linesJson = JSON.stringify(lineItems);
      await env.PHOTOS_BUCKET.put(linesFilename, linesJson, { httpMetadata: { contentType: 'application/json' } });
      const r2Url = `${R2_PUBLIC_URL}/${linesFilename}`;
      // Append R2 URL to site_notes so GHL preserves it (Pam reads it from there)
      payload.site_notes = (payload.site_notes ? payload.site_notes + '\n' : '') + `[lines:${r2Url}]`;
    }
    // Remove raw line_items from payload (too large for GHL webhook)
    delete payload.line_items;

    // Forward to correct GHL webhook based on region
    const region = payload.region === 'bb' ? 'bb' : 'seq';
    const GHL_WEBHOOK = GHL_WEBHOOKS[region];
    await fetch(GHL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return new Response(JSON.stringify({ success: true, photos: photoUrls }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
};
