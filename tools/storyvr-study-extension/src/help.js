chrome.tabs.query({ active: true, currentWindow: true })
  .then((tabs) => chrome.runtime.sendMessage({
    type: "popup-status",
    tabId: Number.isInteger(tabs[0]?.id) ? tabs[0].id : null,
  }))
  .then((status) => {
    if (!status?.ok) return;
    const heading = document.querySelector("[data-study-name]");
    heading.textContent = status.displayName || status.studyConfigId || heading.textContent;
  })
  .catch(() => {});
