var auth = window.auth || firebase.auth();
var rtdb = window.rtdb || firebase.database();
var fsdb = window.fsdb || (typeof firebase.firestore === 'function' ? firebase.firestore() : null);

var trains = {};
var allSchedulesCache = {};
var baseTrains = {};
var selectedTrainKey = null;
var activeFilters = {
    from: '',
    to: '',
    date: '',
};
var advancedFilters = {
    minPrice: 0,
    maxPrice: 0,
    classType: '',
    timeSlot: '',
};
var filterState = {
    uiBound: false,
};
var bookingFlowState = {
    isSubmitting: false,
    handlersBound: false,
    pendingBookingId: null,
    selectedTrip: null,
};
var rebookState = {
    draft: null,
    applied: false,
};

function setText(id, value) {
    var el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

function showRegistrationWelcomeIfAny() {
    var key = 'dtms_welcome_message';
    var message = '';

    try {
        message = window.sessionStorage.getItem(key) || '';
        if (message) {
            window.sessionStorage.removeItem(key);
        }
    } catch (_err) {
        return;
    }

    if (!message) {
        return;
    }

    if (window.AppNotify && typeof window.AppNotify.success === 'function') {
        window.AppNotify.success(message, { title: 'Welcome' });
        return;
    }

    alert(message);
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
    var myProfileLink = dropdown ? dropdown.querySelector('a[href="profile.html"]') : null;
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

    setProfileMenuInitial(user);
}

function watchMyBookings(user) {
    rtdb.ref('bookings').orderByChild('userId').equalTo(user.uid).on('value', function (snapshot) {
        var bookings = snapshot.val() || {};
        var list = Object.keys(bookings).map(function (key) {
            return bookings[key];
        }).filter(function (booking) {
            return isBookingActive(booking);
        });

        setText('myBookingsCount', String(list.length));

        if (!list.length) {
            setText('lastBookingInfo', 'No bookings yet.');
            setText('preferredRoute', '-');
            return;
        }

        list.sort(function (a, b) {
            return (new Date(b.createdAt || 0)).getTime() - (new Date(a.createdAt || 0)).getTime();
        });

        var latest = list[0] || {};
        var route = (latest.fromStation || '-') + ' -> ' + (latest.toStation || '-');
        var latestDate = getBookingDateValue(latest);
        var dateText = latestDate ? (' on ' + formatTravelDate(latestDate)) : '';
        setText('lastBookingInfo', 'Latest: ' + (latest.trainId || 'Train') + dateText);
        setText('preferredRoute', route);
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load your bookings right now.');
        }
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTravelDate(dateStr) {
    if (!dateStr) return 'Select date';
    var date = new Date(String(dateStr) + 'T00:00:00');
    if (Number.isNaN(date.getTime())) {
        return dateStr;
    }
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function normalizeDateValue(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
    }

    var parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return parsed.toISOString().slice(0, 10);
}

function scheduleMatchesDate(schedule, selectedDate) {
    var normalizedSelectedDate = normalizeDateValue(selectedDate);
    if (!normalizedSelectedDate) {
        return false;
    }

    var directDate = normalizeDateValue(schedule && (schedule.date || schedule.travelDate || schedule.departureDate));
    if (directDate) {
        return directDate === normalizedSelectedDate;
    }

    var availableDates = schedule && schedule.availableDates;
    if (Array.isArray(availableDates)) {
        return availableDates.some(function (dateValue) {
            return normalizeDateValue(dateValue) === normalizedSelectedDate;
        });
    }

    return false;
}

function getBookingDateValue(booking) {
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

function renderResults() {
    var results = document.getElementById('trainResults');
    if (!results) return;

    var selectedDate = getTrimmedInputValue('date') || activeFilters.date;
    var keys = Object.keys(trains || {});

    if (!keys.length) {
        if (getScheduleCount(baseTrains)) {
            results.innerHTML = '<div class="train-card"><div class="ticket-main"><h4>No trains match your filters. Try adjusting your preferences.</h4><p>Use Reset Filters to quickly return to all available trains.</p></div></div>';
        } else {
            results.innerHTML = '<div class="train-card"><div class="ticket-main"><h4>No trains available for this date</h4><p>Please try another date or route.</p></div></div>';
        }
        return;
    }

    results.innerHTML = keys.map(function (key) {
        var t = trains[key] || {};
        var trainNumber = escapeHtml(t.trainId || key);
        var route = escapeHtml(t.from) + ' -> ' + escapeHtml(t.to);
        var depart = escapeHtml(t.departureTime || 'N/A');
        var price = escapeHtml(t.priceSar || 0);
        var classType = escapeHtml((t.classType || t.class || t.trainClass || 'Not specified'));
        var capacity = parseInt(t.capacity, 10);
        var trainDate = normalizeDateValue(t.date || t.travelDate || t.departureDate || selectedDate);
        var displayDate = formatTravelDate(trainDate || selectedDate);
        var remainingSeats = Number.isFinite(capacity) ? Math.max(capacity, 0) : null;
        var seatsText = remainingSeats === null
            ? 'Seats info unavailable'
            : (remainingSeats + ' seats available');
        var isFullyBooked = remainingSeats !== null && remainingSeats <= 0;
        var buttonText = isFullyBooked ? 'Fully Booked' : 'Book Now';
        var disabledAttr = isFullyBooked ? ' disabled aria-disabled="true"' : '';
        return (
            '<div class="train-card">' +
                '<div class="ticket-main">' +
                    '<div class="ticket-left">' +
                        '<img src="logo.jpeg" alt="Diriyah Train" class="ticket-logo">' +
                        '<div>' +
                            '<p class="ticket-label">Train</p>' +
                            '<h4>' + trainNumber + '</h4>' +
                        '</div>' +
                    '</div>' +
                    '<div class="ticket-center">' +
                        '<p class="ticket-route"><i class="fas fa-train"></i> ' + route + '</p>' +
                        '<p class="ticket-time"><i class="far fa-clock"></i> ' + depart + '</p>' +
                        '<p class="ticket-date"><i class="far fa-calendar"></i> ' + escapeHtml(displayDate) + '</p>' +
                        '<p class="ticket-seats"><i class="fas fa-star"></i> ' + classType + ' Class</p>' +
                        '<p class="ticket-seats"><i class="fas fa-chair"></i> ' + escapeHtml(seatsText) + '</p>' +
                    '</div>' +
                '</div>' +
                '<div class="ticket-stub">' +
                    '<p class="ticket-price-label">Price</p>' +
                    '<strong class="price-tag">' + price + ' SAR</strong>' +
                    '<button class="btn-primary" onclick="openModal(\'' + escapeHtml(key) + '\')"' + disabledAttr + '>' + buttonText + '</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');
}

function getScheduleCount(scheduleMap) {
    return Object.keys(scheduleMap || {}).length;
}

function logSchedulesDebug(source, scheduleMap) {
    var count = getScheduleCount(scheduleMap);
    console.log('[Schedules][' + source + '] Retrieved ' + count + ' schedule(s).');
}

function parsePriceValue(value) {
    var numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function getPriceBounds(scheduleMap) {
    var prices = Object.keys(scheduleMap || {}).map(function (key) {
        return parsePriceValue((scheduleMap[key] || {}).priceSar);
    }).filter(function (price) {
        return Number.isFinite(price) && price >= 0;
    });

    if (!prices.length) {
        return { min: 0, max: 0 };
    }

    return {
        min: Math.floor(Math.min.apply(null, prices)),
        max: Math.ceil(Math.max.apply(null, prices)),
    };
}

function normalizeClassValue(train) {
    var rawClass = train && (train.classType || train.class || train.trainClass);
    return String(rawClass || '').trim().toLowerCase();
}

function getDepartureHour(train) {
    var time = String((train && train.departureTime) || '').trim();
    var match = /^(\d{1,2})\s*:\s*(\d{2})/.exec(time);
    if (!match) {
        return null;
    }

    var hour = Number(match[1]);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        return null;
    }
    return hour;
}

function resolveTimeSlot(train) {
    var hour = getDepartureHour(train);
    if (hour === null) {
        return '';
    }

    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
}

function matchesAdvancedFilters(train) {
    var price = parsePriceValue((train || {}).priceSar);
    var inPriceRange = price >= advancedFilters.minPrice && price <= advancedFilters.maxPrice;
    if (!inPriceRange) {
        return false;
    }

    if (advancedFilters.classType) {
        if (normalizeClassValue(train) !== advancedFilters.classType) {
            return false;
        }
    }

    if (advancedFilters.timeSlot) {
        if (resolveTimeSlot(train) !== advancedFilters.timeSlot) {
            return false;
        }
    }

    return true;
}

function updatePriceDisplay(minValue, maxValue) {
    var minEl = document.getElementById('priceMinValue');
    var maxEl = document.getElementById('priceMaxValue');
    if (minEl) minEl.textContent = String(minValue);
    if (maxEl) maxEl.textContent = String(maxValue);
}

function setActiveTimeSlotButton(slot) {
    var buttons = document.querySelectorAll('.time-slot-btn');
    buttons.forEach(function (btn) {
        var btnSlot = btn.getAttribute('data-slot') || '';
        btn.classList.toggle('active', btnSlot === slot);
    });
}

function applyClientFiltersAndRender() {
    var filtered = {};
    Object.keys(baseTrains || {}).forEach(function (key) {
        var train = baseTrains[key] || {};
        if (matchesAdvancedFilters(train)) {
            filtered[key] = train;
        }
    });

    trains = filtered;
    renderResults();
}

function syncPriceInputsToCurrentBounds(preserveCurrentRange) {
    var bounds = getPriceBounds(baseTrains);
    var minInput = document.getElementById('priceMinRange');
    var maxInput = document.getElementById('priceMaxRange');

    if (!preserveCurrentRange || advancedFilters.maxPrice < advancedFilters.minPrice ||
        (advancedFilters.minPrice === 0 && advancedFilters.maxPrice === 0)) {
        advancedFilters.minPrice = bounds.min;
        advancedFilters.maxPrice = bounds.max;
    } else {
        advancedFilters.minPrice = Math.max(bounds.min, Math.min(bounds.max, advancedFilters.minPrice));
        advancedFilters.maxPrice = Math.max(advancedFilters.minPrice, Math.min(bounds.max, advancedFilters.maxPrice));
    }

    if (minInput) {
        minInput.min = String(bounds.min);
        minInput.max = String(bounds.max);
        minInput.value = String(advancedFilters.minPrice);
    }

    if (maxInput) {
        maxInput.min = String(bounds.min);
        maxInput.max = String(bounds.max);
        maxInput.value = String(advancedFilters.maxPrice);
    }

    updatePriceDisplay(advancedFilters.minPrice, advancedFilters.maxPrice);
}

function resetAdvancedFilters() {
    var classFilter = document.getElementById('classFilter');
    advancedFilters.classType = '';
    advancedFilters.timeSlot = '';
    if (classFilter) {
        classFilter.value = '';
    }

    setActiveTimeSlotButton('');
    syncPriceInputsToCurrentBounds(false);
    applyClientFiltersAndRender();
}

function initAdvancedFilterUI() {
    if (filterState.uiBound) {
        return;
    }
    filterState.uiBound = true;

    var minInput = document.getElementById('priceMinRange');
    var maxInput = document.getElementById('priceMaxRange');
    var classFilter = document.getElementById('classFilter');
    var timeButtons = document.querySelectorAll('.time-slot-btn');
    var resetBtn = document.getElementById('resetTrainFiltersBtn');

    if (minInput) {
        minInput.addEventListener('input', function () {
            advancedFilters.minPrice = parsePriceValue(minInput.value);
            if (advancedFilters.minPrice > advancedFilters.maxPrice) {
                advancedFilters.maxPrice = advancedFilters.minPrice;
                if (maxInput) {
                    maxInput.value = String(advancedFilters.maxPrice);
                }
            }
            updatePriceDisplay(advancedFilters.minPrice, advancedFilters.maxPrice);
            applyClientFiltersAndRender();
        });
    }

    if (maxInput) {
        maxInput.addEventListener('input', function () {
            advancedFilters.maxPrice = parsePriceValue(maxInput.value);
            if (advancedFilters.maxPrice < advancedFilters.minPrice) {
                advancedFilters.minPrice = advancedFilters.maxPrice;
                if (minInput) {
                    minInput.value = String(advancedFilters.minPrice);
                }
            }
            updatePriceDisplay(advancedFilters.minPrice, advancedFilters.maxPrice);
            applyClientFiltersAndRender();
        });
    }

    if (classFilter) {
        classFilter.addEventListener('change', function () {
            advancedFilters.classType = String(classFilter.value || '').trim().toLowerCase();
            applyClientFiltersAndRender();
        });
    }

    timeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var selectedSlot = btn.getAttribute('data-slot') || '';
            advancedFilters.timeSlot = selectedSlot;
            setActiveTimeSlotButton(selectedSlot);
            applyClientFiltersAndRender();
        });
    });

    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            resetAdvancedFilters();
        });
    }

    setActiveTimeSlotButton('');
    syncPriceInputsToCurrentBounds(false);
}

