const path = require('path');
// Set env variables for test
process.env.PORT = '3012';
process.env.JWT_SECRET = 'test-jwt-secret-key-12345';
process.env.SHOP_NOTIFY_EMAIL = 'info@dckidsbrand.com';

const dbPath = path.resolve(__dirname, 'inventory.db');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(dbPath);

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Clean test user first
db.run(`DELETE FROM customer_accounts WHERE email = ?`, ['testreset@dckids.com'], (err) => {
    if (err) console.error('Error cleaning test account:', err.message);
    
    // Capture stdout logs of password recovery
    const originalLog = console.log;
    let loggedLink = '';
    console.log = function(...args) {
        originalLog.apply(console, args);
        const str = args.join(' ');
        if (str.includes('[PASSWORD RECOVERY]')) {
            const match = str.match(/Link: (\S+)/);
            if (match) loggedLink = match[1];
        }
    };

    // Load server.js to run the server on port 3012
    console.log('Importing server.js to start server on port 3012...');
    require('./server');

    // Wait a brief moment for DB connect and server start
    setTimeout(async () => {
        try {
            console.log('\n--- Running End-to-End Integration Tests ---');
            
            // 1. Register test user
            console.log('1. Registering customer testreset@dckids.com...');
            const regRes = await fetch('http://localhost:3012/api/customer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Test Customer',
                    email: 'testreset@dckids.com',
                    password: 'oldpassword123'
                })
            });
            const regData = await regRes.json();
            if (!regRes.ok) throw new Error(`Reg failed: ${regData.error}`);
            console.log('   Registration SUCCESS.');

            // 2. Request Forgot Password
            console.log('2. Requesting forgot password link...');
            const forgotRes = await fetch('http://localhost:3012/api/customer/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'testreset@dckids.com' })
            });
            const forgotData = await forgotRes.json();
            if (!forgotRes.ok) throw new Error(`Forgot failed: ${forgotData.error}`);
            console.log('   Forgot Password Request SUCCESS.');

            // Extract token from resetLink
            let token = '';
            if (loggedLink) {
                console.log(`   Captured reset link from server console: ${loggedLink}`);
                const url = new URL(loggedLink);
                token = url.searchParams.get('resetToken');
            } else {
                throw new Error('Could not capture password reset link from console logs!');
            }

            // 3. Reset password
            console.log('3. Resetting password to newpassword123...');
            const resetRes = await fetch('http://localhost:3012/api/customer/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'testreset@dckids.com',
                    token: token,
                    password: 'newpassword123'
                })
            });
            const resetData = await resetRes.json();
            if (!resetRes.ok) throw new Error(`Reset failed: ${resetData.error}`);
            console.log('   Reset Password SUCCESS.');

            // 4. Try Login with new password
            console.log('4. Logging in with new password...');
            const loginRes = await fetch('http://localhost:3012/api/customer/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'testreset@dckids.com',
                    password: 'newpassword123'
                })
            });
            const loginData = await loginRes.json();
            if (!loginRes.ok) throw new Error(`Login failed: ${loginData.error}`);
            console.log('   Login SUCCESS! Session token received.');

            console.log('\nALL TESTS PASSED SUCCESSFULLY! 🎉');
            db.close();
            process.exit(0);
        } catch (err) {
            console.error('\nTEST FAILED: ❌', err.message);
            db.close();
            process.exit(1);
        }
    }, 1500);
});
