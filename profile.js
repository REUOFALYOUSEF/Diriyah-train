var auth = window.auth || firebase.auth();
var rtdb = window.rtdb || firebase.database();

var currentUser = null;
var currentProfile = {};

function textById(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
}

function valueById(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
}

function computeProfile(user, profile) {
    var firstName = profile && profile.firstName ? profile.firstName : '';
    var lastName = profile && profile.lastName ? profile.lastName : '';
    var fullName = (profile && profile.fullName) || (firstName + ' ' + lastName).trim() || user.displayName || 'Passenger';
    var email = (profile && profile.email) || user.email || 'Not set';
    var phoneNumber = (profile && (profile.phoneNumber || profile.phone)) || 'Not set';
    var address = (profile && profile.address) || 'Not set';

    return {
        fullName: fullName,
        email: email,
        phoneNumber: phoneNumber,
        address: address,
    };
}

function setProfileMenuInitial(user, profile) {
    var labelEl = document.getElementById('profileMenuLabel');
    if (!labelEl) return;

    var displayName = (profile && profile.fullName) || user.displayName || user.email || '';
    var initial = String(displayName).trim().charAt(0).toUpperCase();

    if (!initial) {
        labelEl.innerHTML = '<i class="fas fa-user"></i>';
        return;
    }

    labelEl.textContent = initial;
}

function renderProfile(user, profile) {
    var merged = computeProfile(user, profile);
    textById('summaryName', merged.fullName);
    textById('summaryEmail', merged.email);
    textById('fullNameText', merged.fullName);
    textById('emailText', merged.email);
    textById('phoneNumberText', merged.phoneNumber);
    textById('addressText', merged.address);

    valueById('fullNameInput', merged.fullName === 'Not set' ? '' : merged.fullName);
    valueById('emailInput', merged.email === 'Not set' ? '' : merged.email);
    valueById('phoneNumberInput', merged.phoneNumber === 'Not set' ? '' : merged.phoneNumber);
    valueById('addressInput', merged.address === 'Not set' ? '' : merged.address);

    setProfileMenuInitial(user, merged);
}

function toggleEdit(field, isOpen) {
    var view = document.getElementById(field + 'View');
    var edit = document.getElementById(field + 'EditWrap');
    if (!view || !edit) return;

    if (isOpen) {
        view.classList.add('hidden');
        edit.classList.remove('hidden');
    } else {
        view.classList.remove('hidden');
        edit.classList.add('hidden');
    }
}

function buildUpdatePayload(field, value) {
    if (field === 'fullName') {
        var parts = value.split(/\s+/).filter(Boolean);
        var first = parts[0] || '';
        var last = parts.length > 1 ? parts.slice(1).join(' ') : '';
        return {
            fullName: value,
            firstName: first,
            lastName: last,
        };
    }

    if (field === 'email') {
        return { email: value };
    }

    if (field === 'phoneNumber') {
        return { phoneNumber: value };
    }

    if (field === 'address') {
        return { address: value };
    }

    return null;
}

function saveField(field) {
    if (!currentUser) return;

    var input = document.getElementById(field + 'Input');
    if (!input) return;

    var value = input.value.trim();
    var payload = buildUpdatePayload(field, value);
    if (!payload) return;

    rtdb.ref('users/' + currentUser.uid).update(payload).then(function () {
        toggleEdit(field, false);
    }).catch(function (error) {
        console.error(error);
        alert('Could not update profile field. Please try again.');
    });
}

function initFieldEditor() {
    var container = document.getElementById('profileFields');
    if (!container) return;

    container.addEventListener('click', function (event) {
        var action = event.target.getAttribute('data-action');
        var field = event.target.getAttribute('data-field');
        if (!action || !field) return;

        if (action === 'edit') {
            toggleEdit(field, true);
            return;
        }

        if (action === 'cancel') {
            renderProfile(currentUser, currentProfile || {});
            toggleEdit(field, false);
            return;
        }

        if (action === 'save') {
            saveField(field);
        }
    });
}

