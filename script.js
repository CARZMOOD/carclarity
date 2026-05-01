/* ============================================================
   CarClarity — script.js
   Vanilla JS · NHTSA API · No frameworks · No paid APIs
   ============================================================ */

'use strict';

/* ---- NHTSA API Base URLs ---------------------------------- */
const NHTSA = {
  COMPLAINTS: 'https://api.nhtsa.gov/complaints/complaintsByVehicle',
  RECALLS_VIN: 'https://api.nhtsa.gov/recalls/recallsByVehicleId',
  RECALLS_YMM: 'https://api.nhtsa.gov/recalls/recallsByVehicle',
  DECODE_VIN:  'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues',
  MAKES:       'https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car',
  MODELS:      'https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make',
};

/* ---- State ----------------------------------------------- */
let state = {
  mode: 'vin',        // 'vin' | 'ymm'
  unlocked: false,
  lastResult: null,
};

/* ============================================================
   COUNTRY GATE
   ============================================================ */
const countrySelect  = document.getElementById('country-select');
const countryConfirm = document.getElementById('country-confirm');
const countryBlocked = document.getElementById('country-blocked');
const countryGate    = document.getElementById('country-gate');
const appEl          = document.getElementById('app');

countrySelect.addEventListener('change', () => {
  const val = countrySelect.value;
  countryConfirm.disabled = !val;

  if (val && val !== 'US') {
    countryBlocked.classList.remove('hidden');
    countryConfirm.disabled = true;
  } else {
    countryBlocked.classList.add('hidden');
    countryConfirm.disabled = val !== 'US';
  }
});

countryConfirm.addEventListener('click', () => {
  if (countrySelect.value === 'US') {
    countryGate.style.transition = 'opacity 0.4s ease';
    countryGate.style.opacity = '0';
    setTimeout(() => {
      countryGate.classList.add('hidden');
      appEl.classList.remove('hidden');
      initApp();
    }, 400);
  }
});

/* ============================================================
   INIT
   ============================================================ */
function initApp() {
  populateYears();
}

/* ============================================================
   TAB SWITCHING
   ============================================================ */
function switchTab(tab) {
  state.mode = tab;
  document.getElementById('tab-vin').classList.toggle('active', tab === 'vin');
  document.getElementById('tab-ymm').classList.toggle('active', tab === 'ymm');
  document.getElementById('panel-vin').classList.toggle('hidden', tab !== 'vin');
  document.getElementById('panel-ymm').classList.toggle('hidden', tab !== 'ymm');
  clearError();
}

/* ============================================================
   YMM DROPDOWNS
   ============================================================ */
function populateYears() {
  const sel = document.getElementById('ymm-year');
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1981; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', onYearChange);
}

async function onYearChange() {
  const year = document.getElementById('ymm-year').value;
  const makeSel  = document.getElementById('ymm-make');
  const modelSel = document.getElementById('ymm-model');

  resetSelect(makeSel, 'Make', true);
  resetSelect(modelSel, 'Model', true);

  if (!year) return;

  try {
    const url = `${NHTSA.MAKES}?modelYear=${year}&format=json`;
    const data = await fetchJSON(url);
    const makes = (data.Results || [])
      .map(m => m.MakeName)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    populateSelect(makeSel, makes, 'Make', false);
    makeSel.addEventListener('change', onMakeChange, { once: false });
    // Remove old listener properly
    makeSel.onchange = onMakeChange;
  } catch (e) {
    showError('Could not load makes. Please try again.');
  }
}

async function onMakeChange() {
  const year  = document.getElementById('ymm-year').value;
  const make  = document.getElementById('ymm-make').value;
  const modelSel = document.getElementById('ymm-model');

  resetSelect(modelSel, 'Model', true);
  if (!make) return;

  try {
    const url = `${NHTSA.MODELS}/${encodeURIComponent(make)}/modelYear/${year}?format=json`;
    const data = await fetchJSON(url);
    const models = (data.Results || [])
      .map(m => m.Model_Name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    populateSelect(modelSel, models, 'Model', false);
  } catch (e) {
    showError('Could not load models. Please try again.');
  }
}

function resetSelect(sel, placeholder, disabled) {
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  sel.disabled = disabled;
}

function populateSelect(sel, items, placeholder, disabled) {
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    sel.appendChild(opt);
  });
  sel.disabled = disabled;
}

