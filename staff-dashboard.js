/* ── Staff Dashboard JS ─────────────────────────────────────────────────────── */
'use strict';

var rtdb = firebase.database();
var auth = firebase.auth();
var BOOTSTRAP_ADMINS = window.ADMIN_EMAILS || [];

function isBootstrapAdmin(email) {
    return email && BOOTSTRAP_ADMINS.indexOf(email.toLowerCase().trim()) !== -1;
}

function getEffectiveRole(profile, email) {
    if (isBootstrapAdmin(email)) return 'admin';
    if (profile) {
        if (profile.role === 'admin' || profile.isAdmin === true) return 'admin';
        if (profile.role === 'staff') return 'staff';
    }
    return 'passenger';
}

/* ── Auth gate ──────────────────────────────────────────────────────────────── */
auth.onAuthStateChanged(function (user) {
    if (!user) { window.location.href = 'page.html'; return; }
    var resolveRole = window.RoleRouting && typeof window.RoleRouting.resolveRoleForUser === 'function'
        ? window.RoleRouting.resolveRoleForUser(user)
        : Promise.resolve('passenger');

    resolveRole.then(function (role) {
        if (role !== 'staff' && role !== 'admin') {
            if (window.RoleRouting && typeof window.RoleRouting.routeToRoleHome === 'function') {
                window.RoleRouting.routeToRoleHome(role);
            } else {
                window.location.href = 'booking.html';
            }
            return;
        }

        rtdb.ref('users/' + user.uid).once('value').then(function (snap) {
            var profile = snap.val() || {};
            initWelcome(profile);
            initProfileMenu(user, profile);
            initSidebar();
            initMobileMenu();
            loadData();
            initRegisterPassenger();
            initUpdateProfile();
            initCreateReservation();
            initSeatAvailability();
            initTripSearch();
            initBookingHistory();
            initCancelReservation();
            initConfirmations();
        });
    }).catch(function () {
        window.location.href = 'page.html';
    });
});

/* ── Welcome message ────────────────────────────────────────────────────────── */
function initWelcome(profile) {
    var el = document.getElementById('sdWelcome');
    if (!el) return;
    var name = ((profile.firstName || '') + ' ' + (profile.lastName || '')).trim();
    el.textContent = name ? 'Welcome, ' + name + '!' : 'Staff Dashboard';
}

/* ── Profile menu ───────────────────────────────────────────────────────────── */
function initProfileMenu(user, profile) {
    var btn = document.getElementById('profileMenuButton');
    var label = document.getElementById('profileMenuLabel');
    var dropdown = document.getElementById('profileDropdown');
    var logoutBtn = document.getElementById('profileLogoutBtn');
    if (label) label.textContent = (profile.firstName || user.email || 'S').charAt(0).toUpperCase();
    if (btn && dropdown) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); dropdown.classList.toggle('open'); });
    }
    document.addEventListener('click', function () { if (dropdown) dropdown.classList.remove('open'); });
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            auth.signOut().then(function () {
                if (window.RoleRouting && typeof window.RoleRouting.clearStoredRole === 'function') {
                    window.RoleRouting.clearStoredRole();
                }
                window.location.href = 'page.html';
            });
        });
    }
}

/* ── Sidebar navigation ─────────────────────────────────────────────────────── */
function initSidebar() {
    var links = document.querySelectorAll('.sd-nav-link');
    links.forEach(function (link) {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            links.forEach(function (l) { l.classList.remove('active'); });
            link.classList.add('active');
            var panelId = link.dataset.panel;
            document.querySelectorAll('.sd-panel').forEach(function (p) { p.style.display = 'none'; });
            var target = document.getElementById(panelId);
            if (target) target.style.display = '';
        });
    });
}

/* ── Mobile sidebar toggle ──────────────────────────────────────────────────── */
function initMobileMenu() {
    var toggle = document.getElementById('sdMenuToggle');
    var sidebar = document.getElementById('sdSidebar');
    if (!toggle || !sidebar) return;
    toggle.addEventListener('click', function () { sidebar.classList.toggle('open'); });
    document.addEventListener('click', function (e) {
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
            sidebar.classList.remove('open');
        }
    });
}

/* ── Load dashboard stats ───────────────────────────────────────────────────── */
function loadData() {
    rtdb.ref('users').on('value', function (snap) {
        var count = 0;
        snap.forEach(function (c) { if ((c.val().role || '') === 'passenger') count++; });
        var el = document.getElementById('statPassengers');
        if (el) el.textContent = count;
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load passenger statistics.');
        }
    });
    rtdb.ref('bookings').on('value', function (snap) {
        var el = document.getElementById('statBookings');
        if (el) el.textContent = snap.numChildren();
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load bookings statistics.');
        }
    });
    rtdb.ref('schedules').on('value', function (snap) {
        var el = document.getElementById('statTrips');
        if (el) el.textContent = snap.numChildren();
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load trip statistics.');
        }
    });
}

