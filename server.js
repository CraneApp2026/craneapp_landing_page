const express = require('express');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Redis } = require('@upstash/redis');
const { Resend } = require('resend');

// Vercel KV (старый продукт) был выведен из эксплуатации; теперь Vercel
// использует Upstash Redis через маркетплейс. Upstash прокидывает в
// проект переменные UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// (если у тебя остались переменные KV_REST_API_URL/KV_REST_API_TOKEN от
// старой интеграции — они тоже подойдут, см. фолбэк ниже).
const kv = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
});

// Resend используется для рассылки email-уведомлений подписчикам.
// RESEND_API_KEY нужно добавить в переменные окружения Vercel.
// Отправитель: домен, который вы верифицировали в Resend (или onboarding@resend.dev для тестов).
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'CraneApp <onboarding@resend.dev>';

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

// -----------------------------------------------------------------------
// Routes: admin email blast
// -----------------------------------------------------------------------

// Максимальное число получателей в одном вызове Resend (лимит batch API).
// При большой базе подписчиков разбиваем на чанки.
const RESEND_BATCH_SIZE = 100;

// Хелпер: генерирует HTML-тело письма о релизе
function buildReleaseEmailHtml({ platform, subject, body, downloadUrl }) {
    const safePlatform = platform.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeBody = body.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const btnHtml = downloadUrl
        ? `<a href="${downloadUrl}" style="display:inline-block;margin-top:24px;padding:14px 32px;background:#8b5cf6;color:#fff;text-decoration:none;border-radius:50px;font-weight:600;font-size:1rem;">Скачать CraneApp</a>`
        : '';

    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b0a1d;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0a1d;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#131224;border-radius:20px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#4f2dc8 0%,#8b5cf6 100%);padding:32px;text-align:center;">
            <p style="margin:0;font-size:1.7rem;font-weight:700;color:#fff;letter-spacing:-0.5px;">🚀 CraneApp</p>
            <p style="margin:8px 0 0;font-size:0.95rem;color:rgba(255,255,255,0.75);">Уведомление о релизе</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:0.82rem;color:#7e7d9c;text-transform:uppercase;letter-spacing:1px;">Платформа</p>
            <p style="margin:0 0 24px;font-size:1.2rem;font-weight:700;color:#b07ff0;">${safePlatform}</p>
            <p style="margin:0;font-size:1rem;color:#c8c7e0;line-height:1.7;">${safeBody}</p>
            ${btnHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:0.8rem;color:#4a4865;text-align:center;">
              Вы получили это письмо, так как подписались на уведомления на сайте CraneApp.<br>
              Если вы не хотите получать уведомления — просто проигнорируйте это письмо.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

app.post('/api/admin/send-release-notification', async (req, res) => {
    try {
        const { sessionToken, platform, subject, body, downloadUrl } = req.body;
        const username = await validateSession(sessionToken);

        if (!username) {
            return res.status(403).json({ success: false, message: 'Ошибка доступа: сессия не валидна!' });
        }

        if (!platform || typeof platform !== 'string' || platform.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Укажите платформу (например, App Store, Google Play)' });
        }
        if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Укажите тему письма' });
        }
        if (!body || typeof body !== 'string' || body.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Укажите текст письма' });
        }

        const subscribers = await kv.smembers(SUBSCRIBERS_KEY);
        if (!subscribers || subscribers.length === 0) {
            return res.json({ success: false, message: 'Нет подписчиков для рассылки' });
        }

        const html = buildReleaseEmailHtml({
            platform: platform.trim(),
            subject: subject.trim(),
            body: body.trim(),
            downloadUrl: downloadUrl?.trim() || ''
        });

        // Отправляем батчами, чтобы не превышать лимит Resend
        let sent = 0;
        let failed = 0;
        for (let i = 0; i < subscribers.length; i += RESEND_BATCH_SIZE) {
            const chunk = subscribers.slice(i, i + RESEND_BATCH_SIZE);
            const messages = chunk.map(email => ({
                from: EMAIL_FROM,
                to: [email],
                subject: subject.trim(),
                html
            }));

            try {
                await resend.batch.send(messages);
                sent += chunk.length;
            } catch (batchErr) {
                console.error('Ошибка батча Resend:', batchErr);
                failed += chunk.length;
            }
        }

        res.json({
            success: true,
            message: `Рассылка завершена: отправлено ${sent}, ошибок ${failed}`,
            sent,
            failed
        });
    } catch (err) {
        console.error('Ошибка рассылки:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера при рассылке' });
    }
});



if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;