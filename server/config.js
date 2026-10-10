const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DEFAULT_JWT_SECRET = 'dckids-super-secret-key-change-in-production';
const DEFAULT_RESEND_FROM = 'DC Kids Admin <onboarding@resend.dev>';

class ConfigurationError extends Error {
    constructor(errors) {
        super('Invalid production configuration:\n- ' + errors.join('\n- '));
        this.name = 'ConfigurationError';
        this.errors = errors;
    }
}

function splitList(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function parseOrigin(value, requireHttps) {
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)) return null;
        if (requireHttps && url.protocol !== 'https:') return null;
        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
        return url.origin;
    } catch (error) {
        return null;
    }
}

function ensureWritableDirectory(directory, label) {
    try {
        fs.mkdirSync(directory, { recursive: true });
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        throw new ConfigurationError([`${label} must exist or be creatable and writable`]);
    }
}

function buildConfig(env = process.env, options = {}) {
    const isProd = env.NODE_ENV === 'production';
    const explicitDataDir = String(env.DATA_DIR || '').trim();
    const dataDir = path.resolve(explicitDataDir || __dirname);
    const dbPath = path.resolve(String(env.DB_PATH || '').trim() || path.join(dataDir, 'inventory.db'));
    const uploadDir = path.resolve(String(env.UPLOAD_DIR || '').trim() || path.join(dataDir, 'uploads'));
    const backupDir = path.resolve(String(env.BACKUP_DIR || '').trim() || path.join(dataDir, 'backups'));
    const allowedOrigins = splitList(env.ALLOWED_ORIGINS).map((origin) => origin.replace(/\/$/, ''));
    const ownerEmails = splitList(env.OWNER_EMAIL).map((email) => email.toLowerCase());
    const appUrl = String(env.APP_URL || (isProd ? '' : 'http://localhost:3001')).trim().replace(/\/$/, '');
    const jwtSecret = String(env.JWT_SECRET || DEFAULT_JWT_SECRET);
    const resendApiKey = String(env.RESEND_API_KEY || '').trim();
    const resendFrom = String(env.RESEND_FROM || DEFAULT_RESEND_FROM).trim();
    const portRaw = String(env.PORT || '3001').trim();
    const port = Number(portRaw);
    const errors = [];

    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer between 1 and 65535');

    if (isProd) {
        if (!explicitDataDir) errors.push('DATA_DIR is required in production');
        else if (!path.isAbsolute(explicitDataDir)) errors.push('DATA_DIR must be an absolute path');
        if (jwtSecret === DEFAULT_JWT_SECRET || jwtSecret.length < 32) errors.push('JWT_SECRET must be unique and at least 32 characters');
        if (!allowedOrigins.length) errors.push('ALLOWED_ORIGINS must contain at least one HTTPS origin');
        const normalizedOrigins = allowedOrigins.map((origin) => parseOrigin(origin, true));
        if (normalizedOrigins.some((origin) => !origin)) errors.push('ALLOWED_ORIGINS entries must be HTTPS origins without paths');
        const appOrigin = parseOrigin(appUrl, true);
        if (!appOrigin) errors.push('APP_URL must be a valid HTTPS origin');
        else if (!normalizedOrigins.includes(appOrigin)) errors.push('APP_URL must also appear in ALLOWED_ORIGINS');
        if (!ownerEmails.length || ownerEmails.some((email) => !isEmail(email))) errors.push('OWNER_EMAIL must contain at least one valid email address');
        if (!resendApiKey) errors.push('RESEND_API_KEY is required in production');
        if (!resendFrom || /onboarding@resend\.dev/i.test(resendFrom) || !/@[^>\s]+/.test(resendFrom)) errors.push('RESEND_FROM must be a verified, non-default sender address');
    }

    if (errors.length) throw new ConfigurationError(errors);

    if (options.createDirectories !== false) {
        ensureWritableDirectory(dataDir, 'DATA_DIR');
        ensureWritableDirectory(path.dirname(dbPath), 'Database directory');
        ensureWritableDirectory(uploadDir, 'Upload directory');
        ensureWritableDirectory(backupDir, 'Backup directory');
    }

    return Object.freeze({
        nodeEnv: String(env.NODE_ENV || 'development'),
        isProd,
        port,
        dataDir,
        dbPath,
        uploadDir,
        backupDir,
        allowedOrigins: Object.freeze(allowedOrigins),
        ownerEmails: Object.freeze(ownerEmails),
        appUrl,
        jwtSecret,
        resendApiKey,
        resendFrom,
        googleClientId: String(env.GOOGLE_CLIENT_ID || '').trim(),
        customerAccountsEnabled: String(env.CUSTOMER_ACCOUNTS_ENABLED || '').toLowerCase() === 'true',
        telegramBotToken: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
        telegramChatIds: Object.freeze(splitList(env.TELEGRAM_CHAT_ID))
    });
}

const config = buildConfig(process.env);

module.exports = Object.freeze(Object.assign({}, config, {
    buildConfig,
    ConfigurationError,
    DEFAULT_JWT_SECRET,
    DEFAULT_RESEND_FROM,
    ensureWritableDirectory
}));