function setBaseTrains(nextBaseTrains, preserveCurrentRange) {
    baseTrains = nextBaseTrains || {};
    syncPriceInputsToCurrentBounds(Boolean(preserveCurrentRange));
    applyClientFiltersAndRender();
}

function matchesSearchFilters(schedule, filters) {
    var from = String((filters && filters.from) || '').trim();
    var to = String((filters && filters.to) || '').trim();
    var date = String((filters && filters.date) || '').trim();

    var matchFrom = !from || String((schedule && schedule.from) || '').trim() === from;
    var matchTo = !to || String((schedule && schedule.to) || '').trim() === to;
    var matchDate = !date || scheduleMatchesDate(schedule, date);
    return matchFrom && matchTo && matchDate;
}

function rebuildBaseTrainsFromActiveSearch() {
    var scopedSchedules = {};
    Object.keys(allSchedulesCache || {}).forEach(function (key) {
        var schedule = allSchedulesCache[key] || {};
        if (matchesSearchFilters(schedule, activeFilters)) {
            scopedSchedules[key] = schedule;
        }
    });

    setBaseTrains(scopedSchedules, true);
}

function searchTrains() {
    var from = getTrimmedInputValue('from');
    var to = getTrimmedInputValue('to');
    var date = getTrimmedInputValue('date');

    if (from && to && from === to) {
        alert('From and To stations cannot be the same.');
        return;
    }

    activeFilters = { from: from, to: to, date: date };
    console.log('[Schedules][Search] Applying local search filters:', activeFilters);
    rebuildBaseTrainsFromActiveSearch();
}

