// See https://publicsuffix.org and https://github.com/lupomontero/psl for psl library details
import './psl.min.js';

'use strict';

// Default to "The Marvellous Suspender" as the de facto The Great Suspender replacement
const THE_MARVELLOUS_SUSPENDER_EXTENSION_ID = "noogafoofpebimajpfpamcfhoaifemoa";

var TAB_SUSPENDER_EXTENSION_ID = "";
var SUSPENDED_PREFIX = 'chrome-extension://' + TAB_SUSPENDER_EXTENSION_ID + '/suspended.html#';
var SUSPENDED_PREFIX_LEN = SUSPENDED_PREFIX.length;

// Query parameters that only track where a link came from, ignored by dedupe if 'dedupeIgnoreTrackingParams' is set
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igshid|_ga|_gl)$/i;

// How long the post-sort badge stays on the extension icon
const BADGE_DURATION_MS = 4000;

// Prefix a tab group's title with this marker to keep it from being rearranged, e.g. "🔒 Work"
const LOCKED_GROUP_MARKER = "🔒";

// Extension icon onClick handler...
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type == "click_event") {
        // closeTabIds is set when the user confirmed a duplicates preview, limiting dedupe to the tabs they kept checked
        let closeTabIds = request.closeTabIds ? new Set(request.closeTabIds) : null
        sortTabGroups({ closeTabIds: closeTabIds }).then((run) => showSortBadge(run.closedTabCount), showErrorBadge);
        sendResponse({ message: 'success' });
    } else if (request.type == "preview_duplicates") {
        sortTabGroups({ dryRun: true }).then(
            (run) => sendResponse({ message: 'success', duplicateSets: run.duplicateSets }),
            (error) => sendResponse({ message: 'error', error: String(error) })
        );
        // Keep the message channel open for the async response
        return true;
    }
})

// Return whether tab is currently suspended
function isSuspended(tab) {
    return tab.url.startsWith(SUSPENDED_PREFIX);
}

// One-time installation and v0.4.0 upgrade handlers...
chrome.runtime.onInstalled.addListener(function (details) {

    var thisVersion = chrome.runtime.getManifest().version;
    if (details.reason == "install") {
        chrome.storage.sync.set({
            installedVersion: thisVersion,
            newInstall: true,
            newUpdate: false
        }, function () {
            // Prompt for (optional) uninstall feedback so I can see if there's room for improvement...
            if (chrome.runtime.setUninstallURL) {
                var uninstallGoogleFormLink = 'https://docs.google.com/forms/d/e/1FAIpQLSe-r_WFNry_KZCwOjdMjDjiS8sEIWmmwY-3hbSmIYV393RLCA/viewform';
                chrome.runtime.setUninstallURL(uninstallGoogleFormLink);
            }
        });
    } else if (details.reason == "update") {
        chrome.storage.sync.set({
            installedVersion: thisVersion,
            newInstall: false,
            newUpdate: true
        }, function () { });
    }
})

