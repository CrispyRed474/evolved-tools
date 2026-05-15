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

async function notifyGemmaNewTradeAccount(data) {
  // Simple email via GHL contact note — Gemma gets GHL notifications
  // Full email via Gmail would need separate API call; GHL webhook covers immediate notification
  console.log('New trade account:', JSON.stringify(data));
}

function formatRooms(rooms, p) {
  if (!rooms || typeof rooms !== 'object') return '';
  const labels = {
    bedroom_1: 'Bedroom 1', bedroom_2: 'Bedroom 2', bedroom_3: 'Bedroom 3',
    bedroom_4: 'Bedroom 4', living_dining: 'Living/Dining', kitchen: 'Kitchen',
    hallway_entry: 'Hallway/Entry'
  };
  const lines = Object.entries(rooms)
    .filter(([k, v]) => v && parseFloat(v) > 0 && k !== 'extra_rooms')
    .map(([k, v]) => `${labels[k] || k}: ${v}m²`);
  // Extra rooms (dynamic)
  const extras = Array.isArray(rooms.extra_rooms) ? rooms.extra_rooms : (Array.isArray(p.extra_rooms) ? p.extra_rooms : []);
  extras.filter(r => r.sqm > 0).forEach(r => lines.push(`${r.name || 'Other'}: ${r.sqm}m²`));
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

const corsHeaders = CORS_HEADERS;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /trade/create-checkout (account registration — fixed amounts)
    if (pathname === '/trade/create-checkout' && request.method === 'POST') {
      const body = await request.json();
      const { tier, business_name, contact_name, email, phone, abn, address } = body;
      
      const STRIPE_SECRET = env.STRIPE_SECRET || '__STRIPE_SECRET_PLACEHOLDER__';
      const amount = tier === 'volume' ? 550000 : 110000; // cents AUD
      const tierLabel = tier === 'volume' ? 'Volume Trade Account ($5,500)' : 'Standard Trade Account ($1,100)';
      
      const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(STRIPE_SECRET + ':')}`,'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'payment_method_types[]': 'card',
          'line_items[0][price_data][currency]': 'aud',
          'line_items[0][price_data][product_data][name]': tierLabel,
          'line_items[0][price_data][unit_amount]': amount,
          'line_items[0][quantity]': '1',
          'mode': 'payment',
          'success_url': `https://tools.evolvedluxuryfloors.com.au/trade/?payment=success&email=${encodeURIComponent(email)}&tier=${tier}&business=${encodeURIComponent(business_name)}&contact=${encodeURIComponent(contact_name)}&phone=${encodeURIComponent(phone)}&abn=${encodeURIComponent(abn)}&address=${encodeURIComponent(address)}`,
          'cancel_url': 'https://tools.evolvedluxuryfloors.com.au/trade/',
          'customer_email': email,
          'metadata[business_name]': business_name,
          'metadata[contact_name]': contact_name,
          'metadata[phone]': phone,
          'metadata[abn]': abn,
          'metadata[address]': address,
          'metadata[tier]': tier
        })
      });
      
      const session = await sessionRes.json();
      if (session.error) {
        return new Response(JSON.stringify({ error: session.error.message }), { status: 400, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ url: session.url }), { headers: corsHeaders });
    }

    // POST /trade/order-checkout (order fulfillment — variable amounts)
    if (pathname === '/trade/order-checkout' && request.method === 'POST') {
      const body = await request.json();
      const { amount_cents, order_id, email, description } = body;
      
      if (!amount_cents || !email) {
        return new Response(JSON.stringify({ error: 'amount_cents and email required' }), { status: 400, headers: corsHeaders });
      }
      
      const STRIPE_SECRET = env.STRIPE_SECRET || '__STRIPE_SECRET_PLACEHOLDER__';
      
      const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(STRIPE_SECRET + ':')}`,'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'payment_method_types[]': 'card',
          'line_items[0][price_data][currency]': 'aud',
          'line_items[0][price_data][product_data][name]': description || 'Order Payment',
          'line_items[0][price_data][unit_amount]': amount_cents,
          'line_items[0][quantity]': '1',
          'mode': 'payment',
          'success_url': 'https://tools.evolvedluxuryfloors.com.au/trade/?order=success',
          'cancel_url': 'https://tools.evolvedluxuryfloors.com.au/trade/',
          'customer_email': email,
          'metadata[order_id]': order_id || 'unknown',
          'metadata[type]': 'order_payment'
        })
      });
      
      const session = await sessionRes.json();
      if (session.error) {
        return new Response(JSON.stringify({ error: session.error.message }), { status: 400, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ url: session.url }), { headers: corsHeaders });
    }

    // POST /trade/order-notify
    if (pathname === '/trade/order-notify' && request.method === 'POST') {
      const body = await request.json();
      
      // Notify GHL
      await fetch('https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, source: 'trade_portal_order' })
      });
      
      // Email via VPS webhook
      await fetch('http://72.60.40.192:8765/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Secret': 'ef_trade_notify_2026' },
        body: JSON.stringify({
          to: 'gemma@elfloors.com.au',
          subject: `New Trade Order — ${body.business_name || 'Unknown'} ($${(body.total || 0).toFixed(2)})`,
          body: `New trade order received\n\nBusiness: ${body.business_name}\nContact: ${body.contact_name}\nPhone: ${body.phone}\nEmail: ${body.email}\nTier: ${body.tier}\nTotal: $${(body.total || 0).toFixed(2)} inc GST\nPayment: ${body.payment_method}\nOrder ID: ${body.order_id}\n\nLog into GHL to process this order.`
        })
      }).catch(() => {});
      
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // POST /trade/bank-transfer-notify
    if (pathname === '/trade/bank-transfer-notify' && request.method === 'POST') {
      const body = await request.json();
      const { business_name, contact_name, email, phone, abn, address, tier } = body;
      
      // Save to KV as pending
      const credit = tier === 'volume' ? 5000 : 1000;
      const account = { business_name, contact_name, email, phone, abn, address, tier, credit, status: 'pending_payment', created_at: new Date().toISOString(), payment_method: 'bank_transfer' };
      await env.DASHBOARD_KV.put(`trade_account:${email}`, JSON.stringify(account));
      
      // Notify GHL
      await fetch('https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: contact_name.split(' ')[0], last_name: contact_name.split(' ').slice(1).join(' '), email, phone, business_name, abn, address, tier, credit_amount: credit, source: 'trade_portal', payment_method: 'bank_transfer' })
      });
      
      // Email Gemma
      await notifyGemmaNewTradeAccount({ business_name, contact_name, email, phone, abn, address, tier, credit, payment_method: 'bank_transfer' });
      
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // GET /trade/account?email=xxx
    if (pathname === '/trade/account' && request.method === 'GET') {
      const email = url.searchParams.get('email');
      if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: corsHeaders });
      const account = await env.DASHBOARD_KV.get(`trade_account:${email}`);
      if (!account) return new Response(JSON.stringify({ found: false }), { headers: corsHeaders });
      return new Response(JSON.stringify({ found: true, account: JSON.parse(account) }), { headers: corsHeaders });
    }

    // POST /trade/confirm-payment (called by GHL webhook when bank transfer confirmed)
    // Simple endpoint: just needs email, looks up existing KV record and flips to active
    if (pathname === '/trade/confirm-payment' && request.method === 'POST') {
      const body = await request.json();
      const { email } = body;
      if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: corsHeaders });
      const existing = await env.DASHBOARD_KV.get(`trade_account:${email}`);
      if (!existing) return new Response(JSON.stringify({ error: 'account not found' }), { status: 404, headers: corsHeaders });
      const account = JSON.parse(existing);
      account.status = 'active';
      account.activated_at = new Date().toISOString();
      await env.DASHBOARD_KV.put(`trade_account:${email}`, JSON.stringify(account));
      // Notify Gemma via GHL
      await fetch('https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, business_name: account.business_name, tier: account.tier, credit_amount: account.credit, source: 'trade_portal', payment_method: 'bank_transfer', status: 'activated' })
      });
      return new Response(JSON.stringify({ ok: true, email, status: 'active' }), { headers: corsHeaders });
    }

    // POST /trade/activate (called on Stripe success redirect)
    if (pathname === '/trade/activate' && request.method === 'POST') {
      const body = await request.json();
      const { business_name, contact_name, email, phone, abn, address, tier } = body;
      const credit = tier === 'volume' ? 5000 : 1000;
      const account = { business_name, contact_name, email, phone, abn, address, tier, credit, status: 'active', created_at: new Date().toISOString(), payment_method: 'stripe' };
      await env.DASHBOARD_KV.put(`trade_account:${email}`, JSON.stringify(account));
      
      // Notify GHL
      await fetch('https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: contact_name.split(' ')[0], last_name: contact_name.split(' ').slice(1).join(' '), email, phone, business_name, abn, address, tier, credit_amount: credit, source: 'trade_portal', payment_method: 'stripe' })
      });
      
      // Email Gemma
      await notifyGemmaNewTradeAccount({ business_name, contact_name, email, phone, abn, address, tier, credit, payment_method: 'stripe' });
      
      return new Response(JSON.stringify({ ok: true, account }), { headers: corsHeaders });
    }

    // Dashboard data endpoint — live GHL + KV state
    if (request.method === 'GET' && pathname === '/dashboard-data') {
      try {
        const ghlKey = env.GHL_KEY;
        const [oppsRes, leadsRes, kvState] = await Promise.allSettled([
          fetch(
            'https://services.msgsndr.com/opportunities/search?location_id=1cvFdmlQAU5WpfaQwhB9&limit=100&status=open',
            { headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28' } }
          ),
          fetch(
            `https://services.msgsndr.com/contacts/?locationId=1cvFdmlQAU5WpfaQwhB9&limit=100`,
            { headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28' } }
          ),
          env.DASHBOARD_KV ? env.DASHBOARD_KV.get('state', { type: 'json' }) : Promise.resolve(null)
        ]);

        const opps = oppsRes.status === 'fulfilled' ? ((await oppsRes.value.json()).opportunities || []) : [];
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const allContacts = leadsRes.status === 'fulfilled' ? ((await leadsRes.value.json()).contacts || []) : [];
        const leads_7d = allContacts.filter(c => c.dateAdded && c.dateAdded >= cutoff).length;
        const pipeline_value = opps.reduce((s, o) => s + (o.monetaryValue || 0), 0);
        const state = kvState.status === 'fulfilled' ? (kvState.value || {}) : {};

        return new Response(JSON.stringify({
          leads_7d,
          active_opps: opps.length,
          pipeline_value: Math.round(pipeline_value),
          updated: new Date().toISOString(),
          goals: state.goals || {},
          session: state.session || {},
          decisions: state.decisions || []
        }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, updated: new Date().toISOString() }), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // Brian update endpoint — POST from chat sessions to update dashboard state
    if (request.method === 'POST' && pathname === '/brian-update') {
      try {
        const auth = request.headers.get('x-brian-token');
        if (auth !== env.BRIAN_TOKEN) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });
        }
        const body = await request.json();
        const existing = (await (env.DASHBOARD_KV ? env.DASHBOARD_KV.get('state', { type: 'json' }) : null)) || {};
        const merged = {
          ...existing,
          goals: { ...(existing.goals || {}), ...(body.goals || {}) },
          session: { ...(existing.session || {}), ...(body.session || {}) },
          decisions: [
            ...((body.decisions || []).map(d => ({ ...d, ts: new Date().toISOString() }))),
            ...((existing.decisions || []).slice(0, 20))
          ],
          lastUpdated: new Date().toISOString()
        };
        await env.DASHBOARD_KV.put('state', JSON.stringify(merged));
        return new Response(JSON.stringify({ ok: true, state: merged }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
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
    // Map address to GHL standard contact fields
    if (payload.customer_address) {
      payload.address1 = payload.customer_address;
    }

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

    // Upload signature to R2
    const sigData = payload.signature_image;
    if (sigData && typeof sigData === 'string' && sigData.startsWith('data:')) {
      try {
        const base64Data = sigData.split(',')[1];
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const sigFilename = `signatures/${timestamp}-${customerSlug}-signature.png`;
        await env.PHOTOS_BUCKET.put(sigFilename, bytes, { httpMetadata: { contentType: 'image/png' } });
        payload.signature_url = `${R2_PUBLIC_URL}/${sigFilename}`;
      } catch (err) {
        payload.signature_url = `upload-error: ${err.message}`;
      }
    }
    delete payload.signature_image; // remove raw base64 before forwarding to GHL

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

    // Embed photo URLs into site_notes:
    // 1. Machine-readable tag for Pam's parser (kept at end, stripped from display)
    // 2. Human-readable plain URLs so GHL emails auto-hyperlink them
    const photoEntries = Object.entries(photoUrls).filter(([k,v]) => !v.startsWith('upload-error'));
    if (photoEntries.length > 0) {
      // Plain clickable URLs for the email (one per line, numbered)
      const photoLines = photoEntries.map(([k, v], i) => `Photo ${i+1}: ${v}`).join('\n');
      // Human-readable block goes into site_notes for Gemma's email
      payload.site_notes = (payload.site_notes ? payload.site_notes + '\n\n' : '') + 'SITE PHOTOS\n' + photoLines;
      // Machine tag goes into a SEPARATE field so it never appears in emails
      payload.photos_tag = '[photos:' + photoEntries.map(([k,v]) => `${k}=${v}`).join('|') + ']';
    }

    // Store full line items JSON in R2 so Pam can build proper Xero quotes
    const lineItems = payload.line_items || [];
    if (lineItems.length > 0) {
      const linesFilename = `quotes/${timestamp}-${customerSlug}-lines.json`;
      const linesJson = JSON.stringify(lineItems);
      await env.PHOTOS_BUCKET.put(linesFilename, linesJson, { httpMetadata: { contentType: 'application/json' } });
      const r2Url = `${R2_PUBLIC_URL}/${linesFilename}`;
      payload.site_notes = (payload.site_notes ? payload.site_notes + '\n' : '') + `[lines:${r2Url}]`;
    }
    // Remove raw line_items from payload (too large for GHL webhook)
    delete payload.line_items;

    // Forward to correct GHL webhook — use ctx.waitUntil so CF doesn't kill the fetch early
    const region = payload.region === 'bb' ? 'bb' : 'seq';
    const GHL_WEBHOOK = GHL_WEBHOOKS[region];
    const ghlFetch = fetch(GHL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ctx.waitUntil(ghlFetch);

    return new Response(JSON.stringify({ success: true, photos: photoUrls }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
};
