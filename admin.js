var auth = window.auth || firebase.auth();
var rtdb = window.rtdb || firebase.database();
var fsdb = window.fsdb || (typeof firebase.firestore === 'function' ? firebase.firestore() : null);
var adminEmails = (window.ADMIN_EMAILS || []).map(function (email) {
    return String(email || '').trim().toLowerCase();
});

var trainsRef = rtdb.ref('schedules');
var bookingsRef = rtdb.ref('bookings');
var addFormState = {
    initialized: false,
    editingKey: null,
};
var deleteFormState = {
    initialized: false,
    pendingKey: null,
};
var inquiriesState = {
    initialized: false,
    unsubscribe: null,
    rows: [],
    activeFilter: 'all',
    searchQuery: '',
};

function hasSweetAlert() {
    return Boolean(window.Swal && typeof window.Swal.fire === 'function');
}

function normalizeTrainId(value) {
    return String(value || '').trim().toLowerCase();
}

function findCascadeDeleteTargets(trainKey, trainId, schedules, bookings) {
    var scheduleMap = schedules || {};
    var bookingMap = bookings || {};
    var normalizedTrainId = normalizeTrainId(trainId);
    var relatedScheduleKeyLookup = {};

    if (trainKey) {
        relatedScheduleKeyLookup[String(trainKey)] = true;
    }

    if (normalizedTrainId) {
        Object.keys(scheduleMap).forEach(function (scheduleKey) {
            var schedule = scheduleMap[scheduleKey] || {};
            if (normalizeTrainId(schedule.trainId) === normalizedTrainId) {
                relatedScheduleKeyLookup[scheduleKey] = true;
            }
        });
    }

    var relatedScheduleKeys = Object.keys(relatedScheduleKeyLookup);
    var relatedBookingKeys = [];

    Object.keys(bookingMap).forEach(function (bookingKey) {
        var booking = bookingMap[bookingKey] || {};
        var linkedByScheduleKey = Boolean(booking.trainKey) && Boolean(relatedScheduleKeyLookup[String(booking.trainKey)]);
        var linkedByTrainId = Boolean(normalizedTrainId) && normalizeTrainId(booking.trainId) === normalizedTrainId;

        if (linkedByScheduleKey || linkedByTrainId) {
            relatedBookingKeys.push(bookingKey);
        }
    });

    return {
        relatedScheduleKeys: relatedScheduleKeys,
        relatedBookingKeys: relatedBookingKeys,
    };
}

function askDeleteConfirmation(trainId, scheduleCount, bookingCount) {
    var trainLabel = trainId || 'this schedule';
    var message = 'Delete ' + trainLabel + '? This will remove ' + scheduleCount + ' schedule(s) and cancel ' + bookingCount + ' related booking(s).';

    if (!hasSweetAlert()) {
        return Promise.resolve(window.confirm(message));
    }

    return window.Swal.fire({
        icon: 'question',
        title: 'Confirm Deletion',
        html: '<p style="margin:0 0 8px;">Delete <strong>' + escapeHtml(trainLabel) + '</strong>?</p>' +
            '<p style="margin:0;">This will remove <strong>' + String(scheduleCount) + '</strong> schedule(s) and cancel <strong>' + String(bookingCount) + '</strong> related booking(s).</p>',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete it',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#967035',
        cancelButtonColor: '#967035',
        reverseButtons: true,
        customClass: {
            popup: 'admin-delete-confirm-alert',
        },
    }).then(function (result) {
        return Boolean(result.isConfirmed);
    });
}

async function handleScheduleDelete(trainKey, train) {
    if (!trainKey) return;

    var trainData = train || {};
    var trainId = trainData.trainId || trainKey;

    try {
        var snapshots = await Promise.all([
            trainsRef.once('value'),
            bookingsRef.once('value'),
        ]);
        var allSchedules = snapshots[0].val() || {};
        var allBookings = snapshots[1].val() || {};
        var targets = findCascadeDeleteTargets(trainKey, trainId, allSchedules, allBookings);

        var confirmed = await askDeleteConfirmation(trainId, targets.relatedScheduleKeys.length, targets.relatedBookingKeys.length);
        if (!confirmed) {
            return;
        }

        var nowIso = new Date().toISOString();
        var updates = {};

        targets.relatedScheduleKeys.forEach(function (scheduleKey) {
            updates['schedules/' + scheduleKey] = null;
        });

        targets.relatedBookingKeys.forEach(function (bookingKey) {
            updates['bookings/' + bookingKey + '/status'] = 'cancelled';
            updates['bookings/' + bookingKey + '/bookingStatus'] = 'cancelled';
            updates['bookings/' + bookingKey + '/trainDeleted'] = true;
            updates['bookings/' + bookingKey + '/cancelReason'] = 'linked_train_deleted';
            updates['bookings/' + bookingKey + '/cancelledAt'] = nowIso;
            updates['bookings/' + bookingKey + '/updatedAt'] = nowIso;
        });

        if (!Object.keys(updates).length) {
            return;
        }

        await rtdb.ref().update(updates);

        if (hasSweetAlert()) {
            await window.Swal.fire({
                icon: 'success',
                title: 'Train deleted',
                text: 'Related schedules and bookings were updated automatically.',
                confirmButtonColor: '#967035',
            });
        }
    } catch (error) {
        console.error(error);
        alert('Could not delete this schedule. Please try again.');
    }
}

function isBootstrapAdminEmail(email) {
    var normalized = String(email || '').trim().toLowerCase();
    return adminEmails.indexOf(normalized) !== -1;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setProfileMenuInitial(user, profile) {
    var labelEl = document.getElementById('profileMenuLabel');
    if (!labelEl) return;

    var firstName = profile && profile.firstName ? profile.firstName : '';
    var displayName = firstName || user.displayName || user.email || '';
    var initial = String(displayName).trim().charAt(0).toUpperCase();

    if (!initial) {
        labelEl.innerHTML = '<i class="fas fa-user"></i>';
        return;
    }

    labelEl.textContent = initial;
}

function formatInquiryDate(value) {
    if (!value) return 'N/A';

    if (value && typeof value.toDate === 'function') {
        try {
            return value.toDate().toLocaleString();
        } catch (_err) {
            return 'N/A';
        }
    }

    var parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        return 'N/A';
    }
    return parsed.toLocaleString();
}

function sortInquiriesByDateDesc(rows) {
    return (rows || []).slice().sort(function (a, b) {
        var aTime = a._sortTimestamp || 0;
        var bTime = b._sortTimestamp || 0;
        return bTime - aTime;
    });
}

function getFilteredInquiryRows() {
    var activeFilter = String(inquiriesState.activeFilter || 'all').toLowerCase();
    var query = String(inquiriesState.searchQuery || '').trim().toLowerCase();

    return (inquiriesState.rows || []).filter(function (item) {
        var status = String(item.status || 'open').toLowerCase();
        var matchesFilter = activeFilter === 'all' || status === activeFilter;
        if (!matchesFilter) return false;

        if (!query) return true;

        var searchable = [
            item.fullName || '',
            item.subject || '',
            item.email || '',
        ].join(' ').toLowerCase();

        return searchable.indexOf(query) !== -1;
    });
}

function renderInquiriesWithCurrentFilters() {
    renderCustomerInquiriesTable(getFilteredInquiryRows());
}

function renderCustomerInquiriesTable(rows) {
    var wrap = document.getElementById('customerInquiriesTableWrap');
    if (!wrap) return;

    var items = rows || [];
    if (!items.length) {
        if ((inquiriesState.rows || []).length) {
            wrap.innerHTML = '<div class="empty-state">No inquiries match current filters.</div>';
            return;
        }

        wrap.innerHTML = '<div class="empty-state">No customer inquiries yet.</div>';
        return;
    }

    wrap.innerHTML =
        '<div class="inquiries-header">' +
            '<span>Sender Name</span><span>Email</span><span>Subject</span><span>Date</span><span>Message</span><span>Actions</span>' +
        '</div>' +
        items.map(function (item) {
            var isResolved = String(item.status || '').toLowerCase() === 'resolved';
            return '<article class="inquiries-row">' +
                '<span>' + escapeHtml(item.fullName || 'Unknown') + '</span>' +
                '<span>' + escapeHtml(item.email || 'N/A') + '</span>' +
                '<span class="inquiry-subject-wrap"><strong>' + escapeHtml(item.subject || 'No subject') + '</strong>' +
                    '<small class="inquiry-status' + (isResolved ? ' resolved' : '') + '">' + escapeHtml(isResolved ? 'Resolved' : 'Open') + '</small></span>' +
                '<span>' + escapeHtml(formatInquiryDate(item.timestamp || item.createdAt)) + '</span>' +
                '<span class="inquiry-message-cell" title="' + escapeHtml(item.message || '') + '">' + escapeHtml(item.message || 'No message content') + '</span>' +
                '<span class="inquiry-actions">' +
                    '<button class="inquiry-action-btn view" type="button" data-action="view" data-id="' + escapeHtml(item.id) + '">View Message</button>' +
                    '<button class="inquiry-action-btn resolve" type="button" data-action="resolve" data-id="' + escapeHtml(item.id) + '"' + (isResolved ? ' disabled' : '') + '>Resolved</button>' +
                    '<button class="inquiry-action-btn delete" type="button" data-action="delete" data-id="' + escapeHtml(item.id) + '">Delete</button>' +
                '</span>' +
            '</article>';
        }).join('');
}

function showInquiryMessage(item) {
    if (!item) return;

    var bodyHtml =
        '<p style="margin:0 0 8px;"><strong>From:</strong> ' + escapeHtml(item.fullName || 'Unknown') + ' (' + escapeHtml(item.email || 'No email') + ')</p>' +
        '<p style="margin:0 0 8px;"><strong>Subject:</strong> ' + escapeHtml(item.subject || 'No subject') + '</p>' +
        '<p style="margin:0 0 8px;"><strong>Date:</strong> ' + escapeHtml(formatInquiryDate(item.timestamp || item.createdAt)) + '</p>' +
        '<div style="border:1px solid #e6ddd0;border-radius:8px;padding:10px;background:#fffdf9;white-space:pre-wrap;">' + escapeHtml(item.message || 'No message content') + '</div>';

    if (hasSweetAlert()) {
        window.Swal.fire({
            title: 'Inquiry Message',
            html: bodyHtml,
            confirmButtonColor: '#967035',
        });
        return;
    }

    alert('From: ' + (item.fullName || 'Unknown') + '\nSubject: ' + (item.subject || 'No subject') + '\n\n' + (item.message || 'No message content'));
}

async function markInquiryResolved(inquiryId) {
    if (!fsdb || !inquiryId) return;

    try {
        await fsdb.collection('inquiries').doc(inquiryId).update({
            status: 'resolved',
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (window.AppNotify && typeof window.AppNotify.success === 'function') {
            window.AppNotify.success('Inquiry marked as resolved.');
        }
    } catch (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not mark inquiry as resolved.');
        }
    }
}

function askDeleteInquiryConfirmation() {
    if (!hasSweetAlert()) {
        return Promise.resolve(window.confirm('Delete this inquiry? This action cannot be undone.'));
    }

    return window.Swal.fire({
        icon: 'warning',
        title: 'Delete Inquiry?',
        text: 'This action cannot be undone.',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#967035',
        cancelButtonColor: '#967035',
        reverseButtons: true,
    }).then(function (result) {
        return Boolean(result.isConfirmed);
    });
}

async function deleteInquiry(inquiryId) {
    if (!fsdb || !inquiryId) return;

    var confirmed = await askDeleteInquiryConfirmation();
    if (!confirmed) return;

    try {
        await fsdb.collection('inquiries').doc(inquiryId).delete();
        if (window.AppNotify && typeof window.AppNotify.success === 'function') {
            window.AppNotify.success('Inquiry deleted successfully.');
        }
    } catch (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not delete inquiry.');
        }
    }
}

