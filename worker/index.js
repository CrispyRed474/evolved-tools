export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Only accept POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Parse incoming payload
      const payload = await request.json();

      // Process photos: convert base64 to R2 URLs
      const photoUrls = {};
      if (payload.photos && typeof payload.photos === 'object') {
        for (const [photoKey, photoData] of Object.entries(payload.photos)) {
          // Skip empty photos
          if (!photoData || photoData === '') {
            continue;
          }

          try {
            // Extract base64 from data URI if present
            let base64Data = photoData;
            if (typeof photoData === 'string' && photoData.startsWith('data:')) {
              // data:image/jpeg;base64,{base64} -> extract base64 part
              base64Data = photoData.split(',')[1];
            }

            if (!base64Data) {
              console.warn(`Skipping empty photo: ${photoKey}`);
              continue;
            }

            // Decode base64 to binary
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            // Generate filename
            const timestamp = Date.now();
            const customerSlug = (payload.customer_name || 'unknown')
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9-]/g, '');
            const filename = `${timestamp}-${customerSlug}-${photoKey}.jpg`;

            // Upload to R2 (if R2 bucket binding is available)
            if (env.PHOTOS_BUCKET) {
              await env.PHOTOS_BUCKET.put(filename, bytes, {
                httpMetadata: {
                  contentType: 'image/jpeg',
                },
              });

              // Build public URL using R2 public bucket domain
              // Format: https://{account_id}.r2.cloudflarestorage.com/{bucket}/{filename}
              // (assumes bucket is set to public; requires manual setup in Cloudflare Dashboard)
              const publicUrl = `https://evolved-quote-photos.b9453defbd98ede42ecb2f7bf0ae2eca.r2.cloudflarestorage.com/${filename}`;
              photoUrls[photoKey] = publicUrl;

              console.log(`Uploaded ${photoKey}: ${publicUrl}`);
            } else {
              // R2 bucket not available - use placeholder
              // Rich will need to enable R2 in Cloudflare Dashboard and redeploy with binding
              photoUrls[photoKey] = `r2://evolved-quote-photos/${filename}`;
              console.warn(`R2 not bound - using placeholder: ${photoKey}`);
            }
          } catch (photoErr) {
            console.error(`Error processing photo ${photoKey}:`, photoErr);
            // Don't fail entire request, just skip this photo
          }
        }
      }

      // Build modified payload for GHL
      const ghlPayload = {
        ...payload,
        photos: photoUrls,
      };

      // Forward to GHL webhook
      const ghlUrl = 'https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049';
      const ghlResponse = await fetch(ghlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ghlPayload),
      });

      if (!ghlResponse.ok) {
        const ghlError = await ghlResponse.text();
        console.error(`GHL webhook error: ${ghlResponse.status} - ${ghlError}`);
        return new Response(JSON.stringify({ 
          error: 'GHL webhook failed',
          ghlStatus: ghlResponse.status,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Success response to browser
      return new Response(JSON.stringify({ 
        success: true,
        photos_uploaded: Object.keys(photoUrls).length,
        photos: photoUrls,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal worker error',
        message: error.message,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
