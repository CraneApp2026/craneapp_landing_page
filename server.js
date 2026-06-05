const express = require('express');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// БАЗА ДАННЫХ ЛЕНДИНГА (Теперь админы могут редактировать абсолютно любое поле отсюда!)
// БАЗА ДАННЫХ ЛЕНДИНГА (Исправленная и расширенная)
let siteData = {
    totalDownloads: 1450,
    totalVisits: 3820,
    visitedIPs: [],
    texts: {
        // Оборачиваем слово в тег span прямо здесь, чтобы при обновлении оно оставалось фиолетовым!
        heroTitle: "Мессенджер, созданный для <span class=\"text-purple\">вашей</span> безопасности.",
        heroSubtitle: "Пока крупные корпорации монетизируют персональные данные, три разработчика из Новокузнецка создали альтернативу.",
        btnInstall: "Установить приложение",      // Для главной кнопки
        btnHeaderDownload: "Скачать",             // ОТДЕЛЬНЫЙ КЛЮЧ для кнопки в шапке!
        btnHowItWorks: "Как это работает?",
        timerTitle: "До релиза осталось:",
        counterTitle: "Скачиваний приложения по всему миру:"
    }
};

// ХРАНИЛИЩЕ УЧЕТНЫХ ЗАПИСЕЙ АДМИНИСТРАТОРОВ
const ADMIN_USERS = {
    "math_solvers": "mZ9$vK2xQ7pW_math",
    "loikbruni":     "bR8!nX4vL1pQ_loik",
    "zhuroffa":      "zH3#fW9tK5mY_zhur",
    "khazatsky":     "kH2@qN7zX4sV_khaz",
    "saimoncinema":  "sC5&mL1vR9pW_saim",
    "mezz1k":        "mZ4*pX8vK2qN_mezz",
    "err412":        "eR7%vW1xQ9pL_err4"
};

// База активных сессионных токенов
let activeSessions = new Set();

// Функция генерации вечного 2FA-секрета
function getDeterministicSecret(username, password) {
    const hash = crypto.createHmac('sha256', password).update(username).digest('hex');
    return hash.substring(0, 32).toUpperCase().replace(/[^A-Z2-7]/g, 'A');
}

// Расширенное логирование безопасности
function logSecurityEvent(action, username, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const realIp = req.headers['x-real-ip'] || ip; 
    
    console.log(`[SECURITY EVENT] [${new Date().toISOString()}]`);
    console.log(`Действие: ${action} | Логин: ${username}`);
    console.log(`IP-адрес: ${realIp} | User-Agent: ${userAgent}`);
    console.log(`--------------------------------------------------`);
}

// --- ОТКРЫТЫЕ ИНТЕРФЕЙСЫ ДЛЯ СЛИТИЯ ДАННЫХ НА ЛЕНДИНГ ---
app.get('/api/get-site-data', (req, res) => {
    res.json(siteData);
});

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

// 1. Проверка логина и пароля
app.post('/api/admin/login-password', (req, res) => {
    const { username, password } = req.body;
    
    if (!ADMIN_USERS[username] || ADMIN_USERS[username] !== password) {
        logSecurityEvent("ОТКАЗ ВХОДА (Некорректные данные)", username, req);
        return res.status(401).json({ success: false, message: "Ошибка авторизации!" });
    }

    const userSecret = getDeterministicSecret(username, password);
    const otpauthUrl = speakeasy.otpauthURL({
        secret: userSecret,
        label: `CraneApp:${username}`,
        encoding: 'base32'
    });
    
    qrcode.toDataURL(otpauthUrl, (err, dataUrl) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Ошибка генерации QR-кода" });
        }
        // Возвращаем шаг verify_2fa, чтобы фронтенд сразу переходил к форме ввода цифр и ожидал сессию
        return res.json({ success: true, step: "verify_2fa", qrCode: dataUrl });
    });
});

// 2. Верификация TOTP-токена с выдачей сессии
app.post('/api/admin/verify-2fa', (req, res) => {
    const { username, code } = req.body;
    const password = ADMIN_USERS[username];

    if (!password) {
        return res.status(400).json({ success: false, message: "Пройдите первый этап авторизации!" });
    }

    const userSecret = getDeterministicSecret(username, password);

    const isCodeValid = speakeasy.totp.verify({
        secret: userSecret,
        encoding: 'base32',
        token: code,
        window: 1
    });

    if (!isCodeValid) {
        logSecurityEvent("ОТКАЗ 2FA (Неверный одноразовый код)", username, req);
        return res.status(412).json({ success: false, message: "Неверный код 2FA!" });
    }

    // Создаем сессионный токен
    const sessionToken = crypto.randomBytes(24).toString('hex');
    activeSessions.add(sessionToken);

    logSecurityEvent("УСПЕШНАЯ АВТОРИЗАЦИЯ (2FA пройден)", username, req);
    
    // Возвращаем токен на фронтенд
    res.json({ success: true, sessionToken });
});

// 3. Сохранение ЛЮБЫХ правок контента лендинга
app.post('/api/admin/update-site', (req, res) => {
    const { sessionToken, totalDownloads, totalVisits, texts } = req.body;

    // Жесткая проверка токена сессии
    if (!sessionToken || !activeSessions.has(sessionToken)) {
        return res.status(403).json({ success: false, message: "Ошибка доступа: сессия не валидна!" });
    }

    // Позволяем обновлять счетчики напрямую из админки
    if (totalDownloads !== undefined) siteData.totalDownloads = parseInt(totalDownloads) || 0;
    if (totalVisits !== undefined) siteData.totalVisits = parseInt(totalVisits) || 0;
    
    // Позволяем обновлять любые тексты (включая новые поля, если ты их добавишь в форму HTML)
    if (texts) {
        siteData.texts = {
            ...siteData.texts,
            ...texts
        };
    }

    res.json({ success: true, message: "Контент успешно обновлен в памяти сервера!" });
});

app.get('/', (req, res) => res.send('CraneApp Security API Node'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Secure Server initialized on port ${PORT}`));

module.exports = app;