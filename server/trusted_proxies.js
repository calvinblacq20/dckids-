const net = require('net');

// From https://www.cloudflare.com/ips, checked 2026-11-04.
const CLOUDFLARE_RANGES = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];

const cloudflare = new net.BlockList();
CLOUDFLARE_RANGES.forEach((range) => {
    const [address, prefix] = range.split('/');
    cloudflare.addSubnet(address, Number(prefix), net.isIPv6(address) ? 'ipv6' : 'ipv4');
});

function isCloudflareAddress(ip) {
    const address = String(ip || '').replace(/^::ffff:/i, '');
    if (net.isIPv4(address)) return cloudflare.check(address, 'ipv4');
    if (net.isIPv6(address)) return cloudflare.check(address, 'ipv6');
    return false;
}

// Hop 0 is Railway's edge. Cloudflare is trusted only as the hop right behind it,
// so a forged X-Forwarded-For sent straight to Railway can't choose its own identity.
function shouldTrustProxy(ip, hop) {
    return hop === 0 || (hop === 1 && isCloudflareAddress(ip));
}

module.exports = { shouldTrustProxy, isCloudflareAddress };