/* ============================================================
   MAIN CHECK LOGIC
   ============================================================ */
async function runCheck() {
  clearError();
  hideResults();

  // Validate input
  let vehicleLabel = '';
  let recallParams = {};
  let complaintParams = {};

  if (state.mode === 'vin') {
    const vin = document.getElementById('vin-input').value.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      showError('Please enter a valid 17-character VIN (letters and numbers, no I, O, or Q).');
      return;
    }
    // Decode VIN to get year/make/model for label and complaint lookup
    setLoading(true, 'Decoding VIN…');
    try {
      const decoded = await decodeVIN(vin);
      if (!decoded.year || !decoded.make || !decoded.model) {
        showError('Could not decode this VIN. Please check it or use Year/Make/Model search.');
        setLoading(false);
        return;
      }
      vehicleLabel = `${decoded.year} ${decoded.make} ${decoded.model}`;
      recallParams  = { year: decoded.year, make: decoded.make, model: decoded.model };
      complaintParams = { year: decoded.year, make: decoded.make, model: decoded.model };
    } catch (e) {
      showError('VIN decode failed. Please try the Year/Make/Model tab instead.');
      setLoading(false);
      return;
    }
  } else {
    const year  = document.getElementById('ymm-year').value;
    const make  = document.getElementById('ymm-make').value;
    const model = document.getElementById('ymm-model').value;

    if (!year || !make || !model) {
      showError('Please select Year, Make, and Model to continue.');
      return;
    }
    vehicleLabel = `${year} ${make} ${model}`;
    recallParams  = { year, make, model };
    complaintParams = { year, make, model };
  }

  setLoading(true, 'Fetching safety data…');

  try {
    const [recalls, complaints] = await Promise.all([
      fetchRecalls(recallParams),
      fetchComplaints(complaintParams),
    ]);

    state.lastResult = { vehicleLabel, recalls, complaints };
    state.unlocked = false; // reset paywall on new search

    displayResults(vehicleLabel, recalls, complaints);
  } catch (e) {
    showError('Failed to retrieve data from NHTSA. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
}

/* ============================================================
   NHTSA API CALLS
   ============================================================ */
async function decodeVIN(vin) {
  const url = `${NHTSA.DECODE_VIN}/${vin}?format=json`;
  const data = await fetchJSON(url);
  const res = (data.Results || [])[0] || {};
  return {
    year:  res.ModelYear || '',
    make:  res.Make || '',
    model: res.Model || '',
  };
}

async function fetchRecalls({ year, make, model }) {
  const url = `${NHTSA.RECALLS_YMM}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const data = await fetchJSON(url);
  return data.results || [];
}

async function fetchComplaints({ year, make, model }) {
  const url = `${NHTSA.COMPLAINTS}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const data = await fetchJSON(url);
  return data.results || [];
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ============================================================
   RISK SCORING
   ============================================================ */
function scoreRisk(recallCount, complaintCount) {
  if (recallCount > 2 || complaintCount > 50) {
    return {
      level: 'HIGH',
      explanation: 'This vehicle shows a high number of reported issues and multiple recalls. Proceed with extreme caution and arrange a thorough professional inspection before purchase.',
      advice: 'Given the elevated risk profile, we strongly recommend a pre-purchase inspection by a certified mechanic who specializes in this make. Review each recall record to confirm all safety campaigns have been completed. If recalls are open, contact a dealer for free repairs before finalizing any purchase decision. Consider whether the price reflects the documented safety history.',
    };
  }
  if (recallCount >= 1 || complaintCount >= 10) {
    return {
      level: 'CAUTION',
      explanation: 'This vehicle has some recorded recalls or complaints. It\'s worth verifying recall completion status and investigating complaint patterns before purchasing.',
      advice: 'Review the recall records listed below and contact a franchised dealership to confirm all campaigns are closed. Look for patterns in complaint types — repeated issues with the same component can signal a chronic problem. A professional inspection is still advisable, with focus on any systems mentioned in the complaints.',
    };
  }
  return {
    level: 'LOW',
    explanation: 'This vehicle shows few or no significant safety concerns in the official government database. That\'s a good sign, though no database is exhaustive.',
    advice: 'This vehicle has a clean government safety record. While encouraging, always complement database research with a visual inspection, a test drive, and ideally a pre-purchase inspection by an independent mechanic. Request a full service history from the seller and check for any open technical service bulletins at your local dealership.',
  };
}

/* ============================================================
   DISPLAY RESULTS
   ============================================================ */
function displayResults(vehicleLabel, recalls, complaints) {
  const recallCount    = recalls.length;
  const complaintCount = complaints.length;
  const risk           = scoreRisk(recallCount, complaintCount);

  // Preview
  document.getElementById('result-vehicle-name').textContent = vehicleLabel;
  document.getElementById('preview-recalls').textContent    = recallCount;
  document.getElementById('preview-complaints').textContent = complaintCount;

  // Risk card
  const riskCard = document.getElementById('risk-card');
  const riskLevel = document.getElementById('risk-level');
  riskCard.className = `result-card risk-card ${risk.level}`;
  riskLevel.className = `risk-level ${risk.level}`;
  riskLevel.textContent = risk.level === 'HIGH' ? '⚠ HIGH RISK' :
                          risk.level === 'CAUTION' ? '⚡ CAUTION' : '✓ LOW RISK';
  document.getElementById('risk-explanation').textContent = risk.explanation;

  // Advice
  document.getElementById('advice-text').textContent = risk.advice;

  // Recalls list
  const recallsBadge = document.getElementById('recall-count-badge');
  recallsBadge.textContent = recallCount;
  const recallsList = document.getElementById('recalls-list');
  if (recallCount === 0) {
    recallsList.innerHTML = '<div class="empty-state">✓ No recalls found for this vehicle.</div>';
  } else {
    recallsList.innerHTML = recalls.slice(0, 20).map(r => `
      <div class="item-entry">
        <div class="item-entry-title">${sanitize(r.Component || r.subject || 'Recall')}</div>
        <div class="item-entry-date">Report Date: ${formatDate(r.ReportReceivedDate || r.recallDate)}</div>
        <div class="item-entry-body">${sanitize(r.Summary || r.consequence || r.remedy || 'See NHTSA website for full details.')}</div>
      </div>
    `).join('');
  }

  // Complaints list
  const complaintsBadge = document.getElementById('complaint-count-badge');
  complaintsBadge.textContent = complaintCount;
  const complaintsList = document.getElementById('complaints-list');
  if (complaintCount === 0) {
    complaintsList.innerHTML = '<div class="empty-state">✓ No complaints found for this vehicle.</div>';
  } else {
    complaintsList.innerHTML = complaints.slice(0, 20).map(c => `
      <div class="item-entry">
        <div class="item-entry-title">${sanitize(c.components || c.Component || 'Complaint')}</div>
        <div class="item-entry-date">Date: ${formatDate(c.dateOfIncident || c.IncidentDate)} · Mileage: ${c.mileage ? c.mileage.toLocaleString() + ' mi' : 'N/A'}</div>
        <div class="item-entry-body">${sanitize(truncate(c.description || c.Description || 'No description provided.', 220))}</div>
      </div>
    `).join('');
  }

  // Show results section
  document.getElementById('results-section').classList.remove('hidden');

  // Paywall state
  if (state.unlocked) {
    document.getElementById('paywall-block').classList.add('hidden');
    document.getElementById('full-report').classList.remove('hidden');
  } else {
    document.getElementById('paywall-block').classList.remove('hidden');
    document.getElementById('full-report').classList.add('hidden');
  }

  // Scroll to results
  setTimeout(() => {
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

/* ============================================================
   PAYWALL / UNLOCK
   ============================================================ */
function simulateUnlock(e) {
  e.preventDefault();

  // In production this would verify a Gumroad webhook or license key.
  // For demo purposes, we simulate unlock after a short delay.
  const btn = document.getElementById('gumroad-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Processing…';
  btn.style.pointerEvents = 'none';

  setTimeout(() => {
    state.unlocked = true;
    document.getElementById('paywall-block').style.transition = 'opacity 0.4s ease';
    document.getElementById('paywall-block').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('paywall-block').classList.add('hidden');
      document.getElementById('full-report').classList.remove('hidden');
      document.getElementById('full-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
  }, 1200);
}

/* ============================================================
   BONUS: COPY & SHARE
   ============================================================ */
function copyResults() {
  if (!state.lastResult) return;
  const { vehicleLabel, recalls, complaints } = state.lastResult;
  const risk = scoreRisk(recalls.length, complaints.length);

  const text = [
    `CarClarity Safety Report`,
    `========================`,
    `Vehicle: ${vehicleLabel}`,
    `Source: NHTSA Public Safety Database`,
    ``,
    `RISK LEVEL: ${risk.level}`,
    `Total Recalls: ${recalls.length}`,
    `Total Complaints: ${complaints.length}`,
    ``,
    `Risk Explanation: ${risk.explanation}`,
    ``,
    `Advice: ${risk.advice}`,
    ``,
    `---`,
    `CarClarity · Powered by NHTSA · carclarity.github.io`,
  ].join('\n');

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.action-bar .btn-secondary');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => {
    alert('Copy failed. Please select and copy the text manually.');
  });
}

function shareResults() {
  if (!state.lastResult) return;
  const { vehicleLabel, recalls, complaints } = state.lastResult;
  const risk = scoreRisk(recalls.length, complaints.length);

  const shareText = `I just checked a ${vehicleLabel} on CarClarity. Risk: ${risk.level} · ${recalls.length} recalls · ${complaints.length} complaints. Powered by official NHTSA data.`;
  const shareUrl  = window.location.href;

  if (navigator.share) {
    navigator.share({ title: 'CarClarity Report', text: shareText, url: shareUrl })
      .catch(() => {});
  } else {
    // Fallback: copy share text
    navigator.clipboard.writeText(`${shareText}\n${shareUrl}`).then(() => {
      alert('Share link copied to clipboard!');
    });
  }
}

/* ============================================================
   UI HELPERS
   ============================================================ */
function setLoading(on, label = 'Checking…') {
  const btn     = document.getElementById('check-btn');
  const btnLabel = document.getElementById('btn-label');
  const spinner  = document.getElementById('btn-spinner');

  btn.disabled = on;
  btnLabel.textContent = on ? label : 'Check This Car';
  spinner.classList.toggle('hidden', !on);
}

function showError(msg) {
  const el = document.getElementById('search-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  document.getElementById('search-error').classList.add('hidden');
}

function hideResults() {
  document.getElementById('results-section').classList.add('hidden');
}

function resetApp() {
  hideResults();
  clearError();
  state.lastResult = null;
  state.unlocked   = false;
  document.getElementById('vin-input').value = '';
  document.getElementById('ymm-year').value  = '';
  const makeSel  = document.getElementById('ymm-make');
  const modelSel = document.getElementById('ymm-model');
  resetSelect(makeSel, 'Make', true);
  resetSelect(modelSel, 'Model', true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   STRING UTILITIES
   ============================================================ */
function sanitize(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatDate(raw) {
  if (!raw) return 'N/A';
  // Handle epoch milliseconds
  if (typeof raw === 'number') {
    return new Date(raw).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  // Handle strings like "20231015" or ISO
  const s = String(raw);
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(4, 6)}/${s.slice(6, 8)}/${s.slice(0, 4)}`;
  }
  try {
    const d = new Date(s);
    if (!isNaN(d)) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) {}
  return s;
}