// Separate windows must be sorted separately - this is to prevent undesired accidental sorting in other windows...
// A dryRun computes which tabs dedupe would close (returned as run.duplicateSets) without moving or closing anything.
async function sortTabGroups({ dryRun = false, closeTabIds = null } = {}) {

    let settings = await chrome.storage.sync.get({
        sortBy: "url",
        groupFrom: "leftToRight",
        preserveOrderWithinGroups: false,
        groupSuspendedTabs: false,
        tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
        sortPinnedTabs: false,
        dedupeTabs: false,
        dedupeIgnoreHash: false,
        dedupeIgnoreTrackingParams: false,
        dedupeIgnoreTrailingSlash: false,
        dedupeKeepActiveTab: true
    });

    let run = {
        dryRun: dryRun,
        closeTabIds: closeTabIds,
        // Maps each deduped URL to the id of the tab that keeps it open
        keepers: new Map(),
        tabsById: new Map(),
        // Kept tab id -> the duplicate tabs found for it, in the order dedupe finds them
        duplicatesByKeeper: new Map(),
        closedTabCount: 0
    }

    TAB_SUSPENDER_EXTENSION_ID = settings.tabSuspenderExtensionId;
    SUSPENDED_PREFIX = 'chrome-extension://' + TAB_SUSPENDER_EXTENSION_ID + '/suspended.html#';
    SUSPENDED_PREFIX_LEN = SUSPENDED_PREFIX.length;

    // I believe this was unnecessary in manifest v2, IIRC, and that the "default window" worked as expected though that's not the case in manifest v3.
    let currentWindow  = await chrome.windows.getLastFocused()

    let pinnedTabs = await chrome.tabs.query({
        windowId: currentWindow.id,
        pinned: true,
        currentWindow: true,
    })
    var groupOffset = pinnedTabs.length

    let tabGroups = await chrome.tabGroups.query({ windowId: currentWindow.id })
    let windowTabs = await chrome.tabs.query({ windowId: currentWindow.id })
    for (let tab of windowTabs) {
        run.tabsById.set(tab.id, tab)
    }

    // Order tab groups by their current position in the tab strip...
    let groupPositions = new Map()
    for (let tab of windowTabs) {
        if (tab.groupId > -1 && !groupPositions.has(tab.groupId)) {
            groupPositions.set(tab.groupId, tab.index)
        }
    }
    tabGroups.sort(function (a, b) {
        return groupPositions.get(a.id) - groupPositions.get(b.id);
    });

    // Seed run.keepers with locked groups' tabs so dedupe closes their duplicates elsewhere rather than the locked tabs themselves...
    if (settings.dedupeTabs) {
        for (let tab of windowTabs) {
            let group = tabGroups.find((g) => g.id === tab.groupId)
            if (group && isLockedGroup(group)) {
                keepTab(run, tab, settings)
            }
        }
        // ...then the active tab, unless a locked tab already keeps its URL
        let activeTab = windowTabs.find((tab) => tab.active)
        if (settings.dedupeKeepActiveTab && activeTab) {
            keepTab(run, activeTab, settings)
        }
    }

    if (pinnedTabs.length > 0 && settings.sortPinnedTabs) {
        // Dedupe may close pinned tabs, so groups start after the pinned tabs that remain
        groupOffset = await sortTabs(run, pinnedTabs, pinnedTabs[0].groupId, settings)
    }

    // You can prefix your tab group names with numeric values if you'd like to override the sort order...
    let unlockedGroups = tabGroups.filter((g) => !isLockedGroup(g)).sort(function (a, b) {
        return a.title.localeCompare(b.title);
    });
    // Locked groups keep their slot in the group order, and unlocked groups fill the remaining slots alphabetically...
    let orderedGroups = tabGroups.map((g) => isLockedGroup(g) ? g : unlockedGroups.shift())

    // Sort tab groups
    for (let group of orderedGroups) {
        if (!dryRun) {
            await chrome.tabGroups.move(group.id, { index: groupOffset });
        }
        let tabs = await chrome.tabs.query({
            windowId: currentWindow.id,
            groupId: group.id
        })
        // Sort tabs tab group's tabs while we have a reference to them, leaving locked groups' tabs untouched.
        // Advance by the tabs left open, since moving the next group past closed duplicates lands it inside another group
        if (isLockedGroup(group)) {
            groupOffset += tabs.length
        } else {
            groupOffset += await sortTabs(run, tabs, group.id, settings, group.collapsed)
        }
    }

    // Sort ungrouped tabs
    let ungroupedTabs = await chrome.tabs.query({
        windowId: currentWindow.id,
        pinned: false,
        groupId: -1
    })
    await sortTabs(run, ungroupedTabs, -1, settings)

    run.duplicateSets = Array.from(run.duplicatesByKeeper, ([keeperId, duplicates]) => ({
        keeper: tabSummary(run.tabsById.get(keeperId)),
        duplicates: duplicates.map(tabSummary)
    }))
    return run
}

// The parts of a tab the duplicates preview displays
function tabSummary(tab) {
    return { id: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl }
}

// Flash a checkmark on the extension icon after sorting, or the number of duplicate tabs closed
async function showSortBadge(closedCount) {
    await chrome.action.setBadgeBackgroundColor({ color: closedCount > 0 ? "#d9822b" : "#2e7d32" })
    await chrome.action.setBadgeText({ text: closedCount > 0 ? "-" + closedCount : "✓" })
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), BADGE_DURATION_MS)
}

async function showErrorBadge(error) {
    console.error("Super Tab Sorter failed to sort tabs:", error)
    await chrome.action.setBadgeBackgroundColor({ color: "#c62828" })
    await chrome.action.setBadgeText({ text: "!" })
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), BADGE_DURATION_MS)
}

