# Job Offer Importer — Chrome Extension

Installs as a Chrome extension. Click the extension icon to open the popup, then click "Import job from this page" on any job listing page to extract job details and send them to your configured API endpoint.

## Installation (developer mode)

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension` folder
4. Configure your API endpoint in `extension/config.js`

## Configuration

Edit `extension/config.js` and update the API_URL:

```javascript
const CONFIG = {
  API_URL: 'https://your-api-endpoint.com/api/offers'
};
```

## Usage

1. Visit a job offer page (LinkedIn, Indeed, etc.)
2. Click the extension icon
3. Click "Import job from this page"
4. The extension will extract job details and POST them to your configured API

## Debugging & Monitoring

### Why Access Service Worker DevTools?

The extension uses a **background service worker** to:
- Make POST requests to your API (avoiding CORS issues)
- Log all extracted job data
- Handle network errors

**The popup's DevTools won't show these network requests** — you must use the service worker's DevTools.

### How to Access Service Worker DevTools:

1. Open `chrome://extensions/`
2. Find "Job Offer Importer" extension
3. Click the **"service worker"** link (appears as "Inspect views service worker")
4. A new DevTools window opens for the service worker
5. Use the **Console** tab to see logged JSON payloads
6. Use the **Network** tab to see POST requests to your API

**Note:** The service worker may become inactive when idle. If you don't see the link, trigger the extension (click "Import job from this page") and the service worker will activate.

## Notes

- The extractor uses JSON-LD, meta tags, and common CSS selectors to extract job details
- For site-specific extraction, you may need to adapt `content_script.js`
- The background service worker performs POST requests (your API must accept requests from extensions)
# job-offer-organizer