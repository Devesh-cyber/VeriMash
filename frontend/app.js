'use strict';
/* VeriMash v2 application.
 * Same interface as v1, but there is no VeriMash backend any more:
 *  - the user signs the source transaction in their own wallet (MetaMask)
 *  - the page reads both blockchains directly through public RPCs
 *  - delivery happens when independent validators vote on Chain B */
const cfg = window.VERIMASH;
const $ = id => document.getElementById(id);
const short = (v, start = 11, end = 7) => v && String(v).length > start + end + 2 ? `${String(v).slice(0, start)}…${String(v).slice(-end)}` : String(v ?? '—');
function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (cls) node.className = cls; return node; }
function show(id, text, bad = false) { const node = $(id); node.hidden = false; node.className = bad ? 'result error' : 'result'; node.textContent = text; }
function notice(text) { const node = $('notice'); node.textContent = text; node.hidden = !text; }
function reasonOf(e) {
  const r = e?.reason || e?.revert?.args?.[0] || e?.info?.error?.message || e?.error?.message || e?.shortMessage || e?.message || String(e);
  return String(r).replace(/^execution reverted:?\s*/i, '').replace(/^"|"$/g, '');
}

/* ---------- navigation (unchanged from v1, plus Validators) ---------- */
const VIEWS = { overview: 'Overview', workspace: 'Transaction Workspace', validators: 'Validators', demo: 'Live Transaction Demo', explorer: 'Transaction Explorer', security: 'Security Lab' };
function navigate(name) {
  if (!VIEWS[name]) name = 'overview';
  document.querySelectorAll('.app-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  $('breadcrumbPage').textContent = VIEWS[name];
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => { location.hash = '#' + b.dataset.goto; }));
navigate(location.hash.slice(1) || 'overview');

if (!cfg) {
  window.VM_STATUS = 'not-deployed';
  notice('VeriMash is not deployed yet: frontend/config.js is missing. Run `npm run local`, or deploy with `npm run deploy:testnet`.');
} else {
  main();
}

