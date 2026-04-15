var auth = window.auth || firebase.auth();
var rtdb = window.rtdb || firebase.database();
var fsdb = window.fsdb || (typeof firebase.firestore === 'function' ? firebase.firestore() : null);
var adminEmails = (window.ADMIN_EMAILS || []).map(function (email) {
    return String(email || '').trim().toLowerCase();
});
var adminSignupCode = String(window.ADMIN_SIGNUP_CODE || '').trim();
var staffSignupCode = String(window.STAFF_SIGNUP_CODE || '').trim();

function getById(id) {
    return document.getElementById(id);
}

function showError(message) {
    var errEl = getById('error');
    if (!errEl) {
        alert(message);
        return;
    }
    errEl.textContent = message;
    errEl.style.display = 'block';
}

function friendlyAuthError(err, fallback) {
    var code = err && err.code ? String(err.code) : '';
    if (code === 'auth/configuration-not-found') return 'Firebase Auth configuration not found. Check API key, project, and enabled sign-in methods.';
    if (code === 'auth/email-already-in-use') return 'This email is already in use.';
    if (code === 'auth/invalid-email') return 'Invalid email format.';
    if (code === 'auth/weak-password') return 'Password is too weak (minimum 6 characters).';
    if (code === 'auth/operation-not-allowed') return 'Email/Password sign-in is not enabled in Firebase Auth.';
    if (code === 'auth/network-request-failed') return 'Network error. Please check your internet connection.';
    return (err && err.message) || fallback;
}

function showRoleHint(message) {
    var roleHintEl = getById('role-hint');
    if (!roleHintEl) {
        return;
    }
    roleHintEl.textContent = message;
}

function clearError() {
    var errEl = getById('error');
    if (!errEl) {
        return;
    }
    errEl.textContent = '';
    errEl.style.display = 'none';
}

async function loginWithEmail(email, password) {
    return auth.signInWithEmailAndPassword(email, password);
}

async function registerWithEmail(email, password) {
    return auth.createUserWithEmailAndPassword(email, password);
}

function isBootstrapAdmin(email) {
    var normalized = String(email || '').trim().toLowerCase();
    return adminEmails.indexOf(normalized) !== -1;
}

function getEffectiveRole(profile, email) {
    if (isBootstrapAdmin(email)) return 'admin';
    var stored = String((profile && profile.role) || '').trim().toLowerCase();
    if (stored === 'admin' || (profile && profile.isAdmin === true)) return 'admin';
    if (stored === 'staff') return 'staff';
    return 'passenger';
}

async function findUserProfileByEmail(email) {
    var normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    var snapshot = await rtdb
        .ref('users')
        .orderByChild('email')
        .equalTo(normalized)
        .limitToFirst(1)
        .once('value');

    if (!snapshot.exists()) {
        return null;
    }

    var users = snapshot.val() || {};
    var key = Object.keys(users)[0];
    return users[key] || null;
}

async function signInWithGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider);
}

function getSelectedLoginRole() {
    var roleEl = getById('login-role');
    return roleEl ? roleEl.value : 'auto';
}

function getSelectedRegisterRole() {
    var roleEl = getById('register-role');
    return roleEl ? roleEl.value : 'passenger';
}

function shouldGrantAdminForRegister(email, selectedRole, enteredCode) {
    if (selectedRole !== 'admin') {
        return false;
    }

    if (isBootstrapAdmin(email)) {
        return true;
    }

    return adminSignupCode && enteredCode === adminSignupCode;
}

async function getSignupCodeFromFirebase(role) {
    var normalizedRole = String(role || '').trim().toLowerCase();
    if (!normalizedRole) return '';

    var lookupPaths = [
        'signupCodes/' + normalizedRole,
        'settings/signupCodes/' + normalizedRole,
    ];

    for (var i = 0; i < lookupPaths.length; i += 1) {
        try {
            var snapshot = await rtdb.ref(lookupPaths[i]).once('value');
            if (!snapshot.exists()) continue;

            var value = snapshot.val();
            var code = String(value || '').trim();
            if (code) return code;
        } catch (_err) {
            // Continue to fallback.
        }
    }

    return '';
}

