const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Разрешаем доступ твоему сайту на GitHub Pages
        methods: ["GET", "POST"]
    }
});

// Переменная для хранения кликов
let totalDownloads = 0;

// Чтобы сервер умел читать JSON-запросы
app.use(express.json());

// 1. Делаем так, чтобы главная страница сервера отвечала текстом (для проверки)
app.get('/', (req, res) => {
    res.send(`Сервер CraneApp запущен! Текущие скачивания: ${totalDownloads}`);
});

// 2. Маршрут (API) для увеличения счетчика
app.post('/api/increment-downloads', (req, res) => {
    totalDownloads++;
    io.emit('updateDownloads', totalDownloads); // Отправляем новую цифру всем по сокетам
    res.json({ success: true, totalDownloads });
});

// Сокет-соединение: выдаем цифру сразу при подключении устройства
io.on('connection', (socket) => {
    socket.emit('updateDownloads', totalDownloads);
});

// Настройка порта для Vercel / локального ПК
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
});

// Экспортируем модуль для корректной работы Vercel
module.exports = http;