function openModal(trainKey) {
    var train = trains[trainKey] || {};
    var capacity = parseInt(train.capacity, 10);
    var hasCapacity = Number.isFinite(capacity);
    if (hasCapacity && capacity <= 0) {
        alert('Sorry, this train is fully booked. Please choose another schedule.');
        return;
    }

    var selectedDate = normalizeDateValue(
        train.date || train.travelDate || train.departureDate || getTrimmedInputValue('date') || activeFilters.date
    );
    if (!selectedDate) {
        alert('This train schedule is missing a travel date. Please choose another train.');
        return;
    }

    selectedTrainKey = trainKey;
    bookingFlowState.selectedTrip = {
        trainKey: trainKey,
        trainId: train.trainId || trainKey,
        fromStation: train.from || '',
        toStation: train.to || '',
        departureTime: train.departureTime || '',
        priceSar: Number(train.priceSar || 0),
        travelDate: selectedDate,
    };
    bookingFlowState.pendingBookingId = rtdb.ref('bookings').push().key;
    document.getElementById('bookingModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('bookingModal').style.display = 'none';
    bookingFlowState.pendingBookingId = null;
    bookingFlowState.selectedTrip = null;
    bookingFlowState.isSubmitting = false;
    setBookingButtonLoading(false);
}

function getTrimmedInputValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
}

