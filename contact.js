var firestore = window.fsdb || (firebase.firestore ? firebase.firestore() : null);

function getTrimmedValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
}

function showInquiryError(message) {
    var errorEl = document.getElementById('inquiryError');
    if (!errorEl) return;
    errorEl.textContent = message || '';
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function setSubmitLoading(isLoading) {
    var btn = document.getElementById('sendInquiryBtn');
    if (!btn) return;

    btn.disabled = Boolean(isLoading);
    btn.classList.toggle('loading', Boolean(isLoading));
}

function notifySuccess(message) {
    if (window.AppNotify && typeof window.AppNotify.success === 'function') {
        window.AppNotify.success(message);
        return;
    }
    alert(message);
}

function notifyError(error, fallbackMessage) {
    if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
        window.AppNotify.handleError(error, fallbackMessage);
        return;
    }
    alert(fallbackMessage || 'Could not send your message. Please try again.');
}

function initInquiryForm() {
    var form = document.getElementById('inquiryForm');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        showInquiryError('');

        var fullName = getTrimmedValue('inqFullName');
        var email = getTrimmedValue('inqEmail');
        var subject = getTrimmedValue('inqSubject');
        var message = getTrimmedValue('inqMessage');

        if (!fullName || !email || !subject || !message) {
            showInquiryError('Please fill in all fields before sending your message.');
            return;
        }

        if (!isValidEmail(email)) {
            showInquiryError('Please enter a valid email address.');
            return;
        }

        if (!firestore) {
            showInquiryError('Inquiry service is temporarily unavailable. Please try again shortly.');
            return;
        }

        setSubmitLoading(true);

        try {
            var inquiryRef = firestore.collection('inquiries').doc();
            await inquiryRef.set({
                inquiryId: inquiryRef.id,
                fullName: fullName,
                email: email,
                subject: subject,
                message: message,
                createdAt: new Date().toISOString(),
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            });

            form.reset();
            notifySuccess('Thank you! Your inquiry has been sent to the administrator.');
        } catch (error) {
            notifyError(error, 'Could not send your message. Please try again.');
        } finally {
            setSubmitLoading(false);
        }
    });
}

initInquiryForm();