/* ── Register Passenger ─────────────────────────────────────────────────────── */
function initRegisterPassenger() {
    var btn = document.getElementById('rpSaveBtn');
    var errEl = document.getElementById('rpError');
    var okEl = document.getElementById('rpSuccessMsg');
    if (!btn) return;
    btn.addEventListener('click', function () {
        var firstName = document.getElementById('rpFirstName').value.trim();
        var lastName  = document.getElementById('rpLastName').value.trim();
        var email     = document.getElementById('rpEmail').value.trim().toLowerCase();
        var phone     = document.getElementById('rpPhone').value.trim();
        if (errEl) errEl.textContent = '';
        if (okEl) okEl.style.display = 'none';
        if (!firstName || !lastName || !email) {
            if (errEl) errEl.textContent = 'First name, last name, and email are required.';
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (errEl) errEl.textContent = 'Please enter a valid email address.';
            return;
        }
        btn.disabled = true;
        var ref = rtdb.ref('users').push();
        ref.set({ firstName: firstName, lastName: lastName, email: email, phone: phone, role: 'passenger', createdByStaff: true, createdAt: Date.now() }, function (err) {
            btn.disabled = false;
            if (err) { if (errEl) errEl.textContent = 'Error: ' + err.message; return; }
            if (okEl) { okEl.textContent = 'Passenger registered successfully.'; okEl.style.display = ''; }
            document.getElementById('rpFirstName').value = '';
            document.getElementById('rpLastName').value = '';
            document.getElementById('rpEmail').value = '';
            document.getElementById('rpPhone').value = '';
        });
    });
}

/* ── Update Profile ─────────────────────────────────────────────────────────── */
var upEditingUID = null;
function initUpdateProfile() {
    var searchBtn = document.getElementById('upSearchBtn');
    var formEl    = document.getElementById('upForm');
    var saveBtn   = document.getElementById('upSaveBtn');
    var errEl     = document.getElementById('upError');
    var saveErrEl = document.getElementById('upSaveError');
    var okEl      = document.getElementById('upSuccessMsg');
    var editInfo  = document.getElementById('upEditingFor');
    if (!searchBtn) return;
    searchBtn.addEventListener('click', function () {
        var email = document.getElementById('upEmail').value.trim().toLowerCase();
        if (errEl) errEl.textContent = '';
        if (!email) { if (errEl) errEl.textContent = 'Enter an email to search.'; return; }
        if (formEl) formEl.style.display = 'none';
        upEditingUID = null;
        rtdb.ref('users').orderByChild('email').equalTo(email).once('value').then(function (snap) {
            if (!snap.exists()) { if (errEl) errEl.textContent = 'No passenger found with that email.'; return; }
            snap.forEach(function (c) { upEditingUID = c.key; var p = c.val();
                document.getElementById('upFirstName').value = p.firstName || '';
                document.getElementById('upLastName').value  = p.lastName || '';
                document.getElementById('upPhone').value     = p.phone || '';
                if (editInfo) editInfo.textContent = 'Editing: ' + (p.firstName || '') + ' ' + (p.lastName || '') + ' (' + email + ')';
            });
            if (formEl) formEl.style.display = '';
        });
    });
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            if (!upEditingUID) return;
            var firstName = document.getElementById('upFirstName').value.trim();
            var lastName  = document.getElementById('upLastName').value.trim();
            var phone     = document.getElementById('upPhone').value.trim();
            if (saveErrEl) saveErrEl.textContent = '';
            if (!firstName || !lastName) { if (saveErrEl) saveErrEl.textContent = 'Name fields are required.'; return; }
            saveBtn.disabled = true;
            rtdb.ref('users/' + upEditingUID).update({ firstName: firstName, lastName: lastName, phone: phone, updatedByStaff: true, updatedAt: Date.now() }, function (err) {
                saveBtn.disabled = false;
                if (err) { if (saveErrEl) saveErrEl.textContent = 'Error: ' + err.message; return; }
                if (okEl) { okEl.textContent = 'Profile updated successfully.'; okEl.style.display = ''; }
                setTimeout(function () { if (okEl) okEl.style.display = 'none'; }, 4000);
            });
        });
    }
}

/* ── Create Reservation (enhanced — search by name, phone or email) ─────────── */
var crState = {
    passengerUID: null,
    passengerProfile: null,
    schedulesCache: {},
    baseTrains: {},
    filteredTrains: {},
    selectedTrainKey: null,
    selectedSchedule: null,
    filters: { priceMin: 0, priceMax: 0, timeSlot: '' },
};

function crEscape(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function crGetPriceBounds(map) {
    var prices = Object.keys(map || {}).map(function (k) { return Number((map[k] || {}).priceSar || 0); }).filter(function (p) { return isFinite(p) && p >= 0; });
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.floor(Math.min.apply(null, prices)), max: Math.ceil(Math.max.apply(null, prices)) };
}

function crGetTimeSlot(time) {
    var m = /^(\d{1,2}):/.exec(String(time || ''));
    if (!m) return '';
    var h = parseInt(m[1], 10);
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
}

function crNormalizeDate(v) {
    var r = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return r;
    var p = new Date(r);
    return isNaN(p.getTime()) ? '' : p.toISOString().slice(0, 10);
}

