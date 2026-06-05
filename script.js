document.addEventListener('DOMContentLoaded', () => {
    // ========================================================
    // 1. ТАЙМЕР ОТСЧЕТА ДО РЕЛИЗА
    // ========================================================
    const targetDate = new Date('September 1, 2026 00:00:00').getTime();

    function updateCountdown() {
        const now = new Date().getTime();
        const difference = targetDate - now;

        if (difference <= 0) {
            document.getElementById('days').innerText = '00';
            document.getElementById('hours').innerText = '00';
            document.getElementById('minutes').innerText = '00';
            document.getElementById('seconds').innerText = '00';
            clearInterval(countdownInterval);
            return;
        }

        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        document.getElementById('days').innerText = days < 10 ? '0' + days : days;
        document.getElementById('hours').innerText = hours < 10 ? '0' + hours : hours;
        document.getElementById('minutes').innerText = minutes < 10 ? '0' + minutes : minutes;
        document.getElementById('seconds').innerText = seconds < 10 ? '0' + seconds : seconds;
    }

    updateCountdown();
    const countdownInterval = setInterval(updateCountdown, 1000);


    // ========================================================
    // 2. ДИНАМИЧЕСКИЙ СЧЕТЧИК, ТЕКСТЫ И МОДАЛЬНОЕ ОКНО
    // ========================================================
    const counterElement = document.querySelector('.stat-number');
    const platformButtons = document.querySelectorAll('.btn-download, [id*="download"] a, [id*="download"] button, .download-btn'); 
    const BACKEND_URL = 'https://craneapp-landing-page.vercel.app';

    const modal = document.getElementById('release-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    let isSubmitting = false;

    // Функция для красивого обновления цифры на экране (стиль Geologica)
    function updateScreenNumber(num) {
        if (counterElement) {
            counterElement.innerText = num.toLocaleString('ru-RU');
            counterElement.style.transform = 'scale(1.05)';
            counterElement.style.transition = 'transform 0.15s ease';
            setTimeout(() => {
                counterElement.style.transform = 'scale(1)';
            }, 150);
        }
    }

    // Логика закрытия модального окна
    if (modalCloseBtn && modal) {
        modalCloseBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    // А. Фиксируем посещение (счетчик уникальных заходов в админку)
    fetch(`${BACKEND_URL}/api/track-visit`, { method: 'POST' })
        .catch(err => console.error('Ошибка трекера заходов:', err));

    // Б. Загружаем динамические тексты и скачивания с бэкенда при входе на сайт
    fetch(`${BACKEND_URL}/api/get-site-data`)
        .then(res => res.json())
        .then(data => {

// 1. Помещаем саму функцию в файл (например, в самый конец или начало)
function updateFrontendContent(data) {
    if (!data || !data.texts) return;

    // Исправление для главного заголовка (теперь фиолетовое слово не ломается)
    const titleElement = document.getElementById('hero-title');
    if (titleElement && data.texts.heroTitle) {
        titleElement.innerHTML = data.texts.heroTitle; 
    }

    // Обновление подзаголовка
    const subtitleElement = document.getElementById('hero-subtitle');
    if (subtitleElement && data.texts.heroSubtitle) {
        subtitleElement.innerText = data.texts.heroSubtitle;
    }

    // Точечное разделение кнопок по их ID
    const headerBtn = document.getElementById('header-download-btn'); // Кнопка в шапке ("Скачать")
    const heroBtn = document.getElementById('hero-install-btn');     // Кнопка по центру ("Установить...")

    if (headerBtn && data.texts.btnHeaderDownload) {
        headerBtn.innerText = data.texts.btnHeaderDownload; 
    }
    if (heroBtn && data.texts.btnInstall) {
        heroBtn.innerText = data.texts.btnInstall; 
    }

    // Обновление счетчика скачиваний
    const downloadsCounter = document.getElementById('downloads-count');
    if (downloadsCounter && data.totalDownloads !== undefined) {
        downloadsCounter.innerText = data.totalDownloads;
    }
}

// 2. Вызываем эту функцию там, где ты получаешь данные от Vercel:
fetch('https://craneapp-landing-page.vercel.app/api/get-site-data') // тут твоя ссылка на бэкенд
    .then(res => res.json())
    .then(data => {
        // Просто передаем данные в нашу функцию обновления
        updateFrontendContent(data); 
    })
    .catch(err => console.error("Ошибка загрузки данных лендинга:", err));

            // Обновляем цифру скачиваний актуальным значением
            if (data.totalDownloads !== undefined) {
                updateScreenNumber(data.totalDownloads);
            }
            
            // Синхронизируем тексты на странице с тем, что сохранено в админке
            if (data.texts) {
                const h1 = document.querySelector('.hero h1, main h1, .main-screen h1');
                if (h1 && data.texts.heroTitle) h1.innerText = data.texts.heroTitle;

                const subtitle = document.querySelector('.hero p, main p, .main-screen p');
                if (subtitle && data.texts.heroSubtitle) subtitle.innerText = data.texts.heroSubtitle;

                const btnInstall = document.querySelector('.cta-header-btn, .btn-primary'); 
                if (btnInstall && data.texts.btnInstall) btnInstall.innerText = data.texts.btnInstall;

                const timerTitle = document.querySelector('.timer-title');
                if (timerTitle && data.texts.timerTitle) timerTitle.innerText = data.texts.timerTitle;

                const counterTitle = document.querySelector('.counter-title');
                if (counterTitle && data.texts.counterTitle) counterTitle.innerText = data.texts.counterTitle;
            }
        })
        .catch(err => console.error('Ошибка загрузки данных сайта:', err));

    // В. Обработка клика по кнопкам платформ
    platformButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault(); // Блокируем переход по пустой ссылке

            const releaseDate = new Date('2026-09-01T00:00:00');
            const currentDate = new Date(); 

            // Если релиз еще не наступил — активируем Liquid Glass поп-ап
            if (currentDate < releaseDate) {
                if (modal) modal.classList.add('active');
                return; 
            }

            // --- Этот код сработает строго после релиза ---
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
            .catch(err => console.error('Ошибка отправки клика на сервер:', err))
            .finally(() => {
                setTimeout(() => { isSubmitting = false; }, 300);
            });
        });
    });
});