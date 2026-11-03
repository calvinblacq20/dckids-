// Which browser origins may call the API in production.
//
// A page calling the server that served it is same-origin, never a cross-site
// request, but browsers still send its Origin on every POST. So a shop reached
// on a hostname missing from ALLOWED_ORIGINS (www., or the host's own domain)
// used to have its own checkout and admin sign-in refused, and checkout fell
// back to WhatsApp without saving the order. Same-origin is always allowed;
// any other origin must be listed.

function hostOf(origin) {
    try {
        return new URL(origin).host.toLowerCase();
    } catch (error) {
        return '';
    }
}

function originAllowed(origin, host, allowedOrigins) {
    // No Origin: same-origin GETs, server-to-server calls, webhooks.
    if (!origin) return true;
    const normalized = String(origin).trim().replace(/\/$/, '');
    if ((allowedOrigins || []).includes(normalized)) return true;
    const own = String(host || '').trim().toLowerCase();
    return !!own && hostOf(normalized) === own;
}

module.exports = { originAllowed };