function bindCustomerInquiryActions() {
    var wrap = document.getElementById('customerInquiriesTableWrap');
    if (!wrap || wrap.dataset.actionsBound === 'true') return;

    wrap.dataset.actionsBound = 'true';
    wrap.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-action][data-id]');
        if (!button) return;

        var action = button.getAttribute('data-action');
        var inquiryId = button.getAttribute('data-id');
        if (!action || !inquiryId) return;

        var selected = inquiriesState.rows.filter(function (row) {
            return row.id === inquiryId;
        })[0];

        if (action === 'view') {
            showInquiryMessage(selected);
            return;
        }
        if (action === 'resolve') {
            markInquiryResolved(inquiryId);
            return;
        }
        if (action === 'delete') {
            deleteInquiry(inquiryId);
        }
    });
}

function bindCustomerInquiryControls() {
    var controls = document.getElementById('customerInquiriesControls');
    var chipsWrap = document.getElementById('inquiryFilterChips');
    var searchInput = document.getElementById('inquirySearchInput');

    if (!controls || controls.dataset.controlsBound === 'true') return;
    controls.dataset.controlsBound = 'true';

    if (chipsWrap) {
        chipsWrap.addEventListener('click', function (event) {
            var chip = event.target.closest('button[data-filter]');
            if (!chip) return;

            var selectedFilter = String(chip.getAttribute('data-filter') || 'all').toLowerCase();
            inquiriesState.activeFilter = selectedFilter;

            chipsWrap.querySelectorAll('button[data-filter]').forEach(function (btn) {
                btn.classList.toggle('active', btn === chip);
            });

            renderInquiriesWithCurrentFilters();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            inquiriesState.searchQuery = String(searchInput.value || '').trim();
            renderInquiriesWithCurrentFilters();
        });
    }
}

function initCustomerInquiriesInbox() {
    if (inquiriesState.initialized) return;
    inquiriesState.initialized = true;

    bindCustomerInquiryActions();
    bindCustomerInquiryControls();

    if (!fsdb || typeof fsdb.collection !== 'function') {
        renderCustomerInquiriesTable([]);
        return;
    }

    inquiriesState.unsubscribe = fsdb.collection('inquiries').onSnapshot(function (snapshot) {
        var nextRows = [];
        snapshot.forEach(function (doc) {
            var data = doc.data() || {};
            var sortTs = 0;

            if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                sortTs = data.timestamp.toDate().getTime();
            } else if (data.createdAt) {
                var parsed = new Date(String(data.createdAt));
                sortTs = Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
            }

            nextRows.push({
                id: doc.id,
                fullName: data.fullName || '',
                email: data.email || '',
                subject: data.subject || '',
                message: data.message || '',
                status: data.status || 'open',
                createdAt: data.createdAt || '',
                timestamp: data.timestamp || null,
                _sortTimestamp: sortTs,
            });
        });

        inquiriesState.rows = sortInquiriesByDateDesc(nextRows);
        renderInquiriesWithCurrentFilters();
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load customer inquiries inbox.');
        }
    });
}

function initProfileMenu(user, profile) {
    var menu = document.getElementById('profileMenu');
    var menuButton = document.getElementById('profileMenuButton');
    var dropdown = document.getElementById('profileDropdown');
    var myProfileLink = dropdown ? dropdown.querySelector('a[href="profile.html"]') : null;
    var logoutBtn = document.getElementById('profileLogoutBtn');
    if (!menu || !menuButton || !dropdown) return;

    if (menu.dataset.initialized === 'true') {
        setProfileMenuInitial(user, profile || {});
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

    setProfileMenuInitial(user, profile || {});
}

function setScheduleModalMode(isEdit) {
    var titleEl = document.getElementById('scheduleModalTitle');
    var saveBtn = document.getElementById('scheduleSaveBtn');
    if (titleEl) {
        titleEl.textContent = isEdit ? 'Edit Schedule' : 'Add New Schedule';
    }
    if (saveBtn) {
        saveBtn.textContent = isEdit ? 'Update Schedule' : 'Save Schedule';
    }
}

function fillScheduleForm(schedule) {
    var trainIdEl = document.getElementById('scheduleTrainId');
    var fromEl = document.getElementById('scheduleFrom');
    var toEl = document.getElementById('scheduleTo');
    var dateEl = document.getElementById('scheduleDate');
    var departureEl = document.getElementById('scheduleDepartureTime');
    var capacityEl = document.getElementById('scheduleCapacity');
    var statusEl = document.getElementById('scheduleStatus');
    var priceEl = document.getElementById('schedulePrice');
    if (!trainIdEl || !fromEl || !toEl || !dateEl || !departureEl || !capacityEl || !statusEl || !priceEl) {
        return;
    }

    trainIdEl.value = schedule.trainId || '';
    fromEl.value = schedule.from || '';
    toEl.value = schedule.to || '';
    dateEl.value = schedule.date || '';
    departureEl.value = schedule.departureTime || '';
    capacityEl.value = Number.isFinite(Number(schedule.capacity)) ? String(schedule.capacity) : '';
    statusEl.value = ['active', 'delayed', 'cancelled'].indexOf(schedule.status) === -1 ? 'active' : schedule.status;
    priceEl.value = Number.isFinite(Number(schedule.priceSar)) ? String(schedule.priceSar) : '';
}

function setScheduleFormError(message) {
    var errorEl = document.getElementById('scheduleFormError');
    if (!errorEl) return;
    errorEl.textContent = message || '';
}

function resetScheduleForm() {
    var form = document.getElementById('scheduleForm');
    var statusEl = document.getElementById('scheduleStatus');
    if (!form) return;
    form.reset();
    addFormState.editingKey = null;
    if (statusEl) {
        statusEl.value = 'active';
    }
    setScheduleModalMode(false);
    setScheduleFormError('');
}

function openScheduleModal(options) {
    var backdrop = document.getElementById('scheduleModalBackdrop');
    if (!backdrop) return;

    var config = options || {};
    var isEdit = Boolean(config.key && config.schedule);

    if (isEdit) {
        addFormState.editingKey = config.key;
        setScheduleModalMode(true);
        fillScheduleForm(config.schedule);
    } else {
        resetScheduleForm();
        setScheduleModalMode(false);
    }

    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    setScheduleFormError('');

    var firstInput = document.getElementById('scheduleTrainId');
    if (firstInput) {
        window.setTimeout(function () {
            firstInput.focus();
        }, 0);
    }
}

function closeScheduleModal() {
    var backdrop = document.getElementById('scheduleModalBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    resetScheduleForm();
}

function getSchedulePayloadFromForm() {
    var trainIdEl = document.getElementById('scheduleTrainId');
    var fromEl = document.getElementById('scheduleFrom');
    var toEl = document.getElementById('scheduleTo');
    var dateEl = document.getElementById('scheduleDate');
    var departureEl = document.getElementById('scheduleDepartureTime');
    var capacityEl = document.getElementById('scheduleCapacity');
    var statusEl = document.getElementById('scheduleStatus');
    var priceEl = document.getElementById('schedulePrice');

    if (!trainIdEl || !fromEl || !toEl || !dateEl || !departureEl || !capacityEl || !statusEl || !priceEl) {
        return null;
    }

    var trainId = trainIdEl.value.trim();
    var from = fromEl.value;
    var to = toEl.value;
    var date = dateEl.value;
    var departureTime = departureEl.value;
    var capacity = parseInt(capacityEl.value, 10);
    var status = String(statusEl.value || '').toLowerCase();
    var priceSar = parseFloat(priceEl.value);

    if (!trainId || !from || !to || !date || !departureTime || !capacityEl.value || !status || !priceEl.value) {
        setScheduleFormError('Please fill in all schedule fields.');
        return null;
    }

    if (from === to) {
        setScheduleFormError('From and To cities cannot be the same.');
        return null;
    }

    if (!Number.isFinite(capacity) || capacity <= 0) {
        setScheduleFormError('Capacity must be a positive number.');
        return null;
    }

    if (!Number.isFinite(priceSar) || priceSar < 0) {
        setScheduleFormError('Price must be a non-negative number.');
        return null;
    }

    if (['active', 'delayed', 'cancelled'].indexOf(status) === -1) {
        setScheduleFormError('Status must be active, delayed, or cancelled.');
        return null;
    }

    setScheduleFormError('');
    return {
        trainId: trainId,
        from: from,
        to: to,
        date: date,
        departureTime: departureTime,
        capacity: capacity,
        status: status,
        priceSar: priceSar,
        updatedAt: new Date().toISOString(),
    };
}

function formatScheduleDate(dateStr) {
    if (!dateStr) {
        return 'N/A';
    }

    var date = new Date(String(dateStr) + 'T00:00:00');
    if (Number.isNaN(date.getTime())) {
        return dateStr;
    }

    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function initScheduleModal(user) {
    if (addFormState.initialized) {
        return;
    }
    addFormState.initialized = true;

    var addBtn = document.getElementById('addTrainBtn');
    var closeBtn = document.getElementById('scheduleModalClose');
    var backdrop = document.getElementById('scheduleModalBackdrop');
    var form = document.getElementById('scheduleForm');
    var saveBtn = document.getElementById('scheduleSaveBtn');
    if (!addBtn || !closeBtn || !backdrop || !form || !saveBtn) {
        return;
    }

    addBtn.addEventListener('click', function () {
        openScheduleModal();
    });

    closeBtn.addEventListener('click', function () {
        closeScheduleModal();
    });

    backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) {
            closeScheduleModal();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && backdrop.classList.contains('open')) {
            closeScheduleModal();
        }
    });

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var payload = getSchedulePayloadFromForm();
        if (!payload) {
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = addFormState.editingKey ? 'Updating...' : 'Saving...';

        try {
            if (addFormState.editingKey) {
                payload.updatedBy = user.uid;
                await trainsRef.child(addFormState.editingKey).update(payload);
            } else {
                payload.createdAt = new Date().toISOString();
                payload.createdBy = user.uid;
                await trainsRef.push(payload);
            }
            closeScheduleModal();
        } catch (error) {
            console.error(error);
            setScheduleFormError('Could not save schedule. Please try again.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = addFormState.editingKey ? 'Update Schedule' : 'Save Schedule';
        }
    });
}

function openDeleteModal(trainKey, trainId) {
    var backdrop = document.getElementById('deleteModalBackdrop');
    var label = document.getElementById('deleteModalTrainLabel');
    if (!backdrop || !label) return;

    deleteFormState.pendingKey = trainKey;
    label.textContent = trainId || 'this schedule';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
}

function closeDeleteModal() {
    var backdrop = document.getElementById('deleteModalBackdrop');
    var confirmBtn = document.getElementById('deleteModalConfirm');
    if (!backdrop) return;

    deleteFormState.pendingKey = null;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete';
    }
}

