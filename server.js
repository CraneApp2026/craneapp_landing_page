const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const ADMIN_PASSWORD = "crane_admin_2026"; 

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

// 1. Данные для лендинга
app.get('/api/get-site-data', (req, res) => {
    res.json({
        totalDownloads: siteData.totalDownloads,
        texts: siteData.texts
    });
});

// 2. Получить количество визитов для админки
app.get('/api/get-visits', (req, res) => {
    res.json({ totalVisits: siteData.totalVisits });
});

// 3. Трекер уникальных заходов
app.post('/api/track-visit', (req, res) => {
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!siteData.visitedIPs.includes(clientIP)) {
        siteData.visitedIPs.push(clientIP);
        siteData.totalVisits++;
    }
    res.json({ success: true, totalVisits: siteData.totalVisits });
});

// 4. Клик по кнопке "Скачать"
app.post('/api/increment-downloads', (req, res) => {
    siteData.totalDownloads++;
    res.json({ success: true, totalDownloads: siteData.totalDownloads });
});

// 5. Обновление из админки
app.post('/api/admin/update-site', (req, res) => {
    const { password, totalDownloads, totalVisits, texts } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, message: "Неверный пароль!" });
    }

    if (totalDownloads !== undefined) siteData.totalDownloads = parseInt(totalDownloads) || 0;
    if (totalVisits !== undefined) siteData.totalVisits = parseInt(totalVisits) || 0;
    if (texts) siteData.texts = { ...siteData.texts, ...texts };

    res.json({ success: true, message: "Данные сайта успешно обновлены!" });
}
);

// Базовый роут, чтобы Vercel не выдавал ошибку на главной
app.get('/', (req, res) => {
    res.send('CraneApp Backend API is running...');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;