function getGrantedRoleForRegister(email, selectedRole, adminCode, staffCode) {
    if (selectedRole === 'admin') {
        if (isBootstrapAdmin(email) || (adminSignupCode && adminCode === adminSignupCode)) {
            return 'admin';
        }
        return null;
    }
    if (selectedRole === 'staff') {
        if (staffSignupCode && staffCode === staffSignupCode) {
            return 'staff';
        }
        return null;
    }
    return 'passenger';
}

async function getGrantedRoleForRegisterAsync(email, selectedRole, adminCode, staffCode) {
    if (selectedRole === 'admin') {
        if (isBootstrapAdmin(email)) {
            return 'admin';
        }

        var firebaseAdminCode = await getSignupCodeFromFirebase('admin');
        var expectedAdminCode = firebaseAdminCode || adminSignupCode;
        if (expectedAdminCode && adminCode === expectedAdminCode) {
            return 'admin';
        }
        return null;
    }

    if (selectedRole === 'staff') {
        var firebaseStaffCode = await getSignupCodeFromFirebase('staff');
        var expectedStaffCode = firebaseStaffCode || staffSignupCode;
        if (expectedStaffCode && staffCode === expectedStaffCode) {
            return 'staff';
        }
        return null;
    }

    return 'passenger';
}

async function ensureUserProfile(user) {
    var userRef = rtdb.ref('users/' + user.uid);
    var snapshot = await userRef.once('value');
    if (snapshot.exists()) {
        var profileExisting = snapshot.val() || {};
        var expectedEmail = String(user.email || '').trim().toLowerCase();
        var patch = {};

        if (expectedEmail && String(profileExisting.email || '').trim().toLowerCase() !== expectedEmail) {
            patch.email = expectedEmail;
        }

        if (isBootstrapAdmin(expectedEmail)) {
            if (profileExisting.isAdmin !== true) patch.isAdmin = true;
            if (profileExisting.role !== 'admin') patch.role = 'admin';
        } else if (!profileExisting.role) {
            patch.role = profileExisting.isAdmin === true ? 'admin' : 'passenger';
        }

        if (Object.keys(patch).length) {
            await userRef.update(patch);
            profileExisting = Object.assign({}, profileExisting, patch);
        }

        return profileExisting;
    }

    var isAdminBoot = isBootstrapAdmin(user.email || '');
    var profile = {
        firstName: '',
        lastName: '',
        email: user.email || '',
        isAdmin: isAdminBoot,
        role: isAdminBoot ? 'admin' : 'passenger',
        createdAt: new Date().toISOString(),
    };
    await userRef.set(profile);
    return profile;
}

function routeToHomeByRole(role) {
    if (window.RoleRouting && typeof window.RoleRouting.routeToRoleHome === 'function') {
        window.RoleRouting.routeToRoleHome(role);
        return;
    }

    if (role === 'admin') {
        window.location.href = 'admin.html';
    } else if (role === 'staff') {
        window.location.href = 'staff-dashboard.html';
    } else {
        window.location.href = 'booking.html';
    }
}

async function handleRoleBasedLogin(user, selectedRole) {
    var profile = await ensureUserProfile(user);
    var effectiveRole = getEffectiveRole(profile, user.email || '');

    if (window.RoleRouting && typeof window.RoleRouting.resolveRoleForUser === 'function') {
        try {
            effectiveRole = await window.RoleRouting.resolveRoleForUser(user);
        } catch (_err) {
            if (window.RoleRouting && typeof window.RoleRouting.storeRole === 'function') {
                window.RoleRouting.storeRole(effectiveRole);
            }
        }
    }

    if (selectedRole === 'admin' && effectiveRole !== 'admin') {
        await auth.signOut();
        throw new Error('This account is not an admin account.');
    }

    if (selectedRole === 'staff' && effectiveRole !== 'staff' && effectiveRole !== 'admin') {
        await auth.signOut();
        throw new Error('This account is not a staff account.');
    }

    if (selectedRole === 'passenger' && (effectiveRole === 'admin' || effectiveRole === 'staff')) {
        // Privileged user choosing passenger view — allow booking page.
        if (window.RoleRouting && typeof window.RoleRouting.storeRole === 'function') {
            window.RoleRouting.storeRole('passenger');
        }
        window.location.href = 'booking.html';
        return;
    }

    if (window.RoleRouting && typeof window.RoleRouting.storeRole === 'function') {
        window.RoleRouting.storeRole(effectiveRole);
    }

    routeToHomeByRole(effectiveRole);
}

