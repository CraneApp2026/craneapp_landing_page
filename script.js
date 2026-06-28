document.addEventListener('DOMContentLoaded', () => {

    const targetDate = new Date('September 1, 2026 00:00:00').getTime();

    // Объявляем интервал заранее (let, не const), чтобы updateCountdown
    // мог безопасно обратиться к нему даже при самом первом вызове —
    // раньше тут была ReferenceError при разнице времени <= 0,
    // потому что countdownInterval ещё не существовал на момент
    // первого updateCountdown().
    let countdownInterval;

    function updateCountdown() {
        const now = new Date().getTime();
        const difference = targetDate - now;

        if (difference <= 0) {
            document.getElementById('days').innerText = '00';
            document.getElementById('hours').innerText = '00';
            document.getElementById('minutes').innerText = '00';
            document.getElementById('seconds').innerText = '00';
            if (countdownInterval) clearInterval(countdownInterval);
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
    countdownInterval = setInterval(updateCountdown, 1000);

    const counterElement = document.querySelector('.stat-number');

    // Абсолютный URL, так как фронтенд (GitHub Pages) и бэкенд (Vercel)
    // задеплоены на разных доменах — относительный путь здесь не сработает.
    const BACKEND_URL = 'https://craneapp-landing-page.vercel.app';

    const modal = document.getElementById('release-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    let isSubmitting = false;

    const platformButtons = document.querySelectorAll('.btn-download');

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
        .then(res => {
            if (!res.ok) throw new Error('Ошибка сервера при получении данных');
            return res.json();
        })
        .then(data => {
            if (!data) return;

            if (data.totalDownloads !== undefined) {
                updateScreenNumber(data.totalDownloads);
            } else {
                updateScreenNumber(0);
            }

            if (data.texts) {
                // Используем textContent вместо innerHTML — текст с сервера
                // не должен интерпретироваться как HTML (риск XSS, если
                // кто-то получит доступ к админке или обойдёт её защиту).
                // Подсветку слова "вашей" делаем через DOM, а не через
                // вставку сырого HTML-фрагмента.
                const h1 = document.querySelector('.hero h1, main h1, .main-screen h1');
                if (h1 && data.texts.heroTitle) {
                    const title = data.texts.heroTitle;
                    const marker = 'вашей';
                    const idx = title.indexOf(marker);

                    h1.textContent = '';
                    if (idx === -1) {
                        h1.textContent = title;
                    } else {
                        h1.append(
                            document.createTextNode(title.slice(0, idx)),
                            Object.assign(document.createElement('span'), {
                                style: 'color:#a855f7',
                                textContent: title.slice(idx, idx + marker.length)
                            }),
                            document.createTextNode(title.slice(idx + marker.length))
                        );
                    }
                }

                const subtitle = document.querySelector('.hero p, main p, .main-screen p');
                if (subtitle && data.texts.heroSubtitle) {
                    subtitle.textContent = data.texts.heroSubtitle;
                }

                const headerBtn = document.querySelector('.cta-header-btn');
                if (headerBtn) {
                    headerBtn.textContent = 'Скачать';
                }

                const heroBtn = document.querySelector('.btn-primary');
                if (heroBtn && data.texts.btnInstall) {
                    heroBtn.textContent = data.texts.btnInstall;
                }

                const timerTitle = document.querySelector('.timer-title');
                if (timerTitle && data.texts.timerTitle) {
                    timerTitle.textContent = data.texts.timerTitle;
                }

                const counterTitle = document.querySelector('.counter-title');
                if (counterTitle && data.texts.counterTitle) {
                    counterTitle.textContent = data.texts.counterTitle;
                }
            }
        })
        .catch(err => console.error('Локальный режим безопасности (Сервер офлайн):', err));

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

// Вынесено в отдельный, независимый блок — раньше этот код был случайно
// вложен внутрь обработчика клика по кнопкам платформ (внутри predicate
// выше), из-за чего кнопка "наверх" настраивалась бы только после первого
// клика по кнопке скачивания, а не сразу при загрузке страницы.
document.addEventListener('DOMContentLoaded', () => {
    try {
        const scrollTopBtn = document.getElementById('scroll-to-top');
        const benefitsSection = document.getElementById('benefits');

        if (scrollTopBtn && benefitsSection) {
            // Кнопка появляется, как только верхняя граница #benefits
            // оказывается выше нижней границы экрана (то есть секция
            // "Почему нам доверяют" хотя бы немного видна), и остаётся
            // видимой при дальнейшем скролле, скрываясь только если
            // вернулись выше этой точки.
            const checkScrollPosition = () => {
                const benefitsTop = benefitsSection.getBoundingClientRect().top;
                if (benefitsTop <= window.innerHeight) {
                    scrollTopBtn.classList.add('visible');
                } else {
                    scrollTopBtn.classList.remove('visible');
                }
            };

            window.addEventListener('scroll', checkScrollPosition);
            checkScrollPosition(); // на случай, если страница открыта не с самого верха

            scrollTopBtn.addEventListener('click', () => {
                document.getElementById('home').scrollIntoView({ behavior: 'smooth' });
            });
        } else if (scrollTopBtn) {
            // Запасной вариант, если секция #benefits почему-то не найдена —
            // используем старое поведение по порогу скролла, чтобы кнопка
            // в любом случае не осталась полностью нерабочей.
            window.addEventListener('scroll', () => {
                if (window.scrollY > 300) {
                    scrollTopBtn.classList.add('visible');
                } else {
                    scrollTopBtn.classList.remove('visible');
                }
            });

            scrollTopBtn.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
    } catch (e) {
        console.error(e);
    }
});
