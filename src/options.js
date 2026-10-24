const THE_MARVELLOUS_SUSPENDER_EXTENSION_ID = "noogafoofpebimajpfpamcfhoaifemoa";

// Save options to chrome.storage
function saveOptions() {
    var sortBy = document.getElementById('sortBy').value;
    var groupFrom = document.getElementById('groupFrom').value;
    var preserveOrderWithinGroups = document.getElementById('preserveOrderWithinGroups').checked;
    var groupSuspendedTabs = document.getElementById('groupSuspendedTabs').checked;
    var tabSuspenderExtensionId = document.getElementById('tabSuspenderExtensionId').value;
    var sortPinnedTabs = document.getElementById('sortPinnedTabs').checked;
    var dedupeTabs = document.getElementById('dedupeTabs').checked;
    var dedupeIgnoreHash = document.getElementById('dedupeIgnoreHash').checked;
    var dedupeIgnoreTrackingParams = document.getElementById('dedupeIgnoreTrackingParams').checked;
    var dedupeIgnoreTrailingSlash = document.getElementById('dedupeIgnoreTrailingSlash').checked;
    var dedupeKeepActiveTab = document.getElementById('dedupeKeepActiveTab').checked;
    var dedupeConfirm = document.getElementById('dedupeConfirm').checked;
    chrome.storage.sync.set({
        sortBy: sortBy,
        groupFrom: groupFrom,
        preserveOrderWithinGroups: preserveOrderWithinGroups,
        groupSuspendedTabs: groupSuspendedTabs,
        tabSuspenderExtensionId: tabSuspenderExtensionId,
        sortPinnedTabs: sortPinnedTabs,
        dedupeTabs: dedupeTabs,
        dedupeIgnoreHash: dedupeIgnoreHash,
        dedupeIgnoreTrackingParams: dedupeIgnoreTrackingParams,
        dedupeIgnoreTrailingSlash: dedupeIgnoreTrailingSlash,
        dedupeKeepActiveTab: dedupeKeepActiveTab,
        dedupeConfirm: dedupeConfirm
    }, function () {
        document.getElementById('save').setAttribute("disabled", true);
        // Show status to let user know changes were saved
        $('#status').removeClass("invisible");
        $('#status').addClass("visible");
    });
}

// Restore options state from chrome.storage
function restoreOptions() {
    // Use default value and preserveOrderWithinGroups = false
    chrome.storage.sync.get({
        sortBy: 'url',
        groupFrom: 'leftToRight',
        preserveOrderWithinGroups: true,
        groupSuspendedTabs: false,
        tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
        sortPinnedTabs: false,
        dedupeTabs: false,
        dedupeIgnoreHash: false,
        dedupeIgnoreTrackingParams: false,
        dedupeIgnoreTrailingSlash: false,
        dedupeKeepActiveTab: true,
        dedupeConfirm: false
    }, function (items) {
        toggleTabGroupOptions(items.sortBy);
        document.getElementById('sortBy').value = items.sortBy;
        document.getElementById('groupFrom').value = items.groupFrom;
        document.getElementById('preserveOrderWithinGroups').checked = items.preserveOrderWithinGroups;
        document.getElementById('groupSuspendedTabs').checked = items.groupSuspendedTabs;
        document.getElementById('tabSuspenderExtensionId').value = items.tabSuspenderExtensionId;
        document.getElementById('sortPinnedTabs').checked = items.sortPinnedTabs;
        document.getElementById('dedupeTabs').checked = items.dedupeTabs;
        document.getElementById('dedupeIgnoreHash').checked = items.dedupeIgnoreHash;
        document.getElementById('dedupeIgnoreTrackingParams').checked = items.dedupeIgnoreTrackingParams;
        document.getElementById('dedupeIgnoreTrailingSlash').checked = items.dedupeIgnoreTrailingSlash;
        document.getElementById('dedupeKeepActiveTab').checked = items.dedupeKeepActiveTab;
        document.getElementById('dedupeConfirm').checked = items.dedupeConfirm;
        toggleDedupeOptions();
    });
}

