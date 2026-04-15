(function () {
    if (window.AppNotify) return;

    var container = null;
    var styleInjected = false;

    function injectStyles() {
        if (styleInjected) return;
        styleInjected = true;

        var style = document.createElement('style');
        style.textContent = [
            '.app-notify-stack{position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:min(92vw,420px);pointer-events:none;}',
            '.app-notify-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid rgba(0,0,0,0.08);background:#ffffff;color:#2b2b2b;box-shadow:0 10px 28px rgba(0,0,0,0.16);font:500 14px/1.4 Inter,Segoe UI,Arial,sans-serif;animation:appNotifyIn .18s ease-out;}',
            '.app-notify-toast strong{display:block;font-size:13px;margin-bottom:2px;}',
            '.app-notify-toast button{margin-left:auto;border:none;background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer;opacity:.75;}',
            '.app-notify-toast button:hover{opacity:1;}',
            '.app-notify-toast.info{border-left:4px solid #2563eb;}',
            '.app-notify-toast.success{border-left:4px solid #1b7c42;}',
            '.app-notify-toast.warning{border-left:4px solid #b45309;}',
            '.app-notify-toast.error{border-left:4px solid #b91c1c;}',
            '@keyframes appNotifyIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}'
        ].join('');
        document.head.appendChild(style);
    }

    function ensureContainer() {
        if (container && document.body.contains(container)) {
            return container;
        }

        injectStyles();
        container = document.createElement('div');
        container.className = 'app-notify-stack';
        document.body.appendChild(container);
        return container;
    }

    function codeFromError(error) {
        return String(error && (error.code || error.name) || '').toLowerCase();
    }

    function friendlyMessage(error, fallback) {
        var code = codeFromError(error);

        if (code.indexOf('permission-denied') !== -1) return 'You do not have permission to perform this action.';
        if (code.indexOf('network-request-failed') !== -1) return 'Network issue detected. Check your internet connection and try again.';
        if (code.indexOf('unavailable') !== -1) return 'Service is temporarily unavailable. Please try again shortly.';
        if (code.indexOf('timeout') !== -1) return 'The request timed out. Please try again.';
        if (code.indexOf('too-many-requests') !== -1) return 'Too many requests. Please wait a moment and try again.';

        if (error && typeof error.message === 'string' && error.message.trim()) {
            return error.message;
        }

        return fallback || 'Something went wrong. Please try again.';
    }

    function show(type, message, options) {
        var opts = options || {};
        var kind = type || 'info';
        var text = String(message || '');

        if (!text) return;

        var stack = ensureContainer();
        var toast = document.createElement('div');
        toast.className = 'app-notify-toast ' + kind;

        var titleMap = {
            info: 'Info',
            success: 'Success',
            warning: 'Warning',
            error: 'Error'
        };

        toast.innerHTML =
            '<div>' +
                '<strong>' + (opts.title || titleMap[kind] || 'Notice') + '</strong>' +
                '<span>' + text + '</span>' +
            '</div>' +
            '<button type="button" aria-label="Dismiss notification">x</button>';

        var closeBtn = toast.querySelector('button');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            });
        }

        stack.appendChild(toast);

        var timeoutMs = Number(opts.durationMs);
        if (!Number.isFinite(timeoutMs)) {
            timeoutMs = kind === 'error' ? 6000 : 4000;
        }

        window.setTimeout(function () {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, Math.max(1500, timeoutMs));
    }

    function handleError(error, fallback) {
        console.error(error);
        show('error', friendlyMessage(error, fallback), { title: 'Request Failed' });
    }

    window.AppNotify = {
        show: show,
        info: function (message, options) { show('info', message, options); },
        success: function (message, options) { show('success', message, options); },
        warning: function (message, options) { show('warning', message, options); },
        error: function (message, options) { show('error', message, options); },
        friendlyMessage: friendlyMessage,
        handleError: handleError
    };

    window.handleAppError = handleError;

    if (!window.__nativeAlert) {
        window.__nativeAlert = window.alert.bind(window);
    }

    window.alert = function (message) {
        show('warning', String(message || 'Action required.'), { title: 'Notice' });
    };

    window.addEventListener('error', function (event) {
        if (!event) return;

        var error = event.error || new Error(event.message || 'Unexpected application error.');
        handleError(error, 'Unexpected issue occurred. Please refresh the page.');
    });

    window.addEventListener('unhandledrejection', function (event) {
        var reason = event && Object.prototype.hasOwnProperty.call(event, 'reason') ? event.reason : null;
        handleError(reason, 'A request failed unexpectedly. Please try again.');
    });

    window.addEventListener('offline', function () {
        show('warning', 'You are offline. Some features may not work until internet is restored.', { title: 'Connection Lost', durationMs: 7000 });
    });

    window.addEventListener('online', function () {
        show('success', 'Connection restored. You can continue using the app.', { title: 'Back Online', durationMs: 4500 });
    });
})();
