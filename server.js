const express = require('express');
const cors = require('cors');
const app = express();


app.use(cors({ origin: '*' }));
app.use(express.json());


let totalDownloads = 0; 


app.get('/api/get-downloads', (req, res) => {
    res.json({ totalDownloads });
});


app.post('/api/increment-downloads', (req, res) => {
    totalDownloads++;
    res.json({ success: true, totalDownloads });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

module.exports = app;