function loadRebookDraft() {
    if (rebookState.draft) return;

    try {
        var raw = window.localStorage.getItem('rebookDraft');
        if (!raw) return;
        rebookState.draft = JSON.parse(raw);
    } catch (error) {
        console.error('Could not parse rebook draft:', error);
        window.localStorage.removeItem('rebookDraft');
    }
}

async function applyRebookDraftIfNeeded() {
    if (rebookState.applied || !rebookState.draft) {
        return;
    }

    var draft = rebookState.draft || {};
    var fromInput = document.getElementById('from');
    var toInput = document.getElementById('to');
    var dateInput = document.getElementById('date');

    if (fromInput && draft.from) {
        fromInput.value = draft.from;
    }

    if (toInput && draft.to) {
        toInput.value = draft.to;
    }

    if (dateInput && draft.date) {
        dateInput.value = draft.date;
    }

    if (draft.date) {
        activeFilters = {
            from: draft.from || '',
            to: draft.to || '',
            date: draft.date,
        };

        await searchTrains();
    } else {
        renderResults();
    }

    if (draft.trainKey && trains[draft.trainKey]) {
        openModal(draft.trainKey);
        var phoneInput = document.getElementById('pPhone');
        var seatInput = document.getElementById('pSeat');
        var nameInput = document.getElementById('pName');

        if (nameInput && draft.passengerName) {
            nameInput.value = draft.passengerName;
        }
        if (phoneInput && draft.passengerPhone) {
            phoneInput.value = draft.passengerPhone;
        }
        if (seatInput && draft.seatPreference) {
            seatInput.value = String(draft.seatPreference).toLowerCase();
        }

        rebookState.applied = true;
        window.localStorage.removeItem('rebookDraft');
        rebookState.draft = null;
    }
}