// URL used to detect duplicate tabs, normalized according to the dedupe settings
function dedupeKey(tab, settings) {
    let url = tabToUrl(tab)
    if (settings.dedupeIgnoreHash) {
        url.hash = ''
    }
    if (settings.dedupeIgnoreTrackingParams) {
        for (let param of Array.from(url.searchParams.keys())) {
            if (TRACKING_PARAM.test(param)) url.searchParams.delete(param)
        }
    }
    if (settings.dedupeIgnoreTrailingSlash) {
        url.pathname = url.pathname.replace(/\/+$/, '')
    }
    return url.href
}

// Mark tab as the one to keep for its URL, unless another tab already keeps it
function keepTab(run, tab, settings) {
    let key = dedupeKey(tab, settings)
    if (!run.keepers.has(key)) {
        run.keepers.set(key, tab.id)
    }
}

// Tab groups whose title starts with LOCKED_GROUP_MARKER keep their position and tab order when sorting
function isLockedGroup(group) {
    return (group.title || '').trimStart().startsWith(LOCKED_GROUP_MARKER);
}

// Returns the number of tabs left open after dedupe
async function sortTabs(run, tabs, groupId, settings, collapsed = false) {
    if (tabs.length === 0) return 0
    let firstTabIndex = tabs[0].index
    switch (settings.sortBy) {
        case "url":
        case "title":
        case "urlTitle":
            sortByTitleOrUrl(tabs, settings.sortBy, settings.groupSuspendedTabs, settings.sortPinnedTabs);
            break;
        case "custom":
            sortByCustom(tabs, settings.groupFrom, settings.groupSuspendedTabs, settings.preserveOrderWithinGroups, settings.sortPinnedTabs);
            break;
    }

    // Convert array of tabs to array of tab IDs, deduping tabs (in current window) if enabled in settings...
    var tabIds = []
    if (settings.dedupeTabs) {
        let duplicateIds = []
        for (let tab of tabs) {
            keepTab(run, tab, settings)
            let keeperId = run.keepers.get(dedupeKey(tab, settings))
            // After a preview, only close duplicates the user confirmed - anything else stays open
            if (keeperId === tab.id || (run.closeTabIds && !run.closeTabIds.has(tab.id))) {
                tabIds.push(tab.id)
            } else {
                duplicateIds.push(tab.id)
                if (!run.duplicatesByKeeper.has(keeperId)) run.duplicatesByKeeper.set(keeperId, [])
                run.duplicatesByKeeper.get(keeperId).push(tab)
            }
        }
        if (run.dryRun) return tabIds.length
        if (duplicateIds.length > 0) {
            await chrome.tabs.remove(duplicateIds)
            run.closedTabCount += duplicateIds.length
        }
        // Every tab here was a duplicate, so there's nothing left to move
        if (tabIds.length === 0) return 0
    } else {
        if (run.dryRun) return tabs.length
        tabIds = tabs.map(function(tab){ return tab.id; })
    }
    // Relocate tabs to their new positions...
    await chrome.tabs.move(tabIds, { index: firstTabIndex });

    // Regroup tabs that were moved since moving them appears to remove them from the group...
    if (groupId > -1) {
        await chrome.tabs.group({
            groupId: groupId,
            tabIds: tabIds
        })
        // Regrouping expands collapsed groups, so restore their collapsed state...
        if (collapsed) {
            await chrome.tabGroups.update(groupId, { collapsed: true })
        }
    }
    return tabIds.length
}

// Returns the tab's suspended URL if 'groupSuspendedTabs' is set - otherwise, return's the current tab's URL or suspended tab's original URL
function tabToUrl(tab, groupSuspendedTabs) {
    if (groupSuspendedTabs) {
        return new URL(tab.url);
    } else {
        const suspendedSuffix = tab.url.slice(SUSPENDED_PREFIX_LEN);
        if (suspendedSuffix) {
            var params = new URLSearchParams(suspendedSuffix);
            for (let [param, val] of params) {
                if (param === 'uri') {
                    return new URL(val);
                }
            }
        }
        return new URL(tab.pendingUrl || tab.url);
    }
}