function initDeleteModal() {
    if (deleteFormState.initialized) {
        return;
    }
    deleteFormState.initialized = true;

    var backdrop = document.getElementById('deleteModalBackdrop');
    var closeBtn = document.getElementById('deleteModalClose');
    var cancelBtn = document.getElementById('deleteModalCancel');
    var confirmBtn = document.getElementById('deleteModalConfirm');
    if (!backdrop || !closeBtn || !cancelBtn || !confirmBtn) {
        return;
    }

    closeBtn.addEventListener('click', function () {
        closeDeleteModal();
    });

    cancelBtn.addEventListener('click', function () {
        closeDeleteModal();
    });

    backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) {
            closeDeleteModal();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && backdrop.classList.contains('open')) {
            closeDeleteModal();
        }
    });

    confirmBtn.addEventListener('click', async function () {
        if (!deleteFormState.pendingKey) {
            closeDeleteModal();
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';

        try {
            await trainsRef.child(deleteFormState.pendingKey).remove();
            closeDeleteModal();
        } catch (error) {
            console.error(error);
            alert('Could not delete this schedule. Please try again.');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete';
        }
    });
}

function renderTrains(trains) {
    var cardsContainer = document.getElementById('trainsTableBody');
    if (!cardsContainer) return;

    var keys = Object.keys(trains || {});
    if (!keys.length) {
        cardsContainer.innerHTML = '<div class="empty-state">No trains yet. Click Add New Schedule.</div>';
        return;
    }

    cardsContainer.innerHTML =
        '<div class="schedule-list-header">' +
            '<span>Train</span>' +
            '<span>Route</span>' +
            '<span>Date</span>' +
            '<span>Departure</span>' +
            '<span>Capacity</span>' +
            '<span>Price</span>' +
            '<span>Status</span>' +
            '<span>Actions</span>' +
        '</div>' +
        keys.map(function (key) {
        var t = trains[key] || {};
        var statusClass = ['active', 'delayed', 'cancelled'].indexOf(t.status) === -1 ? 'active' : t.status;
        return (
            '<article class="train-schedule-card">' +
                '<span class="schedule-cell train-id-cell">' + escapeHtml(t.trainId || key) + '</span>' +
                '<span class="schedule-cell route-cell">' + escapeHtml(t.from) + ' -> ' + escapeHtml(t.to) + '</span>' +
                '<span class="schedule-cell">' + escapeHtml(formatScheduleDate(t.date)) + '</span>' +
                '<span class="schedule-cell">' + escapeHtml(t.departureTime || 'N/A') + '</span>' +
                '<span class="schedule-cell">' + escapeHtml(t.capacity || 0) + ' seats</span>' +
                '<span class="schedule-cell schedule-price">' + escapeHtml(t.priceSar || 0) + ' SAR</span>' +
                '<span class="schedule-cell"><span class="status ' + escapeHtml(statusClass) + '">' + escapeHtml(t.status || 'active') + '</span></span>' +
                '<div class="schedule-actions">' +
                    '<button class="action-btn edit" title="Edit train" aria-label="Edit train" data-action="edit" data-key="' + escapeHtml(key) + '"><i class="fas fa-pen"></i></button>' +
                    '<button class="action-btn delete" title="Delete train" aria-label="Delete train" data-action="delete" data-key="' + escapeHtml(key) + '"><i class="fas fa-trash"></i></button>' +
                '</div>' +
            '</article>'
        );
    }).join('');
}

