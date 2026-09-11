export default {
  async fetch(request, env) {
    const { method } = request;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow POST
    if (method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    try {
      // Parse request body
      const contentType = request.headers.get('Content-Type') || '';
      let data;

      if (contentType.includes('application/json')) {
        data = await request.json();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await request.text();
        const params = new URLSearchParams(text);
        data = Object.fromEntries(params);
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        data = Object.fromEntries(formData);
      } else {
        return errorResponse(400, 'Invalid Content-Type', 'application/json');
      }

      // Validate fields
      const { name, email, message } = data;
      const errors = {};

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        errors.name = 'Name is required';
      }

      if (!email || typeof email !== 'string' || !isValidEmail(email)) {
        errors.email = 'Valid email is required';
      }

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        errors.message = 'Message is required';
      }

      if (Object.keys(errors).length > 0) {
        return errorResponse(400, 'Validation failed', 'application/json', { errors });
      }

      // Send via Resend API
      const resendApiKey = env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.error('RESEND_API_KEY not configured');
        return errorResponse(500, 'Email service not configured', 'application/json');
      }

      const emailPayload = {
        from: 'Contact Form <onboarding@resend.dev>',
        to: 'zsbuthelezi932@gmail.com',
        subject: `New contact form submission from ${name}`,
        reply_to: email,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      };

      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailPayload),
      });

      if (!resendResponse.ok) {
        const errorData = await resendResponse.text();
        console.error('Resend API error:', resendResponse.status, errorData);
        return errorResponse(500, 'Failed to send email', 'application/json');
      }

      const result = await resendResponse.json();
      return successResponse({ success: true, message: 'Email sent successfully', id: result.id });
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse(500, 'Internal server error', 'application/json');
    }
  },
};

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function errorResponse(status, message, contentType = 'application/json', extra = {}) {
  return new Response(JSON.stringify({ success: false, error: message, ...extra }), {
    status,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

function successResponse(data, contentType = 'application/json') {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