function crSyncSliders(bounds, reset) {
    var minEl = document.getElementById('crPriceMin');
    var maxEl = document.getElementById('crPriceMax');
    var minVal = document.getElementById('crPriceMinVal');
    var maxVal = document.getElementById('crPriceMaxVal');
    if (reset) {
        crState.filters.priceMin = bounds.min;
        crState.filters.priceMax = bounds.max;
    } else {
        crState.filters.priceMin = Math.max(bounds.min, Math.min(bounds.max, crState.filters.priceMin));
        crState.filters.priceMax = Math.max(crState.filters.priceMin, Math.min(bounds.max, crState.filters.priceMax));
    }
    [minEl, maxEl].forEach(function (el) { if (el) { el.min = bounds.min; el.max = bounds.max; } });
    if (minEl) minEl.value = crState.filters.priceMin;
    if (maxEl) maxEl.value = crState.filters.priceMax;
    if (minVal) minVal.textContent = crState.filters.priceMin;
    if (maxVal) maxVal.textContent = crState.filters.priceMax;
}

function crApplyFilters() {
    var filtered = {};
    Object.keys(crState.baseTrains).forEach(function (k) {
        var t = crState.baseTrains[k] || {};
        var price = Number(t.priceSar || 0);
        if (price < crState.filters.priceMin || price > crState.filters.priceMax) return;
        if (crState.filters.timeSlot && crGetTimeSlot(t.departureTime) !== crState.filters.timeSlot) return;
        filtered[k] = t;
    });
    crState.filteredTrains = filtered;
    crRenderTrains();
}