var roleHintLookupTimer = null;

async function detectAndShowRoleHint() {
    var emailEl = getById('email');
    if (!emailEl) {
        return;
    }

    var email = String(emailEl.value || '').trim().toLowerCase();
    if (!email) {
        showRoleHint('Role hint: enter your email to detect account type.');
        return;
    }

    if (isBootstrapAdmin(email)) {
        showRoleHint('Role hint: Admin account detected.');
        return;
    }

    try {
        var profile = await findUserProfileByEmail(email);
        if (!profile) {
            showRoleHint('Role hint: account not found yet (new user will be Passenger by default).');
            return;
        }
        var detectedRole = getEffectiveRole(profile, email);
        var hintLabels = { admin: 'Role hint: Admin account detected.', staff: 'Role hint: Staff account detected.', passenger: 'Role hint: Passenger account detected.' };
        showRoleHint(hintLabels[detectedRole] || 'Role hint: Passenger account detected.');
    } catch (err) {
        showRoleHint('Role hint: unable to detect role right now.');
    }
}

var loginForm = getById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearError();

        var email = getById('email').value.trim().toLowerCase();
        var password = getById('password').value;
        var selectedRole = getSelectedLoginRole();

        if (!email || !password) {
            showError('Please enter both email and password.');
            return;
        }

        try {
            var credential = await loginWithEmail(email, password);
            await handleRoleBasedLogin(credential.user, selectedRole);
        } catch (err) {
            showError(friendlyAuthError(err, 'Login failed.'));
        }
    });
}