function formatBookingDate(dateStr) {
    if (!dateStr) {
        return 'N/A';
    }

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

function getAdminBookingDateValue(booking) {
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

function toSummaryDateValue(rawDate) {
    var value = String(rawDate || '').trim();
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }

    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    return parsed.toISOString().slice(0, 10);
}

function aggregateBookingsByDate(bookings) {
    var grouped = {};
    Object.keys(bookings || {}).forEach(function (key) {
        var booking = bookings[key] || {};
        var bookingDate = toSummaryDateValue(getAdminBookingDateValue(booking));
        if (!bookingDate) {
            return;
        }

        if (!grouped[bookingDate]) {
            grouped[bookingDate] = {
                date: bookingDate,
                totalBookings: 0,
                totalRevenue: 0,
            };
        }

        grouped[bookingDate].totalBookings += 1;
        grouped[bookingDate].totalRevenue += Number(booking.priceSar || booking.price || 0);
    });

    return Object.keys(grouped).map(function (dateKey) {
        return grouped[dateKey];
    }).sort(function (a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
}

var reportUiState = {
    initialized: false,
    activeTab: 'daily',
    selectedDay: '',
    selectedMonth: '',
    lastSnapshot: null,
};

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

function shiftMonthKey(monthKey, delta) {
    var base = String(monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(base)) {
        base = getCurrentMonthKey();
    }
    var d = new Date(base + '-01T00:00:00');
    d.setMonth(d.getMonth() + delta);
    return d.toISOString().slice(0, 7);
}

function getMonthRange(monthKey) {
    var normalized = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? monthKey : getCurrentMonthKey();
    var start = new Date(normalized + '-01T00:00:00');
    var end = new Date(start);
    end.setMonth(start.getMonth() + 1);
    end.setDate(0);
    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
    };
}

function getWeekRangeEnding(dayKey) {
    var endDate = new Date((dayKey || getTodayKey()) + 'T00:00:00');
    if (Number.isNaN(endDate.getTime())) {
        endDate = new Date();
    }
    var startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    return {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
    };
}

function isDateWithinRange(dateValue, startDate, endDate) {
    if (!dateValue) return false;
    if (startDate && dateValue < startDate) return false;
    if (endDate && dateValue > endDate) return false;
    return true;
}

function collectBookingsWithinRange(bookings, startDate, endDate) {
    var collected = [];
    Object.keys(bookings || {}).forEach(function (key) {
        var booking = bookings[key] || {};
        var bookingDate = toSummaryDateValue(getAdminBookingDateValue(booking));
        collected.push({
            key: key,
            booking: booking,
            date: bookingDate,
        });
    });
    return collected;
}

function summarizeBookingEntries(entries) {
    var passengers = {};
    var totalRevenue = 0;

    (entries || []).forEach(function (entry) {
        var booking = (entry && entry.booking) || {};
        totalRevenue += Number(booking.priceSar || booking.price || 0);
        var passengerId = booking.userId || booking.passengerPhone || booking.passengerId || booking.passengerName || '';
        if (passengerId) {
            passengers[String(passengerId)] = true;
        }
    });

    return {
        totalPassengers: Object.keys(passengers).length,
        totalBookings: (entries || []).length,
        totalRevenue: totalRevenue,
    };
}

function buildDailyRows(entries) {
    var grouped = {};
    (entries || []).forEach(function (entry) {
        var booking = (entry && entry.booking) || {};
        var dateKey = entry.date;
        if (!dateKey) return;
        if (!grouped[dateKey]) {
            grouped[dateKey] = {
                date: dateKey,
                totalBookings: 0,
                totalRevenue: 0,
            };
        }
        grouped[dateKey].totalBookings += 1;
        grouped[dateKey].totalRevenue += Number(booking.priceSar || booking.price || 0);
    });

    return Object.keys(grouped).map(function (dateKey) {
        return grouped[dateKey];
    }).sort(function (a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
}

function parseSeatCapacity(schedule) {
    if (!schedule || typeof schedule !== 'object') return 0;

    var totalSeats = Number(schedule.totalSeats);
    if (Number.isFinite(totalSeats) && totalSeats > 0) {
        return Math.floor(totalSeats);
    }

    var capacity = Number(schedule.capacity);
    if (Number.isFinite(capacity) && capacity > 0) {
        return Math.floor(capacity);
    }

    return 0;
}

function getUtilizationBand(percent) {
    var value = Number(percent || 0);
    if (value > 70) return 'high';
    if (value >= 40) return 'medium';
    return 'low';
}

function buildUtilizationRows(entries, schedulesMap) {
    var schedules = schedulesMap || {};
    var bookingEntries = Array.isArray(entries) ? entries : [];
    var rows = [];

    Object.keys(schedules).forEach(function (scheduleKey) {
        var schedule = schedules[scheduleKey] || {};
        var scheduleId = String(schedule.id || scheduleKey).trim();
        var scheduleTrainId = String(schedule.trainId || '').trim();

        var matchedEntries = bookingEntries.filter(function (entry) {
            var booking = (entry && entry.booking) || {};
            var bookingTripId = String(booking.tripId || '').trim();
            var bookingScheduleId = String(booking.scheduleId || '').trim();
            var bookingTrainKey = String(booking.trainKey || '').trim();
            var bookingTrainId = String(booking.trainId || '').trim();
            return bookingTripId === scheduleId
                || bookingScheduleId === scheduleId
                || bookingTrainKey === scheduleId
                || bookingTrainId === scheduleId;
        });

        var bookedSeats = matchedEntries.length;
        var revenue = matchedEntries.reduce(function (sum, entry) {
            var booking = (entry && entry.booking) || {};
            return sum + Number(booking.priceSar || booking.price || 0);
        }, 0);

        var totalSeats = parseSeatCapacity(schedule);
        var utilizationPercent = totalSeats > 0 ? (bookedSeats / totalSeats) * 100 : 0;
        var safeUtilizationPercent = Number.isFinite(utilizationPercent)
            ? Math.min(Math.max(utilizationPercent, 0), 100)
            : 0;

        rows.push({
            tripId: scheduleId || scheduleKey,
            trainLabel: scheduleTrainId || scheduleId || scheduleKey,
            route: (schedule.from || '-') + ' → ' + (schedule.to || '-'),
            totalSeats: Number.isFinite(totalSeats) ? totalSeats : 0,
            bookedSeats: Number.isFinite(bookedSeats) ? bookedSeats : 0,
            utilizationPercent: safeUtilizationPercent,
            rawUtilizationPercent: Number.isFinite(utilizationPercent) ? utilizationPercent : 0,
            utilizationBand: getUtilizationBand(safeUtilizationPercent),
            revenue: Number.isFinite(revenue) ? revenue : 0,
        });
    });

    return rows.sort(function (a, b) {
        if (b.utilizationPercent !== a.utilizationPercent) {
            return b.utilizationPercent - a.utilizationPercent;
        }
        if (b.bookedSeats !== a.bookedSeats) {
            return b.bookedSeats - a.bookedSeats;
        }
        return String(a.trainLabel || '').localeCompare(String(b.trainLabel || ''));
    });
}

function renderAdminDashboardData() {
    renderAdminBookings(latestBookings);
    renderReportsDashboard(latestBookings);
    updateStats(latestTrains, latestBookings);
}

function initBookingsRealtimeSync() {
    function mergeAndRender() {
        latestBookings = Object.assign({}, bookingsRealtimeState.rtdbBookings || {}, bookingsRealtimeState.firestoreBookings || {});
        console.log('[Admin][Bookings][Merged][ALL]', latestBookings);
        console.log('[Admin][Schedules][ALL]', latestTrains);
        renderAdminDashboardData();
    }

    if (bookingsRealtimeState.firestoreUnsubscribe) {
        bookingsRealtimeState.firestoreUnsubscribe();
        bookingsRealtimeState.firestoreUnsubscribe = null;
    }

    if (!bookingsRealtimeState.rtdbBound) {
        bookingsRealtimeState.rtdbBound = true;
        bookingsRef.on('value', function (snapshot) {
            bookingsRealtimeState.rtdbBookings = snapshot.val() || {};
            console.log('[Admin][Bookings][RTDB][ALL]', bookingsRealtimeState.rtdbBookings);
            mergeAndRender();
        }, function (error) {
            if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
                window.AppNotify.handleError(error, 'Could not sync RTDB bookings fallback.');
            }
        });
    }

    if (!fsdb || typeof fsdb.collection !== 'function') {
        if (window.AppNotify && typeof window.AppNotify.warning === 'function') {
            window.AppNotify.warning('Firestore unavailable, using RTDB bookings fallback.');
        }
        mergeAndRender();
        return;
    }

    bookingsRealtimeState.firestoreUnsubscribe = fsdb.collection('bookings').onSnapshot(function (snapshot) {
        console.log('Bookings found:', snapshot.size);

        var mapped = {};
        snapshot.forEach(function (doc) {
            mapped[doc.id] = doc.data() || {};
        });

        bookingsRealtimeState.firestoreBookings = mapped;
        console.log('[Admin][Bookings][Firestore][ALL]', mapped);
        mergeAndRender();
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not sync Firestore bookings collection. Using RTDB fallback.');
        }
        mergeAndRender();
    });
}

function calculateMonthlyComparison(bookings, monthKey) {
    var currentRange = getMonthRange(monthKey);
    var prevMonthKey = shiftMonthKey(monthKey, -1);
    var previousRange = getMonthRange(prevMonthKey);

    var currentEntries = collectBookingsWithinRange(bookings, currentRange.startDate, currentRange.endDate);
    var previousEntries = collectBookingsWithinRange(bookings, previousRange.startDate, previousRange.endDate);
    var currentSummary = summarizeBookingEntries(currentEntries);
    var previousSummary = summarizeBookingEntries(previousEntries);
    var diff = currentSummary.totalRevenue - previousSummary.totalRevenue;
    var percent = previousSummary.totalRevenue > 0 ? (diff / previousSummary.totalRevenue) * 100 : 0;

    return {
        currentRange: currentRange,
        previousRange: previousRange,
        currentEntries: currentEntries,
        currentSummary: currentSummary,
        previousSummary: previousSummary,
        revenueDiff: diff,
        revenueDiffPercent: percent,
    };
}

function renderReportCards(summary) {
    var passengersEl = document.getElementById('reportPassengersValue');
    var bookingsEl = document.getElementById('reportBookingsValue');
    var revenueEl = document.getElementById('reportRevenueValue');
    if (passengersEl) passengersEl.textContent = String((summary && summary.totalPassengers) || 0);
    if (bookingsEl) bookingsEl.textContent = String((summary && summary.totalBookings) || 0);
    if (revenueEl) revenueEl.textContent = String((summary && summary.totalRevenue) || 0) + ' SAR';
}

function renderDailySummaryTable(rows) {
    var summaryEl = document.getElementById('dailyBookingsSummary');
    if (!summaryEl) return;

    if (!rows || !rows.length) {
        summaryEl.innerHTML = '<div class="empty-state">No report data found for the selected period.</div>';
        return;
    }

    summaryEl.innerHTML =
        '<div class="daily-summary-header">' +
            '<span>Date</span><span>Total Bookings</span><span>Total Revenue (SAR)</span>' +
        '</div>' +
        rows.map(function (row) {
            return '<article class="daily-summary-row">' +
                '<span>' + escapeHtml(formatBookingDate(row.date)) + '</span>' +
                '<span>' + escapeHtml(String(row.totalBookings)) + '</span>' +
                '<span>' + escapeHtml(String(row.totalRevenue)) + ' SAR</span>' +
            '</article>';
        }).join('');
}

function renderUtilizationInsights(rows) {
    var insightsEl = document.getElementById('reportUtilizationInsights');
    if (!insightsEl) return;

    if (!rows || !rows.length) {
        insightsEl.innerHTML = '<div class="empty-state utilization-empty-insights">Utilization insights will appear once booking data is available.</div>';
        return;
    }

    var topPerformer = rows[0];
    var leastUtilized = rows[rows.length - 1];

    function buildInsightCard(title, iconClass, row) {
        return '<article class="utilization-insight-card">' +
            '<p class="utilization-insight-title"><i class="' + escapeHtml(iconClass) + '"></i> ' + escapeHtml(title) + '</p>' +
            '<p class="utilization-insight-train">' + escapeHtml(row.trainLabel) + ' <small>(Trip ' + escapeHtml(row.tripId) + ')</small></p>' +
            '<p class="utilization-insight-meta">Seats: ' + escapeHtml(String(row.bookedSeats)) + ' / ' + escapeHtml(String(row.totalSeats || 0)) + ' • Utilization: ' + escapeHtml(row.utilizationPercent.toFixed(1)) + '%</p>' +
        '</article>';
    }

    insightsEl.innerHTML =
        buildInsightCard('Top Performer', 'fas fa-crown', topPerformer) +
        buildInsightCard('Least Utilized', 'fas fa-chart-line', leastUtilized);
}

function renderUtilizationTable(rows) {
    var utilEl = document.getElementById('reportUtilizationTable');
    if (!utilEl) return;

    if (!rows || !rows.length) {
        utilEl.innerHTML = '<div class="empty-state">No train utilization data yet.</div>';
        renderUtilizationInsights([]);
        return;
    }

    renderUtilizationInsights(rows);

    utilEl.innerHTML =
        '<div class="utilization-header">' +
            '<span>Train / Trip</span><span>Route</span><span>Seats (Booked/Total)</span><span>Occupancy</span><span>Utilization %</span>' +
        '</div>' +
        rows.map(function (row, index) {
            var safeBookedSeats = Number.isFinite(Number(row.bookedSeats)) ? Number(row.bookedSeats) : 0;
            var safeTotalSeats = Number.isFinite(Number(row.totalSeats)) ? Number(row.totalSeats) : 0;
            var safeUtilPercent = Number.isFinite(Number(row.utilizationPercent)) ? Number(row.utilizationPercent) : 0;
            var rankLabel = '';
            if (index === 0) rankLabel = 'Top Performer';
            if (index === rows.length - 1) rankLabel = rows.length > 1 ? 'Least Utilized' : 'Top Performer';
            return '<article class="utilization-row">' +
                '<span class="utilization-train-meta"><strong>' + escapeHtml(row.trainLabel) + '</strong><small>Trip ID: ' + escapeHtml(row.tripId) + '</small></span>' +
                '<span>' + escapeHtml(row.route) + '</span>' +
                '<span class="utilization-seats">' + escapeHtml(String(safeBookedSeats)) + ' / ' + escapeHtml(String(safeTotalSeats)) + '</span>' +
                '<span>' +
                    '<div class="utilization-progress-track"><div class="utilization-progress-fill ' + escapeHtml(row.utilizationBand) + '" style="width:' + escapeHtml(safeUtilPercent.toFixed(1)) + '%;"></div></div>' +
                    '<span class="utilization-progress-text">Booked ' + escapeHtml(String(safeBookedSeats)) + ' of ' + escapeHtml(String(safeTotalSeats)) + ' seats</span>' +
                '</span>' +
                '<span>' +
                    '<span class="utilization-percent-badge ' + escapeHtml(row.utilizationBand) + '">' + escapeHtml(safeUtilPercent.toFixed(1)) + '%</span>' +
                    (rankLabel ? ' <span class="utilization-rank">' + escapeHtml(rankLabel) + '</span>' : '') +
                '</span>' +
            '</article>';
        }).join('');
}

function updateReportPeriodLabel(text) {
    var labelEl = document.getElementById('reportPeriodLabel');
    if (!labelEl) return;
    labelEl.textContent = text || '';
}

function renderReportsDashboard(bookings) {
    var allBookings = bookings || {};
    var tab = reportUiState.activeTab;
    var entries = [];
    var rows = [];
    var utilizationRows = [];
    var summary = { totalPassengers: 0, totalBookings: 0, totalRevenue: 0 };
    var monthlyComparison = null;
    var periodLabelText = '';

    if (tab === 'daily') {
        var selectedDay = toSummaryDateValue(reportUiState.selectedDay || getTodayKey());
        entries = collectBookingsWithinRange(allBookings, selectedDay, selectedDay);
        rows = [{
            date: selectedDay,
            totalBookings: entries.length,
            totalRevenue: entries.reduce(function (sum, item) {
                return sum + Number((item.booking || {}).priceSar || (item.booking || {}).price || 0);
            }, 0),
        }];
        summary = summarizeBookingEntries(entries);
        periodLabelText = 'Daily report for ' + formatBookingDate(selectedDay);
    } else if (tab === 'weekly') {
        var weekRange = getWeekRangeEnding(toSummaryDateValue(reportUiState.selectedDay || getTodayKey()));
        entries = collectBookingsWithinRange(allBookings, weekRange.startDate, weekRange.endDate);
        rows = buildDailyRows(entries);
        summary = summarizeBookingEntries(entries);
        periodLabelText = 'Weekly report: ' + formatBookingDate(weekRange.startDate) + ' to ' + formatBookingDate(weekRange.endDate);
    } else {
        var monthKey = reportUiState.selectedMonth || getCurrentMonthKey();
        monthlyComparison = calculateMonthlyComparison(allBookings, monthKey);
        entries = monthlyComparison.currentEntries;
        rows = buildDailyRows(entries);
        summary = monthlyComparison.currentSummary;

        var diffPrefix = monthlyComparison.revenueDiff >= 0 ? '+' : '-';
        var diffValue = Math.abs(monthlyComparison.revenueDiff);
        var diffPercent = Math.abs(monthlyComparison.revenueDiffPercent).toFixed(1);
        periodLabelText =
            'Monthly report for ' + monthKey +
            ' • Revenue vs previous month: ' + diffPrefix + diffValue + ' SAR (' + diffPrefix + diffPercent + '%)';
    }

    utilizationRows = buildUtilizationRows(entries, latestTrains);

    renderReportCards(summary);
    renderDailySummaryTable(rows);
    renderUtilizationTable(utilizationRows);
    updateReportPeriodLabel(periodLabelText);

    reportUiState.lastSnapshot = {
        tab: tab,
        periodLabel: periodLabelText,
        summary: summary,
        rows: rows,
        utilizationRows: utilizationRows,
        entries: entries,
        monthlyComparison: monthlyComparison,
    };
}

function ensureReportSnapshot() {
    if (!reportUiState.lastSnapshot) {
        renderReportsDashboard(latestBookings || {});
    }
    return reportUiState.lastSnapshot;
}

function formatReportMoney(value) {
    return String(Number(value || 0)) + ' SAR';
}

function exportCurrentReportToPdf() {
    var snapshot = ensureReportSnapshot();
    if (!snapshot) return;

    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('PDF library is not loaded. Please refresh the page and try again.');
        return;
    }

    var jsPDFCtor = window.jspdf.jsPDF;
    var doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(150, 112, 53);
    doc.rect(0, 0, pageWidth, 64, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Diriyah Train - System Report', 40, 40);

    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(snapshot.periodLabel || 'System report', 40, 86);
    doc.text('Generated: ' + new Date().toLocaleString(), 40, 102);

    var cardsTop = 120;
    var cardWidth = (pageWidth - 100) / 3;
    var cardGap = 10;
    var cardTitles = ['Total Passengers', 'Total Bookings', 'Total Revenue'];
    var cardValues = [
        String((snapshot.summary || {}).totalPassengers || 0),
        String((snapshot.summary || {}).totalBookings || 0),
        formatReportMoney((snapshot.summary || {}).totalRevenue || 0),
    ];

    cardTitles.forEach(function (title, index) {
        var x = 40 + index * (cardWidth + cardGap);
        doc.setFillColor(247, 239, 226);
        doc.setDrawColor(225, 209, 184);
        doc.roundedRect(x, cardsTop, cardWidth, 76, 8, 8, 'FD');
        doc.setTextColor(118, 105, 82);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(title, x + 12, cardsTop + 24);
        doc.setTextColor(150, 112, 53);
        doc.setFontSize(14);
        doc.text(cardValues[index], x + 12, cardsTop + 52);
    });

    doc.setTextColor(70, 70, 70);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Train Utilization Metrics', 40, 230);

    var utilRows = (snapshot.utilizationRows || []).map(function (row, index, list) {
        var rankLabel = '';
        if (index === 0) rankLabel = 'Top Performer';
        if (index === list.length - 1) rankLabel = list.length > 1 ? 'Least Utilized' : 'Top Performer';
        return [
            (row.trainLabel || '-') + ' (' + (row.tripId || '-') + ')',
            row.route || '-',
            String(row.bookedSeats || 0) + ' / ' + String(row.totalSeats || 0),
            Number(row.utilizationPercent || 0).toFixed(1) + '%',
            rankLabel || '-',
        ];
    });

    if (typeof doc.autoTable === 'function') {
        doc.autoTable({
            startY: 242,
            head: [['Train / Trip', 'Route', 'Seats (Booked/Total)', 'Utilization %', 'Rank']],
            body: utilRows.length ? utilRows : [['No data', '-', '-', '-', '-']],
            theme: 'grid',
            headStyles: { fillColor: [150, 112, 53], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 6 },
            alternateRowStyles: { fillColor: [252, 248, 242] },
        });
    } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text('autoTable plugin missing. Install jspdf-autotable to render table.', 40, 252);
    }

    doc.save('Diriyah_Train_System_Report.pdf');
}

function exportCurrentReportToExcel() {
    var snapshot = ensureReportSnapshot();
    if (!snapshot) return;

    if (!window.XLSX || !window.XLSX.utils) {
        alert('Excel library is not loaded. Please refresh the page and try again.');
        return;
    }

    var XLSX = window.XLSX;
    var wb = XLSX.utils.book_new();

    var summaryData = [
        ['Diriyah Train - System Report'],
        ['Period', snapshot.periodLabel || 'N/A'],
        ['Report Type', String(snapshot.tab || '').toUpperCase()],
        ['Generated At', new Date().toLocaleString()],
        [],
        ['Metric', 'Value'],
        ['Total Passengers', (snapshot.summary || {}).totalPassengers || 0],
        ['Total Bookings', (snapshot.summary || {}).totalBookings || 0],
        ['Total Revenue (SAR)', (snapshot.summary || {}).totalRevenue || 0],
    ];

    if (snapshot.monthlyComparison) {
        summaryData.push([]);
        summaryData.push(['Monthly Comparison']);
        summaryData.push(['Current Month Revenue (SAR)', snapshot.monthlyComparison.currentSummary.totalRevenue || 0]);
        summaryData.push(['Previous Month Revenue (SAR)', snapshot.monthlyComparison.previousSummary.totalRevenue || 0]);
        summaryData.push(['Revenue Difference (SAR)', snapshot.monthlyComparison.revenueDiff || 0]);
        summaryData.push(['Revenue Difference (%)', Number((snapshot.monthlyComparison.revenueDiffPercent || 0).toFixed(2))]);
    }

    var wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    var bookingRows = (snapshot.entries || []).map(function (entry) {
        var b = (entry && entry.booking) || {};
        return {
            Date: entry.date || '',
            BookingID: b.bookingId || entry.key || '',
            Passenger: b.passengerName || '',
            Email: b.userEmail || '',
            Train: b.trainId || b.trainKey || '',
            Route: (b.fromStation || '-') + ' -> ' + (b.toStation || '-'),
            Seat: b.seatNumber || b.seatPreference || '',
            Status: b.status || '',
            PriceSAR: Number(b.priceSar || b.price || 0),
        };
    });

    var wsBookings = XLSX.utils.json_to_sheet(bookingRows.length ? bookingRows : [{ Info: 'No bookings data for selected period' }]);
    XLSX.utils.book_append_sheet(wb, wsBookings, 'Bookings');

    var utilizationRows = (snapshot.utilizationRows || []).map(function (row, index, list) {
        var rankLabel = '';
        if (index === 0) rankLabel = 'Top Performer';
        if (index === list.length - 1) rankLabel = list.length > 1 ? 'Least Utilized' : 'Top Performer';
        return {
            Train: row.trainLabel || '-',
            TripID: row.tripId || '-',
            Route: row.route || '-',
            BookedSeats: Number(row.bookedSeats || 0),
            TotalSeats: Number(row.totalSeats || 0),
            UtilizationPercent: Number(Number(row.utilizationPercent || 0).toFixed(2)),
            UtilizationBand: row.utilizationBand || '-',
            Rank: rankLabel || '-',
        };
    });

    var wsUtilization = XLSX.utils.json_to_sheet(utilizationRows.length ? utilizationRows : [{ Info: 'No utilization data for selected period' }]);
    XLSX.utils.book_append_sheet(wb, wsUtilization, 'Utilization');

    XLSX.writeFile(wb, 'Diriyah_Train_Report.xlsx');
}

function updateReportsFilterInputs() {
    var dateWrap = document.getElementById('reportDatePickerWrap');
    var monthWrap = document.getElementById('reportMonthPickerWrap');
    var dateInput = document.getElementById('reportDatePicker');
    var monthInput = document.getElementById('reportMonthPicker');
    if (!dateWrap || !monthWrap || !dateInput || !monthInput) return;

    if (reportUiState.activeTab === 'monthly') {
        dateWrap.style.display = 'none';
        monthWrap.style.display = '';
        monthInput.value = reportUiState.selectedMonth || getCurrentMonthKey();
    } else {
        dateWrap.style.display = '';
        monthWrap.style.display = 'none';
        dateInput.value = reportUiState.selectedDay || getTodayKey();
    }
}

function setActiveReportTab(tab) {
    reportUiState.activeTab = tab;
    document.querySelectorAll('.reports-tab').forEach(function (btn) {
        btn.classList.toggle('active', (btn.getAttribute('data-tab') || '') === tab);
    });
    updateReportsFilterInputs();
    renderReportsDashboard(latestBookings);
}

function initReportsSection() {
    if (reportUiState.initialized) return;
    reportUiState.initialized = true;

    reportUiState.selectedDay = getTodayKey();
    reportUiState.selectedMonth = getCurrentMonthKey();

    document.querySelectorAll('.reports-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var tab = btn.getAttribute('data-tab') || 'daily';
            setActiveReportTab(tab);
        });
    });

    var applyBtn = document.getElementById('applyReportFilterBtn');
    var resetBtn = document.getElementById('resetReportFilterBtn');
    var dateInput = document.getElementById('reportDatePicker');
    var monthInput = document.getElementById('reportMonthPicker');
    var exportPdfBtn = document.getElementById('exportReportPdfBtn');
    var exportExcelBtn = document.getElementById('exportReportExcelBtn');

    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            if (reportUiState.activeTab === 'monthly') {
                var monthValue = String((monthInput && monthInput.value) || '').trim();
                reportUiState.selectedMonth = /^\d{4}-\d{2}$/.test(monthValue) ? monthValue : getCurrentMonthKey();
            } else {
                var dayValue = toSummaryDateValue((dateInput && dateInput.value) || '');
                reportUiState.selectedDay = dayValue || getTodayKey();
            }
            renderReportsDashboard(latestBookings);
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            reportUiState.selectedDay = getTodayKey();
            reportUiState.selectedMonth = getCurrentMonthKey();
            updateReportsFilterInputs();
            renderReportsDashboard(latestBookings);
        });
    }

    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', function () {
            exportCurrentReportToPdf();
        });
    }

    if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', function () {
            exportCurrentReportToExcel();
        });
    }

    updateReportsFilterInputs();
}

