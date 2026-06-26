document.addEventListener('DOMContentLoaded', () => {
    
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

    const counterElement = document.querySelector('.stat-number');
    const platformButtons = document.querySelectorAll('.btn-download, [id*="download"] a, [id*="download"] button, .download-btn'); 
    const BACKEND_URL = 'https://craneapp-landing-page.vercel.app';

    const modal = document.getElementById('release-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    let isSubmitting = false;

    
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

   
    if (modalCloseBtn && modal) {
        modalCloseBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    
    fetch(`${BACKEND_URL}/api/track-visit`, { method: 'POST' })
        .catch(err => console.error('Ошибка трекера заходов:', err));

    
    fetch(`${BACKEND_URL}/api/get-site-data`)
        .then(res => res.json())
        .then(data => {
            // 1. Обновляем счетчик скачиваний
            if (data.totalDownloads !== undefined) {
                updateScreenNumber(data.totalDownloads);
            } else {
                updateScreenNumber(0);
            }

            // 2. Обновляем все тексты, если они пришли с сервера
            if (data.texts) {
                const h1 = document.querySelector('.hero h1, main h1, .main-screen h1');
                if (h1 && data.texts.heroTitle) {
                    // Подставляем фиолетовый цвет напрямую для слова "вашей"
                    h1.innerHTML = data.texts.heroTitle.replace('вашей', '<span style="color: #a855f7;">вашей</span>');
                }

                const subtitle = document.querySelector('.hero p, main p, .main-screen p');
                if (subtitle && data.texts.heroSubtitle) {
                    subtitle.innerText = data.texts.heroSubtitle;
                }

                const headerBtn = document.querySelector('.cta-header-btn');
                if (headerBtn) {
                    headerBtn.innerText = 'Скачать';
                }

                const heroBtn = document.querySelector('.btn-primary');
                if (heroBtn && data.texts.btnInstall) {
                    heroBtn.innerText = data.texts.btnInstall;
                }

                const timerTitle = document.querySelector('.timer-title');
                if (timerTitle && data.texts.timerTitle) {
                    timerTitle.innerText = data.texts.timerTitle;
                }

                const counterTitle = document.querySelector('.counter-title');
                if (counterTitle && data.texts.counterTitle) {
                    counterTitle.innerText = data.texts.counterTitle;
                }
            }
        })
        .catch(err => console.error('Ошибка загрузки данных сайта:', err));

    
    platformButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();

            const releaseDate = new Date('2026-09-01T00:00:00');
            const currentDate = new Date(); 

            
            if (currentDate < releaseDate) {
                if (modal) modal.classList.add('active');
                return; 
            }

            if (isSubmitting) return; 
            isSubmitting = true;

            fetch(`${BACKEND_URL}/api/increment-downloads`, {
                method: 'POST'
            })
            .then(res => res.json())
            .catch(err => console.error('Ошибка отправки клика на server:', err))
            .finally(() => {
                setTimeout(() => { isSubmitting = false; }, 300);
            });
        });
    });
});