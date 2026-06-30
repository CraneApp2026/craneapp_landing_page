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
        const { email, recaptchaToken } = req.body;

        if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
            return res.status(400).json({ success: false, message: 'Введите корректный email' });
        }

        // Проверяем reCAPTCHA токен через Google API
        if (!recaptchaToken) {
            return res.status(400).json({ success: false, message: 'Пройдите проверку капчи' });
        }
        const captchaRes = await fetch(
            `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`,
            { method: 'POST' }
        );
        const captchaData = await captchaRes.json();
        if (!captchaData.success) {
            return res.status(400).json({ success: false, message: 'Проверка капчи не пройдена. Попробуйте ещё раз.' });
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

app.post('/api/admin/subscribers/delete', async (req, res) => {
    try {
        const { sessionToken, email } = req.body;
        const username = await validateSession(sessionToken);

        if (!username) {
            return res.status(403).json({ success: false, message: 'Ошибка доступа: сессия не валидна!' });
        }

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ success: false, message: 'Email не указан' });
        }

        const removed = await kv.srem(SUBSCRIBERS_KEY, email.trim().toLowerCase());

        if (!removed) {
            return res.status(404).json({ success: false, message: 'Подписчик не найден' });
        }

        res.json({ success: true, message: 'Подписчик удалён' });
    } catch (err) {
        console.error('Ошибка удаления подписчика:', err);
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
    const safeDownloadUrl = downloadUrl ? downloadUrl.replace(/"/g, '%22') : '';
    const btnHtml = safeDownloadUrl
        ? `<tr><td align="center" style="padding:0 40px 36px;">
            <a href="${safeDownloadUrl}" style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;text-decoration:none;border-radius:50px;font-weight:700;font-size:1rem;letter-spacing:0.3px;box-shadow:0 8px 32px rgba(139,92,246,0.45);">Скачать CraneApp →</a>
           </td></tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CraneApp</title>
</head>
<body style="margin:0;padding:0;background:#0d0b1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;">

  <!-- Фоновый градиент (поддерживается Gmail, Apple Mail) -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(160deg,#0d0b1e 0%,#1a0a2e 40%,#0d0b1e 100%);min-height:100vh;">
    <tr><td align="center" style="padding:48px 16px 48px;">

      <!-- Основная карточка -->
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-radius:28px;overflow:hidden;border:1px solid rgba(168,85,247,0.18);background:linear-gradient(160deg,rgba(255,255,255,0.07) 0%,rgba(255,255,255,0.02) 100%);box-shadow:0 32px 80px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.1);">

        <!-- Шапка с логотипом -->
        <tr>
          <td align="center" style="padding:40px 40px 32px;background:linear-gradient(135deg,rgba(124,58,237,0.5) 0%,rgba(168,85,247,0.3) 100%);border-bottom:1px solid rgba(168,85,247,0.2);">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:10px;vertical-align:middle;">
                  <!-- Иконка журавля -->
                  <div style="width:44px;height:44px;background:rgba(255,255,255,0.12);border-radius:14px;border:1px solid rgba(255,255,255,0.2);display:inline-flex;align-items:center;justify-content:center;font-size:24px;line-height:44px;text-align:center;">🦢</div>
                </td>
                <td style="vertical-align:middle;">
                  <span style="font-size:1.6rem;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">CraneApp</span>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:0.9rem;color:rgba(255,255,255,0.55);letter-spacing:0.5px;text-transform:uppercase;">Уведомление о релизе</p>
          </td>
        </tr>

        <!-- Платформа — стеклянный бейдж -->
        <tr>
          <td align="center" style="padding:32px 40px 0;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.35);border-radius:50px;padding:8px 22px;">
                  <span style="font-size:0.8rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1.5px;display:block;margin-bottom:2px;">Платформа</span>
                  <span style="font-size:1.05rem;font-weight:700;color:#d8b4fe;">${safePlatform}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Разделитель -->
        <tr>
          <td style="padding:28px 40px 0;">
            <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(168,85,247,0.3),transparent);"></div>
          </td>
        </tr>

        <!-- Текст письма -->
        <tr>
          <td style="padding:28px 40px 32px;">
            <p style="margin:0;font-size:1rem;color:rgba(255,255,255,0.8);line-height:1.75;">${safeBody}</p>
          </td>
        </tr>

        <!-- Кнопка скачать -->
        ${btnHtml}

        <!-- Футер -->
        <tr>
          <td style="padding:24px 40px 32px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:0.78rem;color:rgba(255,255,255,0.2);text-align:center;line-height:1.6;">
              Вы получили это письмо, так как подписались на уведомления на сайте CraneApp.<br>
              Если вы не хотите получать уведомления — просто проигнорируйте это письмо.
            </p>
          </td>
        </tr>

      </table>

      <!-- Подпись под карточкой -->
      <p style="margin:24px 0 0;font-size:0.78rem;color:rgba(255,255,255,0.15);text-align:center;">
        © 2026 CraneApp · craneapp.ru
      </p>

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