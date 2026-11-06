'use strict';
/* VeriMash v2 application.
 * Same interface as v1, but there is no VeriMash backend any more:
 *  - the user signs the source transaction in their own wallet (MetaMask)
 *  - the page reads both blockchains directly through public RPCs
 *  - delivery happens when independent validators vote on Chain B
 *  - the named recipient accepts it on Chain B from their own wallet */
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
const VIEWS = { overview: 'Overview', workspace: 'Transaction Workspace', inbox: 'My Inbox', validators: 'Validators', demo: 'Live Transaction Demo', explorer: 'Transaction Explorer', security: 'Security Lab' };
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
  const keyFor = (nonce, sender, recipient, message) => ethers.keccak256(coder.encode(
    ['uint256', 'address', 'uint256', 'address', 'uint64', 'address', 'address', 'bytes32'],
    [cfg.chainA.chainId, cfg.chainA.source, cfg.chainB.chainId, cfg.chainB.gate, nonce, sender, recipient, ethers.keccak256(ethers.toUtf8Bytes(message))]));
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
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
    sent: new Map(),      // nonce -> {nonce, sender, recipient, message, txHash, block, key}
    votes: new Map(),     // key -> Map(validatorLower -> {txHash, block})
    delivered: new Map(), // nonce -> {nonce, key, txHash, block, message, sender, recipient}
    accepted: new Map(),  // nonce -> {txHash, block, recipient}
    voteCount: 0,
  };
  const votersOf = key => st.votes.get(key) || new Map();

  // Public RPCs are load-balanced: one server can be a block or two behind another.
  // So we read logs a few blocks behind the tip, and treat "beyond head" errors as "try again next tick".
  const LAG = cfg.local ? 0 : 3;
  const RETRY_LATER = Symbol('retry');
  async function logs(contract, filter, from, to) {
    try { return await contract.queryFilter(filter, from, to); }
    catch (e) {
      const msg = String(e?.error?.message || e?.info?.error?.message || e?.shortMessage || e?.message || '');
      if (/beyond current head|head block|header not found|unknown block|block not found|after last accepted/i.test(msg)) return RETRY_LATER;
      if (CHUNK > 10) { CHUNK = Math.max(10, Math.floor(CHUNK / 4)); return null; } // RPC range limit: shrink and retry
      throw e;
    }
  }
  async function scanA() {
    st.headA = await pA.getBlockNumber();
    const target = st.headA - LAG;
    while (st.nextA <= target) {
      const to = Math.min(target, st.nextA + CHUNK - 1);
      const evs = await logs(source, source.filters.MessageSent(), st.nextA, to);
      if (evs === RETRY_LATER) break;
      if (!evs) continue;
      for (const ev of evs) {
        if (Number(ev.args.destChainId) !== cfg.chainB.chainId) continue;
        const n = Number(ev.args.nonce);
        st.sent.set(n, { nonce: n, sender: ev.args.sender, recipient: ev.args.recipient, message: ev.args.message, txHash: ev.transactionHash, block: ev.blockNumber, key: keyFor(ev.args.nonce, ev.args.sender, ev.args.recipient, ev.args.message) });
      }
      st.nextA = to + 1;
    }
  }
  async function scanB() {
    st.headB = await pB.getBlockNumber();
    const target = st.headB - LAG;
    while (st.nextB <= target) {
      const to = Math.min(target, st.nextB + CHUNK - 1);
      const att = await logs(gate, gate.filters.Attested(), st.nextB, to); if (att === RETRY_LATER) break; if (!att) continue;
      const del = await logs(gate, gate.filters.MessageDelivered(), st.nextB, to); if (del === RETRY_LATER) break; if (!del) continue;
      const acc = await logs(gate, gate.filters.MessageAccepted(), st.nextB, to); if (acc === RETRY_LATER) break; if (!acc) continue;
      for (const ev of att) {
        if (!st.votes.has(ev.args.key)) st.votes.set(ev.args.key, new Map());
        const m = st.votes.get(ev.args.key), v = ev.args.validator.toLowerCase();
        if (!m.has(v)) st.voteCount++;
        m.set(v, { txHash: ev.transactionHash, block: ev.blockNumber, nonce: Number(ev.args.nonce) });
      }
      for (const ev of del) {
        const n = Number(ev.args.nonce);
        st.delivered.set(n, { nonce: n, key: ev.args.key, txHash: ev.transactionHash, block: ev.blockNumber, message: ev.args.message, sender: ev.args.sender, recipient: ev.args.recipient });
      }
      for (const ev of acc) st.accepted.set(Number(ev.args.nonce), { txHash: ev.transactionHash, block: ev.blockNumber, recipient: ev.args.recipient });
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
    $('audits').textContent = st.accepted.size;
    $('votesLabel').textContent = `Validator votes on Chain B: ${st.voteCount}`;
    renderHistory(); renderValidators(); renderJourney(); renderDemo(); renderInbox();
    busy = false;
  }
  window.VM_REFRESH = refresh;
  $('refreshButton').addEventListener('click', refresh);

  /* ---------- wallets ----------
   * Two people, two chains. The SAME MetaMask can play either role: it is switched to
   * Chain A to send (Person 1) and to Chain B to accept (Person 2).
   * In local mode without MetaMask, built-in demo wallets play both people. */
  let account = null;
  const chainHex = chain => '0x' + chain.chainId.toString(16);
  async function switchTo(chain) {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex(chain) }] }); }
    catch (e) {
      if (e.code === 4902 || /unrecognized|not added|addEthereumChain/i.test(e.message || '')) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: chainHex(chain), chainName: chain.name, rpcUrls: [fixRpc(chain.rpc)], nativeCurrency: { name: chain.currency, symbol: chain.currency, decimals: 18 }, blockExplorerUrls: chain.explorer ? [chain.explorer] : undefined }] });
      } else throw e;
    }
  }
  function showAccount(addr, how) {
    account = addr;
    $('walletButton').textContent = `● ${short(addr, 6, 4)}`;
    $('walletButton').classList.add('connected');
    $('walletButton').title = how;
    renderInbox();
  }
  /** Returns a signer on `chain` ('A' to send, 'B' to accept). */
  async function signerOn(which) {
    const chain = which === 'A' ? cfg.chainA : cfg.chainB;
    if (window.ethereum) {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      await switchTo(chain);
      const signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
      showAccount(await signer.getAddress(), `MetaMask on ${chain.name}`);
      return signer;
    }
    if (cfg.local && cfg.demoKey) {
      const w = which === 'A' ? new ethers.Wallet(cfg.demoKey, pA) : new ethers.Wallet(cfg.demoRecipientKey, pB);
      showAccount(w.address, which === 'A' ? 'Local demo sender wallet (Person 1)' : 'Local demo receiver wallet (Person 2)');
      return w;
    }
    throw new Error('No wallet found. Install MetaMask, or on a phone open this page inside the MetaMask app browser.');
  }
  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', accs => { if (accs?.[0]) showAccount(ethers.getAddress(accs[0]), 'MetaMask'); });
    window.ethereum.request({ method: 'eth_accounts' }).then(a => { if (a?.[0]) showAccount(ethers.getAddress(a[0]), 'MetaMask'); }).catch(() => {});
  }
  $('walletButton').addEventListener('click', async () => {
    try { await signerOn(location.hash === '#inbox' ? 'B' : 'A'); } catch (e) { notice(reasonOf(e)); navigate('overview'); }
  });

  /* ---------- sending (shared by Workspace and Live Demo) ---------- */
  const tracking = { workspace: null, demo: null };
  function checkRecipient(raw) {
    const v = String(raw || '').trim();
    if (!ethers.isAddress(v)) throw new Error('Enter the recipient\'s wallet address on Chain B (0x… 42 characters).');
    return ethers.getAddress(v);
  }
  async function sendMessage(slot, text, recipientRaw) {
    const recipient = checkRecipient(recipientRaw);
    if (!text) throw new Error('Type a message first.');
    if (new TextEncoder().encode(text).length > 240) throw new Error('Message is longer than 240 bytes.');
    const signer = await signerOn('A');
    const contract = new ethers.Contract(cfg.chainA.source, cfg.abis.source, signer);
    tracking[slot] = { message: text, recipient, txHash: null, nonce: null, startedAt: Date.now() };
    renderJourney(); renderDemo();
    const tx = await contract.sendMessage(cfg.chainB.chainId, recipient, text);
    tracking[slot].txHash = tx.hash; renderJourney(); renderDemo();
    const r = await tx.wait();
    const ev = r.logs.map(l => { try { return source.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'MessageSent');
    tracking[slot].nonce = Number(ev.args.nonce);
    refresh();
    return tracking[slot];
  }
  async function acceptMessage(nonce) {
    const signer = await signerOn('B');
    const me = await signer.getAddress();
    const d = st.delivered.get(nonce);
    if (d && !same(d.recipient, me)) throw new Error(`This message is addressed to ${short(d.recipient, 8, 6)}, but the connected wallet is ${short(me, 8, 6)}. Switch to the recipient's account in MetaMask.`);
    const g = new ethers.Contract(cfg.chainB.gate, cfg.abis.gate, signer);
    const tx = await g.accept(nonce);
    await tx.wait();
    await refresh();
    return tx.hash;
  }

  /* ---------- journey stages, computed from chain state ---------- */
  function stagesFor(t) {
    const m = t?.nonce != null ? st.sent.get(t.nonce) : null;
    const conf = m ? Math.max(0, st.headA - m.block + 1) : 0;
    const confOk = m && conf >= cfg.confirmations;
    const voters = m ? votersOf(m.key) : new Map();
    const d = m ? st.delivered.get(m.nonce) : null;
    const delivered = d && d.key === m.key;
    const acc = delivered ? st.accepted.get(m.nonce) : null;
    const mode = (done, active) => (done ? 'done' : active ? 'processing' : 'waiting');
    const voterNames = [...voters.keys()].map(vName);
    const to = t?.recipient || m?.recipient;
    return [
      { title: 'Source transaction signed', desc: `${cfg.chainA.name} · Sender's own wallet emits MessageSent, addressed to ${to ? short(to, 8, 6) : 'the recipient'}`, label: 'Source tx:', value: t?.txHash || (t ? 'Waiting for wallet confirmation…' : 'Send a message to begin.'), url: t?.txHash && txUrl(cfg.chainA, t.txHash), mode: mode(!!m, !!t && !m) },
      { title: 'Source block confirmations', desc: `Validators wait for ${cfg.confirmations} confirmation(s) so the event cannot be reorganised away`, label: m ? `Block #${m.block} · ` : '', value: m ? `${Math.min(conf, cfg.confirmations)} / ${cfg.confirmations} confirmations · nonce #${m.nonce}` : '—', mode: mode(confOk, !!m && !confOk) },
      { title: 'Independent validators verify', desc: 'Each validator re-reads the receipt and block hash through its own RPC provider', label: m ? `${voters.size} of ${N} confirmed:` : '', value: m ? (voterNames.join(', ') || 'Waiting for the first validator…') : '—', mode: mode(voters.size >= T, confOk && voters.size < T) },
      { title: 'Threshold reached on Chain B', desc: `${cfg.chainB.name} · Gate counts on-chain votes, ${T} of ${N} required, no relay`, label: m ? `${voters.size} vote${voters.size === 1 ? '' : 's'} (${T} needed) ·` : '', value: m ? (voters.size ? [...voters.values()].map(v => short(v.txHash, 10, 6)).join(', ') : 'No votes yet') : '—', votes: m?.key, mode: mode(voters.size >= T, confOk && voters.size > 0 && voters.size < T) },
      { title: 'Delivered to the recipient', desc: `${cfg.chainB.name} · Gate emits MessageDelivered for ${to ? short(to, 8, 6) : 'the recipient'}`, label: 'Delivery tx:', value: delivered ? d.txHash : '—', url: delivered && txUrl(cfg.chainB, d.txHash), mode: mode(delivered, voters.size >= T && !delivered) },
      { title: 'Accepted by the recipient', desc: `${cfg.chainB.name} · Recipient signs accept() with their own wallet — nobody else can`, label: acc ? 'Accept tx:' : '', value: acc ? acc.txHash : delivered ? 'Waiting for the recipient — open "My Inbox" on their device' : '—', url: acc && txUrl(cfg.chainB, acc.txHash), mode: mode(!!acc, delivered && !acc) },
    ].map(s => ({ ...s, m, d: delivered ? d : null, acc }));
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
  for (let i = 0; i < 6; i++) {
    const s = el('div', undefined, 'journey-step' + (i === 5 ? ' last' : '')); s.id = 'step' + i;
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
    const done = stages[4].mode === 'done', accepted = stages[5].mode === 'done';
    const state = $('journeyState');
    state.className = 'journey-state ' + (!t ? 'idle' : done ? 'done' : 'running');
    state.textContent = !t ? 'Awaiting transaction' : accepted ? 'Accepted by recipient' : done ? 'Delivered · awaiting recipient' : 'Verifying live…';
    $('transactionSummary').querySelector('.success-text').textContent = accepted ? '✓ Delivered and accepted' : '✓ Delivered · waiting for recipient';
    $('transactionSummary').hidden = !done;
    if (done) $('summaryAudit').textContent = short(stages[4].d.key, 15, 8);
  }

  // Live demo journey (v1 demo layout)
  const demoTitles = ['Alice signs on Chain A', 'Source confirmations reached', 'Validators verify independently', `${T}-of-${N} votes on Chain B`, 'Delivered to Bob\'s wallet', 'Bob accepts on Chain B'];
  const demoDescs = ['Source transaction from Alice\'s own wallet, addressed to Bob', 'Block confirmations before any validator may vote', 'Each validator checks Chain A through its own RPC', 'Votes submitted directly by validators, no relay', 'Gate emits MessageDelivered for Bob\'s address', 'Bob signs accept() from his own wallet — only he can'];
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
    const done = stages[4].mode === 'done', accepted = stages[5].mode === 'done';
    $('demoState').className = 'journey-state ' + (!t ? 'idle' : done ? 'done' : 'running');
    $('demoState').textContent = !t ? 'Ready to send' : accepted ? 'Accepted by Bob' : done ? 'Delivered · waiting for Bob' : 'Verifying live…';
    if (done && demoMeta) {
      const m = stages[0].m, d = stages[4].d, acc = stages[5].acc, voters = votersOf(m.key);
      demoMeta.result = { m, d, acc, voters };
      const rows = [['Reference', demoMeta.reference], ['Record type', demoMeta.type], ['Alice (sender) · ' + cfg.chainA.name, m.sender], ['Bob (recipient) · ' + cfg.chainB.name, m.recipient], ['Source transaction hash', m.txHash], ['Source block', m.block], ['Message nonce', m.nonce], ['Validator approvals', `${voters.size} of ${N} · ${[...voters.keys()].map(vName).join(', ')}`], ...[...voters.entries()].map(([a, v]) => [`Vote tx · ${vName(a)}`, v.txHash]), ['Delivery transaction hash', d.txHash], ['Delivery receipt ID', d.key], ['Bob\'s acceptance', acc ? acc.txHash : 'Waiting — Bob opens "My Inbox" and accepts']];
      $('demoReceiptFields').replaceChildren(...rows.map(([k, v]) => { const w = el('div', undefined, 'demo-receipt-field'); w.append(el('span', k)); const c = el('code', String(v ?? '—')); c.title = String(v ?? '—'); w.append(c); return w; }));
      $('demoBanner').textContent = acc ? 'Bob accepted the verified message with his own wallet on Chain B.' : 'Verified message delivered to Bob on Chain B. Waiting for Bob to accept it from his wallet.';
      document.querySelector('#demoReceipt .demo-ok').textContent = acc ? '✓ DELIVERED & ACCEPTED' : '✓ VERIFIED & DELIVERED';
      if ($('demoReceipt').hidden) { $('demoReceipt').hidden = false; $('demoReceipt').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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
      const t = await sendMessage('workspace', $('message').value.trim(), $('recipient').value);
      $('sendResult').hidden = false; $('sendResult').className = 'notice';
      $('sendResult').textContent = `Source transaction confirmed (nonce #${t.nonce}) for ${short(t.recipient, 8, 6)}. Validators are now verifying it independently — watch the journey below. The recipient accepts it in "My Inbox".`;
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
    try { await sendMessage('demo', message, $('demoRecipient').value); }
    catch (err) { tracking.demo = tracking.demo?.txHash ? tracking.demo : null; renderDemo(); $('demoState').className = 'journey-state failed'; $('demoState').textContent = 'Transaction failed'; show('demoError', `Unable to send: ${reasonOf(err)}`, true); }
    finally { btn.disabled = false; btn.textContent = 'Send & verify transaction →'; }
  });
  $('demoCopy').addEventListener('click', async () => {
    const r = demoMeta?.result; if (!r) return;
    const lines = [`VeriMash v2 verification record`, `Reference: ${demoMeta.reference}`, `Record type: ${demoMeta.type}`, `Alice (sender) wallet on ${cfg.chainA.name}: ${r.m.sender}`, `Bob (recipient) wallet on ${cfg.chainB.name}: ${r.m.recipient}`, `Source: ${cfg.chainA.name} (${cfg.chainA.chainId})`, `Destination: ${cfg.chainB.name} (${cfg.chainB.chainId})`, `Source transaction: ${r.m.txHash}`, `Source block: ${r.m.block}`, `Validator approvals: ${r.voters.size}/${N}`, ...[...r.voters.entries()].map(([a, v]) => `  ${vName(a)}: ${v.txHash}`), `Delivery transaction: ${r.d.txHash}`, `Receipt ID: ${r.d.key}`, `Bob's acceptance: ${r.acc ? r.acc.txHash : 'not yet accepted'}`, `Verified-message delivery between two wallets on two chains; not a fund transfer.`];
    try { await navigator.clipboard.writeText(lines.join('\n')); $('demoCopy').textContent = 'Copied ✓'; } catch { $('demoCopy').textContent = 'Copy unavailable'; }
  });
  $('demoExplorer').addEventListener('click', () => { const r = demoMeta?.result; if (!r) return; $('historySearch').value = r.d.key; searchTerm = r.d.key.toLowerCase(); renderHistory(); location.hash = '#explorer'; });

  /* ---------- explorer ---------- */
  let searchTerm = '', selected = null;
  $('historySearch').addEventListener('input', e => { searchTerm = e.target.value.trim().toLowerCase(); renderHistory(); });
  function renderHistory() {
    const all = [...st.delivered.values()].sort((a, b) => b.nonce - a.nonce);
    const visible = all.filter(r => [r.key, r.message, r.txHash, r.sender, r.recipient, st.sent.get(r.nonce)?.txHash, st.accepted.get(r.nonce)?.txHash].some(v => String(v ?? '').toLowerCase().includes(searchTerm)));
    $('recordCount').textContent = `${visible.length} of ${all.length} records`;
    const tbody = $('receipts'); tbody.replaceChildren();
    if (!visible.length) { const tr = el('tr'); const td = el('td', all.length ? 'No records match your search.' : `No deliveries on ${cfg.chainB.name} yet. Submit a transaction in the workspace.`, 'empty'); td.colSpan = 7; tr.append(td); tbody.append(tr); return; }
    for (const item of visible) {
      const tr = el('tr');
      const a = el('td'); a.append(el('code', short(item.key), 'mono')); tr.append(a);
      const msg = el('td', item.message, 'table-message'); msg.title = item.message; tr.append(msg);
      const route = el('td', `${short(item.sender, 6, 4)} → ${short(item.recipient, 6, 4)}`, 'mono'); route.title = `${cfg.chainA.name} ${item.sender} → ${cfg.chainB.name} ${item.recipient}`; tr.append(route);
      tr.append(el('td', short(item.txHash, 10, 6), 'mono'));
      tr.append(el('td', item.block));
      const acc = st.accepted.get(item.nonce);
      const stc = el('td'); stc.append(el('span', acc ? `Accepted ✓ · ${votersOf(item.key).size}/${N}` : `Delivered · awaiting recipient`, acc ? 'accepted-chip' : 'delivered-chip')); tr.append(stc);
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
    const acc = st.accepted.get(record.nonce);
    field(p, 'Status', `${acc ? 'Delivered and accepted' : 'Delivered, waiting for the recipient'} · ${voters.size} of ${N} validators`);
    field(p, 'Message', record.message);
    field(p, 'Delivery receipt ID', record.key);
    field(p, 'Message nonce', record.nonce);
    field(p, `Sender wallet (${cfg.chainA.name})`, record.sender);
    field(p, `Recipient wallet (${cfg.chainB.name})`, record.recipient);
    if (src && src.key === record.key) {
      field(p, `Source transaction (${cfg.chainA.name})`, src.txHash, txUrl(cfg.chainA, src.txHash));
      field(p, 'Source block', src.block);
    }
    for (const [addr, v] of voters) field(p, `Vote · ${vName(addr)}`, v.txHash, txUrl(cfg.chainB, v.txHash));
    field(p, `Destination delivery tx (${cfg.chainB.name})`, record.txHash, txUrl(cfg.chainB, record.txHash));
    field(p, 'Destination block', record.block);
    field(p, 'Recipient acceptance', acc ? acc.txHash : 'Not accepted yet', acc && txUrl(cfg.chainB, acc.txHash));
    $('integrityMessage').value = record.message; $('integrityResult').hidden = true;
    $('details').showModal();
  }
  $('integrityButton').addEventListener('click', () => {
    if (!selected) return;
    const calc = keyFor(selected.nonce, selected.sender, selected.recipient, $('integrityMessage').value);
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
    const why = await expectRevert(() => gate.attest.staticCall(d.nonce, d.sender, d.recipient, d.message, { from: voter }));
    return why ? [`Replay REJECTED. ${vName(voter)} re-submitting delivered message #${d.nonce} → "${why}". Delivered count unchanged (${st.delivered.size}).`, false] : ['Replay was NOT rejected.', true];
  });
  test('unauthorizedButton', 'unauthorizedResult', 'Testing…', 'Test unauthorized caller ↗', async () => {
    const outsider = ethers.Wallet.createRandom().address;
    const why = await expectRevert(() => gate.attest.staticCall(999999n, outsider, outsider, 'Send 1000 tokens to attacker', { from: outsider }));
    return why ? [`Unauthorized call REJECTED. Outsider ${short(outsider, 8, 6)} (a relayer, hacker or server) → "${why}".`, false] : ['Outsider call was NOT rejected.', true];
  });
  test('validatorButton', 'validatorResult', 'Checking threshold…', 'Test lone validator ↗', async () => {
    const rogue = cfg.validators[0];
    const nonce = BigInt(1_000_000_000 + Math.floor(Math.random() * 1e6));
    const fake = 'FORGED: approve payout to attacker', sender = ethers.Wallet.createRandom().address;
    const why = await expectRevert(() => gate.attest.staticCall(nonce, sender, sender, fake, { from: rogue.address }));
    if (why) return [`Unexpected: ${why}`, true];
    const key = keyFor(nonce, sender, sender, fake);
    const [votes, threshold, delivered] = await Promise.all([gate.votes(key), gate.threshold(), gate.isDelivered(nonce)]);
    return [`Lone validator BLOCKED. ${rogue.name} can cast a vote for a forged message that never happened on ${cfg.chainA.name}, but that is only ${Number(votes) + 1} of ${threshold} votes. The honest validators find no source event, never vote, and the gate never delivers it (delivered = ${delivered}).`, false];
  });
  test('sourceEvidenceButton', 'sourceEvidenceResult', 'Checking evidence…', 'Test source tampering ↗', async () => {
    const d = needOne();
    const tampered = d.message + ' (edited)';
    const src = st.sent.get(d.nonce);
    const evidence = src ? (src.message === tampered ? 'matches' : 'does not match') : 'cannot be found for';
    const voter = cfg.validators[0].address;
    const why = await expectRevert(() => gate.attest.staticCall(d.nonce, d.sender, d.recipient, tampered, { from: voter }));
    return why
      ? [`Altered message REJECTED. The source event for #${d.nonce} on ${cfg.chainA.name}${src ? ` (block ${src.block})` : ''} ${evidence} the tampered text, so honest validators refuse it — and even a validator pushing it gets "${why}".`, false]
      : ['Tampered message was NOT rejected.', true];
  });

  test('recipientButton', 'recipientResult', 'Checking…', 'Test stranger accept ↗', async () => {
    const d = needOne();
    const stranger = ethers.Wallet.createRandom().address;
    const whyAccept = await expectRevert(() => gate.accept.staticCall(d.nonce, { from: stranger }));
    const whyRedirect = await expectRevert(() => gate.attest.staticCall(d.nonce, d.sender, stranger, d.message, { from: cfg.validators[0].address }));
    return whyAccept && whyRedirect
      ? [`Stranger REJECTED. ${short(stranger, 8, 6)} tries to accept message #${d.nonce} (addressed to ${short(d.recipient, 8, 6)}) → "${whyAccept}". Re-routing it to the stranger → "${whyRedirect}".`, false]
      : ['A stranger was NOT rejected.', true];
  });

  /* ---------- my inbox (the receiving side, Person 2) ---------- */
  let inboxAddr = null;
  function renderInbox() {
    const who = inboxAddr || account;
    const mineAll = who ? [...st.sent.values()].filter(m => same(m.recipient, who)).sort((a, b) => b.nonce - a.nonce) : [];
    const waiting = mineAll.filter(m => { const d = st.delivered.get(m.nonce); return d && d.key === m.key && !st.accepted.has(m.nonce); }).length;
    const badge = $('inboxBadge'); badge.hidden = !waiting; badge.textContent = waiting;
    $('inboxWho').textContent = who ? `${inboxAddr && !same(inboxAddr, account) ? 'Viewing' : 'Connected'}: ${who}` : 'Connect the receiving wallet';
    $('inboxBadgeTop').className = 'status-badge ' + (who ? 'online' : 'pending');
    $('inboxBadgeTop').textContent = !who ? 'No wallet connected' : waiting ? `${waiting} waiting to accept` : `${mineAll.length} message${mineAll.length === 1 ? '' : 's'}`;
    $('inboxCount').textContent = `${mineAll.length} message${mineAll.length === 1 ? '' : 's'}`;
    const tb = $('inboxRows'); tb.replaceChildren();
    if (!mineAll.length) { const tr = el('tr'); const td = el('td', who ? 'No messages addressed to this wallet yet. Ask the sender to put this address in the recipient field.' : 'Connect a wallet to see its messages.', 'empty'); td.colSpan = 6; tr.append(td); tb.append(tr); return; }
    for (const m of mineAll) {
      const d = st.delivered.get(m.nonce), delivered = d && d.key === m.key, acc = st.accepted.get(m.nonce);
      const vs = votersOf(m.key);
      const tr = el('tr');
      tr.append(el('td', m.nonce));
      const msg = el('td', m.message, 'inbox-msg'); tr.append(msg);
      const from = el('td', short(m.sender, 8, 6), 'mono'); from.title = m.sender; tr.append(from);
      const v = el('td'); v.append(voteBoxes(m.key)); v.title = `${vs.size} of ${N} validators confirmed (${T} needed)`; tr.append(v);
      const stc = el('td'); stc.append(el('span', acc ? 'Accepted ✓' : delivered ? 'Delivered · ready' : 'Waiting for validators', acc ? 'accepted-chip' : delivered ? 'delivered-chip' : 'pending-chip')); tr.append(stc);
      const act = el('td');
      if (delivered && !acc) {
        const b = el('button', 'Accept ✓', 'accept-btn'); b.type = 'button';
        b.disabled = !!inboxAddr && !same(inboxAddr, account);
        b.addEventListener('click', async () => {
          b.disabled = true; b.textContent = 'Confirm in wallet…'; $('inboxResult').hidden = true;
          try { const h = await acceptMessage(m.nonce); $('inboxResult').hidden = false; $('inboxResult').textContent = `Accepted message #${m.nonce} on ${cfg.chainB.name}. Your acceptance tx: ${h}`; }
          catch (e) { $('inboxResult').hidden = false; $('inboxResult').textContent = `Could not accept: ${reasonOf(e)}`; b.disabled = false; b.textContent = 'Accept ✓'; }
        });
        act.append(b);
      } else if (acc) {
        const a = el(txUrl(cfg.chainB, acc.txHash) ? 'a' : 'code', short(acc.txHash, 8, 6), 'mono');
        if (a.tagName === 'A') { a.href = txUrl(cfg.chainB, acc.txHash); a.target = '_blank'; a.rel = 'noopener'; }
        act.append(a);
      }
      tr.append(act);
      tb.append(tr);
    }
  }
  $('inboxConnect').addEventListener('click', async () => {
    try {
      inboxAddr = null; $('inboxLookup').value = '';
      // Let the receiver pick WHICH account to use, instead of reusing whatever is already connected.
      if (window.ethereum) await window.ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      await signerOn('B');
    }
    catch (e) { $('inboxResult').hidden = false; $('inboxResult').textContent = reasonOf(e); }
  });
  $('inboxLookupBtn').addEventListener('click', () => {
    const v = $('inboxLookup').value.trim();
    if (!ethers.isAddress(v)) { $('inboxResult').hidden = false; $('inboxResult').textContent = 'That is not a valid wallet address.'; return; }
    $('inboxResult').hidden = true; inboxAddr = ethers.getAddress(v); renderInbox();
  });
  if (cfg.local && cfg.demoKey && !window.ethereum) $('inboxHint').textContent = 'Local mode: "Connect receiver wallet" uses the built-in demo receiver (Person 2). With MetaMask installed, it uses your MetaMask account instead.';

  /* ---------- recipient fields ---------- */
  const demoBob = cfg.local && cfg.demoRecipientKey ? new ethers.Wallet(cfg.demoRecipientKey).address : '';
  $('recipient').value = demoBob; $('demoRecipient').value = demoBob;
  $('recipient').addEventListener('input', () => { $('recipient').dataset.touched = '1'; });
  $('recipientMine').addEventListener('click', async () => {
    try { if (!account) await signerOn('A'); $('recipient').value = account; $('recipient').dataset.touched = '1'; } catch (e) { show('sendResult', reasonOf(e), true); }
  });

  /* ---------- go ---------- */
  refresh();
  loadBalances();
  setInterval(refresh, 4000);
  setInterval(loadBalances, 20000);
}