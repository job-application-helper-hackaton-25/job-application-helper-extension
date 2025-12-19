// Background service worker: receives offer and sends to configured JobOffer API

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // Support programmatic injection when popup requests it
  if (msg.type === 'ensureContentScript') {
    const tabId = msg.tabId;
    if (!tabId) { sendResponse({ok: false, error: 'no tabId'}); return; }
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content_script.js']
    }, () => {
      if (chrome.runtime.lastError) sendResponse({ok: false, error: chrome.runtime.lastError.message});
      else sendResponse({ok: true});
    });
    return true;
  }

  if (msg.type !== 'sendToApi') return;

  chrome.storage.local.get({jobOfferApiUrl: ''}, (items) => {
    const apiUrl = items.jobOfferApiUrl && items.jobOfferApiUrl.trim();
    // Always log the payload for debugging
    try {
      console.log('JobOffer Importer - payload to send:', msg.offer);
    } catch (e) { /* ignore */ }

    if (!apiUrl) {
      // If API is not configured, return the payload to the popup for inspection
      sendResponse({ok: true, payload: msg.offer, info: 'API URL not configured — logged locally.'});
      return;
    }

    (async () => {
      try {
        console.log('JobOffer Importer - sending to', apiUrl, msg.offer);
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.offer)
        });
        if (!res.ok) {
          const text = await res.text();
          sendResponse({ok: false, error: `HTTP ${res.status}: ${text}`, payload: msg.offer});
        } else {
          sendResponse({ok: true, payload: msg.offer});
        }
      } catch (err) {
        sendResponse({ok: false, error: err && err.message ? err.message : String(err), payload: msg.offer});
      }
    })();
  });

  // Return true to indicate we'll call sendResponse asynchronously
  return true;
});