function crRenderTrains() {
    var el = document.getElementById('crTrainResults');
    var bar = document.getElementById('crFiltersBar');
    if (!el) return;

    var baseKeys = Object.keys(crState.baseTrains);
    if (!baseKeys.length) {
        el.innerHTML = '<div class="sd-empty">No trains found for this route and date.</div>';
        if (bar) bar.style.display = 'none';
        return;
    }
    if (bar) bar.style.display = '';
    var bounds = crGetPriceBounds(crState.baseTrains);
    crSyncSliders(bounds, crState.filters.priceMax === 0 && crState.filters.priceMin === 0);

    var keys = Object.keys(crState.filteredTrains);
    if (!keys.length) {
        el.innerHTML = '<div class="sd-empty">No trains match your filters. Try adjusting your preferences.</div>';
        return;
    }

    el.innerHTML = keys.map(function (k) {
        var t = crState.baseTrains[k] || {};
        var cap = parseInt(t.capacity, 10);
        var seats = isFinite(cap) ? Math.max(cap, 0) : null;
        var seatsLabel = seats === null ? 'Seats unavailable' : seats + ' seats available';
        var isFull = seats !== null && seats <= 0;
        var d = crNormalizeDate(t.date || '');
        var dLabel = d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        return '<div class="sd-train-result-card' + (isFull ? ' cr-full' : '') + '">' +
            '<div class="sd-trc-main">' +
                '<div class="sd-trc-route">' + crEscape((t.from || '?') + ' → ' + (t.to || '?')) + '</div>' +
                '<div class="sd-trc-meta">' +
                    '<span><i class="fas fa-clock"></i> ' + crEscape(t.departureTime || 'N/A') + '</span>' +
                    '<span><i class="far fa-calendar"></i> ' + crEscape(dLabel) + '</span>' +
                    '<span><i class="fas fa-train"></i> ' + crEscape(t.trainId || k) + '</span>' +
                    '<span><i class="fas fa-chair"></i> ' + crEscape(seatsLabel) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="sd-trc-side">' +
                '<span class="sd-trc-price">' + crEscape(String(t.priceSar || 0)) + ' SAR</span>' +
                '<button class="sd-btn-primary sd-trc-book" data-key="' + crEscape(k) + '"' + (isFull ? ' disabled' : '') + '>' +
                    (isFull ? 'Fully Booked' : '<i class="fas fa-ticket-alt"></i> Book') + '</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function crSetSlotActive(slot) {
    document.querySelectorAll('#crTimeSlots .sd-slot-btn').forEach(function (b) {
        b.classList.toggle('active', (b.getAttribute('data-slot') || '') === slot);
    });
}

function crRunTrainSearch() {
    var from = (document.getElementById('crFrom').value || '').trim();
    var to   = (document.getElementById('crTo').value || '').trim();
    var date = (document.getElementById('crDate').value || '').trim();
    var el   = document.getElementById('crTrainResults');
    if (from && to && from === to) { alert('From and To cannot be the same city.'); return; }
    if (el) el.innerHTML = '<div class="sd-empty">Searching…</div>';
    var filtered = {};
    Object.keys(crState.schedulesCache).forEach(function (k) {
        var s = crState.schedulesCache[k] || {};
        if (s.status === 'cancelled') return;
        if (from && (s.from || '') !== from) return;
        if (to   && (s.to   || '') !== to)   return;
        if (date && crNormalizeDate(s.date || '') !== crNormalizeDate(date)) return;
        filtered[k] = s;
    });
    crState.baseTrains = filtered;
    crState.filters.priceMin = 0;
    crState.filters.priceMax = 0;
    crState.filters.timeSlot = '';
    crSetSlotActive('');
    crApplyFilters();
}

function crOpenConfirm(key) {
    var t = crState.filteredTrains[key] || crState.baseTrains[key] || {};
    crState.selectedTrainKey = key;
    crState.selectedSchedule = t;
    var capNote = document.getElementById('crCapacityNote');
    var confirmBtn = document.getElementById('crConfirmFinalBtn');
    var cap = parseInt(t.capacity, 10);
    if (isFinite(cap)) {
        if (capNote) capNote.textContent = cap + ' seat(s) available for this trip.';
        if (confirmBtn) confirmBtn.disabled = cap <= 0;
    } else {
        if (capNote) capNote.textContent = '';
    }
    var sumEl = document.getElementById('crSummary');
    if (sumEl && crState.passengerProfile) {
        var p = crState.passengerProfile;
        var d = crNormalizeDate(t.date || '');
        var dLabel = d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
        sumEl.innerHTML =
            '<div class="sd-sum-row"><span>Passenger</span><strong>' + crEscape(((p.firstName || '') + ' ' + (p.lastName || '')).trim() || p.email || 'Unknown') + '</strong></div>' +
            '<div class="sd-sum-row"><span>Route</span><strong>'     + crEscape((t.from || '?') + ' → ' + (t.to || '?')) + '</strong></div>' +
            '<div class="sd-sum-row"><span>Date</span><strong>'      + crEscape(dLabel) + '</strong></div>' +
            '<div class="sd-sum-row"><span>Departure</span><strong>' + crEscape(t.departureTime || 'N/A') + '</strong></div>' +
            '<div class="sd-sum-row"><span>Train</span><strong>'     + crEscape(t.trainId || key) + '</strong></div>' +
            '<div class="sd-sum-row"><span>Price</span><strong>'     + crEscape(String(t.priceSar || 0)) + ' SAR</strong></div>';
    }
    var sec = document.getElementById('crConfirmSection');
    if (sec) { sec.style.display = ''; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    var seatEl = document.getElementById('crSeatPref');
    if (seatEl) seatEl.value = '';
    var errEl = document.getElementById('crConfirmError');
    if (errEl) errEl.textContent = '';
    var okEl = document.getElementById('crSuccessMsg');
    if (okEl) okEl.style.display = 'none';
}

function initCreateReservation() {
    rtdb.ref('schedules').on('value', function (snap) {
        crState.schedulesCache = snap.val() || {};
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load schedules for reservation flow.');
        }
    });

    /* Passenger search */
    var searchBtn = document.getElementById('crSearchPassengerBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', function () {
            var query = (document.getElementById('crSearchQuery').value || '').trim().toLowerCase();
            var errEl   = document.getElementById('crSearchError');
            var resEl   = document.getElementById('crPassengerResults');
            var selCard = document.getElementById('crSelectedPassengerCard');
            if (errEl) errEl.textContent = '';
            if (resEl)   { resEl.innerHTML = ''; resEl.style.display = 'none'; }
            if (selCard) selCard.style.display = 'none';
            var trainSec   = document.getElementById('crTrainSearchSection');
            var confirmSec = document.getElementById('crConfirmSection');
            if (trainSec)   trainSec.style.display = 'none';
            if (confirmSec) confirmSec.style.display = 'none';
            crState.passengerUID = null;
            crState.passengerProfile = null;
            if (!query) { if (errEl) errEl.textContent = 'Enter a name, phone, or email to search.'; return; }
            searchBtn.disabled = true;
            rtdb.ref('users').once('value').then(function (snap) {
                searchBtn.disabled = false;
                var users = snap.val() || {};
                var matches = [];
                Object.keys(users).forEach(function (uid) {
                    var u = users[uid] || {};
                    if (u.role && u.role !== 'passenger') return;
                    var fullName  = ((u.firstName || '') + ' ' + (u.lastName || '')).trim().toLowerCase();
                    var email     = (u.email  || '').toLowerCase();
                    var phone     = (u.phone  || '').replace(/\s+/g, '');
                    var qPhone    = query.replace(/\s+/g, '');
                    if (fullName.indexOf(query) !== -1 || email.indexOf(query) !== -1 || phone.indexOf(qPhone) !== -1) {
                        matches.push({ uid: uid, profile: u });
                    }
                });
                if (!matches.length) { if (errEl) errEl.textContent = 'No passengers found. Try a different name, phone, or email.'; return; }
                if (resEl) {
                    resEl.style.display = '';
                    resEl.innerHTML = matches.slice(0, 10).map(function (m) {
                        var p = m.profile;
                        var name = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '—';
                        return '<div class="sd-passenger-pick" data-uid="' + crEscape(m.uid) + '">' +
                            '<div class="sd-pp-info">' +
                                '<div class="sd-pp-name">' + crEscape(name) + '</div>' +
                                '<div class="sd-pp-meta">' + crEscape(p.email || '') + (p.phone ? ' · ' + crEscape(p.phone) : '') + '</div>' +
                            '</div>' +
                            '<button class="sd-btn-secondary sd-pp-select" type="button">Select</button>' +
                        '</div>';
                    }).join('');
                    resEl.querySelectorAll('.sd-pp-select').forEach(function (btn) {
                        btn.addEventListener('click', function () {
                            var uid = btn.closest('.sd-passenger-pick').dataset.uid;
                            var found = matches.filter(function (m) { return m.uid === uid; })[0];
                            if (!found) return;
                            crState.passengerUID = uid;
                            crState.passengerProfile = found.profile;
                            var p = found.profile;
                            var name = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '—';
                            if (selCard) {
                                selCard.innerHTML =
                                    '<div class="sd-selected-label"><i class="fas fa-user-check"></i> Selected Passenger</div>' +
                                    '<div class="sd-pp-name">' + crEscape(name) + '</div>' +
                                    '<div class="sd-pp-meta">' + crEscape(p.email || '') + (p.phone ? ' · ' + crEscape(p.phone) : '') + '</div>';
                                selCard.style.display = '';
                            }
                            if (resEl) resEl.style.display = 'none';
                            if (trainSec) trainSec.style.display = '';
                        });
                    });
                }
            }).catch(function (err) {
                searchBtn.disabled = false;
                if (errEl) errEl.textContent = 'Search error: ' + err.message;
            });
        });
    }

    /* Train search */
    var searchTrainsBtn = document.getElementById('crSearchTrainsBtn');
    if (searchTrainsBtn) searchTrainsBtn.addEventListener('click', crRunTrainSearch);

    /* Price sliders */
    var priceMinEl = document.getElementById('crPriceMin');
    var priceMaxEl = document.getElementById('crPriceMax');
    if (priceMinEl) {
        priceMinEl.addEventListener('input', function () {
            crState.filters.priceMin = Number(priceMinEl.value);
            if (crState.filters.priceMin > crState.filters.priceMax) {
                crState.filters.priceMax = crState.filters.priceMin;
                if (priceMaxEl) priceMaxEl.value = crState.filters.priceMax;
            }
            var minV = document.getElementById('crPriceMinVal'); var maxV = document.getElementById('crPriceMaxVal');
            if (minV) minV.textContent = crState.filters.priceMin;
            if (maxV) maxV.textContent = crState.filters.priceMax;
            crApplyFilters();
        });
    }
    if (priceMaxEl) {
        priceMaxEl.addEventListener('input', function () {
            crState.filters.priceMax = Number(priceMaxEl.value);
            if (crState.filters.priceMax < crState.filters.priceMin) {
                crState.filters.priceMin = crState.filters.priceMax;
                if (priceMinEl) priceMinEl.value = crState.filters.priceMin;
            }
            var minV = document.getElementById('crPriceMinVal'); var maxV = document.getElementById('crPriceMaxVal');
            if (minV) minV.textContent = crState.filters.priceMin;
            if (maxV) maxV.textContent = crState.filters.priceMax;
            crApplyFilters();
        });
    }

    /* Time slot buttons */
    document.querySelectorAll('#crTimeSlots .sd-slot-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            crState.filters.timeSlot = btn.getAttribute('data-slot') || '';
            crSetSlotActive(crState.filters.timeSlot);
            crApplyFilters();
        });
    });

    /* Reset filters */
    var resetBtn = document.getElementById('crResetFilters');
    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            crState.filters.timeSlot = '';
            crSetSlotActive('');
            crSyncSliders(crGetPriceBounds(crState.baseTrains), true);
            crApplyFilters();
        });
    }

    /* Train results — Book button delegation */
    var trainResultsEl = document.getElementById('crTrainResults');
    if (trainResultsEl) {
        trainResultsEl.addEventListener('click', function (e) {
            var btn = e.target.closest('.sd-trc-book');
            if (!btn || btn.disabled) return;
            crOpenConfirm(btn.getAttribute('data-key'));
        });
    }

    /* Back to trains */
    var backBtn = document.getElementById('crBackToTrainsBtn');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            var sec = document.getElementById('crConfirmSection');
            if (sec) sec.style.display = 'none';
            crState.selectedTrainKey = null;
            crState.selectedSchedule = null;
        });
    }

    /* Confirm booking */
    var confirmFinalBtn = document.getElementById('crConfirmFinalBtn');
    if (confirmFinalBtn) {
        confirmFinalBtn.addEventListener('click', function () {
            var errEl = document.getElementById('crConfirmError');
            var okEl  = document.getElementById('crSuccessMsg');
            if (errEl) errEl.textContent = '';
            if (okEl)  okEl.style.display = 'none';

            var seatPref = (document.getElementById('crSeatPref').value || '').trim().toLowerCase();
            if (!seatPref) { if (errEl) errEl.textContent = 'Please select a seat preference.'; return; }
            if (!crState.passengerUID) { if (errEl) errEl.textContent = 'No passenger selected.'; return; }
            if (!crState.selectedTrainKey) { if (errEl) errEl.textContent = 'No train selected.'; return; }

            var t = crState.selectedSchedule || {};
            var liveCap = parseInt(t.capacity, 10);
            if (isFinite(liveCap) && liveCap <= 0) {
                if (errEl) errEl.textContent = 'This train is fully booked. Please select another.';
                return;
            }

            confirmFinalBtn.disabled = true;
            confirmFinalBtn.textContent = 'Confirming…';

            var scheduleKey = crState.selectedTrainKey;
            rtdb.ref('schedules/' + scheduleKey).once('value').then(function (snap) {
                if (!snap.exists()) throw new Error('This schedule no longer exists.');
                var live = snap.val() || {};
                var cap = parseInt(live.capacity, 10);
                if (isFinite(cap) && cap <= 0) throw new Error('This train is fully booked. Please select another.');

                /* Atomic seat decrement */
                return rtdb.ref('schedules/' + scheduleKey).transaction(function (current) {
                    if (!current) return;
                    var c = parseInt(current.capacity, 10);
                    if (!isFinite(c) || c <= 0) return; /* abort */
                    current.capacity = c - 1;
                    return current;
                }).then(function (result) {
                    if (!result.committed) throw new Error('This train is fully booked. Please select another.');
                    var liveSchedule = result.snapshot.val() || live;
                    var p = crState.passengerProfile || {};
                    var bookingRef = rtdb.ref('bookings').push();
                    return bookingRef.set({
                        bookingId:      bookingRef.key,
                        userId:         crState.passengerUID,
                        userEmail:      p.email || '',
                        passengerName:  ((p.firstName || '') + ' ' + (p.lastName || '')).trim(),
                        passengerPhone: p.phone || '',
                        seatPreference: seatPref,
                        trainKey:       scheduleKey,
                        trainId:        liveSchedule.trainId || t.trainId || scheduleKey,
                        fromStation:    liveSchedule.from || t.from || '',
                        toStation:      liveSchedule.to   || t.to   || '',
                        departureTime:  liveSchedule.departureTime || t.departureTime || '',
                        date:           liveSchedule.date || t.date || '',
                        travelDate:     liveSchedule.date || t.date || '',
                        priceSar:       Number(liveSchedule.priceSar || t.priceSar || 0),
                        status:         'active',
                        createdByStaff: true,
                        createdAt:      new Date().toISOString(),
                    }).then(function () {
                        if (okEl) { okEl.textContent = 'Booking confirmed! Reference: ' + bookingRef.key; okEl.style.display = ''; }
                        /* Reset form */
                        var confirmSec = document.getElementById('crConfirmSection');
                        var trainSec   = document.getElementById('crTrainSearchSection');
                        var selCard    = document.getElementById('crSelectedPassengerCard');
                        var queryEl    = document.getElementById('crSearchQuery');
                        if (confirmSec) confirmSec.style.display = 'none';
                        if (trainSec)   trainSec.style.display   = 'none';
                        if (selCard)    { selCard.style.display = 'none'; selCard.innerHTML = ''; }
                        if (queryEl)    queryEl.value = '';
                        crState.passengerUID = null; crState.passengerProfile = null;
                        crState.selectedTrainKey = null; crState.selectedSchedule = null;
                        crState.baseTrains = {}; crState.filteredTrains = {};
                        setTimeout(function () { if (okEl) okEl.style.display = 'none'; }, 5000);
                    });
                });
            }).catch(function (err) {
                if (errEl) errEl.textContent = err.message || 'Booking failed. Please try again.';
            }).then(function () {
                confirmFinalBtn.disabled = false;
                confirmFinalBtn.innerHTML = '<i class="fas fa-ticket-alt"></i> Confirm Booking';
            });
        });
    }
}


