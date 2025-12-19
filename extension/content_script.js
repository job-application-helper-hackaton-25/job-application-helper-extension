// Enhanced job extraction with JSON-LD, site-specific heuristics, and light normalization.

// ---------- small helpers ----------
const normalize = (text) => (text ? text.replace(/\s+/g, ' ').trim() : null);

function trimTruncationMarker(text) {
  if (!text) return null;
  // Remove "Show more" truncation marker from company descriptions
  return text
    .replace(/\s*…\s*Pokaż więcej…?\s*$/i, '')
    .trim() || null;
}

function getMeta(names) {
  for (const n of names) {
    const el = document.querySelector(`meta[name="${n}"]`) || document.querySelector(`meta[property="${n}"]`);
    if (el?.content) return normalize(el.content);
  }
  return null;
}

function textFromSelectors(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const txt = el && (el.innerText || el.textContent || '').trim();
    if (txt) return txt;
  }
  return null;
}

// ---------- parsing helpers ----------
function parseCompanySize(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return null;
  const raw = sizeStr.trim();
  // Common formats: "501-1000", "5001-10 000", "1-10 employees"
  const range = raw.match(/(\d+[\s\u00A0]*[–\-—][\s\u00A0]*)(\d+[\s\u00A0]*\d*)/);
  if (range) {
    const minStr = range[1].replace(/[–\-—]/g, '').replace(/[\s\u00A0]/g, '');
    const maxStr = range[2].replace(/[\s\u00A0]/g, '');
    const min = parseInt(minStr, 10);
    const max = parseInt(maxStr, 10);
    return { raw, min: Number.isNaN(min) ? null : min, max: Number.isNaN(max) ? null : max };
  }
  const single = raw.match(/(\d+[\s\u00A0]*)\+?/);
  if (single) {
    const n = parseInt(single[1].replace(/[\s\u00A0]/g, ''), 10);
    if (!Number.isNaN(n)) return { raw, min: n, max: null };
  }
  return { raw };
}

function parseSalary(salStr) {
  if (!salStr || typeof salStr !== 'string') return null;
  const raw = salStr.trim();
  const s = raw.replace(/\u00A0/g, ' ').replace(/–|—/g, '-');
  const numMatches = Array.from(s.matchAll(/(\d+[\d\s,.]*)/g)).map((m) => m[1].replace(/[\s,]/g, ''));
  const currency = s.match(/([A-Z]{3}|zł|PLN|EUR|USD|GBP|CZK|HUF)/i);
  const period = s.match(/(miesi[eę]cznie|rocznie|per year|month|year|daily|hour)/i);
  const contract = s.match(/\(([^)]+)\)/);
  let min = null;
  let max = null;
  if (numMatches.length >= 2) {
    min = parseFloat(numMatches[0]);
    max = parseFloat(numMatches[1]);
  } else if (numMatches.length === 1) {
    min = parseFloat(numMatches[0]);
  }
  return {
    raw,
    min: Number.isNaN(min) ? null : min,
    max: Number.isNaN(max) ? null : max,
    currency: currency ? currency[0] : null,
    period: period ? period[0] : null,
    contract: contract ? contract[1] : null,
  };
}

function parseJsonLdJobPosting() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        if (!it) continue;
        const type = (it['@type'] || (it['@type'] && it['@type'][0])) || null;
        if (!type || !String(type).toLowerCase().includes('jobposting')) continue;

        const job = {
          title: it.title || it.name || null,
          description: it.description || null,
          url: it.url || it.mainEntityOfPage || null,
        };
        if (it.hiringOrganization) job.company = it.hiringOrganization.name || null;
        if (it.jobLocation) {
          const loc = it.jobLocation.address || (Array.isArray(it.jobLocation) && it.jobLocation[0]?.address);
          if (loc) job.location = loc.addressLocality || loc.addressRegion || loc.streetAddress || null;
        }
        if (it.baseSalary) {
          if (typeof it.baseSalary === 'object') job.salary = (it.baseSalary.value && (it.baseSalary.value.value || it.baseSalary.value)) || null;
          else job.salary = it.baseSalary;
        }
        return job;
      }
    } catch (e) {
      // ignore JSON-LD parse errors
    }
  }
  return null;
}