var registerForm = getById('register-form');
if (registerForm) {
    var registerFieldState = {
        fullName: false,
        email: false,
        password: false,
        confirmPassword: false,
    };
    var registerSubmitting = false;

    function isValidEmailFormat(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
    }

    function setFieldErrorState(fieldId, errorId, message) {
        var fieldEl = getById(fieldId);
        var errEl = getById(errorId);
        if (errEl) {
            errEl.textContent = message || '';
        }
        if (fieldEl) {
            fieldEl.classList.toggle('field-invalid', Boolean(message));
        }
    }

    function validateFullName() {
        var value = getById('full-name') ? getById('full-name').value.trim() : '';
        if (!value) {
            setFieldErrorState('full-name', 'full-name-error', 'Full name is required.');
            registerFieldState.fullName = false;
            return false;
        }
        setFieldErrorState('full-name', 'full-name-error', '');
        registerFieldState.fullName = true;
        return true;
    }

    function validateEmail() {
        var value = getById('email') ? getById('email').value.trim().toLowerCase() : '';
        if (!value || !isValidEmailFormat(value)) {
            setFieldErrorState('email', 'email-error', 'Please enter a valid email.');
            registerFieldState.email = false;
            return false;
        }
        setFieldErrorState('email', 'email-error', '');
        registerFieldState.email = true;
        return true;
    }

    function validatePassword() {
        var value = getById('password') ? getById('password').value : '';
        if (!value || value.length < 6) {
            setFieldErrorState('password', 'password-error', 'Password must be at least 6 characters.');
            registerFieldState.password = false;
            return false;
        }
        setFieldErrorState('password', 'password-error', '');
        registerFieldState.password = true;
        return true;
    }

    function validateConfirmPassword() {
        var passwordValue = getById('password') ? getById('password').value : '';
        var confirmValue = getById('confirm-password') ? getById('confirm-password').value : '';
        if (!confirmValue || confirmValue !== passwordValue) {
            setFieldErrorState('confirm-password', 'confirm-password-error', 'Confirm password must match your password.');
            registerFieldState.confirmPassword = false;
            return false;
        }
        setFieldErrorState('confirm-password', 'confirm-password-error', '');
        registerFieldState.confirmPassword = true;
        return true;
    }

    function setRegisterButtonLoading(isLoading) {
        var registerBtn = getById('register-btn');
        if (!registerBtn) return;

        registerBtn.classList.toggle('loading', Boolean(isLoading));
        registerBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    }

    function updateRegisterButtonState() {
        var registerBtn = getById('register-btn');
        if (!registerBtn) return;

        var selectedRegisterRole = getSelectedRegisterRole();
        var adminCodeValue = getById('admin-code') ? getById('admin-code').value.trim() : '';
        var staffCodeValue = getById('staff-code') ? getById('staff-code').value.trim() : '';
        var hasRoleCode = selectedRegisterRole === 'passenger'
            || (selectedRegisterRole === 'admin' && !!adminCodeValue)
            || (selectedRegisterRole === 'staff' && !!staffCodeValue);

        var isValid = registerFieldState.fullName
            && registerFieldState.email
            && registerFieldState.password
            && registerFieldState.confirmPassword
            && hasRoleCode;
        registerBtn.disabled = !isValid || registerSubmitting;
    }

    function validateAllRegisterFields() {
        validateFullName();
        validateEmail();
        validatePassword();
        validateConfirmPassword();
        updateRegisterButtonState();
        return registerFieldState.fullName && registerFieldState.email && registerFieldState.password && registerFieldState.confirmPassword;
    }

    ['full-name', 'email', 'password', 'confirm-password', 'staff-code', 'admin-code'].forEach(function (fieldId) {
        var el = getById(fieldId);
        if (!el) return;
        el.addEventListener('input', function () {
            clearError();
            if (fieldId === 'full-name') validateFullName();
            if (fieldId === 'email') validateEmail();
            if (fieldId === 'password') {
                validatePassword();
                validateConfirmPassword();
            }
            if (fieldId === 'confirm-password') validateConfirmPassword();
            updateRegisterButtonState();
        });
        el.addEventListener('blur', function () {
            if (fieldId === 'full-name') validateFullName();
            if (fieldId === 'email') validateEmail();
            if (fieldId === 'password') {
                validatePassword();
                validateConfirmPassword();
            }
            if (fieldId === 'confirm-password') validateConfirmPassword();
            updateRegisterButtonState();
        });
    });

    var registerRoleSelectEl = getById('register-role');
    var adminCodeGroupEl = getById('admin-code-group');
    var staffCodeGroupEl = getById('staff-code-group');

    function toggleRegisterRoleCodeInputs() {
        var selectedRole = getSelectedRegisterRole();
        if (adminCodeGroupEl) {
            adminCodeGroupEl.style.display = selectedRole === 'admin' ? 'flex' : 'none';
        }
        if (staffCodeGroupEl) {
            staffCodeGroupEl.style.display = selectedRole === 'staff' ? 'flex' : 'none';
        }
        updateRegisterButtonState();
    }

    if (registerRoleSelectEl) {
        registerRoleSelectEl.addEventListener('change', function () {
            clearError();
            toggleRegisterRoleCodeInputs();
        });
        toggleRegisterRoleCodeInputs();
    }

    updateRegisterButtonState();

    registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearError();

        if (!validateAllRegisterFields()) {
            return;
        }

        var email = getById('email').value.trim().toLowerCase();
        var password = getById('password').value;
        var fullName = getById('full-name').value.trim();
        var selectedRegisterRole = getSelectedRegisterRole();
        var adminCodeValue = getById('admin-code') ? getById('admin-code').value.trim() : '';
        var staffCodeValue = getById('staff-code') ? getById('staff-code').value.trim() : '';

        registerSubmitting = true;
        setRegisterButtonLoading(true);
        updateRegisterButtonState();

        try {
            var grantedRole = await getGrantedRoleForRegisterAsync(email, selectedRegisterRole, adminCodeValue, staffCodeValue);
            if (grantedRole === null) {
                if (selectedRegisterRole === 'admin') {
                    alert('Incorrect Admin Code');
                } else {
                    showError('Invalid staff code.');
                }
                return;
            }

            var existingMethods = await auth.fetchSignInMethodsForEmail(email);
            if (Array.isArray(existingMethods) && existingMethods.length) {
                alert('This email is already registered');
                return;
            }

            var userCredential = await registerWithEmail(email, password);

            try {
                if (!fsdb || typeof fsdb.collection !== 'function') {
                    throw new Error('Firestore is not available.');
                }

                await fsdb.collection('users').doc(userCredential.user.uid).set({
                    fullName: fullName,
                    email: email,
                    role: grantedRole,
                    createdAt: (firebase.firestore && firebase.firestore.FieldValue)
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : new Date().toISOString(),
                }, { merge: true });

                // Keep RTDB profile in sync for existing app features that still rely on it.
                await rtdb.ref('users/' + userCredential.user.uid).set({
                    firstName: fullName,
                    lastName: '',
                    email: email,
                    isAdmin: grantedRole === 'admin',
                    role: grantedRole,
                    createdAt: new Date().toISOString(),
                });
            } catch (profileErr) {
                console.warn('User profile write failed after successful signup:', profileErr);
            }

            if (window.RoleRouting && typeof window.RoleRouting.storeRole === 'function') {
                window.RoleRouting.storeRole(grantedRole);
            }

            if (grantedRole === 'passenger') {
                try {
                    window.sessionStorage.setItem('dtms_welcome_message', 'Welcome, ' + fullName + '!');
                } catch (_storageErr) {}
            }

            routeToHomeByRole(grantedRole);
        } catch (err) {
            if (err && err.code === 'auth/email-already-in-use') {
                showError('This email is already registered.');
            } else if (err && err.code === 'auth/network-request-failed') {
                showError('Network error. Please check your internet connection.');
            } else {
                showError(friendlyAuthError(err, 'Registration failed.'));
            }
        } finally {
            registerSubmitting = false;
            setRegisterButtonLoading(false);
            updateRegisterButtonState();
        }
    });
}