function startSchedulesListener() {
    console.log('[Schedules] Opening realtime listener on schedules collection.');
    rtdb.ref('schedules').on('value', function (snapshot) {
        allSchedulesCache = snapshot.val() || {};
        logSchedulesDebug('DefaultView', allSchedulesCache);
        rebuildBaseTrainsFromActiveSearch();
    }, function (error) {
        console.error('[Schedules] Failed to read schedules collection:', error);
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Unable to load train schedules. Please check your connection.');
        }
        var results = document.getElementById('trainResults');
        if (results) {
            results.innerHTML = '<div class="train-card"><div class="ticket-main"><h4>Unable to load trains</h4><p>Check Firebase connection and database rules for schedules.</p></div></div>';
        }
    });
}

function isBookingActive(booking) {
    var status = String((booking || {}).status || (booking || {}).bookingStatus || 'active').trim().toLowerCase();
    return ['cancelled', 'canceled', 'refunded'].indexOf(status) === -1;
}

function countCurrentBookingsForTrain(trainKey, trainId) {
    var normalizedTrainKey = String(trainKey || '');
    var normalizedTrainId = String(trainId || '').trim().toLowerCase();

    return rtdb.ref('bookings').once('value').then(function (snapshot) {
        var bookings = snapshot.val() || {};
        return Object.keys(bookings).reduce(function (count, key) {
            var booking = bookings[key] || {};
            if (!isBookingActive(booking)) {
                return count;
            }

            var byTrainKey = String(booking.trainKey || '') === normalizedTrainKey;
            var byTrainId = normalizedTrainId && String(booking.trainId || '').trim().toLowerCase() === normalizedTrainId;
            return byTrainKey || byTrainId ? count + 1 : count;
        }, 0);
    });
}

function setBookingButtonLoading(isLoading) {
    var confirmBtn = document.querySelector('#bookingModal .btn-confirm');
    if (!confirmBtn) return;

    if (isLoading) {
        if (!confirmBtn.dataset.defaultText) {
            confirmBtn.dataset.defaultText = confirmBtn.textContent;
        }
        confirmBtn.disabled = true;
        confirmBtn.setAttribute('aria-busy', 'true');
        confirmBtn.textContent = 'Confirming...';
        return;
    }

    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-busy', 'false');
    confirmBtn.textContent = confirmBtn.dataset.defaultText || 'Confirm Reservation';
}

function resetBookingForm() {
    document.getElementById('pName').value = '';
    var phoneInput = document.getElementById('pPhone');
    if (phoneInput) {
        phoneInput.value = '';
    }
    var idInput = document.getElementById('pID');
    if (idInput) {
        idInput.value = '';
    }
    document.getElementById('pSeat').value = '';
}

