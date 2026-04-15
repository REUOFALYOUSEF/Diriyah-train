document.addEventListener('DOMContentLoaded', () => {
    const questions = document.querySelectorAll('.faq-question');

    questions.forEach((question) => {
        question.addEventListener('click', () => {
            const isExpanded = question.getAttribute('aria-expanded') === 'true';
            const answer = question.nextElementSibling;
            const icon = question.querySelector('.faq-icon');

            question.setAttribute('aria-expanded', String(!isExpanded));

            if (answer) {
                answer.hidden = isExpanded;
            }

            if (icon) {
                icon.textContent = isExpanded ? '+' : '-';
            }
        });
    });
});