function initProfileMenu() {
    var menu = document.getElementById('profileMenu');
    var menuButton = document.getElementById('profileMenuButton');
    var dropdown = document.getElementById('profileDropdown');
    var myProfileLink = dropdown ? dropdown.querySelector('a[href="profile.html"]') : null;
    var logoutBtn = document.getElementById('profileLogoutBtn');
    if (!menu || !menuButton || !dropdown) return;

    if (menu.dataset.initialized === 'true') {
        return;
    }
    menu.dataset.initialized = 'true';

    menuButton.addEventListener('click', function (event) {
        event.stopPropagation();
        var isOpen = dropdown.classList.toggle('open');
        menuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', function (event) {
        if (!menu.contains(event.target)) {
            dropdown.classList.remove('open');
            menuButton.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            dropdown.classList.remove('open');
            menuButton.setAttribute('aria-expanded', 'false');
        }
    });

    if (myProfileLink) {
        myProfileLink.addEventListener('click', function () {
            dropdown.classList.remove('open');
            menuButton.setAttribute('aria-expanded', 'false');
            window.location.href = 'profile.html';
        });
    }

    if (logoutBtn) {
        logoutBtn.onclick = async function () {
            try {
                await firebase.auth().signOut();
                if (window.RoleRouting && typeof window.RoleRouting.clearStoredRole === 'function') {
                    window.RoleRouting.clearStoredRole();
                }
                window.location.replace('page.html');
            } catch (error) {
                console.error(error);
                alert('Logout failed. Please try again.');
            }
        };
    }
}

function ensureFirebaseProfile(user) {
    var userRef = rtdb.ref('users/' + user.uid);
    return userRef.once('value').then(function (snapshot) {
        if (snapshot.exists()) {
            var existing = snapshot.val() || {};
            var patch = {};

            if (!existing.email && user.email) {
                patch.email = user.email;
            }

            if (!existing.fullName && user.displayName) {
                patch.fullName = user.displayName;
            }

            if (!existing.firstName && user.displayName) {
                var splitName = String(user.displayName).trim().split(/\s+/).filter(Boolean);
                patch.firstName = splitName[0] || '';
                patch.lastName = splitName.length > 1 ? splitName.slice(1).join(' ') : '';
            }

            if (Object.keys(patch).length) {
                return userRef.update(patch);
            }

            return;
        }

        var fallbackName = user.displayName || '';
        var parts = String(fallbackName).trim().split(/\s+/).filter(Boolean);
        var firstName = parts[0] || '';
        var lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

        return userRef.set({
            firstName: firstName,
            lastName: lastName,
            fullName: fallbackName,
            email: user.email || '',
            phoneNumber: '',
            address: '',
            isAdmin: false,
            createdAt: new Date().toISOString(),
        });
    });
}

auth.onAuthStateChanged(function (user) {
    if (!user) {
        window.location.href = 'page.html';
        return;
    }

    var resolveRole = window.RoleRouting && typeof window.RoleRouting.resolveRoleForUser === 'function'
        ? window.RoleRouting.resolveRoleForUser(user)
        : Promise.resolve('passenger');

    resolveRole.then(function (role) {
        if (role !== 'passenger') {
            if (window.RoleRouting && typeof window.RoleRouting.routeToRoleHome === 'function') {
                window.RoleRouting.routeToRoleHome(role);
            } else {
                window.location.href = role === 'admin' ? 'admin.html' : 'staff-dashboard.html';
            }
            return;
        }

        currentUser = user;
        initProfileMenu();
        initFieldEditor();

        ensureFirebaseProfile(user).catch(function (error) {
            console.error('Failed to ensure Firebase profile node:', error);
        });

        rtdb.ref('users/' + user.uid).on('value', function (snapshot) {
            currentProfile = snapshot.val() || {};
            renderProfile(user, currentProfile);
        }, function (error) {
            if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
                window.AppNotify.handleError(error, 'Could not load profile data right now.');
            }
            renderProfile(user, {});
        });
    }).catch(function () {
        window.location.href = 'page.html';
    });
});