// ---------- optional fetch for LinkedIn company page ----------
async function fetchCompanyDetails(companyUrl) {
  try {
    const res = await fetch(companyUrl, { credentials: 'same-origin' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const details = {};

    const nameEl = doc.querySelector('h1') || doc.querySelector('.org-top-card-summary__title');
    if (nameEl?.textContent) details.company = normalize(nameEl.textContent);

    for (const sel of [
      '.org-top-card__description',
      '.org-top-card-summary__tagline',
      '.org-about-us-organization-description__text',
      '.about-us__content',
      'section.about-us',
      '.org-about-company-module__description',
    ]) {
      const el = doc.querySelector(sel);
      if (el?.textContent) { details.companyDescription = normalize(el.textContent); break; }
    }

    const terms = Array.from(doc.querySelectorAll('dt, .org-page-details__definition-list dt, .org-about-company-module__definition-term'));
    for (const t of terms) {
      const key = normalize(t.textContent)?.toLowerCase();
      const val = normalize(t.nextElementSibling?.textContent || '');
      if (!key || !val) continue;
      if (key.includes('industry') || key.includes('bran')) details.industry = details.industry || val;
      if (key.includes('company size') || key.includes('employees') || key.includes('liczba') || key.includes('wielko')) details.size = details.size || val;
    }

    if (!details.industry || !details.size) {
      const lines = (doc.body.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (!details.industry && (lower.includes('industry') || lower.includes('bran'))) details.industry = lines[i + 1] || details.industry;
        if (!details.size && (lower.includes('company size') || lower.includes('employees') || lower.includes('liczba pracowników') || lower.includes('wielkość'))) details.size = lines[i + 1] || details.size;
      }
    }
    return details;
  } catch (e) {
    console.warn('fetchCompanyDetails failed', e);
    return {};
  }
}

// ---------- site-specific extractors ----------
const SELECTORS = {
  linkedin: {
    title: [
      'h1.jobs-unified-top-card__job-title',
      'h1.topcard__title',
      'h1.jobs-search__job-title',
      '[data-test-job-title]',
      'h1[class*=jobs]',
      'h1'
    ],
    company: [
      'a.jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      'a.topcard__org-name-link',
      'a.top-card__subtitle-link',
      'a[href*="/company/"]',
      '.topcard__org-name-link',
      '.company-name',
      '[data-test-company-name]'
    ],
    location: [
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis',
      '.job-details-jobs-unified-top-card__primary-description-container',
      'span.jobs-unified-top-card__bullet',
      'span.topcard__flavor--bullet',
      '[data-test-location]'
    ],
    logo: [
      '.job-details-jobs-unified-top-card__container img[alt*="Logo"]',
      '.ivm-view-attr__img--centered.EntityPhoto-square-1',
      '.jobs-company img[alt*="Logo firmy"]',
      '.topcard__logo img',
      '.jobs-unified-top-card__company-logo img'
    ],
    description: [
      'div.jobs-description__content',
      'div.jobs-description',
      '.jobs-description-content__text',
      'div.show-more-less-html__markup'
    ],
    salary: [
      '.job-details-jobs-unified-top-card__job-insight--highlight',
      '.salary-range'
    ],
    publishedDate: [
      '.posted-time-ago__text',
      'time.posted-time-ago__text',
      'span.jobs-unified-top-card__posted-date'
    ]
  },
  nofluffjobs: {
    title: ['h1[data-qa="offer-title"]', 'h1.offer-title', 'h1.offer__title', 'title h1', 'h1'],
    company: [
      'a#postingCompanyUrl',
      'a[data-cy="JobOffer_CompanyProfile"]',
      '.offer-top__company-name',
      '.offer__company',
      'a.offer__company-link',
      '.company-name'
    ],
    location: [
      '#backToCity a',
      'popover-content li a span',
      'nfj-posting-item-city div',
      '.offer-top__location',
      '.offer__location'
    ],
    workType: [
      'common-posting-locations span:first-child',
      '[data-cy="location_pin"] > span:first-child'
    ],
    description: [
      'common-posting-description',
      '.offer-description',
      '.offer__description'
    ],
    salary: [
      'nfj-posting-item-salary',
      '.salary'
    ]
  },

  justjoinit: {
    title: ['h1.posting-title', 'h1.zui-heading'],
    company: [
      'a[href*="/company/"]',
      '.company-name'
    ],
    location: [
      '.location',
      '.post__location'
    ],
    description: [
      '.description__content',
      '.post__description',
      '.description'
    ],
    salary: ['.salary']
  }
};

function extractBySite(site) {
  const selectors = SELECTORS[site];
  if (!selectors) return {};
  
  return {
    title: textFromSelectors(selectors.title) || null,
    company: textFromSelectors(selectors.company) || null,
    location: textFromSelectors(selectors.location) || null,
    description: textFromSelectors(selectors.description) || null,
    salary: textFromSelectors(selectors.salary) || null,
    publishedDate: selectors.publishedDate ? textFromSelectors(selectors.publishedDate) : null,
    logo: selectors.logo ? textFromSelectors(selectors.logo) : null,
    workType: selectors.workType ? textFromSelectors(selectors.workType) : null
  };
}

function extractCompanyInfoFromJobPage() {
  const linkedInBox = document.querySelector('.jobs-company__box') || document.querySelector('[data-test-company-details]');
  const nfBox = document.querySelector('common-posting-company-about') || document.querySelector('#posting-company') || document.querySelector('.common-posting-company-about');
  const box = linkedInBox || nfBox;
  if (!box) return {};

  const result = {};
  
  // LinkedIn: extract industry from visible text within company box
  const infoDiv = box.querySelector('.t-14.mt5') || box.querySelector('.t-14');
  if (infoDiv) {
    for (const node of infoDiv.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent && node.textContent.trim();
        // Filter out JSON responses or code-like strings
        if (t && t.length > 3 && t.length < 100 && !t.startsWith('{') && !t.includes('request')) { 
          result.industry = t; 
          break; 
        }
      }
    }
    const spans = (infoDiv.querySelectorAll && infoDiv.querySelectorAll('.jobs-company__inline-information')) || [];
    if (spans.length) {
      const s0 = (spans[0].textContent || '').trim();
      // Filter out JSON/API responses
      if (s0 && !s0.startsWith('{') && !s0.includes('request')) result.size = s0;
    }
  }

  const nameEl = box.querySelector('.artdeco-entity-lockup__title a') || box.querySelector('.artdeco-entity-lockup__title');
  if (nameEl) result.company = (nameEl.textContent || '').trim();

  const descEl =
    box.querySelector('.jobs-company__company-description') ||
    box.querySelector('.org-about-company-module__description') ||
    box.querySelector('article') ||
    box.querySelector('.x_elementToProof');
  if (descEl) result.companyDescription = (descEl.textContent || '').trim();

  const listItems = (box.querySelectorAll && Array.from(box.querySelectorAll('.list-group-item'))) || [];
  for (const li of listItems) {
    try {
      const labelSpan = li.querySelector('span.font-gray-757575') || li.querySelector('span');
      const p = li.querySelector('p') || li;
      const label = labelSpan?.textContent ? labelSpan.textContent.trim().toLowerCase() : '';
      const full = p?.textContent ? p.textContent.trim() : '';
      if (!label) continue;
      const value = full.replace(labelSpan?.textContent || '', '').trim();
      if (!value) continue;
      if (label.includes('wielko') || label.includes('company size') || label.includes('employees')) result.size = result.size || value;
      if (label.includes('utworzona') || label.includes('founded')) result.founded = result.founded || value;
      if (label.includes('lokalizac')) result.locations = result.locations || value;
    } catch (e) {
      // ignore list item parse errors
    }
  }
  return result;
}

// ---------- derived fields ----------
function deriveWorkType(description, companyDescription) {
  const text = `${description || ''} ${companyDescription || ''}`;
  if (/hybrid|hybryd/i.test(text)) return 'hybrid';
  if (/remote|zdaln/i.test(text)) return 'remote';
  if (/office|stacjonarny|on-site|on site/i.test(text)) return 'office';
  return null;
}

function deriveContractType(description) {
  if (!description) return null;
  const match = description.match(/(b2b|zlecenie|o pracę|employment|contract)/i);
  return match ? match[1] : null;
}

function detectSource(hostname) {
  if (!hostname) return 'Unknown';
  if (hostname.includes('linkedin')) return 'LinkedIn';
  if (hostname.includes('nofluff')) return 'No Fluff Jobs';
  if (hostname.includes('justjoin')) return 'Just Join IT';
  if (hostname.includes('adzuna')) return 'Adzuna';
  return hostname;
}

function extractLogo() {
  // Try meta tags first (works on some LinkedIn pages)
  const metaImg = getMeta(['og:image']) || getMeta(['twitter:image']);
  if (metaImg && /^https?:/i.test(metaImg)) return metaImg;

  // LinkedIn specific logo selectors - try multiple variations
  const imgSelectors = [
    '.topcard__logo img',
    '.jobs-unified-top-card__company-logo img',
    '.org-top-card-primary-content__logo img',
    '.jobs-company__box img.artdeco-entity-image',
    'img[alt*="company"]',
    'img[alt*="logo"]',
    '.company-logo img',
    'img.logo',
    '.artdeco-entity-image',
    'img[class*="company"]',
    'img[data-delayed-url*="company"]',
    // For newer LinkedIn layouts
    '.jobs-details__company-logo img',
    '[class*="unified-top-card"] img[class*="logo"]',
    '.topcard img[class*="logo"]',
  ];

  for (const sel of imgSelectors) {
    const img = document.querySelector(sel);
    if (!img) continue;
    
    const src = img.getAttribute('src') || 
                img.getAttribute('data-delayed-url') || 
                img.getAttribute('data-img-url') ||
                null;
    
    if (src && /^https?:/i.test(src)) return src;
  }

  return null;
}

function extractPublishedDate() {
  return getMeta(['article:published_time']) || textFromSelectors([
    'time[datetime]',
    '.posted-time-ago__text',
    'time.posted-time-ago__text'
  ]);
}

// ---------- main pipeline ----------
async function extractJobOffer() {
  const offer = { url: location.href };

  const jsonLd = parseJsonLdJobPosting();
  if (jsonLd) {
    Object.assign(offer, jsonLd);
    offer.url = offer.url || location.href;
    
    // Apply derived fields even when using JSON-LD
    offer.description = normalize(offer.description);
    offer.workType = offer.workType || deriveWorkType(offer.description, offer.companyDescription);
    offer.contractType = offer.contractType || deriveContractType(offer.description);
    offer.source = detectSource(location.hostname || '');
    offer.logo = offer.logo || extractLogo();
    offer.publishedDate = offer.publishedDate || extractPublishedDate();
    // Fallback: infer salary from description when missing (e.g., LinkedIn)
    if (!offer.salary && offer.description) {
      const m = offer.description.match(/(\d[\d\s.,]+)\s*[–\-—]\s*(\d[\d\s.,]+)\s*(PLN|zł|EUR|USD|GBP)\b[^\n]*?(miesi[eę]cznie|rocznie|per year|month|year|hour)?/i);
      if (m) offer.salary = m[0];
    }
    
    if (offer.companySize && typeof offer.companySize === 'string') {
      try { offer.companySizeParsed = parseCompanySize(offer.companySize); } catch (e) { console.warn('companySize parse failed', e); }
    }
    if (offer.salary && typeof offer.salary === 'string') {
      try { offer.salaryParsed = parseSalary(offer.salary); } catch (e) { console.warn('salary parse failed', e); }
    }
    
    console.log('extractJobOffer: final offer (from JSON-LD)', offer);
    return offer;
  }

  offer.title = getMeta(['og:title', 'twitter:title']) || textFromSelectors(['h1.job-title', 'h1[class*=title]', 'h1']) || document.title || null;
  offer.company = getMeta(['og:site_name', 'company', 'employer']) || textFromSelectors(['.company', '.companyName', '.employer', '.job-company', '.topcard__org-name-link']) || null;
  offer.location = textFromSelectors(['.location', '.job-location', '.topcard__flavor--bullet']) || getMeta(['location']) || null;
  offer.salary = textFromSelectors(['.salary', '.compensation', '.pay']) || null;
  offer.description = getMeta(['og:description', 'twitter:description', 'description']) ||
    textFromSelectors(['.description', '.job-description', '#job-description', '.job-posting__description', '.listing-summary', '.jd']) || null;

  const host = location.hostname || '';
  try {
    if (host.includes('linkedin.com')) {
      const s = extractBySite('linkedin');
      offer.title = offer.title || s.title || null;
      offer.company = offer.company || s.company || null;
      offer.location = offer.location || s.location || null;
      offer.description = offer.description || s.description || null;
      offer.salary = offer.salary || s.salary || null;
      offer.publishedDate = offer.publishedDate || s.publishedDate || null;
      offer.logo = offer.logo || s.logo || null;

      try {
        const pageInfo = extractCompanyInfoFromJobPage();
        if (pageInfo.industry) offer.industry = offer.industry || pageInfo.industry;
        if (pageInfo.size) offer.companySize = offer.companySize || pageInfo.size;
        if (pageInfo.company) offer.company = offer.company || pageInfo.company;
        if (pageInfo.companyDescription) offer.companyDescription = offer.companyDescription || pageInfo.companyDescription;
      } catch (e) {
        console.warn('extractJobOffer: error parsing company info from job page', e);
      }

      try {
        const compAnchor = document.querySelector('a[href*="/company/"]') || document.querySelector('[data-test-company-name] a');
        if (compAnchor?.href) {
          const companyUrl = compAnchor.href.split('?')[0];
          const missingCompanyInfo = !offer.company || !offer.description || !offer.industry || !offer.companySize;
          if (missingCompanyInfo) {
            const details = await fetchCompanyDetails(companyUrl);
            if (details.company) offer.company = offer.company || details.company;
            if (details.companyDescription) offer.companyDescription = offer.companyDescription || details.companyDescription;
            if (details.industry) offer.industry = offer.industry || details.industry;
            if (details.size) offer.companySize = offer.companySize || details.size;
          }
        }
      } catch (e) {
        console.warn('extractJobOffer: error fetching company page', e);
      }
    } else if (host.includes('nofluffjobs') || host.includes('nofluff')) {
      const s = extractBySite('nofluffjobs');
      offer.title = offer.title || s.title || null;
      offer.company = offer.company || s.company || null;
      offer.location = offer.location || s.location || null;
      offer.description = offer.description || s.description || null;
      offer.salary = offer.salary || s.salary || null;
      offer.workType = offer.workType || s.workType || null;
    } else if (host.includes('justjoin.it') || host.includes('justjoin')) {
      const s = extractBySite('justjoinit');
      offer.title = offer.title || s.title || null;
      offer.company = offer.company || s.company || null;
      offer.location = offer.location || s.location || null;
      offer.description = offer.description || s.description || null;
      offer.salary = offer.salary || s.salary || null;
    }
  } catch (e) {
    console.warn('extractJobOffer: host-specific extraction error', e);
  }

  try {
    const pageInfo = extractCompanyInfoFromJobPage();
    if (pageInfo.company) offer.company = offer.company || pageInfo.company;
    if (pageInfo.industry) offer.industry = offer.industry || pageInfo.industry;
    if (pageInfo.size) offer.companySize = offer.companySize || pageInfo.size;
    if (pageInfo.companyDescription) offer.companyDescription = offer.companyDescription || pageInfo.companyDescription;
  } catch (e) {
    console.warn('extractJobOffer: error merging generic company info', e);
  }

  offer.description = normalize(offer.description);
  offer.companyDescription = normalize(offer.companyDescription);
  // Trim "Show more" marker from company description only
  offer.companyDescription = trimTruncationMarker(offer.companyDescription);

  offer.workType = offer.workType || deriveWorkType(offer.description, offer.companyDescription);
  offer.contractType = offer.contractType || deriveContractType(offer.description);
  offer.source = detectSource(host);
  offer.logo = offer.logo || extractLogo();
  offer.publishedDate = offer.publishedDate || extractPublishedDate();
  // Fallback: infer salary from description when missing (e.g., LinkedIn)
  if (!offer.salary && offer.description) {
    const m = offer.description.match(/(\d[\d\s.,]+)\s*[–\-—]\s*(\d[\d\s.,]+)\s*(PLN|zł|EUR|USD|GBP)\b[^\n]*?(miesi[eę]cznie|rocznie|per year|month|year|hour)?/i);
    if (m) offer.salary = m[0];
  }

  if (offer.companySize && typeof offer.companySize === 'string') {
    try { offer.companySizeParsed = parseCompanySize(offer.companySize); } catch (e) { console.warn('companySize parse failed', e); }
  }
  if (offer.salary && typeof offer.salary === 'string') {
    try { offer.salaryParsed = parseSalary(offer.salary); } catch (e) { console.warn('salary parse failed', e); }
  }
  
  // Map parsed contract type to main contractType field if not already set
  if (!offer.contractType && offer.salaryParsed?.contract) {
    offer.contractType = offer.salaryParsed.contract;
  }

  console.log('extractJobOffer: final offer', offer);
  return offer;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'extractJobOffer') {
    (async () => {
      const offer = await extractJobOffer();
      sendResponse({ offer });
    })();
    return true; // keep channel open for async response
  }
});
