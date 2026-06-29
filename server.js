const express = require('express');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Redis } = require('@upstash/redis');

// Vercel KV (старый продукт) был выведен из эксплуатации; теперь Vercel
// использует Upstash Redis через маркетплейс. Upstash прокидывает в
// проект переменные UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// (если у тебя остались переменные KV_REST_API_URL/KV_REST_API_TOKEN от
// старой интеграции — они тоже подойдут, см. фолбэк ниже).
const kv = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
});

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// -----------------------------------------------------------------------
// Default site data. Used only the very first time the site runs
// (when nothing exists yet in KV). After that, KV is the source of truth.
// -----------------------------------------------------------------------
const DEFAULT_SITE_DATA = {
    totalDownloads: 0,
    totalVisits: 0,
    texts: {
        heroTitle: "Мессенджер, созданный для вашей безопасности.",
        heroSubtitle: "Пока крупные корпорации монетизируют персональные данные, три разработчика из Новокузнецка создали альтернативу.",
        btnHeaderDownload: "Скачать",
        btnInstall: "Установить приложение",
        timerTitle: "До релиза осталось:",
        counterTitle: "Скачиваний приложения по всему миру:"
    }
};

const SITE_DATA_KEY = 'site:data';
const VISITED_IPS_KEY = 'site:visited-ips'; // Redis Set
const SUBSCRIBERS_KEY = 'site:subscribers'; // Redis Set of emails
const SESSION_PREFIX = 'session:'; // session:<token> -> username, with TTL
const ADMIN_PREFIX = 'admin:'; // admin:<username> -> { passwordHash, totpSecret }
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

// Simple in-memory rate limiter (best-effort; resets per cold start, but
// still meaningfully slows down brute-force attempts within a warm instance).
const loginAttempts = new Map(); // key: ip+username -> { count, firstAttempt }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(key) {
    const now = Date.now();
    const entry = loginAttempts.get(key);
    if (!entry) return false;
    if (now - entry.firstAttempt > WINDOW_MS) {
        loginAttempts.delete(key);
        return false;
    }
    return entry.count >= MAX_ATTEMPTS;
}

function recordAttempt(key) {
    const now = Date.now();
    const entry = loginAttempts.get(key);
    if (!entry || now - entry.firstAttempt > WINDOW_MS) {
        loginAttempts.set(key, { count: 1, firstAttempt: now });
    } else {
        entry.count++;
    }
}

function clearAttempts(key) {
    loginAttempts.delete(key);
}

// -----------------------------------------------------------------------
// Site data helpers (KV-backed)
// -----------------------------------------------------------------------
async function getSiteData() {
    const data = await kv.get(SITE_DATA_KEY);
    if (!data) {
        await kv.set(SITE_DATA_KEY, DEFAULT_SITE_DATA);
        return DEFAULT_SITE_DATA;
    }
    return data;
}

async function setSiteData(data) {
    await kv.set(SITE_DATA_KEY, data);
}

// Very basic sanitizer to strip tags from admin-supplied text fields,
// since heroTitle is inserted via innerHTML on the frontend.
function stripTags(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/<[^>]*>/g, '');
}

function sanitizeTexts(texts) {
    const clean = {};
    for (const [key, value] of Object.entries(texts)) {
        clean[key] = stripTags(value);
    }
    return clean;
}

