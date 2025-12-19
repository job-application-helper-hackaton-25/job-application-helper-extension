# Job Offer Importer — Chrome Extension

Installs as a Chrome extension. Click the extension icon to open the popup, configure the JobOffer API URL, then click "Import job from this page" on any job listing page.

Installation (developer mode):

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder

Usage:

- Enter your JobOffer API endpoint in the popup (e.g. `https://example.com/api/offers`).
- Visit a job offer page, click the extension, then click "Import job from this page".

Notes:

- The extractor uses simple heuristics (meta tags, common CSS classes). For reliable imports you may need to adapt `content_script.js` to the target site structure.
- The background worker performs the POST request (so CORS and the API must accept requests from extensions).
# job-offer-organizer