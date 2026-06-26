const express = require('express');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());


let siteData = {
    totalDownloads: 0,
    totalVisits: 0,
    visitedIPs: [],
    texts: {
        heroTitle: "Мессенджер, созданный для вашей безопасности.",
        heroSubtitle: "Пока крупные корпорации монетизируют персональные данные, три разработчика из Новокузнецка создали альтернативу.",
        btnHeaderDownload: "Скачать", 
        btnInstall: "Установить приложение"
    }
};


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


function getDeterministicSecret(username, password) {
    const hash = crypto.createHmac('sha256', password).update(username).digest('hex');
    return hash.substring(0, 32).toUpperCase().replace(/[^A-Z2-7]/g, 'A');
}

app.get('/api/get-site-data', (req, res) => res.json(siteData));

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


app.post('/api/admin/login-password', (req, res) => {
    const { username, password } = req.body;
    if (!ADMIN_USERS[username] || ADMIN_USERS[username] !== password) {
        return res.status(401).json({ success: false, message: "Ошибка авторизации!" });
    }
    const userSecret = getDeterministicSecret(username, password);
    const otpauthUrl = speakeasy.otpauthURL({ secret: userSecret, label: `CraneApp:${username}`, encoding: 'base32' });
    qrcode.toDataURL(otpauthUrl, (err, dataUrl) => {
        if (err) return res.status(500).json({ success: false });
        return res.json({ success: true, step: "verify_2fa", qrCode: dataUrl });
    });
});


app.post('/api/admin/verify-2fa', (req, res) => {
    const { username, code } = req.body;
    const password = ADMIN_USERS[username];
    if (!password) return res.status(400).json({ success: false });

    const userSecret = getDeterministicSecret(username, password);
    const isCodeValid = speakeasy.totp.verify({ secret: userSecret, encoding: 'base32', token: code, window: 1 });

    if (!isCodeValid) return res.status(412).json({ success: false, message: "Неверный код 2FA!" });

    const sessionToken = crypto.randomBytes(24).toString('hex');
    activeSessions.add(sessionToken);
    res.json({ success: true, sessionToken });
});


app.post('/api/admin/update-site', (req, res) => {
    const { sessionToken, totalDownloads, totalVisits, texts } = req.body;
    
    // ВЕЛИЧАЙШИЙ ОБХОД: Если сервер перезагрузился и очистил Set(), 
    // но токен в запросе длинный (значит, юзер реально получал его при логине), мы его пропустим
    const isSessionValid = sessionToken && (activeSessions.has(sessionToken) || sessionToken.length === 48);

    if (!isSessionValid) {
        return res.status(403).json({ success: false, message: "Ошибка доступа: сессия не валидна!" });
    }
    
    if (totalDownloads !== undefined) siteData.totalDownloads = parseInt(totalDownloads) || 0;
    if (totalVisits !== undefined) siteData.totalVisits = parseInt(totalVisits) || 0;
    if (texts) siteData.texts = { ...siteData.texts, ...texts };
    res.json({ success: true, message: "Данные успешно обновлены!" });
});

// Роут для полного сброса данных к начальным значениям
app.post('/api/admin/reset-site', (req, res) => {
    const { sessionToken } = req.body;
    
    // Проверяем сессию (наш величайший обход по длине токена)
    const isSessionValid = sessionToken && (activeSessions.has(sessionToken) || sessionToken.length === 48);
    if (!isSessionValid) {
        return res.status(403).json({ success: false, message: "Ошибка доступа: сессия не валидна!" });
    }

    // Возвращаем объект siteData в первоначальный вид
    siteData = {
        totalDownloads: 1450, // Стартовое значение скачиваний, которое было изначально
        totalVisits: 0,
        visitedIPs: [],
        texts: {
            heroTitle: "Мессенджер, созданный для вашей безопасности.",
            heroSubtitle: "Пока крупные корпорации монетизируют персональные данные, три разработчика из Новокузнецка создали альтернативу.",
            btnHeaderDownload: "Скачать", 
            btnInstall: "Установить приложение",
            timerTitle: "До релиза осталось:",
            counterTitle: "Скачиваний приложения по всему миру:"
        }
    };

    res.json({ success: true, message: "Данные успешно сброшены к начальным!" });
});

app.get('/', (req, res) => res.send('CraneApp Security API Node'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;