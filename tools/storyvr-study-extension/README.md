# StoryVR study extension

This Manifest V3 extension adds interactions from an explicitly approved original-story tab to StoryVR's local interaction-log file. An original page is recorded only when two independent gates are active:

1. The exact page has been approved in the extension popup.
2. **Data collection** is on in StoryVR.

Opening the popup does not approve or observe a page. Approval requires the visible confirmation and **Approve this story page** action. This technical authorization supplements the study's informed-consent procedure; it does not replace it.

## Build and install

1. Review `study-config.json`. Keep the StoryVR controller pages limited to the intended loopback author server and confirm whether the study permits the optional collection of visible control labels.
2. From the project root, run `npm run storyvr:study-extension`.
3. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
4. Select **Load unpacked** and choose `tools/storyvr-study-extension/unpacked/`.
5. If StoryVR was already open, reload its tab once so its controller bridge is attached.
6. Use a separate Chrome profile for the study and keep StoryVR and the original story in that profile.

The extension does not need a build-time URL entry for each original story. Any top-level HTTP or HTTPS story page can be approved explicitly when it is in the active tab.

## Approve an original story

1. Open the original story and select the StoryVR study logger in Chrome's toolbar.
2. Review the exact origin and path displayed by the popup.
3. Check **I confirm this exact page is part of the consented study**.
4. If the study configuration allows it, an additional unchecked option can include visible text on clicked controls. Enable it only when that collection is required and disclosed; visible labels can contain sensitive information.
5. Select **Approve this story page**.
6. Return to StoryVR and turn on **Data collection** when the session should begin. Select the folder where StoryVR should create the named JSON data file.

Approval is limited to the current tab, exact origin, and exact path. Query strings and fragments are excluded from page identity and from the stored data. Reloading the same page retains approval. Moving to another path or origin, closing the tab, explicitly revoking access, successfully finalizing the session, reloading the extension, or restarting Chrome removes approval. New and duplicated tabs must be approved separately.

Only the top-level page is observed. Interactions inside any embedded frame are outside the collection boundary.

## Collect and save

StoryVR remains the start, checkpoint, and finalization controller. Turning **Data collection** on opens a folder chooser. After the user selects a location, StoryVR creates a named JSON data file in that folder and begins collection. Canceling the initial folder choice leaves collection off and does not start an extension session.

While collection is on, StoryVR periodically prepares the extension cache, combines both event streams in timestamp order, and checkpoints them to the same JSON file. A checkpoint clears only the events that were written successfully; it keeps the session and original-page approvals active. If a checkpoint fails, the unwritten events stay cached for retry.

Turning **Data collection** off records an immediate collection cutoff, stops accepting new events, and finalizes that existing file in the selected folder. It does not open a second file or folder chooser. If finalization must retry, the same cutoff and buffered events are preserved. StoryVR clears the remaining cache and page approvals only after finalization succeeds.

An approved original page can contribute clicks, safe control kinds, coarse pointer and scroll buckets, and page visibility and focus. Tab switching is recorded at a generic level while collection is on. For a tab that has not been approved, the extension records only that the user switched outside the study pages; it does not read or export that tab's address or content.

By default, arbitrary visible page text is excluded. When the optional visible-control-label choice is permitted and selected, the log may include sanitized visible text from the clicked control. Typed text and form values are never collected.

The extension does not collect:

- typing, form values, or keystrokes;
- cookies or page local/session storage;
- query strings, fragments, full or raw URLs;
- browsing history;
- raw Chrome tab or document identifiers; or
- content inside embedded frames.

Unwritten session data and temporary page approvals remain in session-only extension storage. StoryVR writes approved data only to the selected local folder; the extension does not upload it.

## Revoke an approved page

Open the extension popup on the approved original page and select **Stop observing this tab**. The observer is disabled and the service worker rejects further events from that grant. Revoking one page does not stop StoryVR's overall Data collection session; use the StoryVR switch to finalize the complete session in its selected folder.

## Configuration

The checked-in study configuration identifies the study and its trusted local StoryVR controller pages. Original-story permission is granted at runtime through the popup, so changing stories no longer requires rebuilding the extension. Keep separate study identifiers for distinct study protocols, and disclose the interaction categories and optional label collection in the study's consent materials.