// -----------------------------------------------------------------------
// Routes: public
// -----------------------------------------------------------------------
app.get('/api/get-site-data', async (req, res) => {
    try {
        const siteData = await getSiteData();
        // Don't leak internal-only fields if any get added later.
        res.json(siteData);
    } catch (err) {
        console.error('Ошибка получения данных сайта:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/track-visit', async (req, res) => {
    try {
        const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const alreadyVisited = await kv.sismember(VISITED_IPS_KEY, clientIP);

        const siteData = await getSiteData();
        if (!alreadyVisited) {
            await kv.sadd(VISITED_IPS_KEY, clientIP);
            siteData.totalVisits++;
            await setSiteData(siteData);
        }
        res.json({ success: true, totalVisits: siteData.totalVisits });
    } catch (err) {
        console.error('Ошибка трекера заходов:', err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/track-visit', async (req, res) => {
    try {
        const siteData = await getSiteData();
        res.json({ success: true, totalVisits: siteData.totalVisits, note: 'GET fallback for Vercel routing' });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/increment-downloads', async (req, res) => {
    try {
        const siteData = await getSiteData();
        siteData.totalDownloads++;
        await setSiteData(siteData);
        res.json({ success: true, totalDownloads: siteData.totalDownloads });
    } catch (err) {
        console.error('Ошибка увеличения счётчика скачиваний:', err);
        res.status(500).json({ success: false });
    }
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/subscribe', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
            return res.status(400).json({ success: false, message: 'Введите корректный email' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const rateLimitKey = `subscribe:${clientIP}`;

        if (isRateLimited(rateLimitKey)) {
            return res.status(429).json({ success: false, message: 'Слишком много попыток. Попробуйте позже.' });
        }
        recordAttempt(rateLimitKey);

        const alreadySubscribed = await kv.sismember(SUBSCRIBERS_KEY, normalizedEmail);
        if (alreadySubscribed) {
            return res.json({ success: true, message: 'Вы уже подписаны!' });
        }

        await kv.sadd(SUBSCRIBERS_KEY, normalizedEmail);
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка подписки на уведомления:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// -----------------------------------------------------------------------
// Routes: admin auth
// -----------------------------------------------------------------------
app.post('/api/admin/login-password', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Укажите имя пользователя и пароль' });
        }

        const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const rateLimitKey = `${clientIP}:${username}`;

        if (isRateLimited(rateLimitKey)) {
            return res.status(429).json({ success: false, message: 'Слишком много попыток входа. Попробуйте позже.' });
        }

        const admin = await kv.get(`${ADMIN_PREFIX}${username}`);
        if (!admin) {
            recordAttempt(rateLimitKey);
            return res.status(401).json({ success: false, message: 'Ошибка авторизации!' });
        }

        const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
        if (!passwordMatches) {
            recordAttempt(rateLimitKey);
            return res.status(401).json({ success: false, message: 'Ошибка авторизации!' });
        }

        clearAttempts(rateLimitKey);

        // Generate a random TOTP secret on first login, then reuse it.
        // This used to be derived deterministically from the password,
        // which made the "second factor" computable by anyone who knew
        // the password. Now it's a real, independent secret.
        let totpSecret = admin.totpSecret;
        if (!totpSecret) {
            totpSecret = speakeasy.generateSecret({ length: 20 }).base32;
            admin.totpSecret = totpSecret;
            await kv.set(`${ADMIN_PREFIX}${username}`, admin);
        }

        const otpauthUrl = speakeasy.otpauthURL({
            secret: totpSecret,
            label: `CraneApp:${username}`,
            encoding: 'base32'
        });

        qrcode.toDataURL(otpauthUrl, (err, dataUrl) => {
            if (err) {
                console.error('Ошибка генерации QR-кода:', err);
                return res.status(500).json({ success: false });
            }
            return res.json({ success: true, step: 'verify_2fa', qrCode: dataUrl });
        });
    } catch (err) {
        console.error('Ошибка входа администратора:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/admin/verify-2fa', async (req, res) => {
    try {
        const { username, code } = req.body;
        if (!username || !code) {
            return res.status(400).json({ success: false, message: 'Укажите код 2FA' });
        }

        const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const rateLimitKey = `${clientIP}:${username}:2fa`;

        if (isRateLimited(rateLimitKey)) {
            return res.status(429).json({ success: false, message: 'Слишком много попыток. Попробуйте позже.' });
        }

        const admin = await kv.get(`${ADMIN_PREFIX}${username}`);
        if (!admin || !admin.totpSecret) {
            recordAttempt(rateLimitKey);
            return res.status(400).json({ success: false, message: 'Сначала выполните вход по паролю' });
        }

        const isCodeValid = speakeasy.totp.verify({
            secret: admin.totpSecret,
            encoding: 'base32',
            token: code,
            window: 1
        });

        if (!isCodeValid) {
            recordAttempt(rateLimitKey);
            return res.status(412).json({ success: false, message: 'Неверный код 2FA!' });
        }

        clearAttempts(rateLimitKey);

        const sessionToken = crypto.randomBytes(24).toString('hex');
        await kv.set(`${SESSION_PREFIX}${sessionToken}`, username, { ex: SESSION_TTL_SECONDS });

        res.json({ success: true, sessionToken });
    } catch (err) {
        console.error('Ошибка проверки 2FA:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Validates a session token against KV. Returns the username if valid,
// or null otherwise. No length-based shortcuts here — a session is
// valid only if it actually exists in KV.
async function validateSession(sessionToken) {
    if (!sessionToken) return null;
    const username = await kv.get(`${SESSION_PREFIX}${sessionToken}`);
    return username || null;
}

app.post('/api/admin/update-site', async (req, res) => {
    try {
        const { sessionToken, totalDownloads, totalVisits, texts } = req.body;
        const username = await validateSession(sessionToken);

        if (!username) {
            return res.status(403).json({ success: false, message: 'Ошибка доступа: сессия не валидна!' });
        }

        const siteData = await getSiteData();
        if (totalDownloads !== undefined) siteData.totalDownloads = parseInt(totalDownloads, 10) || 0;
        if (totalVisits !== undefined) siteData.totalVisits = parseInt(totalVisits, 10) || 0;
        if (texts) siteData.texts = { ...siteData.texts, ...sanitizeTexts(texts) };

        await setSiteData(siteData);
        res.json({ success: true, message: 'Данные успешно обновлены!' });
    } catch (err) {
        console.error('Ошибка обновления данных сайта:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/admin/reset-site', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        const username = await validateSession(sessionToken);

        if (!username) {
            return res.status(403).json({ success: false, message: 'Ошибка доступа: сессия не валидна!' });
        }

        await setSiteData(DEFAULT_SITE_DATA);
        await kv.del(VISITED_IPS_KEY);

        res.json({ success: true, message: 'Данные успешно сброшены к начальным!' });
    } catch (err) {
        console.error('Ошибка сброса данных сайта:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/admin/logout', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        if (sessionToken) {
            await kv.del(`${SESSION_PREFIX}${sessionToken}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/subscribers', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        const username = await validateSession(sessionToken);

        if (!username) {
            return res.status(403).json({ success: false, message: 'Ошибка доступа: сессия не валидна!' });
        }

        const subscribers = await kv.smembers(SUBSCRIBERS_KEY);
        res.json({ success: true, subscribers: subscribers || [], count: (subscribers || []).length });
    } catch (err) {
        console.error('Ошибка получения списка подписчиков:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.get('/', (req, res) => res.send('CraneApp Security API Node'));

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