function initBookingModalHandlers() {
    if (bookingFlowState.handlersBound) {
        return;
    }
    bookingFlowState.handlersBound = true;

    var confirmBtn = document.getElementById('confirmBookingBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
            confirmBooking();
        });
    }
}

async function confirmBooking() {
    if (bookingFlowState.isSubmitting) {
        console.log('Duplicate confirm click ignored while booking is in progress.');
        return;
    }

    bookingFlowState.isSubmitting = true;
    setBookingButtonLoading(true);

    var name = getTrimmedInputValue('pName');
    var phone = getTrimmedInputValue('pPhone') || getTrimmedInputValue('pID');
    var seat = getTrimmedInputValue('pSeat').toLowerCase();
    var selectedDate = getTrimmedInputValue('date');
    var selectedTrip = bookingFlowState.selectedTrip || {};
    var travelDate = normalizeDateValue(
        selectedTrip.travelDate ||
        (trains[selectedTrainKey] && (trains[selectedTrainKey].date || trains[selectedTrainKey].travelDate || trains[selectedTrainKey].departureDate)) ||
        activeFilters.date ||
        selectedDate
    );
    var user = auth.currentUser;
    var train = trains[selectedTrainKey];
    var allowedSeats = ['window', 'aisle'];
    var missingFields = [];

    if (!name) missingFields.push('Name');
    if (!phone) missingFields.push('Phone');
    if (!seat || allowedSeats.indexOf(seat) === -1) missingFields.push('Seat Preference');

    if (missingFields.length) {
        console.log('Confirm reservation values:', {
            name: name,
            phone: phone,
            seat: seat,
            selectedDate: selectedDate,
            activeFilterDate: activeFilters.date,
        });
        missingFields.forEach(function (field) {
            console.log('Confirm reservation validation failed for field:', field);
        });
        alert('Please fill in all fields!');
        bookingFlowState.isSubmitting = false;
        setBookingButtonLoading(false);
        return;
    }

    if (!travelDate) {
        alert('Unable to determine travel date for this train. Please pick another schedule.');
        bookingFlowState.isSubmitting = false;
        setBookingButtonLoading(false);
        return;
    }

    if (!selectedTrainKey || !train) {
        alert('Please pick a train first.');
        bookingFlowState.isSubmitting = false;
        setBookingButtonLoading(false);
        return;
    }

    if (!user) {
        alert('Session expired. Please login again.');
        window.location.href = 'page.html';
        bookingFlowState.isSubmitting = false;
        setBookingButtonLoading(false);
        return;
    }

    var scheduleRef = rtdb.ref('schedules/' + selectedTrainKey);
    var bookingId = bookingFlowState.pendingBookingId || rtdb.ref('bookings').push().key;

    try {
        var scheduleSnapshot = await scheduleRef.once('value');
        if (!scheduleSnapshot.exists()) {
            alert('This schedule is no longer available. Please refresh and pick another train.');
            return;
        }

        var liveTrain = scheduleSnapshot.val() || {};
        var capacity = parseInt(liveTrain.capacity, 10);
        if (!Number.isFinite(capacity) || capacity <= 0) {
            alert('This schedule cannot accept bookings right now.');
            return;
        }

        var liveTrainId = liveTrain.trainId || selectedTrip.trainId || train.trainId || selectedTrainKey;

        // Idempotent seat reservation: each bookingId can consume one seat only once.
        var seatReservation = await scheduleRef.transaction(function (currentSchedule) {
            if (!currentSchedule) {
                return;
            }

            var txCapacity = parseInt(currentSchedule.capacity, 10);
            if (!Number.isFinite(txCapacity) || txCapacity <= 0) {
                return;
            }

            var processed = currentSchedule.processedBookingIds || {};
            if (processed[bookingId]) {
                return;
            }

            if (txCapacity <= 0) {
                return;
            }

            currentSchedule.capacity = txCapacity - 1;
            if (!currentSchedule.processedBookingIds) {
                currentSchedule.processedBookingIds = {};
            }
            currentSchedule.processedBookingIds[bookingId] = Date.now();
            return currentSchedule;
        });

        if (!seatReservation.committed) {
            alert('Sorry, this train is fully booked. Please choose another schedule.');
            return;
        }

        var updatedSchedule = seatReservation.snapshot.val() || {};
        var remainingCapacity = Number(updatedSchedule.capacity || 0);
        var bookingRef = rtdb.ref('bookings/' + bookingId);
        var bookingPayload = {
            bookingId: bookingId,
            passengerName: name,
            passengerPhone: phone,
            passengerId: phone,
            seatPreference: seat,
            date: travelDate,
            travelDate: travelDate,
            status: 'active',
            trainKey: selectedTrainKey,
            tripId: selectedTrainKey,
            scheduleId: selectedTrainKey,
            trainId: liveTrainId,
            fromStation: liveTrain.from || selectedTrip.fromStation || train.from || '',
            toStation: liveTrain.to || selectedTrip.toStation || train.to || '',
            departureTime: liveTrain.departureTime || selectedTrip.departureTime || train.departureTime || '',
            priceSar: Number(liveTrain.priceSar || selectedTrip.priceSar || train.priceSar || 0),
            userId: user.uid,
            userEmail: user.email || '',
            createdAt: new Date().toISOString(),
        };

        try {
            await bookingRef.set(bookingPayload);

            // Firestore mirror is best-effort and must not block passenger booking success.
            if (fsdb && typeof fsdb.collection === 'function') {
                fsdb.collection('bookings').doc(bookingId).set(bookingPayload, { merge: true }).catch(function (mirrorError) {
                    console.warn('Firestore mirror write failed, but booking is saved in RTDB:', mirrorError);
                });
            }
        } catch (writeError) {
            await scheduleRef.transaction(function (currentSchedule) {
                if (!currentSchedule) {
                    return currentSchedule;
                }

                var txCapacity = parseInt(currentSchedule.capacity, 10);
                if (!Number.isFinite(txCapacity) || txCapacity < 0) {
                    txCapacity = 0;
                }

                currentSchedule.capacity = txCapacity + 1;

                if (currentSchedule.processedBookingIds && currentSchedule.processedBookingIds[bookingId]) {
                    delete currentSchedule.processedBookingIds[bookingId];
                }

                return currentSchedule;
            });

            try {
                await bookingRef.remove();
            } catch (_cleanupErr) {}

            throw writeError;
        }

        var remainingSeats = Math.max(remainingCapacity, 0);
        trains[selectedTrainKey] = Object.assign({}, trains[selectedTrainKey] || {}, liveTrain, {
            capacity: remainingSeats,
        });
        baseTrains[selectedTrainKey] = Object.assign({}, baseTrains[selectedTrainKey] || {}, liveTrain, {
            capacity: remainingSeats,
        });
        allSchedulesCache[selectedTrainKey] = Object.assign({}, allSchedulesCache[selectedTrainKey] || {}, liveTrain, {
            capacity: remainingSeats,
        });
        applyClientFiltersAndRender();

        alert('Success! Ticket Reserved for: ' + name + '. Remaining seats: ' + remainingSeats + '.');
        resetBookingForm();
        closeModal();
    } catch (error) {
        console.error(error);
        alert('Failed to save booking. Check Firebase setup and Realtime Database rules.');
    } finally {
        bookingFlowState.isSubmitting = false;
        setBookingButtonLoading(false);
    }
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

        var passengerNameInput = document.getElementById('pName');
        if (passengerNameInput && !passengerNameInput.value) {
            passengerNameInput.value = user.displayName || '';
        }

        initProfileMenu(user);
        initBookingModalHandlers();
        initAdvancedFilterUI();
        watchMyBookings(user);
        showRegistrationWelcomeIfAny();
        loadRebookDraft();

        var results = document.getElementById('trainResults');
        if (results) {
            results.innerHTML = '<div class="train-card"><div class="ticket-main"><h4>Loading trains...</h4><p>Fetching schedules from Firebase.</p></div></div>';
        }

        startSchedulesListener();
        applyRebookDraftIfNeeded();
    }).catch(function () {
        window.location.href = 'page.html';
    });
});