/* ── Seat Availability ──────────────────────────────────────────────────────── */
function initSeatAvailability() {
    var searchBtn = document.getElementById('saSearchBtn');
    var errEl = document.getElementById('saError');
    var resultsEl = document.getElementById('saResults');
    if (!searchBtn) return;
    searchBtn.addEventListener('click', function () {
        var trainId = document.getElementById('saTrainId').value.trim();
        if (errEl) errEl.textContent = '';
        if (resultsEl) resultsEl.innerHTML = '';
        if (!trainId) { if (errEl) errEl.textContent = 'Enter a Train ID.'; return; }
        rtdb.ref('schedules').orderByChild('trainId').equalTo(trainId).once('value').then(function (sSnap) {
            if (!sSnap.exists()) {
                rtdb.ref('schedules').once('value').then(function (all) {
                    if (errEl) errEl.textContent = 'No trips found for that ID. Try: ' + Object.keys(all.val() || {}).slice(0,3).join(', ');
                });
                return;
            }
            var promises = [];
            sSnap.forEach(function (c) {
                var s = c.val(); var key = c.key;
                var p = rtdb.ref('bookings').orderByChild('scheduleId').equalTo(key).once('value').then(function (bSnap) {
                    var booked = 0; bSnap.forEach(function (b) { if (b.val().status !== 'cancelled') booked++; });
                    var capacity = parseInt(s.capacity || 0);
                    var avail = capacity - booked;
                    var pct = capacity ? Math.round((booked / capacity) * 100) : 0;
                    var card = document.createElement('div'); card.className = 'sd-seat-strip';
                    card.innerHTML = '<div class="sd-seat-strip-title">' + (s.from || '?') + ' → ' + (s.to || '?') + ' &nbsp;|&nbsp; ' + (s.date || '') + ' ' + (s.time || '') + '</div>' +
                        '<div class="sd-seat-bar-wrap"><div class="sd-seat-bar" style="width:' + pct + '%"></div></div>' +
                        '<div class="sd-seat-label">' + booked + ' booked, ' + avail + ' available of ' + capacity + '</div>';
                    if (resultsEl) resultsEl.appendChild(card);
                });
                promises.push(p);
            });
        });
    });
}