var backupUiState = {
    initialized: false,
    busy: false,
};

function setBackupStatusMessage(message, type) {
    var statusEl = document.getElementById('backupStatusMessage');
    if (!statusEl) return;
    statusEl.textContent = String(message || '');
    statusEl.classList.remove('success', 'error');
    if (type === 'success' || type === 'error') {
        statusEl.classList.add(type);
    }
}

function setBackupBusyState(isBusy) {
    backupUiState.busy = Boolean(isBusy);
    var downloadBtn = document.getElementById('downloadBackupBtn');
    var restoreBtn = document.getElementById('restoreBackupBtn');
    if (downloadBtn) downloadBtn.disabled = backupUiState.busy;
    if (restoreBtn) restoreBtn.disabled = backupUiState.busy;
}

function getBackupFilename() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var seconds = String(now.getSeconds()).padStart(2, '0');
    return 'diriyah-firebase-backup-' + year + '-' + month + '-' + day + '_' + hours + '-' + minutes + '-' + seconds + '.json';
}

function triggerJsonDownload(fileName, content) {
    var blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('Could not read backup file.')); };
        reader.readAsText(file);
    });
}

function getRestorableData(parsedPayload) {
    if (!parsedPayload || typeof parsedPayload !== 'object') {
        throw new Error('Backup file must contain a JSON object.');
    }

    if (Object.prototype.hasOwnProperty.call(parsedPayload, 'data') && parsedPayload.data && typeof parsedPayload.data === 'object') {
        return parsedPayload.data;
    }

    return parsedPayload;
}

function askRestoreBackupConfirmation(fileName) {
    var message = 'This will overwrite all current Firebase data with the uploaded backup. Continue?';

    if (!hasSweetAlert()) {
        return Promise.resolve(window.confirm(message));
    }

    return window.Swal.fire({
        icon: 'warning',
        title: 'Restore Full Database?',
        html: '<p style="margin:0 0 8px;">This will replace your current data with:</p><p style="margin:0;font-weight:700;">' + escapeHtml(fileName || 'selected file') + '</p>',
        text: message,
        showCancelButton: true,
        confirmButtonText: 'Yes, Restore',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#967035',
        cancelButtonColor: '#967035',
        reverseButtons: true,
    }).then(function (result) {
        return Boolean(result.isConfirmed);
    });
}

async function downloadFullDatabaseBackup() {
    if (backupUiState.busy) return;

    setBackupBusyState(true);
    setBackupStatusMessage('Preparing full backup download...', '');

    try {
        var snapshot = await rtdb.ref('/').once('value');
        var payload = {
            meta: {
                exportedAt: new Date().toISOString(),
                source: 'Diriyah Train Management System Admin',
            },
            data: snapshot.val() || {},
        };

        triggerJsonDownload(getBackupFilename(), JSON.stringify(payload, null, 2));
        setBackupStatusMessage('Backup downloaded successfully.', 'success');
    } catch (error) {
        console.error(error);
        setBackupStatusMessage('Backup download failed. Please try again.', 'error');
    } finally {
        setBackupBusyState(false);
    }
}

