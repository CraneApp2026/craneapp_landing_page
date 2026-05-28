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
    // 2. СЧЕТЧИК СКАЧИВАНИЙ (Защита от кликов до 1 сентября)
    // ========================================================
    const counterElement = document.querySelector('.stat-number');
    const platformButtons = document.querySelectorAll('.btn-download, [id*="download"] a, [id*="download"] button, .download-btn'); 
    const BACKEND_URL = 'https://craneapp-landing-page.vercel.app';

    let isSubmitting = false;

    // Функция для обновления цифры на экране
    function updateScreenNumber(num) {
        if (counterElement) {
            counterElement.innerText = num.toLocaleString('ru-RU');
        }
    }

    // Запрашиваем число скачиваний при загрузке страницы
    fetch(`${BACKEND_URL}/api/get-downloads`)
        .then(res => res.json())
        .then(data => {
            if (data.totalDownloads !== undefined) {
                updateScreenNumber(data.totalDownloads);
            }
        })
        .catch(err => console.error('Ошибка получения данных:', err));

    // Обработка клика по кнопкам с проверкой даты
    platformButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            // Отменяем стандартный переход по ссылке, если он есть
            event.preventDefault(); 

            // Настраиваем дату релиза: 1 сентября 2026 года
            const releaseDate = new Date('2026-09-01T00:00:00');
            const currentDate = new Date(); // Текущее время пользователя

            // Если релиз еще не наступил — блокируем клик
            if (currentDate < releaseDate) {
                alert('Релиз CraneApp состоится 1 сентября 2026 года! Скачивание будет доступно автоматически.');
                return; // Прерываем выполнение кода, на сервер ничего не отправляется
            }

            // --- КОД НИЖЕ СРАБОТАЕТ ТОЛЬКО ПОСЛЕ 1 СЕНТЯБРЯ ---
            if (isSubmitting) return;
            isSubmitting = true;

            fetch(`${BACKEND_URL}/api/increment-downloads`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    updateScreenNumber(data.totalDownloads);
                }
            })
            .catch(err => console.error('Ошибка отправки клика:', err))
            .finally(() => {
                setTimeout(() => { isSubmitting = false; }, 300);
            });
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