function main() {
  const { ethers } = window;
  /* ---------- chain connections ---------- */
  const fixRpc = url => (cfg.local && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? url.replace('127.0.0.1', location.hostname) : url);
  const pA = new ethers.JsonRpcProvider(fixRpc(cfg.chainA.rpc), cfg.chainA.chainId, { staticNetwork: true });
  const pB = new ethers.JsonRpcProvider(fixRpc(cfg.chainB.rpc), cfg.chainB.chainId, { staticNetwork: true });
  const source = new ethers.Contract(cfg.chainA.source, cfg.abis.source, pA);
  const gate = new ethers.Contract(cfg.chainB.gate, cfg.abis.gate, pB);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const N = cfg.validators.length, T = cfg.threshold;
  const keyFor = (nonce, sender, message) => ethers.keccak256(coder.encode(
    ['uint256', 'address', 'uint256', 'address', 'uint64', 'address', 'bytes32'],
    [cfg.chainA.chainId, cfg.chainA.source, cfg.chainB.chainId, cfg.chainB.gate, nonce, sender, ethers.keccak256(ethers.toUtf8Bytes(message))]));
  const vName = addr => cfg.validators.find(v => v.address.toLowerCase() === String(addr).toLowerCase())?.name || short(addr, 8, 6);
  const txUrl = (chain, hash) => chain.explorer ? `${chain.explorer}/tx/${hash}` : null;

  /* ---------- static labels ---------- */
  document.querySelectorAll('.nameA').forEach(e => (e.textContent = cfg.chainA.name));
  document.querySelectorAll('.nameB').forEach(e => (e.textContent = cfg.chainB.name));
  document.querySelectorAll('.srcContract').forEach(e => (e.textContent = `Source ${short(cfg.chainA.source, 8, 6)}`));
  document.querySelectorAll('.gateContract').forEach(e => (e.textContent = `Gate ${short(cfg.chainB.gate, 8, 6)}`));
  document.querySelectorAll('.chainALine').forEach(e => (e.textContent = `${cfg.chainA.name} · Chain ID ${cfg.chainA.chainId}`));
  document.querySelectorAll('.chainBLine').forEach(e => (e.textContent = `${cfg.chainB.name} · Chain ID ${cfg.chainB.chainId}`));
  $('chainAId').textContent = `Chain ID ${cfg.chainA.chainId}`;
  $('chainBId').textContent = `Chain ID ${cfg.chainB.chainId}`;
  $('sentLabel').textContent = `${cfg.chainA.name} · VeriMashSource`;
  $('receivedLabel').textContent = `${cfg.chainB.name} · VeriMashGate`;
  $('thresholdBadge').textContent = `${T} of ${N} required`;
  $('envChip').innerHTML = `<span class="live-dot"></span> ${cfg.local ? 'LOCAL TESTNET' : 'PUBLIC TESTNET'}`;
  document.querySelectorAll('.demo-environment').forEach(e => (e.textContent = cfg.local ? 'LOCAL TEST CHAINS · NO REAL FUNDS' : 'PUBLIC TESTNET · NO REAL FUNDS'));
  $('envName').textContent = cfg.local ? 'Local development chains' : 'Public test networks';
  $('envDetail').innerHTML = `${cfg.chainA.name} → ${cfg.chainB.name}<br/>No relay · ${T}-of-${N} independent validators`;

  /* ---------- chain state, read incrementally ---------- */
  let CHUNK = cfg.logChunk || 2000;
  const st = {
    headA: 0, headB: 0, nextA: cfg.chainA.deployBlock, nextB: cfg.chainB.deployBlock,
    sent: new Map(),      // nonce -> {nonce, sender, message, txHash, block, key}
    votes: new Map(),     // key -> Map(validatorLower -> {txHash, block})
    delivered: new Map(), // nonce -> {nonce, key, txHash, block, message, sender}
    voteCount: 0,
  };
  const votersOf = key => st.votes.get(key) || new Map();

  async function logs(contract, filter, from, to) {
    try { return await contract.queryFilter(filter, from, to); }
    catch (e) { if (CHUNK > 10) { CHUNK = Math.max(10, Math.floor(CHUNK / 4)); return null; } throw e; } // RPC range limit: shrink and retry
  }
  async function scanA() {
    st.headA = await pA.getBlockNumber();
    while (st.nextA <= st.headA) {
      const to = Math.min(st.headA, st.nextA + CHUNK - 1);
      const evs = await logs(source, source.filters.MessageSent(), st.nextA, to);
      if (!evs) continue;
      for (const ev of evs) {
        if (Number(ev.args.destChainId) !== cfg.chainB.chainId) continue;
        const n = Number(ev.args.nonce);
        st.sent.set(n, { nonce: n, sender: ev.args.sender, message: ev.args.message, txHash: ev.transactionHash, block: ev.blockNumber, key: keyFor(ev.args.nonce, ev.args.sender, ev.args.message) });
      }
      st.nextA = to + 1;
    }
  }
  async function scanB() {
    st.headB = await pB.getBlockNumber();
    while (st.nextB <= st.headB) {
      const to = Math.min(st.headB, st.nextB + CHUNK - 1);
      const att = await logs(gate, gate.filters.Attested(), st.nextB, to); if (!att) continue;
      const del = await logs(gate, gate.filters.MessageDelivered(), st.nextB, to); if (!del) continue;
      for (const ev of att) {
        if (!st.votes.has(ev.args.key)) st.votes.set(ev.args.key, new Map());
        const m = st.votes.get(ev.args.key), v = ev.args.validator.toLowerCase();
        if (!m.has(v)) st.voteCount++;
        m.set(v, { txHash: ev.transactionHash, block: ev.blockNumber, nonce: Number(ev.args.nonce) });
      }
      for (const ev of del) {
        const n = Number(ev.args.nonce);
        st.delivered.set(n, { nonce: n, key: ev.args.key, txHash: ev.transactionHash, block: ev.blockNumber, message: ev.args.message, sender: ev.args.sender });
      }
      st.nextB = to + 1;
    }
  }

  /* ---------- refresh loop ---------- */
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true;
    let okA = true, okB = true;
    try { await scanA(); } catch (e) { okA = false; console.warn('Chain A', e); }
    try { await scanB(); } catch (e) { okB = false; console.warn('Chain B', e); }
    if (okA && okB) {
      window.VM_STATUS = 'ready';
      notice('');
      $('connection').textContent = 'Connected';
      $('chainId').textContent = `Chain IDs ${cfg.chainA.chainId} / ${cfg.chainB.chainId}`;
      $('statusBadge').className = 'status-badge online'; $('statusBadge').textContent = '● Both blockchains connected';
      $('topNetwork').textContent = `● A #${st.headA} · B #${st.headB}`;
    } else {
      $('connection').textContent = 'Offline';
      $('topNetwork').textContent = `● ${okA ? '' : 'Chain A '}${okB ? '' : 'Chain B '}unavailable`;
      $('statusBadge').textContent = '● Connection unavailable'; $('statusBadge').className = 'status-badge offline';
      notice(`Cannot reach ${okA ? '' : cfg.chainA.name + ' '}${okA || okB ? '' : 'or '}${okB ? '' : cfg.chainB.name}. ${cfg.local ? 'Is `npm run local` (or the Chain B node) still running?' : 'The public RPC may be busy; it retries automatically.'}`);
    }
    $('sent').textContent = st.sent.size;
    $('received').textContent = st.delivered.size;
    $('audits').textContent = st.voteCount;
    renderHistory(); renderValidators(); renderJourney(); renderDemo();
    busy = false;
  }
  window.VM_REFRESH = refresh;
  $('refreshButton').addEventListener('click', refresh);

  /* ---------- wallet ---------- */
  let signerSource = null, account = null;
  async function connectWallet() {
    if (signerSource) return signerSource;
    if (window.ethereum) {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const hex = '0x' + cfg.chainA.chainId.toString(16);
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); }
      catch (e) {
        if (e.code === 4902 || /unrecognized|not added/i.test(e.message || '')) {
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: cfg.chainA.name, rpcUrls: [fixRpc(cfg.chainA.rpc)], nativeCurrency: { name: cfg.chainA.currency, symbol: cfg.chainA.currency, decimals: 18 }, blockExplorerUrls: cfg.chainA.explorer ? [cfg.chainA.explorer] : undefined }] });
        } else throw e;
      }
      const signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
      account = await signer.getAddress();
      signerSource = new ethers.Contract(cfg.chainA.source, cfg.abis.source, signer);
      window.ethereum.on?.('accountsChanged', () => location.reload());
      window.ethereum.on?.('chainChanged', () => location.reload());
    } else if (cfg.local && cfg.demoKey) {
      const w = new ethers.Wallet(cfg.demoKey, pA);
      account = w.address;
      signerSource = new ethers.Contract(cfg.chainA.source, cfg.abis.source, w);
    } else {
      throw new Error('No wallet found. Install MetaMask, or on a phone open this page inside the MetaMask app browser.');
    }
    $('walletButton').textContent = `● ${short(account, 6, 4)}`;
    $('walletButton').classList.add('connected');
    $('walletButton').title = window.ethereum ? 'Connected with MetaMask' : 'Local demo wallet';
    return signerSource;
  }
  $('walletButton').addEventListener('click', async () => {
    try { await connectWallet(); } catch (e) { notice(reasonOf(e)); navigate('overview'); }
  });

  /* ---------- sending (shared by Workspace and Live Demo) ---------- */
  const tracking = { workspace: null, demo: null };
  async function sendMessage(slot, text) {
    const contract = await connectWallet();
    if (new TextEncoder().encode(text).length > 240) throw new Error('Message is longer than 240 bytes.');
    tracking[slot] = { message: text, txHash: null, nonce: null, startedAt: Date.now() };
    renderJourney(); renderDemo();
    const tx = await contract.sendMessage(cfg.chainB.chainId, text);
    tracking[slot].txHash = tx.hash; renderJourney(); renderDemo();
    const r = await tx.wait();
    const ev = r.logs.map(l => { try { return source.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'MessageSent');
    tracking[slot].nonce = Number(ev.args.nonce);
    refresh();
    return tracking[slot];
  }

  /* ---------- journey stages, computed from chain state ---------- */
  function stagesFor(t) {
    const m = t?.nonce != null ? st.sent.get(t.nonce) : null;
    const conf = m ? Math.max(0, st.headA - m.block + 1) : 0;
    const confOk = m && conf >= cfg.confirmations;
    const voters = m ? votersOf(m.key) : new Map();
    const d = m ? st.delivered.get(m.nonce) : null;
    const delivered = d && d.key === m.key;
    const mode = (done, active) => (done ? 'done' : active ? 'processing' : 'waiting');
    const voterNames = [...voters.keys()].map(vName);
    return [
      { title: 'Source transaction signed', desc: `${cfg.chainA.name} · Your wallet emits a MessageSent event`, label: 'Source tx:', value: t?.txHash || (t ? 'Waiting for wallet confirmation…' : 'Send a message to begin.'), url: t?.txHash && txUrl(cfg.chainA, t.txHash), mode: mode(!!m, !!t && !m) },
      { title: 'Source block confirmations', desc: `Validators wait for ${cfg.confirmations} confirmation(s) so the event cannot be reorganised away`, label: m ? `Block #${m.block} · ` : '', value: m ? `${Math.min(conf, cfg.confirmations)} / ${cfg.confirmations} confirmations · nonce #${m.nonce}` : '—', mode: mode(confOk, !!m && !confOk) },
      { title: 'Independent validators verify', desc: 'Each validator re-reads the receipt and block hash through its own RPC provider', label: m ? `${voters.size} of ${N} confirmed:` : '', value: m ? (voterNames.join(', ') || 'Waiting for the first validator…') : '—', mode: mode(voters.size >= T, confOk && voters.size < T) },
      { title: 'Threshold reached on Chain B', desc: `${cfg.chainB.name} · Gate counts on-chain votes, ${T} of ${N} required, no relay`, label: m ? `${voters.size} vote${voters.size === 1 ? '' : 's'} (${T} needed) ·` : '', value: m ? (voters.size ? [...voters.values()].map(v => short(v.txHash, 10, 6)).join(', ') : 'No votes yet') : '—', votes: m?.key, mode: mode(voters.size >= T, confOk && voters.size > 0 && voters.size < T) },
      { title: 'Delivered and recorded', desc: `${cfg.chainB.name} · Gate emits MessageDelivered with a receipt ID`, label: 'Destination tx:', value: delivered ? d.txHash : '—', url: delivered && txUrl(cfg.chainB, d.txHash), mode: mode(delivered, voters.size >= T && !delivered) },
    ].map(s => ({ ...s, m, d: delivered ? d : null }));
  }

  function voteBoxes(key) {
    const wrap = el('span', undefined, 'vote-boxes');
    for (const v of cfg.validators) { const i = el('i'); i.title = v.name; if (votersOf(key).has(v.address.toLowerCase())) i.className = 'yes'; wrap.append(i); }
    return wrap;
  }
  function proofNode(node, label, value, url, votesKey) {
    node.replaceChildren();
    if (label) node.append(el('span', label + ' ', 'proof-label'));
    if (votesKey) node.append(voteBoxes(votesKey));
    if (url) { const a = el('a', short(value, 14, 8), 'mono'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; node.append(a); }
    else node.append(el('code', value, 'mono'));
    if (/^0x[0-9a-f]{64}$/i.test(value)) {
      const b = el('button', 'Copy', 'copy'); b.type = 'button';
      b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Copy unavailable'; } });
      node.append(b);
    }
  }

  // Workspace journey (v1 step layout)
  const stepsWrap = $('journeySteps');
  for (let i = 0; i < 5; i++) {
    const s = el('div', undefined, 'journey-step' + (i === 4 ? ' last' : '')); s.id = 'step' + i;
    s.innerHTML = `<div class="step-circle">${i + 1}</div><div class="step-body"><div class="step-top"><strong></strong><span id="stepLabel${i}">Waiting</span></div><p></p><div class="step-proof" id="proof${i}">—</div></div>`;
    stepsWrap.append(s);
  }
  function renderJourney() {
    const t = tracking.workspace, stages = stagesFor(t);
    stages.forEach((s, i) => {
      const wrap = $('step' + i);
      wrap.querySelector('strong').textContent = s.title;
      wrap.querySelector('p').textContent = s.desc;
      wrap.classList.toggle('done', s.mode === 'done'); wrap.classList.toggle('processing', s.mode === 'processing');
      $('stepLabel' + i).textContent = s.mode === 'done' ? 'Verified' : s.mode === 'processing' ? 'Processing…' : 'Waiting';
      wrap.querySelector('.step-circle').textContent = s.mode === 'done' ? '✓' : i + 1;
      proofNode($('proof' + i), s.label, s.value, s.url, s.votes);
    });
    const done = stages[4].mode === 'done';
    const state = $('journeyState');
    state.className = 'journey-state ' + (!t ? 'idle' : done ? 'done' : 'running');
    state.textContent = !t ? 'Awaiting transaction' : done ? 'Delivery confirmed' : 'Verifying live…';
    $('transactionSummary').hidden = !done;
    if (done) $('summaryAudit').textContent = short(stages[4].d.key, 15, 8);
  }

  // Live demo journey (v1 demo layout)
  const demoTitles = ['Alice signs on Chain A', 'Source confirmations reached', 'Validators verify independently', `${T}-of-${N} votes on Chain B`, 'Destination records delivery'];
  const demoDescs = ['Source transaction from Alice\'s own wallet', 'Block confirmations before any validator may vote', 'Each validator checks Chain A through its own RPC', 'Votes submitted directly by validators, no relay', 'Gate emits MessageDelivered for Bob\'s application'];
  $('demoJourney').innerHTML = demoTitles.map((t, i) => `<div class="demo-stage"><span class="demo-step-number">${i + 1}</span><div><strong>${t}</strong><p>${demoDescs[i]}</p><code id="demoProof${i}">Awaiting transaction</code></div><span class="demo-check" id="demoCheck${i}">Pending</span></div>`).join('');
  let demoMeta = null;
  function renderDemo() {
    const t = tracking.demo;
    const stages = stagesFor(t);
    stages.forEach((s, i) => {
      $('demoProof' + i).textContent = t ? `${s.label} ${s.value}`.trim() : 'Awaiting transaction';
      $('demoCheck' + i).textContent = !t ? 'Pending' : s.mode === 'done' ? 'Verified' : s.mode === 'processing' ? 'In progress…' : 'Waiting';
      $('demoCheck' + i).className = 'demo-check' + (s.mode === 'done' ? ' verified' : '');
    });
    const done = stages[4].mode === 'done';
    $('demoState').className = 'journey-state ' + (!t ? 'idle' : done ? 'done' : 'running');
    $('demoState').textContent = !t ? 'Ready to send' : done ? 'Delivery confirmed' : 'Verifying live…';
    if (done && demoMeta && $('demoReceipt').hidden) {
      const m = stages[0].m, d = stages[4].d, voters = votersOf(m.key);
      demoMeta.result = { m, d, voters };
      const rows = [['Reference', demoMeta.reference], ['Record type', demoMeta.type], ['Source chain', `${cfg.chainA.name} · ${cfg.chainA.chainId}`], ['Destination chain', `${cfg.chainB.name} · ${cfg.chainB.chainId}`], ['Source transaction hash', m.txHash], ['Source block', m.block], ['Message nonce', m.nonce], ['Validator approvals', `${voters.size} of ${N} · ${[...voters.keys()].map(vName).join(', ')}`], ...[...voters.entries()].map(([a, v]) => [`Vote tx · ${vName(a)}`, v.txHash]), ['Destination transaction hash', d.txHash], ['Delivery receipt ID', d.key], ['Destination block', d.block]];
      $('demoReceiptFields').replaceChildren(...rows.map(([k, v]) => { const w = el('div', undefined, 'demo-receipt-field'); w.append(el('span', k)); const c = el('code', String(v ?? '—')); c.title = String(v ?? '—'); w.append(c); return w; }));
      $('demoReceipt').hidden = false;
      $('demoReceipt').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  $('message').addEventListener('input', () => { $('charCount').textContent = `${$('message').value.length} / 240 characters`; });
  $('message').dispatchEvent(new Event('input'));
  document.querySelectorAll('[data-message]').forEach(b => b.addEventListener('click', () => { $('message').value = b.dataset.message; $('message').dispatchEvent(new Event('input')); $('message').focus(); }));

  $('sendForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('sendButton'); btn.disabled = true; btn.textContent = 'Confirm in your wallet…'; $('sendResult').hidden = true;
    $('journey').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const t = await sendMessage('workspace', $('message').value.trim());
      $('sendResult').hidden = false; $('sendResult').className = 'notice';
      $('sendResult').textContent = `Source transaction confirmed (nonce #${t.nonce}). Validators are now verifying it independently — watch the journey below.`;
    } catch (err) {
      tracking.workspace = tracking.workspace?.txHash ? tracking.workspace : null; renderJourney();
      $('journeyState').className = 'journey-state failed'; $('journeyState').textContent = 'Transaction failed';
      show('sendResult', reasonOf(err), true);
    } finally { btn.disabled = false; btn.innerHTML = 'Submit &amp; verify A → B  ↗'; }
  });
  $('viewLatest').addEventListener('click', () => { const s = stagesFor(tracking.workspace); if (s[4].d) openDetails(s[4].d); });

  $('demoForm').addEventListener('submit', async event => {
    event.preventDefault();
    const reference = $('demoReference').value.trim(), type = $('demoType').value, description = $('demoNote').value.trim();
    if (!reference || !description) return;
    const message = `${type} | Alice to Bob | ${reference} | ${description}`;
    if (message.length > 240) { show('demoError', `Message exceeds the 240-character limit (${message.length}). Shorten the description.`, true); return; }
    $('demoReceipt').hidden = true; $('demoError').hidden = true;
    demoMeta = { reference, type, description };
    const btn = $('demoSend'); btn.disabled = true; btn.textContent = 'Confirm in your wallet…';
    try { await sendMessage('demo', message); }
    catch (err) { tracking.demo = tracking.demo?.txHash ? tracking.demo : null; renderDemo(); $('demoState').className = 'journey-state failed'; $('demoState').textContent = 'Transaction failed'; show('demoError', `Unable to send: ${reasonOf(err)}`, true); }
    finally { btn.disabled = false; btn.textContent = 'Send & verify transaction →'; }
  });
  $('demoCopy').addEventListener('click', async () => {
    const r = demoMeta?.result; if (!r) return;
    const lines = [`VeriMash v2 verification record`, `Reference: ${demoMeta.reference}`, `Record type: ${demoMeta.type}`, `Sender: Alice (demo) · wallet ${r.m.sender}`, `Intended recipient: Bob (demo)`, `Source: ${cfg.chainA.name} (${cfg.chainA.chainId})`, `Destination: ${cfg.chainB.name} (${cfg.chainB.chainId})`, `Source transaction: ${r.m.txHash}`, `Source block: ${r.m.block}`, `Validator approvals: ${r.voters.size}/${N}`, ...[...r.voters.entries()].map(([a, v]) => `  ${vName(a)}: ${v.txHash}`), `Destination transaction: ${r.d.txHash}`, `Receipt ID: ${r.d.key}`, `Verified-message delivery; not a fund transfer.`];
    try { await navigator.clipboard.writeText(lines.join('\n')); $('demoCopy').textContent = 'Copied ✓'; } catch { $('demoCopy').textContent = 'Copy unavailable'; }
  });
  $('demoExplorer').addEventListener('click', () => { const r = demoMeta?.result; if (!r) return; $('historySearch').value = r.d.key; searchTerm = r.d.key.toLowerCase(); renderHistory(); location.hash = '#explorer'; });

  /* ---------- explorer ---------- */
  let searchTerm = '', selected = null;
  $('historySearch').addEventListener('input', e => { searchTerm = e.target.value.trim().toLowerCase(); renderHistory(); });
  function renderHistory() {
    const all = [...st.delivered.values()].sort((a, b) => b.nonce - a.nonce);
    const visible = all.filter(r => [r.key, r.message, r.txHash, r.sender, st.sent.get(r.nonce)?.txHash].some(v => String(v ?? '').toLowerCase().includes(searchTerm)));
    $('recordCount').textContent = `${visible.length} of ${all.length} records`;
    const tbody = $('receipts'); tbody.replaceChildren();
    if (!visible.length) { const tr = el('tr'); const td = el('td', all.length ? 'No records match your search.' : `No deliveries on ${cfg.chainB.name} yet. Submit a transaction in the workspace.`, 'empty'); td.colSpan = 7; tr.append(td); tbody.append(tr); return; }
    for (const item of visible) {
      const tr = el('tr');
      const a = el('td'); a.append(el('code', short(item.key), 'mono')); tr.append(a);
      const msg = el('td', item.message, 'table-message'); msg.title = item.message; tr.append(msg);
      tr.append(el('td', `${cfg.chainA.name} → ${cfg.chainB.name}`));
      tr.append(el('td', short(item.txHash, 10, 6), 'mono'));
      tr.append(el('td', item.block));
      const stc = el('td'); stc.append(el('span', `Delivered · ${votersOf(item.key).size}/${N}`, 'delivered-chip')); tr.append(stc);
      const action = el('td'); const btn = el('button', 'View ↗', 'table-action'); btn.addEventListener('click', () => openDetails(item)); action.append(btn); tr.append(action);
      tbody.append(tr);
    }
  }
  function field(parent, name, value, url) {
    const row = el('div', undefined, 'detail-row'); row.append(el('span', name));
    if (url) { const a = el('a', value, 'detail-value'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; row.append(a); }
    else row.append(el('code', value == null ? '—' : String(value), 'detail-value'));
    parent.append(row);
  }
  function openDetails(record) {
    selected = record;
    const p = $('detailFields'); p.replaceChildren();
    const src = st.sent.get(record.nonce);
    const voters = votersOf(record.key);
    field(p, 'Status', `Delivered · ${voters.size} of ${N} validators`);
    field(p, 'Message', record.message);
    field(p, 'Delivery receipt ID', record.key);
    field(p, 'Message nonce', record.nonce);
    field(p, 'Sender wallet', record.sender);
    if (src && src.key === record.key) {
      field(p, `Source transaction (${cfg.chainA.name})`, src.txHash, txUrl(cfg.chainA, src.txHash));
      field(p, 'Source block', src.block);
    }
    for (const [addr, v] of voters) field(p, `Vote · ${vName(addr)}`, v.txHash, txUrl(cfg.chainB, v.txHash));
    field(p, `Destination delivery tx (${cfg.chainB.name})`, record.txHash, txUrl(cfg.chainB, record.txHash));
    field(p, 'Destination block', record.block);
    $('integrityMessage').value = record.message; $('integrityResult').hidden = true;
    $('details').showModal();
  }
  $('integrityButton').addEventListener('click', () => {
    if (!selected) return;
    const calc = keyFor(selected.nonce, selected.sender, $('integrityMessage').value);
    const match = calc === selected.key;
    show('integrityResult', `${match ? 'MATCH — this is exactly the message the validators approved.' : 'MISMATCH — this text was never approved; Chain B would reject it.'}\nStored:     ${selected.key}\nCalculated: ${calc}`, !match);
  });

  /* ---------- validators view ---------- */
  const balances = new Map();
  async function loadBalances() {
    for (const v of cfg.validators) { try { balances.set(v.address, await pB.getBalance(v.address)); } catch {} }
    renderValidators();
  }
  function renderValidators() {
    const sentList = [...st.sent.values()].sort((a, b) => b.nonce - a.nonce);
    $('validatorList').replaceChildren(...cfg.validators.map((v, i) => {
      const lower = v.address.toLowerCase();
      const mine = [...st.votes.values()].map(m => m.get(lower)).filter(Boolean);
      const last = mine.sort((a, b) => b.block - a.block)[0];
      // "Behind" = a message old enough to vote on that this validator has not voted for.
      const ready = sentList.filter(m => st.headA - m.block + 1 >= cfg.confirmations + 2);
      const missed = ready.filter(m => !votersOf(m.key).has(lower)).length;
      const state = !ready.length ? ['Waiting for messages', 'idle'] : missed === 0 ? ['Active · up to date', 'online'] : [`Behind on ${missed} message${missed > 1 ? 's' : ''}`, 'offline'];
      const card = el('div', undefined, 'panel validator-card');
      card.innerHTML = `<div class="validator-top"><div class="chain-badge validator-badge">V${i + 1}</div><div><strong></strong><small class="mono"></small></div></div><span class="status-badge ${state[1]}">${state[0]}</span><div class="validator-stats"><div><small>VOTES CAST</small><b>${mine.length}</b></div><div><small>LAST VOTE</small><b>${last ? '#' + last.nonce : '—'}</b></div><div><small>GAS · CHAIN B</small><b>${balances.has(v.address) ? Number(ethers.formatEther(balances.get(v.address))).toFixed(4) : '—'}</b></div></div>`;
      card.querySelector('strong').textContent = v.name;
      card.querySelector('small').textContent = v.address;
      return card;
    }));
    const rows = sentList.slice(0, 15);
    $('matrixCount').textContent = `${sentList.length} message${sentList.length === 1 ? '' : 's'}`;
    const head = `<thead><tr><th>#</th><th>MESSAGE</th>${cfg.validators.map((v, i) => `<th title="">V${i + 1}</th>`).join('')}<th>STATUS</th></tr></thead>`;
    $('matrix').innerHTML = head + '<tbody></tbody>';
    const tb = $('matrix').querySelector('tbody');
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'No messages yet.', 'empty'); td.colSpan = N + 3; tr.append(td); tb.append(tr); return; }
    for (const m of rows) {
      const tr = el('tr'); const vs = votersOf(m.key); const d = st.delivered.get(m.nonce);
      tr.append(el('td', m.nonce)); const msg = el('td', m.message, 'table-message'); msg.title = m.message; tr.append(msg);
      for (const v of cfg.validators) tr.append(el('td', vs.has(v.address.toLowerCase()) ? '✓' : '—', vs.has(v.address.toLowerCase()) ? 'vote-yes' : 'vote-no'));
      const s = el('td'); s.append(el('span', d && d.key === m.key ? `Delivered · ${vs.size}/${N}` : `Pending · ${vs.size}/${T}`, d && d.key === m.key ? 'delivered-chip' : 'pending-chip')); tr.append(s);
      tb.append(tr);
    }
  }

  /* ---------- security lab: read-only simulations against the live gate ---------- */
  function latestDelivered() { return [...st.delivered.values()].sort((a, b) => b.nonce - a.nonce)[0]; }
  async function expectRevert(fn) { try { await fn(); return null; } catch (e) { return reasonOf(e); } }
  function test(id, resultId, loading, normal, run) {
    $(id).addEventListener('click', async () => {
      const b = $(id); b.disabled = true; b.textContent = loading;
      try { const [text, bad] = await run(); show(resultId, text, bad); }
      catch (e) { show(resultId, reasonOf(e), true); }
      finally { b.disabled = false; b.textContent = normal; }
    });
  }
  const needOne = () => { const d = latestDelivered(); if (!d) throw new Error('Deliver at least one message first, then run this test.'); return d; };

  test('replayButton', 'replayResult', 'Running test…', 'Run replay test ↗', async () => {
    const d = needOne();
    const voter = [...votersOf(d.key).keys()][0];
    const why = await expectRevert(() => gate.attest.staticCall(d.nonce, d.sender, d.message, { from: voter }));
    return why ? [`Replay REJECTED. ${vName(voter)} re-submitting delivered message #${d.nonce} → "${why}". Delivered count unchanged (${st.delivered.size}).`, false] : ['Replay was NOT rejected.', true];
  });
  test('unauthorizedButton', 'unauthorizedResult', 'Testing…', 'Test unauthorized caller ↗', async () => {
    const outsider = ethers.Wallet.createRandom().address;
    const why = await expectRevert(() => gate.attest.staticCall(999999n, outsider, 'Send 1000 tokens to attacker', { from: outsider }));
    return why ? [`Unauthorized call REJECTED. Outsider ${short(outsider, 8, 6)} (a relayer, hacker or server) → "${why}".`, false] : ['Outsider call was NOT rejected.', true];
  });
  test('validatorButton', 'validatorResult', 'Checking threshold…', 'Test lone validator ↗', async () => {
    const rogue = cfg.validators[0];
    const nonce = BigInt(1_000_000_000 + Math.floor(Math.random() * 1e6));
    const fake = 'FORGED: approve payout to attacker', sender = ethers.Wallet.createRandom().address;
    const why = await expectRevert(() => gate.attest.staticCall(nonce, sender, fake, { from: rogue.address }));
    if (why) return [`Unexpected: ${why}`, true];
    const key = keyFor(nonce, sender, fake);
    const [votes, threshold, delivered] = await Promise.all([gate.votes(key), gate.threshold(), gate.isDelivered(nonce)]);
    return [`Lone validator BLOCKED. ${rogue.name} can cast a vote for a forged message that never happened on ${cfg.chainA.name}, but that is only ${Number(votes) + 1} of ${threshold} votes. The honest validators find no source event, never vote, and the gate never delivers it (delivered = ${delivered}).`, false];
  });
  test('sourceEvidenceButton', 'sourceEvidenceResult', 'Checking evidence…', 'Test source tampering ↗', async () => {
    const d = needOne();
    const tampered = d.message + ' (edited)';
    const src = st.sent.get(d.nonce);
    const evidence = src ? (src.message === tampered ? 'matches' : 'does not match') : 'cannot be found for';
    const voter = cfg.validators[0].address;
    const why = await expectRevert(() => gate.attest.staticCall(d.nonce, d.sender, tampered, { from: voter }));
    return why
      ? [`Altered message REJECTED. The source event for #${d.nonce} on ${cfg.chainA.name}${src ? ` (block ${src.block})` : ''} ${evidence} the tampered text, so honest validators refuse it — and even a validator pushing it gets "${why}".`, false]
      : ['Tampered message was NOT rejected.', true];
  });

  /* ---------- go ---------- */
  refresh();
  loadBalances();
  setInterval(refresh, 4000);
  setInterval(loadBalances, 20000);
}