// Populate tab group ordering Map...
function updateTabGroupMap(tabGroupMap, tab, sortBy, groupSuspendedTabs) {
    if (sortBy == "title") {
        if (!tabGroupMap.has(tab.title)) tabGroupMap.set(tab.title, tabGroupMap.size);
    } else {
        // sortBy "url" and "custom" group tabs by URL().host...
        var urlParser = tabToUrl(tab, groupSuspendedTabs);
        var host = urlParser.host;

        if (!tabGroupMap.has(host)) {
            tabGroupMap.set(host, tabGroupMap.size)
        }
    }
}

// Sort by domain name, sub sort by hostname, path, query string, and hash (anchor)
function compareByUrlComponents(urlA, urlB) {
    // See https://publicsuffix.org and https://github.com/lupomontero/psl for psl library details
    var parsedA =  psl.parse(urlA.hostname)
    var keyA = parsedA.domain + parsedA.subdomain + urlA.pathname + urlA.search + urlA.hash;

    var parsedB =  psl.parse(urlB.hostname)
    var keyB = parsedB.domain + parsedB.subdomain + urlB.pathname + urlB.search + urlB.hash;

    return keyA.localeCompare(keyB);
}

// Sort by root domain, sub sort by subdomain, then title, falling back to the full URL for identical titles
function compareByDomainAndTitle(urlA, titleA, urlB, titleB) {
    var parsedA = psl.parse(urlA.hostname)
    var parsedB = psl.parse(urlB.hostname)

    // psl returns a null domain for hosts without a public suffix (e.g. localhost, IP addresses, chrome:// pages)
    var domainCompare = (parsedA.domain || urlA.hostname).localeCompare(parsedB.domain || urlB.hostname);
    if (domainCompare !== 0) return domainCompare;

    var subdomainCompare = (parsedA.subdomain || '').localeCompare(parsedB.subdomain || '');
    if (subdomainCompare !== 0) return subdomainCompare;

    var titleCompare = titleA.localeCompare(titleB);
    if (titleCompare !== 0) return titleCompare;

    return compareByUrlComponents(urlA, urlB);
}

// Group suspended tabs to left side if 'groupSuspendedTabs' is checked in settings
function sortByTitleOrUrl(tabs, sortBy, groupSuspendedTabs, sortPinnedTabs) {
    // Group suspended tabs to the left, using comparator for unsuspended tabs.
    tabs.sort(function (a, b) {

        if (sortBy == "title") {
            return _titleComparator(a, b, groupSuspendedTabs, sortPinnedTabs);
        } else if (sortBy == "urlTitle") {
            return _urlTitleComparator(a, b, groupSuspendedTabs, sortPinnedTabs);
        } else {
            return _urlComparator(a, b, groupSuspendedTabs, sortPinnedTabs);
        }
    });

    // Shift suspended tabs left (if groupSuspendedTabs == true). Otherwise, sort by title in the browser's current locale.
    function _titleComparator(a, b, groupSuspendedTabs, sortPinnedTabs) {

        // Option to exclude pinned tabs in the sort action (excluded by default)
        if (!sortPinnedTabs && (a.pinned || b.pinned)) {
            return 0;
        }

        if (groupSuspendedTabs) {
            if (isSuspended(a) && !isSuspended(b)) return -1;
            if (!isSuspended(a) && isSuspended(b)) return 1;
        }
        return a.title.localeCompare(b.title);
    }

    // Shift suspended tabs left (if groupSuspendedTabs == true). Otherwise, sort by URL in the browser's current locale.
    function _urlComparator(a, b, groupSuspendedTabs, sortPinnedTabs) {

        if (!sortPinnedTabs && (a.pinned || b.pinned)) {
            return 0;
        }

        // Shift suspended tabs left...
        if (groupSuspendedTabs) {
            if (isSuspended(a) && !isSuspended(b)) return -1;
            if (!isSuspended(a) && isSuspended(b)) return 1;
        }

        var urlA = tabToUrl(a, groupSuspendedTabs);
        var urlB = tabToUrl(b, groupSuspendedTabs);

        return compareByUrlComponents(urlA, urlB);
    }

    // Shift suspended tabs left (if groupSuspendedTabs == true). Otherwise, sort by root domain, then subdomain, then title.
    function _urlTitleComparator(a, b, groupSuspendedTabs, sortPinnedTabs) {

        if (!sortPinnedTabs && (a.pinned || b.pinned)) {
            return 0;
        }

        // Shift suspended tabs left...
        if (groupSuspendedTabs) {
            if (isSuspended(a) && !isSuspended(b)) return -1;
            if (!isSuspended(a) && isSuspended(b)) return 1;
        }

        var urlA = tabToUrl(a, groupSuspendedTabs);
        var urlB = tabToUrl(b, groupSuspendedTabs);

        return compareByDomainAndTitle(urlA, a.title, urlB, b.title);
    }
}