async function restoreDatabaseFromBackupFile(file) {
    if (!file || backupUiState.busy) return;

    setBackupBusyState(true);
    setBackupStatusMessage('Validating backup file...', '');

    try {
        var rawContent = await readFileAsText(file);
        var parsedPayload;

        try {
            parsedPayload = JSON.parse(rawContent);
        } catch (_err) {
            throw new Error('Invalid JSON format.');
        }

        var restoreData = getRestorableData(parsedPayload);
        var confirmed = await askRestoreBackupConfirmation(file.name);
        if (!confirmed) {
            setBackupStatusMessage('Restore canceled.', '');
            return;
        }

        setBackupStatusMessage('Restoring data to Firebase...', '');
        await rtdb.ref('/').set(restoreData);
        setBackupStatusMessage('Database restore completed successfully.', 'success');
    } catch (error) {
        console.error(error);
        setBackupStatusMessage('Restore failed: ' + (error && error.message ? error.message : 'Unknown error'), 'error');
    } finally {
        setBackupBusyState(false);
    }
}

function initDatabaseBackupTools() {
    if (backupUiState.initialized) return;

    var downloadBtn = document.getElementById('downloadBackupBtn');
    var restoreBtn = document.getElementById('restoreBackupBtn');
    var fileInput = document.getElementById('backupFileInput');

    if (!downloadBtn || !restoreBtn || !fileInput) return;

    backupUiState.initialized = true;

    downloadBtn.addEventListener('click', function () {
        downloadFullDatabaseBackup();
    });

    restoreBtn.addEventListener('click', function () {
        if (backupUiState.busy) return;
        fileInput.value = '';
        fileInput.click();
    });

    fileInput.addEventListener('change', function () {
        var selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        if (!selectedFile) return;
        restoreDatabaseFromBackupFile(selectedFile);
    });
}

function renderAdminBookings(bookings) {
    var listEl = document.getElementById('adminBookingsList');
    if (!listEl) return;

    var items = Object.keys(bookings || {}).map(function (key) {
        var booking = bookings[key] || {};
        return { key: key, booking: booking, sortValue: new Date(booking.createdAt || 0).getTime() };
    }).sort(function (a, b) { return b.sortValue - a.sortValue; });

    if (!items.length) {
        listEl.innerHTML = '<div class="empty-state">No bookings recorded yet.</div>';
        return;
    }

    listEl.innerHTML =
        '<div class="booking-table-header">' +
            '<span>Ref</span><span>Passenger</span><span>Route</span><span>Date</span><span>Seat</span><span>Price</span><span>Status</span><span>Actions</span>' +
        '</div>' +
        items.map(function (item) {
            var b = item.booking || {};
            var ref = (b.bookingId || item.key).slice(-8).toUpperCase();
            var status = String(b.status || 'active').toLowerCase();
            var statusLabel = b.status || 'active';
            var isCancelled = status === 'cancelled' || status === 'canceled';
            return '<article class="booking-table-row">' +
                '<span class="booking-cell booking-ref" title="' + escapeHtml(b.bookingId || item.key) + '">' + escapeHtml(ref) + '</span>' +
                '<span class="booking-cell">' +
                    '<div>' + escapeHtml(b.passengerName || '—') + '</div>' +
                    '<small style="color:#888;font-size:0.78rem;">' + escapeHtml(b.userEmail || '') + '</small>' +
                '</span>' +
                '<span class="booking-cell">' + escapeHtml((b.fromStation || '—') + ' → ' + (b.toStation || '—')) + '</span>' +
                '<span class="booking-cell">' + escapeHtml(formatBookingDate(b.travelDate || b.date || '')) + '</span>' +
                '<span class="booking-cell">' + escapeHtml(b.seatNumber || b.seatPreference || '—') + '</span>' +
                '<span class="booking-cell">' + escapeHtml(String(b.priceSar || 0)) + ' SAR</span>' +
                '<span class="booking-cell"><span class="status ' + escapeHtml(status) + '">' + escapeHtml(statusLabel) + '</span></span>' +
                '<span class="booking-cell booking-actions">' +
                    '<button class="action-btn edit" data-action="edit-booking" data-key="' + escapeHtml(item.key) + '" title="Edit booking"><i class="fas fa-pen"></i></button>' +
                    '<button class="action-btn delete" data-action="cancel-booking" data-key="' + escapeHtml(item.key) + '" title="Cancel booking"' + (isCancelled ? ' disabled' : '') + '><i class="fas fa-ban"></i></button>' +
                '</span>' +
            '</article>';
        }).join('');
}

function isActiveBookingRecord(booking) {
    var status = String((booking || {}).status || (booking || {}).bookingStatus || 'active').trim().toLowerCase();
    return ['cancelled', 'canceled', 'refunded'].indexOf(status) === -1;
}

function isConfirmedBookingRecord(booking) {
    var status = String((booking || {}).status || (booking || {}).bookingStatus || '').trim().toLowerCase();
    if (!status) return true;
    return ['active', 'confirmed'].indexOf(status) !== -1;
}

async function fetchAllBookingDocuments() {
    if (!fsdb || typeof fsdb.collection !== 'function') {
        throw new Error('Firestore is not available for bookings collection.');
    }

    var querySnapshot = await fsdb.collection('bookings').get();
    console.log('Total Bookings in Firebase:', querySnapshot.size);

    var bookings = {};
    querySnapshot.forEach(function (doc) {
        bookings[doc.id] = doc.data() || {};
    });

    if (querySnapshot.size === 0) {
        console.warn('[Admin] Firestore bookings collection returned 0 documents.');
        if (window.AppNotify && typeof window.AppNotify.warning === 'function') {
            window.AppNotify.warning('Debug: Found 0 bookings in Firebase.');
        }
    }

    return bookings;
}

function updateStats(trains, bookings) {
    var trainsObj = trains || {};
    var bookingsObj = bookings || {};

    var activeTrains = Object.keys(trainsObj).filter(function (key) {
        return (trainsObj[key] || {}).status === 'active';
    }).length;

    var activeBookingKeys = Object.keys(bookingsObj).filter(function (key) {
        return isActiveBookingRecord(bookingsObj[key]);
    });
    var bookingsCount = activeBookingKeys.length;
    var passengersSet = {};
    var revenue = 0;

    activeBookingKeys.forEach(function (key) {
        var b = bookingsObj[key] || {};
        if (b.userId) passengersSet[b.userId] = true;
        revenue += Number(b.priceSar || 0);
    });

    var activeEl = document.getElementById('activeTrainsCount');
    var bookingsEl = document.getElementById('bookingsCount');
    var passengersEl = document.getElementById('passengersCount');
    var revenueEl = document.getElementById('revenueCount');

    if (activeEl) activeEl.textContent = String(activeTrains);
    if (bookingsEl) bookingsEl.textContent = String(bookingsCount);
    if (passengersEl) passengersEl.textContent = String(Object.keys(passengersSet).length);
    if (revenueEl) revenueEl.textContent = String(revenue) + ' SAR';
}

var latestTrains = {};
var latestBookings = {};
var bookingsRealtimeState = {
    firestoreUnsubscribe: null,
    firestoreBookings: {},
    rtdbBookings: {},
    rtdbBound: false,
};
/* ── Edit Booking Modal ─────────────────────────────────────────────────────── */
var editBookingState = { key: null, initialized: false };

function openEditBookingModal(key) {
    var b = latestBookings[key] || {};
    editBookingState.key = key;
    var backdrop = document.getElementById('editBookingModalBackdrop');
    if (!backdrop) return;
    var refEl  = document.getElementById('ebBookingRef');
    var nameEl = document.getElementById('ebPassengerName');
    var routeEl = document.getElementById('ebRoute');
    var dateEl = document.getElementById('ebTravelDate');
    var seatEl = document.getElementById('ebSeatNumber');
    var errEl  = document.getElementById('ebError');
    if (refEl)  refEl.textContent = (b.bookingId || key).slice(-12).toUpperCase();
    if (nameEl) nameEl.value = b.passengerName || '';
    if (routeEl) routeEl.value = (b.fromStation || '—') + ' → ' + (b.toStation || '—');
    if (dateEl) dateEl.value = b.travelDate || b.date || '';
    if (seatEl) seatEl.value = b.seatNumber || b.seatPreference || '';
    if (errEl)  errEl.textContent = '';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
}

function closeEditBookingModal() {
    var backdrop = document.getElementById('editBookingModalBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    editBookingState.key = null;
}

function initEditBookingModal() {
    if (editBookingState.initialized) return;
    editBookingState.initialized = true;
    var backdrop  = document.getElementById('editBookingModalBackdrop');
    var closeBtn  = document.getElementById('editBookingModalClose');
    var cancelBtn = document.getElementById('editBookingModalCancel');
    var saveBtn   = document.getElementById('editBookingModalSave');
    if (!backdrop || !closeBtn || !cancelBtn || !saveBtn) return;
    [closeBtn, cancelBtn].forEach(function (btn) { btn.addEventListener('click', closeEditBookingModal); });
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeEditBookingModal(); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && backdrop.classList.contains('open')) closeEditBookingModal();
    });
    saveBtn.addEventListener('click', function () {
        var errEl  = document.getElementById('ebError');
        if (errEl) errEl.textContent = '';
        var key = editBookingState.key;
        if (!key) return;
        var date = (document.getElementById('ebTravelDate').value || '').trim();
        var seat = (document.getElementById('ebSeatNumber').value || '').trim();
        if (!date) { if (errEl) errEl.textContent = 'Travel date is required.'; return; }
        if (!seat) { if (errEl) errEl.textContent = 'Seat number is required.'; return; }
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        rtdb.ref('bookings/' + key).update({
            travelDate: date,
            date: date,
            seatNumber: seat,
            updatedAt: new Date().toISOString(),
        })
            .then(function () {
                if (latestBookings[key]) {
                    latestBookings[key].travelDate = date;
                    latestBookings[key].date = date;
                    latestBookings[key].seatNumber = seat;
                }
                renderAdminBookings(latestBookings);
                closeEditBookingModal();
                if (hasSweetAlert()) {
                    return window.Swal.fire({
                        icon: 'success',
                        title: 'Booking updated',
                        text: 'Travel date and seat number were updated successfully.',
                        confirmButtonColor: '#967035',
                    });
                }
                alert('Booking updated successfully.');
            })
            .catch(function (err) { if (errEl) errEl.textContent = 'Error: ' + err.message; })
            .then(function () { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; });
    });
}

/* ── Manage Bookings – search + actions ─────────────────────────────────────── */
function initManageBookings() {
    var searchInput = document.getElementById('bookingSearchInput');
    if (searchInput) searchInput.addEventListener('input', function () { renderAdminBookings(latestBookings); });

    var listEl = document.getElementById('adminBookingsList');
    if (listEl) {
        listEl.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-action]');
            if (!btn) return;
            var key = btn.getAttribute('data-key');
            var action = btn.getAttribute('data-action');
            if (!key) return;
            if (action === 'edit-booking') { openEditBookingModal(key); return; }
            if (action === 'cancel-booking') {
                if (!window.confirm('Cancel this booking? The passenger will be notified.')) return;
                rtdb.ref('bookings/' + key).update({ status: 'cancelled', updatedAt: new Date().toISOString() }).catch(function (err) {
                    alert('Could not cancel booking: ' + err.message);
                });
            }
        });
    }
}

