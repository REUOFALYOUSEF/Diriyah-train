var auth = window.auth || firebase.auth();
var rtdb = window.rtdb || firebase.database();
var currentUser = null;
var allBookingsMap = {};
var viewState = {
    filter: 'all',
    search: '',
};

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setText(id, value) {
    var el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

function setProfileMenuInitial(user) {
    var labelEl = document.getElementById('profileMenuLabel');
    if (!labelEl) return;

    var displayName = user.displayName || user.email || '';
    var initial = String(displayName).trim().charAt(0).toUpperCase();
    if (!initial) {
        labelEl.innerHTML = '<i class="fas fa-user"></i>';
        return;
    }

    labelEl.textContent = initial;
}

function initProfileMenu(user) {
    var menu = document.getElementById('profileMenu');
    var menuButton = document.getElementById('profileMenuButton');
    var dropdown = document.getElementById('profileDropdown');
    var logoutBtn = document.getElementById('profileLogoutBtn');
    if (!menu || !menuButton || !dropdown) return;

    if (menu.dataset.initialized === 'true') {
        setProfileMenuInitial(user);
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

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function () {
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
        });
    }

    setProfileMenuInitial(user);
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    var date = new Date(dateStr + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function getReservationDateValue(booking) {
    var directDate = (booking && (booking.travelDate || booking.date)) || '';
    if (directDate) {
        return directDate;
    }

    var createdAt = booking && booking.createdAt ? String(booking.createdAt) : '';
    if (createdAt && createdAt.length >= 10) {
        return createdAt.slice(0, 10);
    }

    return '';
}

function parseTripDateTime(booking) {
    var dateStr = getReservationDateValue(booking);
    var timeStr = booking.departureTime || '00:00';
    if (!dateStr) {
        return new Date(booking.createdAt || Date.now());
    }

    var parsed = new Date(dateStr + 'T' + timeStr + ':00');
    if (Number.isNaN(parsed.getTime())) {
        return new Date(booking.createdAt || Date.now());
    }

    return parsed;
}

function normalizeBookingStatus(booking) {
    var status = String((booking || {}).status || (booking || {}).bookingStatus || 'active').trim().toLowerCase();
    if (['cancelled', 'canceled', 'refunded'].indexOf(status) !== -1) {
        return 'cancelled';
    }
    return 'active';
}

function bookingCardHtml(bookingKey, booking, isPast) {
    var bookingStatus = normalizeBookingStatus(booking);
    var isCancelled = bookingStatus === 'cancelled';
    var trainId = booking.trainId || booking.trainKey || 'N/A';
    var route = (booking.fromStation || '-') + ' -> ' + (booking.toStation || '-');
    var seatLabel = booking.seatPreference ? booking.seatPreference.charAt(0).toUpperCase() + booking.seatPreference.slice(1) : 'N/A';
    var phone = booking.passengerPhone || booking.passengerId || 'N/A';
    var bookingDate = getReservationDateValue(booking);
    var dateLabel = formatDate(bookingDate);
    var timeLabel = booking.departureTime || 'N/A';

    return (
        '<article class="reservation-card' + (isCancelled ? ' cancelled-card' : '') + '" data-key="' + escapeHtml(bookingKey) + '">' +
            '<div class="reservation-main">' +
                '<h3>Train ' + escapeHtml(trainId) + '</h3>' +
                '<div class="reservation-meta">' +
                    '<p><strong>Route:</strong> ' + escapeHtml(route) + '</p>' +
                    '<p><strong>Date:</strong> <span class="booking-date-value">' + escapeHtml(dateLabel) + '</span></p>' +
                    '<p><strong>Time:</strong> ' + escapeHtml(timeLabel) + '</p>' +
                    '<p><strong>Seat:</strong> ' + escapeHtml(seatLabel) + '</p>' +
                    '<p><strong>Phone:</strong> ' + escapeHtml(phone) + '</p>' +
                '</div>' +
                (isCancelled ? '<span class="cancelled-stamp">Cancelled</span>' : '') +
                '<span class="badge ' + (isPast ? 'past' : 'upcoming') + '"><i class="fas ' + (isPast ? 'fa-clock-rotate-left' : 'fa-calendar-check') + '"></i> ' + (isPast ? 'Past Trip' : 'Upcoming Trip') + '</span>' +
                '<div class="edit-panel" id="edit-' + escapeHtml(bookingKey) + '">' +
                    '<div class="form-row">' +
                        '<input type="tel" data-input="phone" value="' + escapeHtml(phone === 'N/A' ? '' : phone) + '" placeholder="Phone Number">' +
                        '<select data-input="seat">' +
                            '<option value="window"' + (String(booking.seatPreference || '').toLowerCase() === 'window' ? ' selected' : '') + '>Window</option>' +
                            '<option value="aisle"' + (String(booking.seatPreference || '').toLowerCase() === 'aisle' ? ' selected' : '') + '>Aisle</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="edit-actions">' +
                        '<button class="btn save" type="button" data-action="save" data-key="' + escapeHtml(bookingKey) + '">Save</button>' +
                        '<button class="btn close" type="button" data-action="close-edit" data-key="' + escapeHtml(bookingKey) + '">Close</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="reservation-actions">' +
                (isCancelled
                    ? '<button class="btn save" type="button" data-action="rebook" data-key="' + escapeHtml(bookingKey) + '">Re-book</button>'
                    : '<button class="btn edit" type="button" data-action="edit" data-key="' + escapeHtml(bookingKey) + '">Edit</button>' +
                      '<button class="btn delete" type="button" data-action="cancel" data-key="' + escapeHtml(bookingKey) + '">Cancel Booking</button>') +
            '</div>' +
        '</article>'
    );
}

function renderReservationLists(bookingsMap) {
    var upcomingList = document.getElementById('upcomingList');
    var pastList = document.getElementById('pastList');
    var cancelledList = document.getElementById('cancelledList');
    var cancelledSection = document.getElementById('cancelledSection');
    if (!upcomingList || !pastList || !cancelledList || !cancelledSection) return;

    var now = new Date();
    var searchText = String(viewState.search || '').trim().toLowerCase();
    var bookings = Object.keys(bookingsMap || {}).map(function (key) {
        var booking = bookingsMap[key] || {};
        return {
            key: key,
            data: booking,
            tripDate: parseTripDateTime(booking),
            normalizedStatus: normalizeBookingStatus(booking),
        };
    });

    bookings.sort(function (a, b) {
        return b.tripDate.getTime() - a.tripDate.getTime();
    });

    var filtered = bookings.filter(function (item) {
        var trainId = String(item.data.trainId || item.data.trainKey || '').toLowerCase();
        if (searchText && trainId.indexOf(searchText) === -1) {
            return false;
        }

        var isCancelled = item.normalizedStatus === 'cancelled';
        var isPast = item.tripDate.getTime() < now.getTime();

        if (viewState.filter === 'upcoming') {
            return !isCancelled && !isPast;
        }

        if (viewState.filter === 'past') {
            return !isCancelled && isPast;
        }

        if (viewState.filter === 'cancelled') {
            return isCancelled;
        }

        return true;
    });

    var upcoming = filtered.filter(function (item) {
        return item.normalizedStatus !== 'cancelled' && item.tripDate.getTime() >= now.getTime();
    });

    var past = filtered.filter(function (item) {
        return item.normalizedStatus !== 'cancelled' && item.tripDate.getTime() < now.getTime();
    });

    var cancelled = filtered.filter(function (item) {
        return item.normalizedStatus === 'cancelled';
    });

    setText('upcomingCount', String(upcoming.length));
    setText('pastCount', String(past.length));
    setText('totalCount', String(filtered.length));

    if (!upcoming.length) {
        upcomingList.innerHTML = '<div class="empty-state">No upcoming reservations.</div>';
    } else {
        upcomingList.innerHTML = upcoming.map(function (item) {
            return bookingCardHtml(item.key, item.data, false);
        }).join('');
    }

    if (!past.length) {
        pastList.innerHTML = '<div class="empty-state">No past reservations yet.</div>';
    } else {
        pastList.innerHTML = past.map(function (item) {
            return bookingCardHtml(item.key, item.data, true);
        }).join('');
    }

    if (!cancelled.length) {
        cancelledList.innerHTML = '<div class="empty-state">No cancelled reservations.</div>';
    } else {
        cancelledList.innerHTML = cancelled.map(function (item) {
            return bookingCardHtml(item.key, item.data, true);
        }).join('');
    }

    var showUpcoming = viewState.filter === 'all' || viewState.filter === 'upcoming';
    var showPast = viewState.filter === 'all' || viewState.filter === 'past';
    var showCancelled = viewState.filter === 'all' || viewState.filter === 'cancelled';

    var upcomingSection = document.getElementById('upcomingList').closest('.list-section');
    var pastSection = document.getElementById('pastList').closest('.list-section');

    if (upcomingSection) {
        upcomingSection.style.display = showUpcoming ? 'block' : 'none';
    }
    if (pastSection) {
        pastSection.style.display = showPast ? 'block' : 'none';
    }
    cancelledSection.style.display = showCancelled ? 'block' : 'none';
}

function toggleEditPanel(bookingKey, open) {
    var panel = document.getElementById('edit-' + bookingKey);
    if (!panel) return;

    if (open) {
        panel.classList.add('open');
    } else {
        panel.classList.remove('open');
    }
}

async function saveBookingChanges(bookingKey) {
    var card = document.querySelector('.reservation-card[data-key="' + bookingKey + '"]');
    if (!card) return;

    var phoneInput = card.querySelector('[data-input="phone"]');
    var seatSelect = card.querySelector('[data-input="seat"]');
    var phone = phoneInput ? String(phoneInput.value || '').trim() : '';
    var seat = seatSelect ? String(seatSelect.value || '').trim().toLowerCase() : '';

    if (!phone) {
        alert('Phone number is required.');
        return;
    }

    if (['window', 'aisle'].indexOf(seat) === -1) {
        alert('Please select a valid seat preference.');
        return;
    }

    try {
        await rtdb.ref('bookings/' + bookingKey).update({
            passengerPhone: phone,
            passengerId: phone,
            seatPreference: seat,
            updatedAt: new Date().toISOString(),
        });
        toggleEditPanel(bookingKey, false);
    } catch (error) {
        console.error(error);
        alert('Could not update booking details. Please try again.');
    }
}

async function cancelBooking(bookingKey) {
    if (!window.confirm('Are you sure you want to cancel this booking?')) {
        return;
    }

    var bookingRef = rtdb.ref('bookings/' + bookingKey);

    try {
        var snapshot = await bookingRef.once('value');
        if (!snapshot.exists()) {
            alert('Booking not found.');
            return;
        }

        var booking = snapshot.val() || {};
        var currentStatus = normalizeBookingStatus(booking);
        if (currentStatus === 'cancelled') {
            alert('This booking is already cancelled.');
            return;
        }

        var trainKey = booking.trainKey;

        if (trainKey) {
            var scheduleRef = rtdb.ref('schedules/' + trainKey);
            await scheduleRef.transaction(function (schedule) {
                if (!schedule) {
                    return schedule;
                }

                var capacity = parseInt(schedule.capacity, 10);
                if (!Number.isFinite(capacity) || capacity < 0) {
                    capacity = 0;
                }

                schedule.capacity = capacity + 1;

                var bookingId = booking.bookingId || bookingKey;
                if (schedule.processedBookingIds && schedule.processedBookingIds[bookingId]) {
                    delete schedule.processedBookingIds[bookingId];
                }

                return schedule;
            });
        }

        await bookingRef.update({
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error(error);
        alert('Could not cancel booking. Please try again.');
    }
}

function rebookCancelledTrip(bookingKey) {
    var booking = allBookingsMap[bookingKey] || null;
    if (!booking) {
        alert('Booking not found.');
        return;
    }

    var draft = {
        trainKey: booking.trainKey || '',
        from: booking.fromStation || '',
        to: booking.toStation || '',
        date: booking.travelDate || booking.date || '',
        seatPreference: booking.seatPreference || '',
        passengerPhone: booking.passengerPhone || booking.passengerId || '',
        passengerName: booking.passengerName || '',
    };

    window.localStorage.setItem('rebookDraft', JSON.stringify(draft));
    window.location.href = 'booking.html#availableTrains';
}

function initReservationActions() {
    document.addEventListener('click', function (event) {
        var action = event.target.getAttribute('data-action');
        var bookingKey = event.target.getAttribute('data-key');
        if (!action || !bookingKey) return;

        if (action === 'edit') {
            toggleEditPanel(bookingKey, true);
            return;
        }

        if (action === 'close-edit') {
            toggleEditPanel(bookingKey, false);
            return;
        }

        if (action === 'save') {
            saveBookingChanges(bookingKey);
            return;
        }

        if (action === 'cancel') {
            cancelBooking(bookingKey);
            return;
        }

        if (action === 'rebook') {
            rebookCancelledTrip(bookingKey);
        }
    });
}

function initFilterBar() {
    var filtersWrap = document.getElementById('reservationFilters');
    var searchInput = document.getElementById('trainSearchInput');
    if (!filtersWrap || !searchInput) {
        return;
    }

    filtersWrap.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-filter]');
        if (!btn) return;

        viewState.filter = btn.getAttribute('data-filter') || 'all';
        var allButtons = filtersWrap.querySelectorAll('button[data-filter]');
        Array.prototype.forEach.call(allButtons, function (el) {
            el.classList.toggle('active', el === btn);
        });

        renderReservationLists(allBookingsMap);
    });

    searchInput.addEventListener('input', function () {
        viewState.search = String(searchInput.value || '').trim();
        renderReservationLists(allBookingsMap);
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
        initProfileMenu(user);
        initReservationActions();
        initFilterBar();

        rtdb.ref('bookings').orderByChild('userId').equalTo(user.uid).on('value', function (snapshot) {
            allBookingsMap = snapshot.val() || {};
            renderReservationLists(allBookingsMap);
        }, function (error) {
            if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
                window.AppNotify.handleError(error, 'Could not load your reservations right now.');
            }
        });
    }).catch(function () {
        window.location.href = 'page.html';
    });
});
