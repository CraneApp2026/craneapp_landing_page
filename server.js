const express = require('express');
const cors = require('cors');
const app = express();

// Включаем CORS-разрешение для Гитхаба
app.use(cors({ origin: '*' }));
app.use(express.json());

// Временная переменная для хранения кликов (в памяти сервера)
let totalDownloads = 1542; // Можешь поставить стартовое число, чтобы не был полный 0!

// 1. Получить текущее число скачиваний (вызывается при загрузке сайта)
app.get('/api/get-downloads', (req, res) => {
    res.json({ totalDownloads });
});

// 2. Увеличить число скачиваний (вызывается при клике на кнопку)
app.post('/api/increment-downloads', (req, res) => {
    totalDownloads++;
    res.json({ success: true, totalDownloads });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

module.exports = app;