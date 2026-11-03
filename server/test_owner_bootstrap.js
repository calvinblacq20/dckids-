// A fresh install with no OWNER_EMAIL: the first person to sign in with Google
// becomes the shop's owner, and everyone after them asks the owner for access.
// Boots the real server on a throwaway database with a stand-in for Google.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        console.error(`  FAIL  ${name} — ${error.message}`);
        process.exitCode = 1;
    }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dckids-owner-'));
const port = 38000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${port}`;
// The stand-in vouches for a credential of the form "google:<email>".
const BOOT = `
const app = require(${JSON.stringify(path.join(__dirname, 'server.js'))});
app.set('verifyGoogleIdToken', async (credential) => {
    const match = /^google:(.+@.+)$/.exec(credential);
    return match ? { email: match[1], email_verified: true, name: match[1], sub: 'sub-' + match[1] } : null;
});`;

async function googleSignIn(email) {
    const res = await fetch(BASE + '/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'google:' + email })
    });
    return { status: res.status, body: await res.json() };
}

async function main() {
    const child = spawn(process.execPath, ['-e', BOOT], {
        env: {
            PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), DB_PATH: path.join(dir, 'owner.db'),
            JWT_SECRET: 'owner-bootstrap-test-secret-0123456789abcdef', OWNER_EMAIL: '',
            GOOGLE_CLIENT_ID: 'bootstrap-client.apps.googleusercontent.com',
            RESEND_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: ''
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    try {
        const started = Date.now();
        while (!/Server running on port/.test(output)) {
            if (Date.now() - started > 30000) throw new Error('server did not start:\n' + output);
            if (child.exitCode !== null) throw new Error('server exited:\n' + output);
            await new Promise((r) => setTimeout(r, 200));
        }

        const first = await googleSignIn('first@test.com');
        check('the first Google sign-in on a fresh install becomes the owner', () => {
            assert.strictEqual(first.status, 200, JSON.stringify(first.body));
            assert.strictEqual(first.body.role, 'manager');
            assert.ok(first.body.accessToken);
        });

        const second = await googleSignIn('second@test.com');
        check('the next new address asks the owner for access instead', () => {
            assert.strictEqual(second.status, 403, JSON.stringify(second.body));
            assert.strictEqual(second.body.pending, true);
            assert.strictEqual(second.body.accessToken, undefined);
        });

        const again = await googleSignIn('first@test.com');
        check('the owner signs in again as the owner', () => {
            assert.strictEqual(again.status, 200, JSON.stringify(again.body));
            assert.strictEqual(again.body.role, 'manager');
        });
    } finally {
        child.kill('SIGTERM');
        await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main()
    .catch((error) => { console.error(`  FAIL  owner bootstrap — ${error.message}`); process.exitCode = 1; })
    .finally(() => console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ', 0 failed'}`));
