(function () {
    if (window.RoleRouting) return;

    var STORAGE_KEY = 'dtms_user_role';

    function normalizeRole(role) {
        var val = String(role || '').trim().toLowerCase();
        if (val === 'admin' || val === 'staff' || val === 'passenger') return val;
        return 'passenger';
    }

    function getStoredRole() {
        try {
            var local = window.localStorage.getItem(STORAGE_KEY);
            if (local) return normalizeRole(local);
        } catch (_err1) {}

        try {
            var session = window.sessionStorage.getItem(STORAGE_KEY);
            if (session) return normalizeRole(session);
        } catch (_err2) {}

        return 'passenger';
    }

    function storeRole(role) {
        var normalized = normalizeRole(role);
        try { window.localStorage.setItem(STORAGE_KEY, normalized); } catch (_err1) {}
        try { window.sessionStorage.setItem(STORAGE_KEY, normalized); } catch (_err2) {}
        return normalized;
    }

    function clearStoredRole() {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (_err1) {}
        try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (_err2) {}
    }

    function routeToRoleHome(role) {
        var normalized = normalizeRole(role);
        storeRole(normalized);

        if (normalized === 'admin') {
            window.location.href = 'admin.html';
            return;
        }
        if (normalized === 'staff') {
            window.location.href = 'staff-dashboard.html';
            return;
        }
        window.location.href = 'booking.html';
    }

    async function roleFromTokenClaims(user) {
        if (!user || typeof user.getIdTokenResult !== 'function') return '';

        try {
            var token = await user.getIdTokenResult(true);
            var claims = (token && token.claims) || {};

            if (claims.role) {
                return normalizeRole(claims.role);
            }
            if (claims.admin === true) {
                return 'admin';
            }
            if (claims.staff === true) {
                return 'staff';
            }
        } catch (_err) {}

        return '';
    }

    async function roleFromFirestore(user) {
        var fsdb = window.fsdb;
        if (!fsdb || !user || !user.uid || typeof fsdb.collection !== 'function') return '';

        try {
            var doc = await fsdb.collection('users').doc(user.uid).get();
            if (!doc.exists) return '';
            var data = doc.data() || {};
            if (data.isAdmin === true) return 'admin';
            return normalizeRole(data.role || '');
        } catch (_err) {
            return '';
        }
    }

    async function roleFromRealtimeDb(user) {
        var rtdb = window.rtdb;
        if (!rtdb || !user || !user.uid || typeof rtdb.ref !== 'function') return '';

        try {
            var snapshot = await rtdb.ref('users/' + user.uid).once('value');
            if (!snapshot.exists()) return '';
            var data = snapshot.val() || {};
            if (data.isAdmin === true) return 'admin';
            return normalizeRole(data.role || '');
        } catch (_err) {
            return '';
        }
    }

    function roleFromBootstrapAdmins(user) {
        var admins = window.ADMIN_EMAILS || [];
        var email = String((user && user.email) || '').trim().toLowerCase();
        if (!email) return '';
        return admins.map(function (x) { return String(x || '').trim().toLowerCase(); }).indexOf(email) !== -1 ? 'admin' : '';
    }

    async function resolveRoleForUser(user) {
        if (!user) return getStoredRole();

        var fromClaims = await roleFromTokenClaims(user);
        if (fromClaims) return storeRole(fromClaims);

        var fromFirestore = await roleFromFirestore(user);
        if (fromFirestore) return storeRole(fromFirestore);

        var fromRtdb = await roleFromRealtimeDb(user);
        if (fromRtdb) return storeRole(fromRtdb);

        var fromBootstrap = roleFromBootstrapAdmins(user);
        if (fromBootstrap) return storeRole(fromBootstrap);

        return storeRole(getStoredRole());
    }

    function bindRoleHomeLinks() {
        var links = document.querySelectorAll('[data-role-home="true"]');
        links.forEach(function (link) {
            if (link.dataset.boundRoleHome === 'true') return;
            link.dataset.boundRoleHome = 'true';
            link.addEventListener('click', async function (event) {
                event.preventDefault();

                if (link.dataset.resolvingRoleHome === 'true') return;
                link.dataset.resolvingRoleHome = 'true';

                try {
                    var auth = window.auth || (window.firebase && typeof window.firebase.auth === 'function' ? window.firebase.auth() : null);
                    var user = auth && auth.currentUser ? auth.currentUser : null;
                    var resolvedRole = user ? await resolveRoleForUser(user) : getStoredRole();
                    routeToRoleHome(resolvedRole);
                } catch (_err) {
                    routeToRoleHome(getStoredRole());
                } finally {
                    link.dataset.resolvingRoleHome = 'false';
                }
            });
        });
    }

    function enforceAllowedRole(resolvedRole, allowedRoles) {
        var allowed = Array.isArray(allowedRoles) ? allowedRoles.map(normalizeRole) : [];
        if (!allowed.length) return true;
        if (allowed.indexOf(normalizeRole(resolvedRole)) !== -1) return true;
        routeToRoleHome(resolvedRole);
        return false;
    }

    window.RoleRouting = {
        normalizeRole: normalizeRole,
        getStoredRole: getStoredRole,
        storeRole: storeRole,
        clearStoredRole: clearStoredRole,
        routeToRoleHome: routeToRoleHome,
        resolveRoleForUser: resolveRoleForUser,
        bindRoleHomeLinks: bindRoleHomeLinks,
        enforceAllowedRole: enforceAllowedRole,
    };

    bindRoleHomeLinks();
})();
