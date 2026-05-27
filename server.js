const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } 
});

// Стартовое число скачиваний
// Теперь отсчет начнется строго с нуля
let totalDownloads = 0;

// Маршрут для увеличения счетчика при клике на кнопку
app.post('/api/increment-downloads', (req, res) => {
    totalDownloads += 1;
    io.emit('updateDownloads', totalDownloads); // Отправляем всем сокетам новое число
    res.status(200).json({ success: true, current: totalDownloads });
});

// Отправка текущего числа при подключении нового юзера
io.on('connection', (socket) => {
    socket.emit('updateDownloads', totalDownloads);
});

// Находим порт, который дает хостинг Vercel, а если его нет (на ПК) — берем 3000
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Сервер успешно запущен и слушает порт ${PORT}`);
});