// Sort by URL as defined by the configured extension settings
function sortByCustom(tabs, groupFrom, groupSuspendedTabs, preserveOrderWithinGroups, sortPinnedTabs) {
    var tabGroupMap = new Map();
    var left = 0, suspendedTabCount = 0, right = tabs.length;

    // Group tabs from leftToRight or rightToLeft as configured in settings...
    if (groupFrom == "leftToRight") {
        // Ensures that suspended tabs will be shifted to the left side of browser if 'groupSuspendedTabs' is checked in settings
        if (groupSuspendedTabs) {
            tabGroupMap.set(TAB_SUSPENDER_EXTENSION_ID, 0);
        }
        while (left !== right) {
            if (isSuspended(tabs[left])) {
                suspendedTabCount += 1;
            }
            updateTabGroupMap(tabGroupMap, tabs[left], "custom", groupSuspendedTabs);
            left += 1;
        }
    } else {
        while (left !== right) {
            right -= 1;
            if (isSuspended(tabs[right])) {
                suspendedTabCount += 1;
            }
            updateTabGroupMap(tabGroupMap, tabs[right], "custom", groupSuspendedTabs);
        }
        // Ensures that suspended tabs will be shifted to the left side of browser if 'groupSuspendedTabs' is checked in settings
        if (groupSuspendedTabs) {
            tabGroupMap.set(TAB_SUSPENDER_EXTENSION_ID, tabGroupMap.size);
        }
    }

    tabs.sort(function (a, b) {
        return _customSortComparator(a, b, groupSuspendedTabs, sortPinnedTabs);
    });

    // Support independent subsorting of suspended tabs if 'groupSuspendedTabs' is checked in settings
    if (groupSuspendedTabs) {
        // Repopulate tabGroupMap, ignoring "groupSuspendedTabs" (so they're not all in the same bucket), to get the subsort right...
        tabGroupMap.clear();
        left = 0, right = suspendedTabCount;
        // Shift suspended tabs to far left of page if keeping them grouped...
        if (groupFrom == "leftToRight") {
            while (left !== right) {
                updateTabGroupMap(tabGroupMap, tabs[left], "custom", false);
                left += 1;
            }
        } else {
            while (left !== right) {
                right -= 1;
                updateTabGroupMap(tabGroupMap, tabs[right], "custom", false);
            }
        }

        var suspendedTabs = tabs.slice(0, suspendedTabCount).sort(function (a, b) { return _customSortComparator(a, b, false); });
        var postSorted = tabs.slice(suspendedTabCount);
        tabs.length = 0;
        tabs.push.apply(tabs, suspendedTabs.concat(postSorted));
    }

    function _customSortComparator(a, b, groupSuspendedTabs, sortPinnedTabs) {
        if (!sortPinnedTabs && (a.pinned || b.pinned)) {
            return 0;
        }

        // Shift suspended tabs left...
        if (groupSuspendedTabs) {
            if (isSuspended(a) && !isSuspended(b)) return -1;
            if (!isSuspended(a) && isSuspended(b)) return 1;
        }

        // Subsort by URL...
        let urlA = tabToUrl(a, groupSuspendedTabs);
        let urlB = tabToUrl(b, groupSuspendedTabs);

        var groupPosA = tabGroupMap.get(urlA.host);
        var groupPosB = tabGroupMap.get(urlB.host);

        if (groupFrom == "leftToRight") {
            if (groupPosA < groupPosB) return -1;
            if (groupPosA > groupPosB) return 1;
        } else {
            if (groupPosA < groupPosB) return 1;
            if (groupPosA > groupPosB) return -1;
        }

        // Subsort tabs within groups unless we're subsorting suspended tabs && 'preserveOrderWithinGroups' is specified in user options
        if (!groupSuspendedTabs && !preserveOrderWithinGroups) {
            return compareByUrlComponents(urlA, urlB);
        }
        return 0;
    }
}