/* ── Admin Create Booking wizard ────────────────────────────────────────────── */
var abState = {
    passengerUID: null, passengerProfile: null,
    schedulesCache: {}, baseTrains: {}, filteredTrains: {},
    selectedTrainKey: null, selectedSchedule: null,
    filters: { priceMin: 0, priceMax: 0, timeSlot: '' },
};

function abGetPriceBounds(map) {
    var prices = Object.keys(map || {}).map(function (k) { return Number((map[k] || {}).priceSar || 0); }).filter(function (p) { return isFinite(p) && p >= 0; });
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.floor(Math.min.apply(null, prices)), max: Math.ceil(Math.max.apply(null, prices)) };
}
function abGetTimeSlot(time) {
    var m = /^(\d{1,2}):/.exec(String(time || '')); if (!m) return '';
    var h = parseInt(m[1], 10);
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
function abNormalizeDate(v) {
    var r = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return r;
    var p = new Date(r); return isNaN(p.getTime()) ? '' : p.toISOString().slice(0, 10);
}
function abSyncSliders(bounds, reset) {
    if (reset) { abState.filters.priceMin = bounds.min; abState.filters.priceMax = bounds.max; }
    else {
        abState.filters.priceMin = Math.max(bounds.min, Math.min(bounds.max, abState.filters.priceMin));
        abState.filters.priceMax = Math.max(abState.filters.priceMin, Math.min(bounds.max, abState.filters.priceMax));
    }
    var minEl = document.getElementById('abPriceMin'); var maxEl = document.getElementById('abPriceMax');
    var minV = document.getElementById('abPriceMinVal'); var maxV = document.getElementById('abPriceMaxVal');
    [minEl, maxEl].forEach(function (el) { if (el) { el.min = bounds.min; el.max = bounds.max; } });
    if (minEl) minEl.value = abState.filters.priceMin; if (maxEl) maxEl.value = abState.filters.priceMax;
    if (minV) minV.textContent = abState.filters.priceMin; if (maxV) maxV.textContent = abState.filters.priceMax;
}
function abApplyFilters() {
    var filtered = {};
    Object.keys(abState.baseTrains).forEach(function (k) {
        var t = abState.baseTrains[k] || {};
        var price = Number(t.priceSar || 0);
        if (price < abState.filters.priceMin || price > abState.filters.priceMax) return;
        if (abState.filters.timeSlot && abGetTimeSlot(t.departureTime) !== abState.filters.timeSlot) return;
        filtered[k] = t;
    });
    abState.filteredTrains = filtered;
    abRenderTrains();
}
function abRenderTrains() {
    var el = document.getElementById('abTrainResults');
    var bar = document.getElementById('abFiltersBar');
    if (!el) return;
    var baseKeys = Object.keys(abState.baseTrains);
    if (!baseKeys.length) { el.innerHTML = '<div class="ab-empty">No trains found for this route and date.</div>'; if (bar) bar.style.display = 'none'; return; }
    if (bar) bar.style.display = '';
    abSyncSliders(abGetPriceBounds(abState.baseTrains), abState.filters.priceMax === 0 && abState.filters.priceMin === 0);
    var keys = Object.keys(abState.filteredTrains);
    if (!keys.length) { el.innerHTML = '<div class="ab-empty">No trains match your filters.</div>'; return; }
    el.innerHTML = keys.map(function (k) {
        var t = abState.baseTrains[k] || {};
        var cap = parseInt(t.capacity, 10);
        var seats = isFinite(cap) ? Math.max(cap, 0) : null;
        var isFull = seats !== null && seats <= 0;
        var d = abNormalizeDate(t.date || '');
        var dLabel = d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        return '<div class="ab-train-card' + (isFull ? ' ab-full' : '') + '">' +
            '<div class="ab-tc-main">' +
                '<div class="ab-tc-route">' + escapeHtml((t.from || '?') + ' → ' + (t.to || '?')) + '</div>' +
                '<div class="ab-tc-meta">' +
                    '<span><i class="fas fa-clock"></i> ' + escapeHtml(t.departureTime || 'N/A') + '</span>' +
                    '<span><i class="far fa-calendar"></i> ' + escapeHtml(dLabel) + '</span>' +
                    '<span><i class="fas fa-train"></i> ' + escapeHtml(t.trainId || k) + '</span>' +
                    '<span><i class="fas fa-chair"></i> ' + escapeHtml(seats === null ? 'N/A' : seats + ' seats') + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="ab-tc-side">' +
                '<span class="ab-tc-price">' + escapeHtml(String(t.priceSar || 0)) + ' SAR</span>' +
                '<button class="add-btn ab-book-btn" data-key="' + escapeHtml(k) + '"' + (isFull ? ' disabled' : '') + ' type="button">' + (isFull ? 'Fully Booked' : '<i class="fas fa-ticket-alt"></i> Book') + '</button>' +
            '</div>' +
        '</div>';
    }).join('');
}
function abSetSlotActive(slot) {
    document.querySelectorAll('#abTimeSlots .ab-slot-btn').forEach(function (b) {
        b.classList.toggle('active', (b.getAttribute('data-slot') || '') === slot);
    });
}
function abRunTrainSearch() {
    var from = (document.getElementById('abFrom').value || '').trim();
    var to   = (document.getElementById('abTo').value || '').trim();
    var date = (document.getElementById('abDate').value || '').trim();
    var el   = document.getElementById('abTrainResults');
    if (from && to && from === to) { alert('From and To cannot be the same city.'); return; }
    if (el) el.innerHTML = '<div class="ab-empty">Searching…</div>';
    var filtered = {};
    Object.keys(abState.schedulesCache).forEach(function (k) {
        var s = abState.schedulesCache[k] || {};
        if (s.status === 'cancelled') return;
        if (from && (s.from || '') !== from) return;
        if (to   && (s.to   || '') !== to)   return;
        if (date && abNormalizeDate(s.date || '') !== abNormalizeDate(date)) return;
        filtered[k] = s;
    });
    abState.baseTrains = filtered;
    abState.filters.priceMin = 0; abState.filters.priceMax = 0; abState.filters.timeSlot = '';
    abSetSlotActive('');
    abApplyFilters();
}
function abOpenConfirm(key) {
    var t = abState.filteredTrains[key] || abState.baseTrains[key] || {};
    abState.selectedTrainKey = key; abState.selectedSchedule = t;
    var capNote = document.getElementById('abCapacityNote');
    var confirmBtn = document.getElementById('abConfirmFinalBtn');
    var cap = parseInt(t.capacity, 10);
    if (isFinite(cap)) { if (capNote) capNote.textContent = cap + ' seat(s) available.'; if (confirmBtn) confirmBtn.disabled = cap <= 0; }
    else { if (capNote) capNote.textContent = ''; }
    var sumEl = document.getElementById('abSummary');
    if (sumEl && abState.passengerProfile) {
        var p = abState.passengerProfile;
        var d = abNormalizeDate(t.date || '');
        var dLabel = d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
        sumEl.innerHTML =
            '<div class="ab-sum-row"><span>Passenger</span><strong>' + escapeHtml(((p.firstName || '') + ' ' + (p.lastName || '')).trim() || p.email || 'Unknown') + '</strong></div>' +
            '<div class="ab-sum-row"><span>Route</span><strong>'     + escapeHtml((t.from || '?') + ' → ' + (t.to || '?')) + '</strong></div>' +
            '<div class="ab-sum-row"><span>Date</span><strong>'      + escapeHtml(dLabel) + '</strong></div>' +
            '<div class="ab-sum-row"><span>Departure</span><strong>' + escapeHtml(t.departureTime || 'N/A') + '</strong></div>' +
            '<div class="ab-sum-row"><span>Price</span><strong>'     + escapeHtml(String(t.priceSar || 0)) + ' SAR</strong></div>';
    }
    var sec = document.getElementById('abConfirmSection');
    if (sec) { sec.style.display = ''; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    var seatEl = document.getElementById('abSeatPref'); if (seatEl) seatEl.value = '';
    var errEl = document.getElementById('abConfirmError'); if (errEl) errEl.textContent = '';
    var okEl = document.getElementById('abSuccessMsg'); if (okEl) okEl.style.display = 'none';
}

function initAdminCreateBooking() {
    var toggleBtn = document.getElementById('abToggleBtn');
    var wizard    = document.getElementById('abWizard');
    if (toggleBtn && wizard) {
        toggleBtn.addEventListener('click', function () {
            var open = wizard.style.display !== 'none';
            wizard.style.display = open ? 'none' : '';
            toggleBtn.innerHTML = open ? '<i class="fas fa-chevron-down"></i> Expand' : '<i class="fas fa-chevron-up"></i> Collapse';
        });
    }

    rtdb.ref('schedules').on('value', function (snap) {
        abState.schedulesCache = snap.val() || {};
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not load schedules for booking creation.');
        }
    });

    /* Passenger search */
    var searchBtn = document.getElementById('abSearchPassengerBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', function () {
            var query   = (document.getElementById('abSearchQuery').value || '').trim().toLowerCase();
            var errEl   = document.getElementById('abSearchError');
            var resEl   = document.getElementById('abPassengerResults');
            var selCard = document.getElementById('abSelectedPassengerCard');
            if (errEl) errEl.textContent = '';
            if (resEl)   { resEl.innerHTML = ''; resEl.style.display = 'none'; }
            if (selCard) selCard.style.display = 'none';
            ['abTrainSearchSection', 'abConfirmSection'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
            abState.passengerUID = null; abState.passengerProfile = null;
            if (!query) { if (errEl) errEl.textContent = 'Enter a name, phone, or email to search.'; return; }
            searchBtn.disabled = true;
            rtdb.ref('users').once('value').then(function (snap) {
                searchBtn.disabled = false;
                var users = snap.val() || {};
                var matches = [];
                Object.keys(users).forEach(function (uid) {
                    var u = users[uid] || {};
                    if (u.role && u.role !== 'passenger') return;
                    var fullName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim().toLowerCase();
                    var email    = (u.email  || '').toLowerCase();
                    var phone    = (u.phone  || '').replace(/\s+/g, '');
                    var qPhone   = query.replace(/\s+/g, '');
                    if (fullName.indexOf(query) !== -1 || email.indexOf(query) !== -1 || phone.indexOf(qPhone) !== -1) {
                        matches.push({ uid: uid, profile: u });
                    }
                });
                if (!matches.length) { if (errEl) errEl.textContent = 'No passengers found.'; return; }
                if (resEl) {
                    resEl.style.display = '';
                    resEl.innerHTML = matches.slice(0, 10).map(function (m) {
                        var p = m.profile;
                        var name = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '—';
                        return '<div class="ab-passenger-pick" data-uid="' + escapeHtml(m.uid) + '">' +
                            '<div><div style="font-weight:600;">' + escapeHtml(name) + '</div>' +
                            '<div style="font-size:0.82rem;color:#888;">' + escapeHtml(p.email || '') + (p.phone ? ' · ' + escapeHtml(p.phone) : '') + '</div></div>' +
                            '<button class="add-btn ab-select-passenger" type="button" style="flex-shrink:0;">Select</button>' +
                        '</div>';
                    }).join('');
                    resEl.querySelectorAll('.ab-select-passenger').forEach(function (btn) {
                        btn.addEventListener('click', function () {
                            var uid = btn.closest('.ab-passenger-pick').dataset.uid;
                            var found = matches.filter(function (m) { return m.uid === uid; })[0];
                            if (!found) return;
                            abState.passengerUID = uid; abState.passengerProfile = found.profile;
                            var p = found.profile;
                            var name = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '—';
                            if (selCard) {
                                selCard.innerHTML = '<strong style="color:var(--primary-blue);">Selected Passenger</strong><br>' +
                                    escapeHtml(name) + '<br><small style="color:#888;">' + escapeHtml(p.email || '') + (p.phone ? ' · ' + escapeHtml(p.phone) : '') + '</small>';
                                selCard.style.display = '';
                            }
                            if (resEl) resEl.style.display = 'none';
                            var trainSec = document.getElementById('abTrainSearchSection');
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

    var searchTrainsBtn = document.getElementById('abSearchTrainsBtn');
    if (searchTrainsBtn) searchTrainsBtn.addEventListener('click', abRunTrainSearch);

    var priceMinEl = document.getElementById('abPriceMin');
    var priceMaxEl = document.getElementById('abPriceMax');
    if (priceMinEl) {
        priceMinEl.addEventListener('input', function () {
            abState.filters.priceMin = Number(priceMinEl.value);
            if (abState.filters.priceMin > abState.filters.priceMax) { abState.filters.priceMax = abState.filters.priceMin; if (priceMaxEl) priceMaxEl.value = abState.filters.priceMax; }
            var minV = document.getElementById('abPriceMinVal'); var maxV = document.getElementById('abPriceMaxVal');
            if (minV) minV.textContent = abState.filters.priceMin; if (maxV) maxV.textContent = abState.filters.priceMax;
            abApplyFilters();
        });
    }
    if (priceMaxEl) {
        priceMaxEl.addEventListener('input', function () {
            abState.filters.priceMax = Number(priceMaxEl.value);
            if (abState.filters.priceMax < abState.filters.priceMin) { abState.filters.priceMin = abState.filters.priceMax; if (priceMinEl) priceMinEl.value = abState.filters.priceMin; }
            var minV = document.getElementById('abPriceMinVal'); var maxV = document.getElementById('abPriceMaxVal');
            if (minV) minV.textContent = abState.filters.priceMin; if (maxV) maxV.textContent = abState.filters.priceMax;
            abApplyFilters();
        });
    }
    document.querySelectorAll('#abTimeSlots .ab-slot-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            abState.filters.timeSlot = btn.getAttribute('data-slot') || '';
            abSetSlotActive(abState.filters.timeSlot); abApplyFilters();
        });
    });
    var resetBtn = document.getElementById('abResetFilters');
    if (resetBtn) resetBtn.addEventListener('click', function () {
        abState.filters.timeSlot = ''; abSetSlotActive('');
        abSyncSliders(abGetPriceBounds(abState.baseTrains), true); abApplyFilters();
    });

    var trainResultsEl = document.getElementById('abTrainResults');
    if (trainResultsEl) {
        trainResultsEl.addEventListener('click', function (e) {
            var btn = e.target.closest('.ab-book-btn');
            if (!btn || btn.disabled) return;
            abOpenConfirm(btn.getAttribute('data-key'));
        });
    }
    var backBtn = document.getElementById('abBackToTrainsBtn');
    if (backBtn) backBtn.addEventListener('click', function () {
        var sec = document.getElementById('abConfirmSection'); if (sec) sec.style.display = 'none';
        abState.selectedTrainKey = null; abState.selectedSchedule = null;
    });

    var confirmFinalBtn = document.getElementById('abConfirmFinalBtn');
    if (confirmFinalBtn) {
        confirmFinalBtn.addEventListener('click', function () {
            var errEl = document.getElementById('abConfirmError');
            var okEl  = document.getElementById('abSuccessMsg');
            if (errEl) errEl.textContent = ''; if (okEl) okEl.style.display = 'none';
            var seatPref = (document.getElementById('abSeatPref').value || '').trim().toLowerCase();
            if (!seatPref) { if (errEl) errEl.textContent = 'Please select a seat preference.'; return; }
            if (!abState.passengerUID) { if (errEl) errEl.textContent = 'No passenger selected.'; return; }
            if (!abState.selectedTrainKey) { if (errEl) errEl.textContent = 'No train selected.'; return; }
            var scheduleKey = abState.selectedTrainKey;
            var t = abState.selectedSchedule || {};
            var liveCap = parseInt(t.capacity, 10);
            if (isFinite(liveCap) && liveCap <= 0) { if (errEl) errEl.textContent = 'This train is fully booked.'; return; }
            confirmFinalBtn.disabled = true; confirmFinalBtn.textContent = 'Confirming…';
            rtdb.ref('schedules/' + scheduleKey).once('value').then(function (snap) {
                if (!snap.exists()) throw new Error('Schedule no longer exists.');
                var live = snap.val() || {};
                var cap = parseInt(live.capacity, 10);
                if (isFinite(cap) && cap <= 0) throw new Error('This train is fully booked.');
                return rtdb.ref('schedules/' + scheduleKey).transaction(function (cur) {
                    if (!cur) return;
                    var c = parseInt(cur.capacity, 10);
                    if (!isFinite(c) || c <= 0) return;
                    cur.capacity = c - 1; return cur;
                }).then(function (result) {
                    if (!result.committed) throw new Error('This train is fully booked.');
                    var liveSchedule = result.snapshot.val() || live;
                    var p = abState.passengerProfile || {};
                    var bookingRef = rtdb.ref('bookings').push();
                    return bookingRef.set({
                        bookingId: bookingRef.key, userId: abState.passengerUID, userEmail: p.email || '',
                        passengerName: ((p.firstName || '') + ' ' + (p.lastName || '')).trim(),
                        passengerPhone: p.phone || '', seatPreference: seatPref,
                        trainKey: scheduleKey, trainId: liveSchedule.trainId || t.trainId || scheduleKey,
                        fromStation: liveSchedule.from || t.from || '', toStation: liveSchedule.to || t.to || '',
                        departureTime: liveSchedule.departureTime || t.departureTime || '',
                        date: liveSchedule.date || t.date || '', travelDate: liveSchedule.date || t.date || '',
                        priceSar: Number(liveSchedule.priceSar || t.priceSar || 0),
                        status: 'active', createdByAdmin: true, createdAt: new Date().toISOString(),
                    }).then(function () {
                        if (okEl) { okEl.textContent = 'Booking confirmed! Ref: ' + bookingRef.key; okEl.style.display = ''; }
                        ['abConfirmSection', 'abTrainSearchSection'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
                        var selCard = document.getElementById('abSelectedPassengerCard'); if (selCard) { selCard.style.display = 'none'; selCard.innerHTML = ''; }
                        var qEl = document.getElementById('abSearchQuery'); if (qEl) qEl.value = '';
                        abState.passengerUID = null; abState.passengerProfile = null;
                        abState.selectedTrainKey = null; abState.selectedSchedule = null;
                        abState.baseTrains = {}; abState.filteredTrains = {};
                        setTimeout(function () { if (okEl) okEl.style.display = 'none'; }, 5000);
                    });
                });
            }).catch(function (err) { if (errEl) errEl.textContent = err.message || 'Booking failed.'; })
              .then(function () { confirmFinalBtn.disabled = false; confirmFinalBtn.innerHTML = '<i class="fas fa-ticket-alt"></i> Confirm Booking'; });
        });
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

    resolveRole.then(function (resolvedRole) {
        if (resolvedRole !== 'admin') {
            alert('Access denied: admin account required.');
            if (window.RoleRouting && typeof window.RoleRouting.routeToRoleHome === 'function') {
                window.RoleRouting.routeToRoleHome(resolvedRole);
            } else {
                window.location.href = resolvedRole === 'staff' ? 'staff-dashboard.html' : 'booking.html';
            }
            return;
        }

        rtdb.ref('users/' + user.uid).once('value').then(function (snap) {
            var profile = snap.val() || {};
            var isAdmin = resolvedRole === 'admin' || profile.isAdmin === true || profile.role === 'admin' || isBootstrapAdminEmail(user.email || '');

            // Keep database profile in sync for bootstrap admins.
            if (isAdmin && (profile.isAdmin !== true || profile.role !== 'admin')) {
                rtdb.ref('users/' + user.uid).update({ isAdmin: true, role: 'admin' });
            }

            if (!isAdmin) {
                alert('Access denied: admin account required.');
                if (window.RoleRouting && typeof window.RoleRouting.routeToRoleHome === 'function') {
                    window.RoleRouting.routeToRoleHome('passenger');
                } else {
                    window.location.href = 'booking.html';
                }
                return;
            }

            initAdminPage(user, profile);
        }).catch(function () {
            // If role was already resolved as admin, allow access even when profile read fails.
            if (resolvedRole === 'admin' || isBootstrapAdminEmail(user.email || '')) {
                initAdminPage(user, {
                    role: 'admin',
                    isAdmin: true,
                    email: user.email || '',
                    firstName: user.displayName || '',
                });
                return;
            }

            alert('Could not verify admin access.');
            if (window.RoleRouting && typeof window.RoleRouting.routeToRoleHome === 'function') {
                window.RoleRouting.routeToRoleHome(resolvedRole || 'passenger');
            } else {
                window.location.href = resolvedRole === 'staff' ? 'staff-dashboard.html' : 'booking.html';
            }
        });
    }).catch(function () {
        window.location.href = 'page.html';
    });
});

function initAdminPage(user, profile) {
    initProfileMenu(user, profile);
    initScheduleModal(user);
    initDeleteModal();
    initEditBookingModal();
    initManageBookings();
    initReportsSection();
    initCustomerInquiriesInbox();
    initDatabaseBackupTools();
    initAdminCreateBooking();

    var cardsContainer = document.getElementById('trainsTableBody');
    if (cardsContainer) {
        cardsContainer.addEventListener('click', async function (e) {
            var button = e.target.closest('button[data-action]');
            if (!button) return;

            var key = button.getAttribute('data-key');
            var action = button.getAttribute('data-action');
            if (!key || !action) return;

            if (action === 'delete') {
                var train = latestTrains[key] || {};
                await handleScheduleDelete(key, train);
                return;
            }

            if (action === 'edit') {
                var existing = latestTrains[key];
                if (!existing) return;
                openScheduleModal({
                    key: key,
                    schedule: existing,
                });
            }
        });
    }

    trainsRef.on('value', function (snapshot) {
        latestTrains = snapshot.val() || {};
        renderTrains(latestTrains);
        renderAdminDashboardData();
    }, function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not sync schedules from database.');
        }
    });

    initBookingsRealtimeSync();

    fetchAllBookingDocuments().then(function (bookings) {
        var fetchedBookings = bookings || {};
        if (Object.keys(fetchedBookings).length) {
            latestBookings = Object.assign({}, latestBookings || {}, fetchedBookings);
        }
        renderAdminDashboardData();
    }).catch(function (error) {
        if (window.AppNotify && typeof window.AppNotify.handleError === 'function') {
            window.AppNotify.handleError(error, 'Could not fetch bookings collection.');
        }
    });
}