var googleSigninBtn = getById('google-signin');
if (googleSigninBtn) {
    googleSigninBtn.addEventListener('click', async function () {
        clearError();
        var selectedRole = getSelectedLoginRole();
        try {
            var credential = await signInWithGoogle();
            await handleRoleBasedLogin(credential.user, selectedRole);
        } catch (err) {
            showError(friendlyAuthError(err, 'Google sign-in failed.'));
        }
    });
}

var googleSignupBtn = getById('google-signup');
if (googleSignupBtn) {
    googleSignupBtn.addEventListener('click', async function () {
        clearError();
        try {
            var credential = await signInWithGoogle();
            await handleRoleBasedLogin(credential.user, 'auto');
        } catch (err) {
            showError(friendlyAuthError(err, 'Google sign-up failed.'));
        }
    });
}

var forgotPasswordLink = getById('forgot-password');
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', async function (e) {
        e.preventDefault();
        clearError();

        var email = getById('email') ? getById('email').value.trim() : '';
        if (!email) {
            showError('Enter your email first, then click Forgot password.');
            return;
        }

        try {
            await auth.sendPasswordResetEmail(email);
            alert('Password reset email sent. Check your inbox.');
        } catch (err) {
            showError(friendlyAuthError(err, 'Failed to send password reset email.'));
        }
    });
}

var loginEmailEl = getById('email');
var loginRoleEl = getById('login-role');
if (loginEmailEl && loginRoleEl) {
    loginEmailEl.addEventListener('input', function () {
        if (roleHintLookupTimer) {
            clearTimeout(roleHintLookupTimer);
        }
        roleHintLookupTimer = setTimeout(function () {
            detectAndShowRoleHint();
        }, 300);
    });

    loginEmailEl.addEventListener('blur', function () {
        detectAndShowRoleHint();
    });

    detectAndShowRoleHint();
}

var registerRoleEl = getById('register-role');
var adminCodeGroupEl = getById('admin-code-group');
var staffCodeGroupEl = getById('staff-code-group');
if (registerRoleEl) {
    var syncRegisterRoleFields = function () {
        var selectedRole = registerRoleEl.value;
        if (adminCodeGroupEl) {
            adminCodeGroupEl.style.display = selectedRole === 'admin' ? 'flex' : 'none';
        }
        if (staffCodeGroupEl) {
            staffCodeGroupEl.style.display = selectedRole === 'staff' ? 'flex' : 'none';
        }
    };

    registerRoleEl.addEventListener('change', syncRegisterRoleFields);
    syncRegisterRoleFields();
}