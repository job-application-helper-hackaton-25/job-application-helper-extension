const importBtn = document.getElementById('import');
const statusEl = document.getElementById('status');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'crimson' : 'green';
}

importBtn.addEventListener('click', async () => {
  setStatus('Extracting job details...', false);
  // ask the active tab to extract details
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab || !tab.id) { setStatus('No active tab found', true); return; }

  // Try executing the extractor in all frames and pick the best result.
  if (chrome.scripting && chrome.scripting.executeScript) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          try {
            if (typeof extractJobOffer === 'function') return extractJobOffer();
            return null;
          } catch (e) {
            return { __extractError: String(e) };
          }
        }
      });

      // results is an array of {frameId, result}
      let best = null;
      let mainFrameResult = null;
      
      // Common third-party iframe domains to exclude
      const blockedDomains = [
        'googletagmanager', 'google-analytics', 'doubleclick', 'google.com/recaptcha',
        'protechts.net', 'sw_iframe', 'recaptcha', 'livechatinc.com', 'intercom.io',
        'drift.com', 'tawk.to', 'zopim.com', 'facebook.com/plugins', 'twitter.com/widgets',
        'linkedin.com/embed', 'youtube.com/embed', 'ads-twitter.com', 'analytics.tiktok.com',
        'bat.bing.com', 'cookie-script.com', 'usercentrics.eu', 'gtm.js'
      ];
      
      for (const r of results) {
        const res = r.result;
        if (!res) continue;
        if (res.__extractError) continue;
        const url = (res.url||'').toString().toLowerCase();
        
        // Filter out third-party iframes
        if (blockedDomains.some(domain => url.includes(domain))) continue;
        if (!url || url === 'about:blank') continue;
        
        // Score by populated fields
        const score = ['title','company','description','location','salary'].reduce((s,k)=> s + (res[k]?1:0), 0);
        
        // Always prefer main frame (frameId 0) if it has any data
        if (r.frameId === 0 && score > 0) {
          mainFrameResult = {res, score, frameId: r.frameId};
        }
        
        if (!best || score > best.score) best = {res, score, frameId: r.frameId};
      }

      // Use main frame if available, otherwise use best scored
      const chosen = mainFrameResult || best;
      if (chosen && chosen.res) {
        handleExtractionResponse({offer: chosen.res});
        return;
      }
      // else fall through to legacy messaging approach
    } catch (e) {
      // ignore and fallback
    }
  }

  // fallback: sendMessage to content script (with injection retry)
  chrome.tabs.sendMessage(tab.id, {type: 'extractJobOffer'}, (response) => {
    if (chrome.runtime.lastError) {
      // Try to inject the content script programmatically then retry
      setStatus('Content script not available — injecting and retrying...', false);
      chrome.runtime.sendMessage({type: 'ensureContentScript', tabId: tab.id}, (res) => {
        if (!res || !res.ok) {
          setStatus('Failed to inject content script: ' + (res && res.error ? res.error : 'unknown'), true);
          return;
        }
        // Retry sending message
        chrome.tabs.sendMessage(tab.id, {type: 'extractJobOffer'}, (response2) => {
          if (chrome.runtime.lastError) { setStatus('Still no content script on page: ' + chrome.runtime.lastError.message, true); return; }
          handleExtractionResponse(response2);
        });
      });
      return;
    }
    handleExtractionResponse(response);
  });
});

function handleExtractionResponse(response) {
  if (!response || !response.offer) { setStatus('No job offer found on the page.', true); return; }

  setStatus('Sending to API...', false);
  // send to background to perform fetch (or log if API not configured)
  chrome.runtime.sendMessage({type: 'sendToApi', offer: response.offer}, (res) => {
    if (res && res.ok) {
      setStatus('Imported successfully.');
    } else {
      setStatus('Failed to import: ' + (res && res.error ? res.error : 'unknown'), true);
    }
  });
}