function toggleSaveButton() {
    chrome.storage.sync.get({
        sortBy: 'url',
        groupFrom: 'leftToRight',
        preserveOrderWithinGroups: true,
        groupSuspendedTabs: false,
        tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
        sortPinnedTabs: false,
        dedupeTabs: false,
        dedupeIgnoreHash: false,
        dedupeIgnoreTrackingParams: false,
        dedupeIgnoreTrailingSlash: false,
        dedupeKeepActiveTab: true,
        dedupeConfirm: false
    }, function (items) {
        if (document.getElementById('sortBy').value != items.sortBy ||
            document.getElementById('groupFrom').value != items.groupFrom ||
            document.getElementById('preserveOrderWithinGroups').checked != items.preserveOrderWithinGroups ||
            document.getElementById('groupSuspendedTabs').checked != items.groupSuspendedTabs ||
            (document.getElementById('tabSuspenderExtensionId').value != items.tabSuspenderExtensionId && document.getElementById('tabSuspenderExtensionId').value != THE_MARVELLOUS_SUSPENDER_EXTENSION_ID ) ||
            document.getElementById('sortPinnedTabs').checked != items.sortPinnedTabs ||
            document.getElementById('dedupeTabs').checked != items.dedupeTabs ||
            document.getElementById('dedupeIgnoreHash').checked != items.dedupeIgnoreHash ||
            document.getElementById('dedupeIgnoreTrackingParams').checked != items.dedupeIgnoreTrackingParams ||
            document.getElementById('dedupeIgnoreTrailingSlash').checked != items.dedupeIgnoreTrailingSlash ||
            document.getElementById('dedupeKeepActiveTab').checked != items.dedupeKeepActiveTab ||
            document.getElementById('dedupeConfirm').checked != items.dedupeConfirm) {
            document.getElementById('save').removeAttribute("disabled");
            // Hide status to reflect that changes have not been saved
            $('#status').removeClass("visible");
            $('#status').addClass("invisible");
        } else {
            document.getElementById('save').setAttribute("disabled", true);
        }
    });
}

function toggleTabSuspenderExtensionId() {
    if (document.getElementById('groupSuspendedTabs').checked) {
        document.getElementById('tabSuspenderExtensionId').setAttribute("disabled", true);
    } else {
        document.getElementById('tabSuspenderExtensionId').removeAttribute("disabled");
    }
    toggleSaveButton();
}

function toggleDedupeOptions() {
    $('.dedupe-option').prop('disabled', !document.getElementById('dedupeTabs').checked);
    toggleSaveButton();
}

function toggleTabGroupOptions(sortBy) {
    if (sortBy == "title" || sortBy == "url" || sortBy == "urlTitle") {
        $('#groupFrom').prop('disabled', true);
        $('#preserveOrderWithinGroups').prop('disabled', true);
    } else {
        $('#groupFrom').prop('disabled', false);
        $('#preserveOrderWithinGroups').prop('disabled', false);
    }
    toggleSaveButton();
}

document.addEventListener('DOMContentLoaded', restoreOptions);
$("#settings-form").submit(function(e) {
    e.preventDefault();
});

document.getElementById('sortBy').addEventListener('change', function() {
    toggleTabGroupOptions(this.value);
});

document.getElementById('groupFrom').addEventListener('change', toggleSaveButton);
document.getElementById('preserveOrderWithinGroups').addEventListener('change', toggleSaveButton);
document.getElementById('groupSuspendedTabs').addEventListener('change', toggleTabSuspenderExtensionId);
document.getElementById('tabSuspenderExtensionId').addEventListener('input', toggleSaveButton);
document.getElementById('sortPinnedTabs').addEventListener('change', toggleSaveButton);
document.getElementById('dedupeTabs').addEventListener('change', toggleDedupeOptions);
document.getElementById('dedupeIgnoreHash').addEventListener('change', toggleSaveButton);
document.getElementById('dedupeIgnoreTrackingParams').addEventListener('change', toggleSaveButton);
document.getElementById('dedupeIgnoreTrailingSlash').addEventListener('change', toggleSaveButton);
document.getElementById('dedupeKeepActiveTab').addEventListener('change', toggleSaveButton);
document.getElementById('dedupeConfirm').addEventListener('change', toggleSaveButton);
document.getElementById('save').addEventListener('click', saveOptions);

$(document).ready(function() {
    toggleTabSuspenderExtensionId();
});