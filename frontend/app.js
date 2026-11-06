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

  /* ---------- chain state ----------
   * History comes from the contracts' STORED STATE, read with cheap eth_calls (no block ranges):
   *   Chain B gate:   deliveryCount() / getDelivery(i), hasVoted(key, validator), accepted(nonce)
   *   Chain A source: nonce() = how many messages were ever sent
   * Only the newest few blocks are scanned for events, to show live transaction hashes.
   * This keeps working on free RPC plans that allow only 10 blocks per log query
   * (Base makes a block every 2 seconds, so scanning all history that way can't keep up). */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const st = {
    headA: 0, headB: 0, nextA: null, nextB: null, sentTotal: 0, dCount: 0,
    sent: new Map(),      // nonce -> {nonce, sender, recipient, message, txHash|null, block|null, key}
    votes: new Map(),     // key -> Map(validatorLower -> {txHash|null, block|null, nonce})
    delivered: new Map(), // nonce -> {nonce, key, txHash|null, block|null, message, sender, recipient, deliveredAt}
    accepted: new Map(),  // nonce -> {txHash|null, block|null, recipient}
    voteCount: 0,
  };
  const votersOf = key => st.votes.get(key) || new Map();
  function addVote(key, validator, info) {
    if (!st.votes.has(key)) st.votes.set(key, new Map());
    const m = st.votes.get(key), v = validator.toLowerCase(), old = m.get(v);
    if (!old) st.voteCount++;
    m.set(v, { ...old, ...Object.fromEntries(Object.entries(info).filter(([, x]) => x != null)) });
  }
  function upsert(map, k, info) { const old = map.get(k) || {}; map.set(k, { ...old, ...Object.fromEntries(Object.entries(info).filter(([, x]) => x != null)) }); }

  const LAG = cfg.local ? 0 : 2;                 // stay a couple of blocks behind the tip (load-balanced RPCs)
  let CHUNK = cfg.local ? 2000 : 10;             // free RPC plans: 10 blocks per log query
  const RECENT = { A: cfg.local ? 1e9 : 100, B: cfg.local ? 1e9 : 150 }; // tip window: ~20 min of Sepolia, ~5 min of Base
  const MAX_VOTE_CHECK = 40;                     // check per-validator votes for the newest 40 deliveries

  function onEvent(which, ev, l) {
    if (which === 'A' && ev.name === 'MessageSent') {
      if (Number(ev.args.destChainId) !== cfg.chainB.chainId) return;
      const n = Number(ev.args.nonce);
      upsert(st.sent, n, { nonce: n, sender: ev.args.sender, recipient: ev.args.recipient, message: ev.args.message, txHash: l.transactionHash, block: l.blockNumber, key: keyFor(ev.args.nonce, ev.args.sender, ev.args.recipient, ev.args.message) });
    } else if (ev.name === 'Attested') {
      addVote(ev.args.key, ev.args.validator, { txHash: l.transactionHash, block: l.blockNumber, nonce: Number(ev.args.nonce) });
    } else if (ev.name === 'MessageDelivered') {
      const n = Number(ev.args.nonce);
      upsert(st.delivered, n, { nonce: n, key: ev.args.key, txHash: l.transactionHash, block: l.blockNumber, message: ev.args.message, sender: ev.args.sender, recipient: ev.args.recipient });
    } else if (ev.name === 'MessageAccepted') {
      upsert(st.accepted, Number(ev.args.nonce), { txHash: l.transactionHash, block: l.blockNumber, recipient: ev.args.recipient });
    }
  }
  async function scanTip(which) {
    const p = which === 'A' ? pA : pB, c = which === 'A' ? source : gate, chain = which === 'A' ? cfg.chainA : cfg.chainB;
    const target = (which === 'A' ? st.headA : st.headB) - LAG;
    let next = which === 'A' ? st.nextA : st.nextB;
    if (next == null || target - next > RECENT[which]) next = Math.max(chain.deployBlock, target - RECENT[which] + 1);
    while (next <= target) {
      const to = Math.min(target, next + CHUNK - 1);
      let lg;
      try { lg = await p.getLogs({ address: await c.getAddress(), fromBlock: next, toBlock: to }); }
      catch (e) {
        const msg = String(e?.error?.message || e?.info?.error?.message || e?.shortMessage || e?.message || '');
        if (/beyond current head|head block|header not found|unknown block|block not found|after last accepted/i.test(msg)) break;
        if (CHUNK > 10) { CHUNK = Math.max(10, Math.floor(CHUNK / 4)); continue; }
        throw e;
      }
      for (const l of lg) { let ev = null; try { ev = c.interface.parseLog(l); } catch {} if (ev) onEvent(which, ev, l); }
      next = to + 1;
    }
    if (which === 'A') st.nextA = next; else st.nextB = next;
  }
  async function readA() {
    const [head, total] = await Promise.all([pA.getBlockNumber(), source.nonce()]);
    st.headA = head; st.sentTotal = Number(total);
  }
  async function readB(full) {
    const [head, count] = await Promise.all([pB.getBlockNumber(), gate.deliveryCount()]);
    st.headB = head;
    const n = Number(count);
    if (n > st.dCount) {
      const idx = Array.from({ length: n - st.dCount }, (_, i) => st.dCount + i);
      const ds = await Promise.all(idx.map(i => gate.getDelivery(i)));
      for (const d of ds) {
        const nonce = Number(d.nonce);
        upsert(st.delivered, nonce, { nonce, key: d.key, message: d.message, sender: d.sender, recipient: d.recipient, deliveredAt: Number(d.deliveredAt) });
        upsert(st.sent, nonce, { nonce, key: d.key, message: d.message, sender: d.sender, recipient: d.recipient });
      }
      st.dCount = n; full = true;
    }
    // Who voted, and who accepted: re-checked every tick for messages being tracked here,
    // and for everything (newest first, capped) on a full check.
    const tracked = new Set([tracking.workspace?.nonce, tracking.demo?.nonce].filter(x => x != null));
    const items = [...st.sent.values()].sort((a, b) => b.nonce - a.nonce)
      .filter((m, i) => tracked.has(m.nonce) || (full && i < MAX_VOTE_CHECK));
    const jobs = [];
    for (const m of items) {
      const known = votersOf(m.key);
      if (known.size < N) for (const v of cfg.validators) {
        if (!known.has(v.address.toLowerCase())) jobs.push(gate.hasVoted(m.key, v.address).then(y => { if (y) addVote(m.key, v.address, { nonce: m.nonce }); }));
      }
      if (st.delivered.has(m.nonce) && !st.accepted.has(m.nonce)) {
        jobs.push(gate.accepted(m.nonce).then(y => { if (y) upsert(st.accepted, m.nonce, { recipient: m.recipient }); }));
      }
    }
    await Promise.all(jobs);
  }

  /* ---------- refresh loop ---------- */
  let busy = false, tickNo = 0;
  async function refresh() {
    if (busy) return; busy = true;
    const full = tickNo++ % 5 === 0;
    let okA = true, okB = true;
    await Promise.all([
      readA().catch(e => { okA = false; console.warn('Chain A', e); }),
      readB(full).catch(e => { okB = false; console.warn('Chain B', e); }),
    ]);
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
      notice(`Cannot reach ${okA ? '' : cfg.chainA.name + ' '}${okA || okB ? '' : 'or '}${okB ? '' : cfg.chainB.name}. ${cfg.local ? 'Is `npm run local` (or the Chain B node) still running?' : 'The RPC did not answer; it retries automatically.'}`);
    }
    renderAll();
    // Live transaction hashes from the newest blocks. Failures here never block the page.
    await Promise.all([okA && scanTip('A').catch(e => console.warn('Chain A logs', e)), okB && scanTip('B').catch(e => console.warn('Chain B logs', e))]);
    renderAll();
    busy = false;
  }
  function renderAll() {
    $('sent').textContent = st.sentTotal;
    $('received').textContent = st.dCount;
    $('audits').textContent = st.accepted.size;
    $('votesLabel').textContent = `Validator votes on Chain B: ${st.voteCount}`;
    renderHistory(); renderValidators(); renderJourney(); renderDemo(); renderInbox();
  }
  window.VM_REFRESH = refresh;
  $('refreshButton').addEventListener('click', refresh);

  /* ---------- wallets ----------
   * Two people, two chains. The SAME MetaMask can play either role: it is switched to
   * Chain A to send (Person 1) and to Chain B to accept (Person 2).
   * Transactions are sent with an explicit `from` address straight through the wallet
   * (this is what MetaMask mobile needs), and confirmed through our own RPC.
   * In local mode without MetaMask, built-in demo wallets play both people. */
  let account = null;
  const chainHex = chain => '0x' + chain.chainId.toString(16);
  async function switchTo(chain) {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex(chain) }] }); }
    catch (e) {
      if (e.code === 4902 || /unrecognized|not added|addEthereumChain/i.test(e.message || '')) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: chainHex(chain), chainName: chain.name, rpcUrls: [fixRpc(chain.walletRpc || chain.rpc)], nativeCurrency: { name: chain.currency, symbol: chain.currency, decimals: 18 }, blockExplorerUrls: chain.explorer ? [chain.explorer] : undefined }] });
      } else throw e;
    }
    for (let i = 0; i < 20; i++) { // wait until the wallet really is on that chain
      const id = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(id, 16) === chain.chainId) return;
      await sleep(250);
    }
    throw new Error(`Please switch MetaMask to ${chain.name} and try again.`);
  }
  function showAccount(addr, how) {
    account = addr;
    $('walletButton').textContent = `● ${short(addr, 6, 4)}`;
    $('walletButton').classList.add('connected');
    $('walletButton').title = how;
    renderInbox();
  }
  /** Connects a wallet on chain 'A' (to send) or 'B' (to accept). Returns { address, send(to, data) → tx hash }. */
  async function walletOn(which) {
    const chain = which === 'A' ? cfg.chainA : cfg.chainB;
    if (window.ethereum) {
      const asked = await window.ethereum.request({ method: 'eth_requestAccounts' });
      await switchTo(chain);
      const now = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
      const raw = (now && now[0]) || (asked && asked[0]);
      if (!raw || !ethers.isAddress(raw)) throw new Error('MetaMask did not share an account with this page. In MetaMask, connect this site to your account, then try again.');
      const from = ethers.getAddress(raw);
      showAccount(from, `MetaMask on ${chain.name}`);
      return { address: from, send: (to, data) => window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to, data, value: '0x0' }] }) };
    }
    if (cfg.local && cfg.demoKey) {
      const w = which === 'A' ? new ethers.Wallet(cfg.demoKey, pA) : new ethers.Wallet(cfg.demoRecipientKey, pB);
      showAccount(w.address, which === 'A' ? 'Local demo sender wallet (Person 1)' : 'Local demo receiver wallet (Person 2)');
      return { address: w.address, send: async (to, data) => (await w.sendTransaction({ to, data })).hash };
    }
    throw new Error('No wallet found. Install MetaMask, or on a phone open this page inside the MetaMask app browser.');
  }
  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', accs => { if (accs?.[0]) showAccount(ethers.getAddress(accs[0]), 'MetaMask'); });
    window.ethereum.request({ method: 'eth_accounts' }).then(a => { if (a?.[0]) showAccount(ethers.getAddress(a[0]), 'MetaMask'); }).catch(() => {});
  }
  $('walletButton').addEventListener('click', async () => {
    try { await walletOn(location.hash === '#inbox' ? 'B' : 'A'); } catch (e) { notice(reasonOf(e)); navigate('overview'); }
  });
  async function confirmed(provider, hash, what) {
    const r = await provider.waitForTransaction(hash, 1, 300000);
    if (!r) throw new Error(`${what} is taking unusually long. Check it in the block explorer: ${hash}`);
    if (r.status !== 1) throw new Error(`${what} failed on chain (tx ${hash}).`);
    return r;
  }

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
    const w = await walletOn('A');
    await source.sendMessage.staticCall(cfg.chainB.chainId, recipient, text, { from: w.address }); // clear error before the wallet opens
    tracking[slot] = { message: text, recipient, txHash: null, nonce: null, startedAt: Date.now() };
    renderJourney(); renderDemo();
    const hash = await w.send(cfg.chainA.source, source.interface.encodeFunctionData('sendMessage', [cfg.chainB.chainId, recipient, text]));
    tracking[slot].txHash = hash; renderJourney(); renderDemo();
    const r = await confirmed(pA, hash, 'The source transaction');
    for (const l of r.logs) { let ev = null; try { ev = source.interface.parseLog(l); } catch {} if (ev?.name === 'MessageSent') { onEvent('A', ev, { ...l, transactionHash: hash, blockNumber: r.blockNumber }); tracking[slot].nonce = Number(ev.args.nonce); } }
    refresh();
    return tracking[slot];
  }
  async function acceptMessage(nonce) {
    const w = await walletOn('B');
    const d = st.delivered.get(nonce);
    if (d && !same(d.recipient, w.address)) throw new Error(`This message is addressed to ${short(d.recipient, 8, 6)}, but the connected wallet is ${short(w.address, 8, 6)}. Switch to the recipient's account in MetaMask.`);
    await gate.accept.staticCall(nonce, { from: w.address }); // clear error before the wallet opens
    const hash = await w.send(cfg.chainB.gate, gate.interface.encodeFunctionData('accept', [nonce]));
    const r = await confirmed(pB, hash, 'The acceptance');
    upsert(st.accepted, nonce, { txHash: hash, block: r.blockNumber, recipient: w.address });
    renderAll(); refresh();
    return hash;
  }

  /* ---------- finding transaction hashes for older records (on demand) ---------- */
  async function blockNear(p, ts) {
    const head = await p.getBlock('latest'), back = await p.getBlock(Math.max(0, head.number - 1000));
    const bt = Math.max(0.5, (head.timestamp - back.timestamp) / (head.number - back.number));
    return Math.round(head.number - (head.timestamp - ts) / bt);
  }
  async function locate(record) {
    if (cfg.local || !record.deliveredAt) return;
    if (!record.txHash) { // delivery tx on Chain B: emitted at deliveredAt
      const est = await blockNear(pB, record.deliveredAt);
      const topic = gate.interface.getEvent('MessageDelivered').topicHash;
      for (const off of [0, -10, 10, -20, 20]) {
        const lg = await pB.getLogs({ address: cfg.chainB.gate, topics: [topic, record.key], fromBlock: est + off - 5, toBlock: est + off + 4 }).catch(() => []);
        if (lg[0]) { upsert(st.delivered, record.nonce, { txHash: lg[0].transactionHash, block: lg[0].blockNumber }); break; }
      }
    }
    const src = st.sent.get(record.nonce);
    if (src && !src.txHash) { // source tx on Chain A: some time before delivery (search back ~15 minutes)
      const end = await blockNear(pA, record.deliveredAt);
      const topic = source.interface.getEvent('MessageSent').topicHash, nTopic = ethers.toBeHex(record.nonce, 32);
      for (let to = end + 2; to > end - 80; to -= 10) {
        const lg = await pA.getLogs({ address: cfg.chainA.source, topics: [topic, nTopic], fromBlock: to - 9, toBlock: to }).catch(() => []);
        if (lg[0]) { upsert(st.sent, record.nonce, { txHash: lg[0].transactionHash, block: lg[0].blockNumber }); break; }
      }
    }
  }

  /* ---------- journey stages, computed from chain state ---------- */
  function stagesFor(t) {
    const m = t?.nonce != null ? st.sent.get(t.nonce) : null;
    const conf = m ? (m.block == null ? cfg.confirmations : Math.max(0, st.headA - m.block + 1)) : 0;
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
      { title: 'Source block confirmations', desc: `Validators wait for ${cfg.confirmations} confirmation(s) so the event cannot be reorganised away`, label: m && m.block != null ? `Block #${m.block} · ` : '', value: m ? `${Math.min(conf, cfg.confirmations)} / ${cfg.confirmations} confirmations · nonce #${m.nonce}` : '—', mode: mode(confOk, !!m && !confOk) },
      { title: 'Independent validators verify', desc: 'Each validator re-reads the receipt and block hash through its own RPC provider', label: m ? `${voters.size} of ${N} confirmed:` : '', value: m ? (voterNames.join(', ') || 'Waiting for the first validator…') : '—', mode: mode(voters.size >= T, confOk && voters.size < T) },
      { title: 'Threshold reached on Chain B', desc: `${cfg.chainB.name} · Gate counts on-chain votes, ${T} of ${N} required, no relay`, label: m ? `${voters.size} vote${voters.size === 1 ? '' : 's'} (${T} needed) ·` : '', value: m ? (voters.size ? [...voters.entries()].map(([a, v]) => v.txHash ? short(v.txHash, 10, 6) : `${vName(a)} ✓`).join(', ') : 'No votes yet') : '—', votes: m?.key, mode: mode(voters.size >= T, confOk && voters.size > 0 && voters.size < T) },
      { title: 'Delivered to the recipient', desc: `${cfg.chainB.name} · Gate emits MessageDelivered for ${to ? short(to, 8, 6) : 'the recipient'}`, label: 'Delivery tx:', value: delivered ? (d.txHash || 'delivered ✓') : '—', url: delivered && d.txHash && txUrl(cfg.chainB, d.txHash), mode: mode(delivered, voters.size >= T && !delivered) },
      { title: 'Accepted by the recipient', desc: `${cfg.chainB.name} · Recipient signs accept() with their own wallet — nobody else can`, label: acc ? 'Accept tx:' : '', value: acc ? (acc.txHash || 'accepted ✓') : delivered ? 'Waiting for the recipient — open "My Inbox" on their device' : '—', url: acc && acc.txHash && txUrl(cfg.chainB, acc.txHash), mode: mode(!!acc, delivered && !acc) },
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
      tr.append(el('td', item.txHash ? short(item.txHash, 10, 6) : '—', 'mono'));
      tr.append(el('td', item.block ?? '—'));
      const acc = st.accepted.get(item.nonce);
      const stc = el('td'); const vsz = votersOf(item.key).size; stc.append(el('span', acc ? `Accepted ✓${vsz ? ` · ${vsz}/${N}` : ''}` : `Delivered · awaiting recipient`, acc ? 'accepted-chip' : 'delivered-chip')); tr.append(stc);
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
  function openDetails(record, again) {
    selected = record;
    if (!again && !cfg.local && (!record.txHash || !st.sent.get(record.nonce)?.txHash)) {
      locate(record).then(() => { if (selected === record && $('details').open) openDetails(st.delivered.get(record.nonce) || record, true); }).catch(() => {});
    }
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
    const looking = again ? 'not found nearby — see the contract on the explorer' : 'looking it up…';
    if (src && src.key === record.key) {
      field(p, `Source transaction (${cfg.chainA.name})`, src.txHash || looking, src.txHash && txUrl(cfg.chainA, src.txHash));
      if (src.block != null) field(p, 'Source block', src.block);
    }
    for (const [addr, v] of voters) field(p, `Vote · ${vName(addr)}`, v.txHash || 'voted ✓', v.txHash && txUrl(cfg.chainB, v.txHash));
    field(p, `Destination delivery tx (${cfg.chainB.name})`, record.txHash || looking, record.txHash && txUrl(cfg.chainB, record.txHash));
    if (record.block != null) field(p, 'Destination block', record.block);
    field(p, 'Recipient acceptance', acc ? (acc.txHash || 'Accepted ✓') : 'Not accepted yet', acc && acc.txHash && txUrl(cfg.chainB, acc.txHash));
    if (cfg.chainB.explorer) field(p, 'All transactions of the gate contract', `${cfg.chainB.explorer}/address/${cfg.chainB.gate}`, `${cfg.chainB.explorer}/address/${cfg.chainB.gate}`);
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
      const last = mine.sort((a, b) => (b.nonce ?? 0) - (a.nonce ?? 0))[0];
      // "Behind" = a message old enough to vote on that this validator has not voted for.
      const ready = sentList.slice(0, MAX_VOTE_CHECK).filter(m => m.block == null || st.headA - m.block + 1 >= cfg.confirmations + 2);
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
      ? [`Altered message REJECTED. The source event for #${d.nonce} on ${cfg.chainA.name}${src?.block != null ? ` (block ${src.block})` : ''} ${evidence} the tampered text, so honest validators refuse it — and even a validator pushing it gets "${why}".`, false]
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
      if (window.ethereum) {
        try { await window.ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] }); }
        catch (e) { if (e.code === 4001) throw e; } // some wallets (e.g. mobile) don't support the picker; carry on
      }
      await walletOn('B');
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
    try { if (!account) await walletOn('A'); $('recipient').value = account; $('recipient').dataset.touched = '1'; } catch (e) { show('sendResult', reasonOf(e), true); }
  });

  /* ---------- go ---------- */
  refresh();
  loadBalances();
  setInterval(refresh, 4000);
  setInterval(loadBalances, 20000);
}
