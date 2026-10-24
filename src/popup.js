const thisVersion = chrome.runtime.getManifest().version;
var newInstallOrUpdate = false;

// Clear install & upgrade flags once they've been handled...
function clearInstallOrUpdate() {
    chrome.storage.sync.set({
        installedVersion: chrome.runtime.getManifest().version,
        newInstall: false,
        newUpdate: false
    }, function () {});
}

// Display modal dialog when first clicked after an install or update...
chrome.storage.sync.get({
    installedVersion: '',
    newInstall: false,
    newUpdate: false,
}, function (config) {
    clearInstallOrUpdate();
    if (config.newInstall) {
        alert(`Welcome to Super Tab Sorter!

        Please review the "User Guide" before getting started.

        You'll need to click the extension icon, again, to sort your tabs after dismissing this dialog but you won't see this dialog again unless you reinstall this extension.

        You can right-click on the extension icon and select \"Options\" at any time to configure extension settings and review the user guide.`);
        window.open(chrome.runtime.getURL('./userguide.html'));
    } else if (config.newUpdate) {
        alert("Super Tab Sorter has been updated to v" + thisVersion +
        ".\n\nThis version uses the new Chrome manifest v3 API (major architectural change) and adds direct support for Chrome's tab groups feature" +
        ".\n\nIt also adds optional duplicate tab removal (during sorting) and Sort By URL sorts by root domain and sub-sorts by host name." +
        "\n\nPlease review the updated User Guide to learn more about the latest changes." +
        "\n\nYou'll need to click the extension icon, again, to sort your tabs after dismissing this dialog but you won't see this dialog again until installing the next update." +
        "\n\nYou can right-click on the extension icon and select \"Options\" at any time to configure extension settings and review the user guide.");
        window.open(chrome.runtime.getURL('./userguide.html'));
    } else {
        sortOrPreviewDuplicates();
    }
});

// Send click event to background.js for processing, limiting dedupe to closeTabIds if given...
function sortTabs(closeTabIds) {
    chrome.runtime.sendMessage({
        type: "click_event",
        closeTabIds: closeTabIds
    }, response => {
        if (response.message === 'success') {
            window.close();
        }
    });
}

// Sort right away unless 'dedupeConfirm' is set and the sort would close duplicate tabs - then preview them first
function sortOrPreviewDuplicates() {
    let notice = document.getElementById('notice');
    notice.hidden = true;
    chrome.storage.sync.get({
        dedupeTabs: false,
        dedupeConfirm: false
    }, function (settings) {
        if (!settings.dedupeTabs || !settings.dedupeConfirm) {
            sortTabs();
            return;
        }
        chrome.runtime.sendMessage({ type: "preview_duplicates" }, response => {
            if (response.message !== 'success') {
                notice.textContent = "Couldn't preview duplicate tabs: " + response.error;
                notice.hidden = false;
            } else if (response.duplicateSets.length === 0) {
                sortTabs();
            } else {
                showDuplicatesPreview(response.duplicateSets);
            }
        });
    });
}

function showDuplicatesPreview(duplicateSets) {
    document.getElementById('notice').hidden = true;
    document.getElementById('preview').hidden = false;

    let list = document.getElementById('duplicate-sets');
    for (let set of duplicateSets) {
        let item = document.createElement('li');
        let keeper = tabRow(set.keeper);
        keeper.classList.add('keeper');
        keeper.prepend(badge('Keep'));
        item.append(keeper);

        let duplicates = document.createElement('ul');
        for (let tab of set.duplicates) {
            let row = document.createElement('label');
            row.className = 'duplicate';
            let checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.value = tab.id;
            checkbox.addEventListener('change', updateCloseButton);
            row.append(checkbox, tabRow(tab));
            let duplicateItem = document.createElement('li');
            duplicateItem.append(row);
            duplicates.append(duplicateItem);
        }
        item.append(duplicates);
        list.append(item);
    }

    document.getElementById('close-and-sort').addEventListener('click', () => sortTabs(checkedTabIds()));
    document.getElementById('sort-only').addEventListener('click', () => sortTabs([]));
    updateCloseButton();
    list.querySelector('input').focus();
}

// Favicon, title, and URL for a tab, built with textContent since titles and URLs come from web pages
function tabRow(tab) {
    let row = document.createElement('div');
    row.className = 'tab';
    let icon = document.createElement('img');
    icon.className = 'favicon';
    icon.alt = '';
    if (tab.favIconUrl) icon.src = tab.favIconUrl;
    icon.addEventListener('error', () => icon.style.visibility = 'hidden');
    let text = document.createElement('div');
    text.className = 'tab-text';
    let title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url;
    title.title = tab.title || '';
    let url = document.createElement('div');
    url.className = 'tab-url';
    url.textContent = tab.url;
    url.title = tab.url;
    text.append(title, url);
    row.append(icon, text);
    return row;
}

function badge(label) {
    let span = document.createElement('span');
    span.className = 'badge';
    span.textContent = label;
    return span;
}

function checkedTabIds() {
    return Array.from(document.querySelectorAll('#duplicate-sets input:checked'), (checkbox) => Number(checkbox.value));
}

function updateCloseButton() {
    let count = checkedTabIds().length;
    let button = document.getElementById('close-and-sort');
    button.textContent = count > 0 ? `Sort & close ${count} tab${count === 1 ? '' : 's'}` : 'Sort';
}

// Enter confirms the preview and Esc cancels without sorting; Space toggles the focused checkbox natively
document.addEventListener('keydown', function (event) {
    if (document.getElementById('preview').hidden) return;
    if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
        event.preventDefault();
        document.getElementById('close-and-sort').click();
    } else if (event.key === 'Escape') {
        window.close();
    }
});
