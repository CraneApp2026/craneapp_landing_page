document.addEventListener("DOMContentLoaded", () => {
    
    // ========================================================
    // 1. КНОПКИ СКРОЛЛА (Шапка «Скачать» и кнопка «Установить» на главном экране)
    // ========================================================
    // Находим кнопку в меню и кнопку на первом экране
    const scrollButtons = document.querySelectorAll('.site-header .btn-download, header a[href="#download"], .nav-links a[href="#download"], .hero .btn-download, .btn-install');
    
    // Дополнительный умный поиск: ищем кнопку «Установить приложение» по её тексту, если нет классов
    const allButtons = document.querySelectorAll('button, a');
    const installBtnByText = Array.from(allButtons).find(el => {
        const text = el.textContent.trim().toLowerCase();
        return text.includes('установить') || text.includes('установить приложение');
    });

    // Собираем все кнопки скролла в один список
    const actionScrollButtons = Array.from(scrollButtons);
    if (installBtnByText && !actionScrollButtons.includes(installBtnByText)) {
        actionScrollButtons.push(installBtnByText);
    }

    // Навешиваем на них плавное центрирование секции
    actionScrollButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const downloadSection = document.querySelector('#download');
            
            if (downloadSection) {
                event.preventDefault(); // Отменяем резкий скачок страницы вверх
                
                // Плавно ставим секцию скачивания ровно по центру экрана
                downloadSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        });
    });

    
    });

  // ========================================================
    // 2. СЧЕТЧИК СКАЧИВАНИЙ (Кнопки платформ + сервер Vercel)
    // ========================================================
    const counterElement = document.querySelector('.stat-number');
    // Было: const platformButtons = document.querySelectorAll('#download ...');
    // Стало: ищем абсолютно все кнопки скачивания на странице по тексту и классам
    const platformButtons = document.querySelectorAll('.btn-download, [id*="download"] a, [id*="download"] button, .download-btn');

    // ВСТАВЛЯЕМ ТВОЮ ССЫЛКУ ОТ VERCEL СЮДА:
    const BACKEND_URL = 'https://craneapp-landing-page.vercel.app';

    // Подключаемся к серверу через сокеты по новому адресу
    const socket = io(BACKEND_URL); 

    socket.on('updateDownloads', (newCount) => {
        if (counterElement) {
            counterElement.innerText = newCount.toLocaleString('ru-RU');
            
            counterElement.style.transform = 'scale(1.08)';
            counterElement.style.transition = 'transform 0.1s ease';
            setTimeout(() => counterElement.style.transform = 'scale(1)', 150);
        }
    });

    // Делаем так, чтобы при клике на ЛЮБУЮ кнопку в секции #download отправлялся сигнал
    platformButtons.forEach(button => {
        button.addEventListener('click', () => {
            fetch(`${BACKEND_URL}/api/increment-downloads`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                console.log('Клик успешно засчитан сервером!', data);
            })
            .catch(err => console.error('Ошибка отправки клика:', err));
        });
    });

    // ========================================================
    // 3. ТАЙМЕР ОБРАТНОГО ОТСЧЕТА ДО 1 СЕНТЯБРЯ
    // ========================================================
    function initCountdown() {
        const currentYear = new Date().getFullYear();
        // Точное время запуска (00:00:00 по МСК)
        const targetDate = new Date(`${currentYear}-09-01T00:00:00+03:00`).getTime();

        const daysElement = document.getElementById('days');
        const hoursElement = document.getElementById('hours');
        const minutesElement = document.getElementById('minutes');
        const secondsElement = document.getElementById('seconds');

        function updateTimer() {
            const now = new Date().getTime();
            const difference = targetDate - now;

            if (difference < 0) {
                const timerBoard = document.querySelector('.timer-board');
                if (timerBoard) {
                    timerBoard.innerHTML = "<span class='timer-number' style='font-size: 28px;'>Релиз состоялся!</span>";
                }
                clearInterval(timerInterval);
                return;
            }

            const days = Math.floor(difference / (1000 * 60 * 60 * 24));
            const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((difference % (1000 * 60)) / 1000);

            if (daysElement) daysElement.innerText = days < 10 ? '0' + days : days;
            if (hoursElement) hoursElement.innerText = hours < 10 ? '0' + hours : hours;
            if (minutesElement) minutesElement.innerText = minutes < 10 ? '0' + minutes : minutes;
            if (secondsElement) secondsElement.innerText = seconds < 10 ? '0' + seconds : seconds;
        }

        updateTimer();
        const timerInterval = setInterval(updateTimer, 1000);
    }

    initCountdown();