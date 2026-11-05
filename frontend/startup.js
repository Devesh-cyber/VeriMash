'use strict';
// VeriMash readiness screen. In v2 there is no backend to wake up:
// it simply waits until the app has reached both blockchains.
(() => {
  const cfg = window.VERIMASH;
  const nameA = cfg?.chainA?.name || 'Blockchain A', nameB = cfg?.chainB?.name || 'Blockchain B';
  const overlay = document.createElement('div');
  overlay.id = 'verimash-startup';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="vm-start-card">
      <div class="vm-start-mark">◇</div>
      <div class="vm-start-brand">VeriMash</div>
      <div class="vm-start-eyebrow">CROSS-CHAIN VERIFICATION</div>
      <h1>Preparing your verification environment</h1>
      <p id="vm-start-detail">Connecting to both blockchains…</p>
      <div class="vm-start-indicator" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="vm-start-route"><div><strong>A</strong><small></small></div><span>→</span><div><strong>B</strong><small></small></div></div>
      <div id="vm-start-trouble" class="vm-start-trouble" hidden>
        <p></p>
        <button id="vm-start-retry" type="button">Retry connection</button>
      </div>
      <p class="vm-start-foot">Independent validators · No trusted relay · No real cryptocurrency required</p>
    </div>`;
  const smalls = overlay.querySelectorAll('.vm-start-route small');
  smalls[0].textContent = nameA; smalls[1].textContent = nameB;
  document.body.appendChild(overlay);
  const detail = overlay.querySelector('#vm-start-detail');
  const trouble = overlay.querySelector('#vm-start-trouble');
  const troubleText = trouble.querySelector('p');
  const retry = overlay.querySelector('#vm-start-retry');
  let started = Date.now();
  const done = () => { overlay.classList.add('vm-start-done'); setTimeout(() => overlay.remove(), 450); };

  function tick() {
    if (window.VM_STATUS === 'ready') { detail.textContent = 'VeriMash is ready'; return done(); }
    if (window.VM_STATUS === 'not-deployed') {
      detail.textContent = 'VeriMash has not been deployed yet.';
      troubleText.textContent = 'frontend/config.js is missing. Run `npm run local`, or deploy with `npm run deploy:testnet`.';
      trouble.hidden = false; retry.textContent = 'Continue anyway';
      retry.onclick = done;
      return;
    }
    const secs = (Date.now() - started) / 1000;
    detail.textContent = secs < 6 ? `Reading ${nameA} and ${nameB}…` : 'Still waiting for a blockchain RPC to answer…';
    if (secs > 45) {
      troubleText.textContent = `${nameA} or ${nameB} is not responding. ${cfg?.local ? 'Check that `npm run local` (or your Chain B node) is still running.' : 'A public RPC may be busy.'} No transaction has been submitted.`;
      trouble.hidden = false;
      return;
    }
    setTimeout(tick, 600);
  }
  retry.addEventListener('click', () => {
    if (window.VM_STATUS === 'not-deployed') return;
    trouble.hidden = true; started = Date.now(); window.VM_REFRESH?.(); tick();
  });
  tick();
})();
