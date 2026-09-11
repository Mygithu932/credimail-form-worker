export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(env);
    }

    // Health check
    if (request.url.endsWith('/') && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCORSHeaders(env) },
      });
    }

    // Form submission
    if (request.url.endsWith('/submit') && request.method === 'POST') {
      return handleFormSubmission(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

function handleCORS(env) {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(env),
  });
}

function getCORSHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

async function handleFormSubmission(request, env) {
  try {
    const data = await parseFormData(request);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // Validation
    const validation = validateInput(data);
    if (!validation.valid) {
      return errorResponse(400, validation.errors, env);
    }

    // Spam checks
    const spamCheck = checkSpam(data, clientIP);
    if (!spamCheck.passed) {
      return errorResponse(403, { error: spamCheck.reason }, env);
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit(clientIP, env);
    if (!rateLimitCheck.allowed) {
      return errorResponse(429, { error: 'Too many submissions. Please try again later.' }, env);
    }

    // Send email via Resend
    const emailResult = await sendViaResend(data, clientIP, env);
    if (!emailResult.success) {
      return errorResponse(500, { error: 'Failed to send message. Please try again later.' }, env);
    }

    return successResponse(env);
  } catch (error) {
    console.error('Form submission error:', error);
    return errorResponse(500, { error: 'Server error. Please try again later.' }, env);
  }
}

async function parseFormData(request) {
  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return await request.json();
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const data = {};
    for (const [key, value] of formData) {
      data[key] = value;
    }
    return data;
  }

  return await request.json();
}

function validateInput(data) {
  const errors = {};

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2 || data.name.length > 100) {
    errors.name = 'Name must be 2–100 characters.';
  }

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'A valid email address is required.';
  }

  if (!data.message || typeof data.message !== 'string' || data.message.trim().length < 10 || data.message.length > 5000) {
    errors.message = 'Message must be 10–5000 characters.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

function checkSpam(data, clientIP) {
  // Honeypot check
  if (data.website || data.phone_check) {
    return { passed: false, reason: 'Spam detected.' };
  }

  // Time-based trap
  const timestamp = parseInt(data._timestamp || 0);
  if (timestamp > 0) {
    const age = Date.now() - timestamp;
    if (age < 3000) {
      return { passed: false, reason: 'Spam detected.' };
    }
  }

  // URL count
  const urlCount = (data.message.match(/https?:\/\//g) || []).length;
  if (urlCount > 3) {
    return { passed: false, reason: 'Spam detected.' };
  }

  // Blacklisted keywords
  const blacklist = ['viagra', 'casino', 'lottery', 'bitcoin', 'forex', 'crypto giveaway'];
  const messageL = data.message.toLowerCase();
  if (blacklist.some(word => messageL.includes(word))) {
    return { passed: false, reason: 'Spam detected.' };
  }

  return { passed: true };
}

async function checkRateLimit(clientIP, env) {
  if (!env.RATE_LIMIT_KV) {
    return { allowed: true };
  }

  const key = `rate_limit:${clientIP}`;
  const count = await env.RATE_LIMIT_KV.get(key);
  const currentCount = (parseInt(count) || 0) + 1;

  if (currentCount > 3) {
    return { allowed: false };
  }

  await env.RATE_LIMIT_KV.put(key, currentCount.toString(), { expirationTtl: 600 });
  return { allowed: true };
}

async function sendViaResend(data, clientIP, env) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return { success: false };
  }

  const htmlContent = `
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #5680ff; margin-top: 0;">New Contact Form Submission</h2>
          
          <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 10px 0;"><strong>Name:</strong> ${escapeHtml(data.name)}</p>
            <p style="margin: 10px 0;"><strong>Email:</strong> ${escapeHtml(data.email)}</p>
            ${data.phone ? `<p style="margin: 10px 0;"><strong>Phone:</strong> ${escapeHtml(data.phone)}</p>` : ''}
            ${data.trial === 'yes' ? `<p style="margin: 10px 0;"><strong>Interested in:</strong> Free 14-day trial</p>` : ''}
          </div>

          <div style="background: #fafafa; padding: 15px; border-left: 3px solid #5680ff; margin: 20px 0; border-radius: 3px;">
            <strong>Message:</strong>
            <p style="white-space: pre-wrap; word-wrap: break-word; margin: 10px 0;">${escapeHtml(data.message)}</p>
          </div>

          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

          <div style="font-size: 12px; color: #999;">
            <p style="margin: 5px 0;"><strong>Submission Time:</strong> ${new Date().toISOString()}</p>
            <p style="margin: 5px 0;"><strong>Client IP:</strong> ${clientIP}</p>
          </div>

          <div style="margin-top: 30px; text-align: center; color: #999; font-size: 11px;">
            <p>This email was sent from your CrediMail contact form.</p>
            <p><a href="https://credimail.co.za" style="color: #5680ff; text-decoration: none;">Visit CrediMail</a></p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CrediMail <noreply@credimail.co.za>',
        to: 'info@credimail.co.za',
        reply_to: data.email,
        subject: `New Lead: ${data.name} - ${data.email}`,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Resend API error:', response.status, errorText);
      return { success: false };
    }

    const result = await response.json();
    console.log('Email sent successfully:', result.id);
    return { success: true };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false };
  }
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function errorResponse(status, data, env) {
  return new Response(JSON.stringify({ success: false, ...data }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCORSHeaders(env),
    },
  });
}

function successResponse(env) {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Thank you! Your message has been sent. We will get back to you within 24 hours.',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...getCORSHeaders(env),
      },
    }
  );
}