/* ── Trip Search ────────────────────────────────────────────────────────────── */
var allSchedules = {};
function initTripSearch() {
    var searchBtn = document.getElementById('tsSearchBtn');
    var clearBtn  = document.getElementById('tsClearBtn');
    var resultsEl = document.getElementById('tsResults');
    if (!searchBtn) return;
    rtdb.ref('schedules').on('value', function (snap) {
        allSchedules = {};
        snap.forEach(function (c) { allSchedules[c.key] = c.val(); });
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load schedules for trip search.');
        }
    });
    function runSearch() {
        var from = (document.getElementById('tsFrom').value || '').trim().toLowerCase();
        var to   = (document.getElementById('tsTo').value || '').trim().toLowerCase();
        var date = (document.getElementById('tsDate').value || '').trim();
        if (resultsEl) resultsEl.innerHTML = '';
        var matches = [];
        Object.keys(allSchedules).forEach(function (k) {
            var s = allSchedules[k];
            if (from && (s.from || '').toLowerCase().indexOf(from) === -1) return;
            if (to   && (s.to   || '').toLowerCase().indexOf(to)   === -1) return;
            if (date && (s.date || '') !== date) return;
            matches.push({ key: k, data: s });
        });
        if (!matches.length) {
            if (resultsEl) resultsEl.innerHTML = '<div class="sd-empty">No trips match your search.</div>';
            return;
        }
        matches.forEach(function (m) {
            var s = m.data;
            var card = document.createElement('div'); card.className = 'sd-result-card';
            var statusCls = (s.status || 'active').replace(/\s+/g, '-');
            card.innerHTML = '<div class="sd-card-details"><div class="sd-card-title">' + (s.from || '?') + ' → ' + (s.to || '?') + '</div>' +
                '<div class="sd-card-sub">' + (s.date || '') + ' ' + (s.time || '') + ' &nbsp;|&nbsp; Train: ' + (s.trainId || m.key) + ' &nbsp;|&nbsp; SAR ' + (s.price || 0) + '</div></div>' +
                '<span class="sd-badge ' + statusCls + '">' + (s.status || 'active') + '</span>';
            if (resultsEl) resultsEl.appendChild(card);
        });
    }
    searchBtn.addEventListener('click', runSearch);
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            document.getElementById('tsFrom').value = '';
            document.getElementById('tsTo').value = '';
            document.getElementById('tsDate').value = '';
            if (resultsEl) resultsEl.innerHTML = '';
        });
    }
}

