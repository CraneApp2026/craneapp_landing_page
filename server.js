const express = require('express');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// БАЗА ДАННЫХ ЛЕНДИНГА (Полная структура со всеми текстами и кнопками)
let siteData = {
    totalDownloads: 0,
    totalVisits: 0,
    visitedIPs: [],
    texts: {
        // Тег span внутри строки — теперь фронтенд отобразит его правильно
        heroTitle: "Мессенджер, созданный для <span class=\"text-purple\">вашей</span> безопасности.",
        heroSubtitle: "Пока крупные корпорации монетизируют персональные данные, три разработчика из Новокузнецка создали альтернативу.",
        btnHeaderDownload: "Скачать", 
        btnInstall: "Установить приложение",
        btnHowItWorks: "Как это работает?",
        timerTitle: "До релиза осталось:",
        counterTitle: "Скачиваний приложения по всему миру:",
        menuLink1: "Главная",
        menuLink2: "Плюсы",
        menuLink3: "Инструкция"
    }
};

// ХРАНИЛИЩЕ УЧЕТНЫХ ЗАПИСЕЙ АДМИНИСТРАТОРОВ (Вечный 2FA на основе логина и пароля)
const ADMIN_USERS = {
    "math_solvers": "mZ9$vK2xQ7pW_math",
    "loikbruni":     "bR8!nX4vL1pQ_loik",
    "zhuroffa":      "zH3#fW9tK5mY_zhur",
    "khazatsky":     "kH2@qN7zX4sV_khaz",
    "saimoncinema":  "sC5&mL1vR9pW_saim",
    "mezz1k":        "mZ4*pX8vK2qN_mezz",
    "err412":        "eR7%vW1xQ9pL_err4"
};

let activeSessions = new Set();

// Генератор уникального неизменяемого 2FA секрета
function getDeterministicSecret(username, password) {
    const hash = crypto.createHmac('sha256', password).update(username).digest('hex');
    return hash.substring(0, 32).toUpperCase().replace(/[^A-Z2-7]/g, 'A');
}

function logSecurityEvent(action, username, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const realIp = req.headers['x-real-ip'] || ip; 
    console.log(`[SECURITY EVENT] [${new Date().toISOString()}] Действие: ${action} | Логин: ${username} | IP: ${realIp}`);
}

// --- ОТКРЫТЫЕ ИНТЕРФЕЙСЫ ДЛЯ ЛЕНДИНГА ---
app.get('/api/get-site-data', (req, res) => res.json(siteData));
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

// --- АДМИНКА: СЕССИИ И АВТОРИЗАЦИЯ ---

app.post('/api/admin/login-password', (req, res) => {
    const { username, password } = req.body;
    
    if (!ADMIN_USERS[username] || ADMIN_USERS[username] !== password) {
        logSecurityEvent("ОТКАЗ ВХОДА", username, req);
        return res.status(401).json({ success: false, message: "Ошибка авторизации!" });
    }

    const userSecret = getDeterministicSecret(username, password);
    const otpauthUrl = speakeasy.otpauthURL({
        secret: userSecret,
        label: `CraneApp:${username}`,
        encoding: 'base32'
    });
    
    qrcode.toDataURL(otpauthUrl, (err, dataUrl) => {
        if (err) return res.status(500).json({ success: false });
        // Возвращаем шаг verify_2fa, чтобы фронтенд переключался на форму ввода цифр
        return res.json({ success: true, step: "verify_2fa", qrCode: dataUrl });
    });
});

app.post('/api/admin/verify-2fa', (req, res) => {
    const { username, code } = req.body;
    const password = ADMIN_USERS[username];

    if (!password) return res.status(400).json({ success: false });

    const userSecret = getDeterministicSecret(username, password);
    const isCodeValid = speakeasy.totp.verify({
        secret: userSecret,
        encoding: 'base32',
        token: code,
        window: 1
    });

    if (!isCodeValid) {
        logSecurityEvent("НЕВЕРНЫЙ 2FA КОД", username, req);
        return res.status(412).json({ success: false, message: "Неверный код 2FA!" });
    }

    // Создаем сессионный токен изменений
    const sessionToken = crypto.randomBytes(24).toString('hex');
    activeSessions.add(sessionToken);

    logSecurityEvent("ВХОД УСПЕШЕН", username, req);
    res.json({ success: true, sessionToken });
});

app.post('/api/admin/update-site', (req, res) => {
    const { sessionToken, totalDownloads, totalVisits, texts } = req.body;

    // Валидация сессии
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