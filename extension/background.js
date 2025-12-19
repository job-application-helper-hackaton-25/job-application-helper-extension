// Background service worker: receives offer and sends to configured JobOffer API
importScripts('config.js');

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

  const apiUrl = CONFIG.API_URL && CONFIG.API_URL.trim();
  // Always log the payload for debugging
  console.log('=== Job Offer Importer ===');
  console.log('Configured API URL:', apiUrl);
  console.log('Payload to send:', msg.offer);

  if (!apiUrl) {
    // If API is not configured, return the payload to the popup for inspection
    console.warn('⚠️ API URL not configured. Update config.js to enable API requests.');
    sendResponse({ok: true, payload: msg.offer, info: 'API URL not configured — logged locally.'});
    return;
  }

  (async () => {
    try {
      console.log('Sending POST request to:', apiUrl);
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg.offer)
      });
      console.log('Response status:', res.status, res.statusText);
      if (!res.ok) {
        const text = await res.text();
        console.error('❌ Request failed:', text);
        sendResponse({ok: false, error: `HTTP ${res.status}: ${text}`, payload: msg.offer});
      } else {
        console.log('✅ Request successful');
        sendResponse({ok: true, payload: msg.offer});
      }
    } catch (err) {
      console.error('❌ Fetch error:', err);
      sendResponse({ok: false, error: err && err.message ? err.message : String(err), payload: msg.offer});
    }
  })();

  // Return true to indicate we'll call sendResponse asynchronously
  return true;
});