/* ── Booking History ────────────────────────────────────────────────────────── */
function initBookingHistory() {
    var searchBtn = document.getElementById('bhSearchBtn');
    var errEl = document.getElementById('bhError');
    var resultsEl = document.getElementById('bhResults');
    if (!searchBtn) return;
    searchBtn.addEventListener('click', function () {
        var email = document.getElementById('bhEmail').value.trim().toLowerCase();
        if (errEl) errEl.textContent = '';
        if (resultsEl) resultsEl.innerHTML = '';
        if (!email) { if (errEl) errEl.textContent = 'Enter a passenger email.'; return; }
        rtdb.ref('users').orderByChild('email').equalTo(email).once('value').then(function (uSnap) {
            if (!uSnap.exists()) { if (errEl) errEl.textContent = 'Passenger not found.'; return; }
            var uid = Object.keys(uSnap.val())[0];
            return rtdb.ref('bookings').orderByChild('passengerId').equalTo(uid).once('value');
        }).then(function (bSnap) {
            if (!bSnap) return;
            if (!bSnap.exists()) {
                if (resultsEl) resultsEl.innerHTML = '<div class="sd-empty">No bookings found for this passenger.</div>';
                return;
            }
            bSnap.forEach(function (c) {
                var b = c.val(); var statusCls = (b.status || 'active').replace(/\s+/g, '-');
                var card = document.createElement('div'); card.className = 'sd-result-card';
                card.innerHTML = '<div class="sd-card-details"><div class="sd-card-title">' + (b.from || '?') + ' → ' + (b.to || '?') + '</div>' +
                    '<div class="sd-card-sub">' + (b.date || '') + ' ' + (b.time || '') + ' &nbsp;|&nbsp; SAR ' + (b.price || 0) + ' &nbsp;|&nbsp; Ref: ' + c.key + '</div></div>' +
                    '<span class="sd-badge ' + statusCls + '">' + (b.status || 'active') + '</span>';
                if (resultsEl) resultsEl.appendChild(card);
            });
        });
    });
}

