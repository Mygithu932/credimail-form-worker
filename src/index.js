/**
 * Cloudflare Worker: Form Submission → Email Forwarding
 * Receives POST form submissions and forwards to info@credimail.co.za via Resend
 */

// ============================================================================
// CONFIGURATION & VALIDATION PATTERNS
// ============================================================================

const VALIDATION_RULES = {
  name: {
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9\s]+$/, // Alphanumeric + spaces only
    errorMsg: 'Name is required and must be 2–100 characters (alphanumeric + spaces only).'
  },
  email: {
    maxLength: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // Simplified RFC 5322
    errorMsg: 'A valid email address is required.'
  },
  message: {
    minLength: 10,
    maxLength: 5000,
    errorMsg: 'Message must be between 10 and 5000 characters.'
  }
};

const SPAM_KEYWORDS = [
  'viagra',
  'casino',
  'lottery',
  'crypto giveaway',
  'bitcoin free',
  'seo ranking',
  'cheap pills',
  'adult content',
  'forex',
  'penny stocks'
];

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW = 10 * 60; // 10 minutes in seconds
const SPAM_TIME_TRAP_MIN_SECONDS = 3;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Validate a single field against rules
 */
function validateField(fieldName, value) {
  const rules = VALIDATION_RULES[fieldName];
  if (!rules) return null; // No validation rule defined

  if (value === undefined || value === null || value === '') {
    return `${fieldName} is required.`;
  }

  const str = String(value).trim();

  if (rules.minLength && str.length < rules.minLength) {
    return rules.errorMsg;
  }

  if (rules.maxLength && str.length > rules.maxLength) {
    return rules.errorMsg;
  }

  if (rules.pattern && !rules.pattern.test(str)) {
    return rules.errorMsg;
  }

  return null;
}

/**
 * Parse form data from various content types
 */
async function parseFormData(request) {
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      return await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      return Object.fromEntries(params);
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const data = {};
      for (const [key, value] of formData) {
        data[key] = value instanceof File ? value.name : value;
      }
      return data;
    }
  } catch (err) {
    console.error('Error parsing form data:', err.message);
  }

  return {};
}

/**
 * Check for spam patterns in message content
 */
function detectSpamContent(message) {
  const lowerMessage = message.toLowerCase();

  // Check for excessive URLs
  const urlPattern = /https?:\/\/[^\s]+/g;
  const urls = lowerMessage.match(urlPattern) || [];
  if (urls.length > 3) {
    return true; // Too many URLs
  }

  // Check for blacklisted keywords
  for (const keyword of SPAM_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Hash IP + colo for rate limiting key
 */
async function getClientFingerprint(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const colo = request.cf?.colo || 'unknown';
  const key = `${ip}:${colo}`;

  // Create a simple hash of the key
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Check and update rate limit in KV
 */
async function checkRateLimit(env, fingerprint) {
  const now = Math.floor(Date.now() / 1000);
  const key = `rate_limit:${fingerprint}`;

  const stored = await env.RATE_LIMIT_KV.get(key);
  let data = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

  if (stored) {
    data = JSON.parse(stored);
  }

  // Reset if window expired
  if (now > data.resetTime) {
    data = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
  } else {
    data.count += 1;
  }

  // Store updated data
  await env.RATE_LIMIT_KV.put(key, JSON.stringify(data), {
    expirationTtl: RATE_LIMIT_WINDOW
  });

  return data.count > RATE_LIMIT_MAX;
}

/**
 * Send email via Resend API
 */
async function sendEmailViaResend(env, { name, email, message, ip, timestamp }) {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured');
    return false;
  }

  const emailBody = `
    <h2>New Contact Form Submission</h2>
    <p><strong>From:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <hr />
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>
    <hr />
    <p style="color: #888; font-size: 0.9em;">
      <strong>Submitted:</strong> ${new Date(timestamp).toISOString()}<br />
      <strong>IP Address:</strong> ${ip}
    </p>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CrediMail Contact Form <onboarding@resend.dev>',
        to: 'info@credimail.co.za',
        replyTo: email,
        subject: `New Contact Form Submission from ${name}`,
        html: emailBody
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Resend API error:', response.status, error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error sending email:', err.message);
    return false;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * CORS response helper
 */
function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

// ============================================================================
// MAIN REQUEST HANDLER
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    const headers = corsHeaders(env);

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // Health check endpoint
    if (pathname === '/' && method === 'GET') {
      return jsonResponse({ status: 'ok' }, 200, headers);
    }

    // Form submission endpoint
    if (pathname === '/submit' && method === 'POST') {
      // Parse form data
      let formData;
      try {
        formData = await parseFormData(request);
      } catch (err) {
        return jsonResponse(
          { success: false, error: 'Failed to parse form data.' },
          400,
          headers
        );
      }

      const { name, email, message, website, _timestamp } = formData;

      // ========== VALIDATION ==========
      const errors = {};
      const nameError = validateField('name', name);
      const emailError = validateField('email', email);
      const messageError = validateField('message', message);

      if (nameError) errors.name = nameError;
      if (emailError) errors.email = emailError;
      if (messageError) errors.message = messageError;

      if (Object.keys(errors).length > 0) {
        return jsonResponse(
          { success: false, errors },
          400,
          headers
        );
      }

      // ========== SPAM PREVENTION ==========

      // 1. Honeypot: silently accept but don't send if website field is filled
      if (website && String(website).trim() !== '') {
        console.log('Honeypot triggered: website field filled');
        return jsonResponse(
          { success: true, message: 'Thank you! Your message has been sent.' },
          200,
          headers
        );
      }

      // 2. Time trap: reject if submitted too quickly
      if (_timestamp) {
        const submittedAt = parseInt(_timestamp, 10);
        const now = Date.now();
        const secondsElapsed = (now - submittedAt) / 1000;

        if (secondsElapsed < SPAM_TIME_TRAP_MIN_SECONDS) {
          console.log(`Time trap triggered: ${secondsElapsed.toFixed(2)}s elapsed`);
          return jsonResponse(
            { success: false, error: 'Spam detected.' },
            403,
            headers
          );
        }
      }

      // 3. Rate limiting: check IP + colo fingerprint
      const fingerprint = await getClientFingerprint(request);
      const isRateLimited = await checkRateLimit(env, fingerprint);
      if (isRateLimited) {
        console.log(`Rate limit exceeded for fingerprint: ${fingerprint}`);
        return jsonResponse(
          { success: false, error: 'Too many submissions. Please try again later.' },
          429,
          headers
        );
      }

      // 4. Content filtering: check for spam keywords and excessive URLs
      if (detectSpamContent(message)) {
        console.log('Spam content detected in message');
        return jsonResponse(
          { success: false, error: 'Spam detected.' },
          403,
          headers
        );
      }

      // ========== EMAIL SENDING ==========
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const timestamp = Date.now();

      const emailSent = await sendEmailViaResend(env, {
        name: String(name).trim(),
        email: String(email).trim(),
        message: String(message).trim(),
        ip,
        timestamp
      });

      if (!emailSent) {
        return jsonResponse(
          { success: false, error: 'Failed to send message. Please try again later.' },
          500,
          headers
        );
      }

      // ========== SUCCESS ==========
      return jsonResponse(
        { success: true, message: 'Thank you! Your message has been sent.' },
        200,
        headers
      );
    }

    // Method not allowed for /submit endpoint
    if (pathname === '/submit') {
      return jsonResponse(
        { success: false, error: 'Method not allowed.' },
        405,
        headers
      );
    }

    // 404 for all other paths
    return jsonResponse(
      { success: false, error: 'Not found.' },
      404,
      headers
    );
  }
};
