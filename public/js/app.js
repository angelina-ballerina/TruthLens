/* ============================================================
   app.js — TruthLens frontend logic

   WHAT THIS FILE DOES:
   1. Listens for user actions (typing, uploading, clicking)
   2. Sends the article text to our backend API (/api/factcheck)
   3. Takes the response and builds the results HTML

   KEY CONCEPTS USED:
   - document.getElementById()  → find an element on the page
   - addEventListener()         → run code when something happens
   - fetch()                    → send a request to a server
   - async / await              → wait for slow things (like API calls)
   - template literals (`...`)  → build strings with variables inside
   ============================================================ */


// ── STEP 1: Get references to elements we'll use ─────────────
// It's good practice to grab these once at the top rather than
// searching the page every time we need them.

const textarea     = document.getElementById('articleInput');
const charCount    = document.getElementById('charCount');
const fileInput    = document.getElementById('fileInput');
const checkBtn     = document.getElementById('checkBtn');
const loadingEl    = document.getElementById('loading');
const loadingStep  = document.getElementById('loadingStep');
const errorBox     = document.getElementById('errorBox');
const resultsEl    = document.getElementById('results');


// ── STEP 2: Character counter ─────────────────────────────────
// Every time the user types in the textarea, update the count.

textarea.addEventListener('input', () => {
  charCount.textContent = textarea.value.length + ' characters';
});


// ── STEP 3: File upload ───────────────────────────────────────
// When a file is chosen, read its text content and put it in the textarea.

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0]; // get the first selected file
  if (!file) return;                   // do nothing if no file chosen

  const reader = new FileReader();

  // This runs when the file has been read
  reader.onload = (e) => {
    textarea.value = e.target.result;
    charCount.textContent = textarea.value.length + ' characters';
  };

  reader.readAsText(file); // actually read the file
});


// ── STEP 4: Loading step messages ────────────────────────────
// While we're waiting for the API, cycle through these messages
// so the user knows something is happening.

const LOADING_STEPS = [
  'Reading article and identifying key claims...',
  'Searching the web for related sources...',
  'Cross-referencing claims with published material...',
  'Calculating credibility score...',
];

let stepIndex = 0;
let stepTimer = null;

function startLoadingSteps() {
  stepIndex = 0;
  loadingStep.textContent = LOADING_STEPS[0];

  // setInterval runs a function repeatedly every N milliseconds
  stepTimer = setInterval(() => {
    // Math.min prevents going past the last step
    stepIndex = Math.min(stepIndex + 1, LOADING_STEPS.length - 1);
    loadingStep.textContent = LOADING_STEPS[stepIndex];
  }, 3500);
}

function stopLoadingSteps() {
  clearInterval(stepTimer);
}


// ── STEP 5: Helper — show an error message ────────────────────

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = 'block';
}

function hideError() {
  errorBox.style.display = 'none';
}


// ── STEP 6: Helper — safely escape HTML ──────────────────────
// This prevents a sneaky security issue called XSS (Cross-Site Scripting).
// If user input contains <script> tags, we turn < into &lt; so the browser
// treats it as text instead of running it as code.

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ── STEP 7: Render the results into the page ──────────────────
// Takes the JSON data from the API and builds HTML to display it.

function renderResults(data) {
  // Clamp score between 0 and 100 just in case
  const score = Math.min(100, Math.max(0, data.score || 50));

  // Choose a colour theme class based on the score
  const verdictClass = score >= 65 ? 'verdict-high'
                     : score >= 40 ? 'verdict-med'
                     :               'verdict-low';

  // The ring animation works using SVG stroke-dashoffset.
  // The circle's circumference (r=45) is 2π×45 ≈ 283.
  // offset=283 means "fully hidden"; offset=0 means "fully drawn".
  const ringOffset = 283 - (score / 100) * 283;

  // Build the claims HTML
  const claimsHTML = (data.claims || []).map(claim => `
    <div class="claim-item">
      <div class="claim-dot ${escapeHtml(claim.status)}"></div>
      <div>
        <div class="claim-text">${escapeHtml(claim.text)}</div>
        <div class="claim-status ${escapeHtml(claim.status)}">${escapeHtml(claim.status)}</div>
      </div>
    </div>
  `).join('');

  // Build the sources HTML
  const sourcesHTML = (data.sources || []).map((source, index) => `
    <div class="source-item">
      <div class="source-num">[${index + 1}]</div>
      <div>
        <div class="source-title">${escapeHtml(source.title)}</div>
        <div class="source-desc">${escapeHtml(source.description)}</div>
        <div class="source-tags">
          ${(source.tags || []).map(tag => `<span class="source-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
    </div>
  `).join('');

  // Put it all together
  resultsEl.innerHTML = `
    <div class="score-card ${verdictClass}">
      <div class="score-ring-wrap">
        <svg viewBox="0 0 100 100">
          <circle class="score-ring-bg" cx="50" cy="50" r="45"/>
          <circle class="score-ring-fill" cx="50" cy="50" r="45" id="scoreRing"
                  style="stroke-dashoffset:${ringOffset}"/>
        </svg>
        <div class="score-center">
          <div class="score-num">${score}</div>
          <div class="score-pct">/ 100</div>
        </div>
      </div>
      <div class="score-info">
        <div class="score-verdict">${escapeHtml(data.verdict || 'Unverified')}</div>
        <div class="score-summary">${escapeHtml(data.summary || '')}</div>
      </div>
    </div>

    <div class="section-label">Key Claims Identified</div>
    <div class="claims-list">${claimsHTML}</div>

    <div class="section-label">Referenced Sources</div>
    <div class="sources-list">${sourcesHTML}</div>
  `;

  resultsEl.style.display = 'block';

  // Tiny delay so the browser has time to paint the element before
  // we change the dashoffset (which triggers the CSS transition animation)
  setTimeout(() => {
    const ring = document.getElementById('scoreRing');
    if (ring) ring.style.strokeDashoffset = ringOffset;
  }, 100);
}


// ── STEP 8: The main fact-check function ─────────────────────
// This runs when the user clicks "Fact Check".
// "async" means it can use "await" to pause while waiting for the API.

checkBtn.addEventListener('click', async () => {
  const text = textarea.value.trim();

  // Basic validation
  if (!text || text.length < 20) {
    showError('Please paste at least a sentence or two to fact-check.');
    return;
  }

  // ── Reset UI ──
  resultsEl.style.display = 'none';
  resultsEl.innerHTML = '';
  hideError();
  loadingEl.style.display = 'block';
  checkBtn.disabled = true;
  startLoadingSteps();

  try {
    // ── Call our backend API ──
    // We call /api/factcheck (our own server), NOT Anthropic directly.
    // This keeps our API key secret — it lives on the server, not in this file.
    const response = await fetch('/api/factcheck', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', // tell the server we're sending JSON
      },
      body: JSON.stringify({ text: text.slice(0, 4000) }), // send the article text
    });

    const data = await response.json(); // parse the response as JSON

    // Stop loading UI
    stopLoadingSteps();
    loadingEl.style.display = 'none';
    checkBtn.disabled = false;

    if (!response.ok) {
      // The server returned an error (e.g. 400, 500)
      showError(data.error || 'Something went wrong. Please try again.');
      return;
    }

    renderResults(data);

  } catch (error) {
    // Network error, or the server crashed
    stopLoadingSteps();
    loadingEl.style.display = 'none';
    checkBtn.disabled = false;
    showError('Could not reach the server. Please check your connection and try again.');
    console.error('Fetch error:', error); // log details for debugging
  }
});