/* ── Cancel Reservation ─────────────────────────────────────────────────────── */
function initCancelReservation() {
    var searchBtn = document.getElementById('cancelSearchBtn');
    var errEl = document.getElementById('cancelError');
    var listEl = document.getElementById('cancelList');
    if (!searchBtn) return;
    searchBtn.addEventListener('click', function () {
        var email = document.getElementById('cancelEmail').value.trim().toLowerCase();
        if (errEl) errEl.textContent = '';
        if (listEl) listEl.innerHTML = '';
        if (!email) { if (errEl) errEl.textContent = 'Enter a passenger email.'; return; }
        rtdb.ref('users').orderByChild('email').equalTo(email).once('value').then(function (uSnap) {
            if (!uSnap.exists()) { if (errEl) errEl.textContent = 'Passenger not found.'; return; }
            var uid = Object.keys(uSnap.val())[0];
            return rtdb.ref('bookings').orderByChild('passengerId').equalTo(uid).once('value');
        }).then(function (bSnap) {
            if (!bSnap) return;
            if (!bSnap.exists()) {
                if (listEl) listEl.innerHTML = '<div class="sd-empty">No bookings found.</div>';
                return;
            }
            var shown = 0;
            bSnap.forEach(function (c) {
                var b = c.val();
                if (b.status === 'cancelled') return;
                shown++;
                var card = document.createElement('div'); card.className = 'sd-result-card';
                var statusCls = (b.status || 'active').replace(/\s+/g, '-');
                card.innerHTML = '<div class="sd-card-details">' +
                    '<div class="sd-card-title">' + (b.from || '?') + ' → ' + (b.to || '?') + '</div>' +
                    '<div class="sd-card-sub">' + (b.date || '') + ' ' + (b.time || '') + ' &nbsp;|&nbsp; SAR ' + (b.price || 0) + '</div></div>' +
                    '<span class="sd-badge ' + statusCls + '">' + (b.status || 'active') + '</span>';
                var cancelBtn = document.createElement('button');
                cancelBtn.className = 'sd-cancel-btn';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.dataset.key = c.key;
                cancelBtn.addEventListener('click', function () {
                    cancelBtn.disabled = true;
                    rtdb.ref('bookings/' + c.key).update({ status: 'cancelled', cancelledByStaff: true, cancelledAt: Date.now() }, function (err) {
                        if (err) { cancelBtn.disabled = false; alert('Error: ' + err.message); return; }
                        card.remove();
                    });
                });
                card.appendChild(cancelBtn);
                if (listEl) listEl.appendChild(card);
            });
            if (!shown && listEl) listEl.innerHTML = '<div class="sd-empty">No active bookings to cancel.</div>';
        });
    });
}

/* ── Booking Confirmations ──────────────────────────────────────────────────── */
var allBookings = {};
var allUsers = {};
var confSearchTimeout = null;
function initConfirmations() {
    var searchInput = document.getElementById('confSearch');
    var listEl = document.getElementById('confirmationsList');
    if (!listEl) return;
    rtdb.ref('users').on('value', function (snap) {
        allUsers = {};
        snap.forEach(function (c) { allUsers[c.key] = c.val(); });
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load passenger directory for confirmations.');
        }
    });
    rtdb.ref('bookings').on('value', function (snap) {
        allBookings = {};
        snap.forEach(function (c) { allBookings[c.key] = c.val(); });
        renderConfirmations(searchInput ? searchInput.value : '');
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load booking confirmations.');
        }
    });
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            clearTimeout(confSearchTimeout);
            confSearchTimeout = setTimeout(function () { renderConfirmations(searchInput.value); }, 300);
        });
    }
}
function renderConfirmations(query) {
    var listEl = document.getElementById('confirmationsList');
    if (!listEl) return;
    listEl.innerHTML = '';
    query = (query || '').trim().toLowerCase();
    var keys = Object.keys(allBookings);
    if (!keys.length) { listEl.innerHTML = '<div class="sd-empty">No bookings yet.</div>'; return; }
    var shown = 0;
    keys.slice().reverse().forEach(function (k) {
        var b = allBookings[k];
        var u = allUsers[b.passengerId] || {};
        var passengerName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
        var passengerEmail = u.email || '';
        if (query) {
            var searchable = (k + ' ' + (b.from || '') + ' ' + (b.to || '') + ' ' + (b.date || '') + ' ' + passengerName + ' ' + passengerEmail).toLowerCase();
            if (searchable.indexOf(query) === -1) return;
        }
        shown++;
        var statusCls = (b.status || 'active').replace(/\s+/g, '-');
        var card = document.createElement('div'); card.className = 'sd-conf-card';
        card.innerHTML = '<div class="sd-conf-body">' +
            '<div class="sd-conf-ref">REF: ' + k + '</div>' +
            '<div class="sd-conf-route">' + (b.from || '?') + ' → ' + (b.to || '?') + '</div>' +
            '<div class="sd-conf-meta">' + (b.date || '') + ' ' + (b.time || '') + ' &nbsp;·&nbsp; ' + (passengerName || passengerEmail || b.passengerId) + '</div>' +
            '</div><div class="sd-conf-side">' +
            '<span class="sd-badge ' + statusCls + '">' + (b.status || 'active') + '</span>' +
            '<span style="font-weight:700;color:var(--sd-brand)">SAR ' + (b.price || 0) + '</span></div>';
        listEl.appendChild(card);
    });
    if (!shown) listEl.innerHTML = '<div class="sd-empty">No matching confirmations.</div>';
}