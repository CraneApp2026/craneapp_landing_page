const express = require('express');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Базовое хранилище данных в оперативной памяти сервера
let siteData = {
    totalDownloads: 0,
    totalVisits: 0,
    visitedIPs: [],
    texts: {
        heroTitle: "Мессенджер, созданный для вашей безопасности.",
        heroSubtitle: "Пока крупные корпорации монетизируют персональные данные, три разработчика из Новокузнецка создали альтернативу.",
        btnInstall: "Установить приложение",
        btnHowItWorks: "Как это работает?",
        timerTitle: "До релиза осталось:",
        counterTitle: "Скачиваний приложения по всему миру:"
    }
};

// ХРАНИЛИЩЕ УЧЕТНЫХ ЗАПИСЕЙ (Сгенерированные криптоустойчивые пароли ровно по 12 символов)
const ADMIN_USERS = {
    "crane_root": { password: "mZ9$vK2xQ7pW", twofaSecret: null, twofaVerified: false },
    "crane_dev":  { password: "bN4v%Z8qR2mX", twofaSecret: null, twofaVerified: false }
};

// База активных сессионных токенов (сбрасывается при перезапуске инстанса)
let activeSessions = new Set();

// Функция расширенного логирования для детекции потенциальных утечек
function logSecurityEvent(action, username, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const realIp = req.headers['x-real-ip'] || ip; 
    
    console.log(`[SECURITY EVENT] [${new Date().toISOString()}]`);
    console.log(`Действие: ${action} | Логин: ${username}`);
    console.log(`IP-адрес: ${realIp} | User-Agent: ${userAgent}`);
    console.log(`--------------------------------------------------`);
}

// --- ОТКРЫТЫЕ ИНТЕРФЕЙСЫ ЛЕНДИНГА ---
app.get('/api/get-site-data', (req, res) => res.json({ totalDownloads: siteData.totalDownloads, texts: siteData.texts }));
app.get('/api/get-visits', (req, res) => res.json({ totalVisits: siteData.totalVisits }));

app.post('/api/track-visit', (req, res) => {
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!siteData.visitedIPs.includes(clientIP)) {
        siteData.visitedIPs.push(clientIP);
        siteData.totalVisits++;
    }
    res.json({ success: true, totalVisits: siteData.totalVisits });
});

app.post('/api/increment-downloads', (req, res) => {
    siteData.totalDownloads++;
    res.json({ success: true, totalDownloads: siteData.totalDownloads });
});


// --- ЗАЩИЩЕННАЯ ЗОНА АДМИНИСТРИРОВАНИЯ ---

// Проверка 1-го фактора: Логин и Автоматический Пароль
app.post('/api/admin/login-password', (req, res) => {
    const { username, password } = req.body;
    
    if (!ADMIN_USERS[username] || ADMIN_USERS[username].password !== password) {
        logSecurityEvent("ОТКАЗ ВХОДА (Некорректные данные)", username, req);
        return res.status(401).json({ success: false, message: "Ошибка авторизации!" });
    }

    const user = ADMIN_USERS[username];

    // Если это первый вход — генерируем секретный ключ TOTP 2FA
    if (!user.twofaSecret) {
        const secret = speakeasy.generateSecret({ name: `CraneApp Core (${username})` });
        user.twofaSecret = secret.base32;
        
        // Превращаем секретный ключ в QR-код для Google Authenticator
        qrcode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
            return res.json({ success: true, step: "setup_2fa", qrCode: dataUrl });
        });
    } else {
        // Если 2FA уже привязан — просто запрашиваем 6-значный код
        return res.json({ success: true, step: "verify_2fa" });
    }
});

// Проверка 2-го фактора: Верификация TOTP-токена
app.post('/api/admin/verify-2fa', (req, res) => {
    const { username, code } = req.body;
    const user = ADMIN_USERS[username];

    if (!user || !user.twofaSecret) {
        return res.status(400).json({ success: false, message: "Пройдите первый этап авторизации!" });
    }

    const isCodeValid = speakeasy.totp.verify({
        secret: user.twofaSecret,
        encoding: 'base32',
        token: code,
        window: 1 // Окно рассинхронизации времени устройства ±30 секунд
    });

    if (!isCodeValid) {
        logSecurityEvent("ОТКАЗ 2FA (Неверный одноразовый код)", username, req);
        return res.status(412).json({ success: false, message: "Неверный код 2FA!" });
    }

    // Генерируем сессионный токен для авторизации последующих изменений
    const sessionToken = speakeasy.generateSecret({ length: 24 }).base32;
    activeSessions.add(sessionToken);

    logSecurityEvent("УСПЕШНАЯ АВТОРИЗАЦИЯ (2FA пройден)", username, req);
    res.json({ success: true, sessionToken });
});

// Сохранение изменений контента лендинга (Доступ закрыт без токена сессии)
app.post('/api/admin/update-site', (req, res) => {
    const { sessionToken, totalDownloads, totalVisits, texts } = req.body;

    if (!sessionToken || !activeSessions.has(sessionToken)) {
        return res.status(403).json({ success: false, message: "Ошибка доступа: сессия не валидна!" });
    }

    if (totalDownloads !== undefined) siteData.totalDownloads = parseInt(totalDownloads) || 0;
    if (totalVisits !== undefined) siteData.totalVisits = parseInt(totalVisits) || 0;
    if (texts) siteData.texts = { ...siteData.texts, ...texts };

    res.json({ success: true, message: "Контент успешно обновлен в памяти сервера!" });
});

app.get('/', (req, res) => res.send('CraneApp Security API Node'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Secure Server initialized on port ${PORT}`));

module.exports = app;