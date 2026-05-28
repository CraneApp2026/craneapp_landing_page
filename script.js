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
    // 2. СЧЕТЧИК СКАЧИВАНИЙ И МОДАЛЬНОЕ ОКНО
    // ========================================================
    const counterElement = document.querySelector('.stat-number');
    // Находим абсолютно все кнопки скачивания (Android, iOS, Windows, Linux)
    const platformButtons = document.querySelectorAll('.btn-download, [id*="download"] a, [id*="download"] button, .download-btn'); 
    const BACKEND_URL = 'https://craneapp-landing-page.vercel.app';

    // Элементы кастомного модального окна
    const modal = document.getElementById('release-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    let isSubmitting = false;

    // Функция для красивого обновления цифры на экране
    function updateScreenNumber(num) {
        if (counterElement) {
            counterElement.innerText = num.toLocaleString('ru-RU');
            counterElement.style.transform = 'scale(1.08)';
            counterElement.style.transition = 'transform 0.1s ease';
            setTimeout(() => counterElement.style.transform = 'scale(1)', 150);
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

    // Запрашиваем актуальное число скачиваний с Vercel при загрузке страницы
    fetch(`${BACKEND_URL}/api/get-downloads`)
        .then(res => res.json())
        .then(data => {
            if (data.totalDownloads !== undefined) {
                updateScreenNumber(data.totalDownloads);
            }
        })
        .catch(err => console.error('Ошибка получения данных скачиваний:', err));

    // Обработка клика по кнопкам платформ
    platformButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault(); // Запрещаем переход по ссылке-заглушке

            const releaseDate = new Date('2026-09-01T00:00:00');
            const currentDate = new Date(); 

            // Если релиз еще не наступил — показываем наше красивое окно и блокируем отправку
            if (currentDate < releaseDate) {
                if (modal) modal.classList.add('active');
                return; 
            }

            // --- Этот код сработает строго ПОСЛЕ 1 сентября 2026 года ---
            if (isSubmitting) return; // Защита от двойного клика (дребезга)
            isSubmitting = true;

            fetch(`${BACKEND_URL}/api/increment-downloads`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    updateScreenNumber(data.totalDownloads); // Обновляем счетчик на экране цифрой от сервера
                }
            })
            .catch(err => console.error('Ошибка отправки клика на сервер:', err))
            .finally(() => {
                // Разблокируем отправку кликов через 300мс
                setTimeout(() => { isSubmitting = false; }, 300);
            });
        });
    });
});