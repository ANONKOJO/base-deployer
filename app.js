/**
 * app.js
 *
 * Handles:
 *  - Wallet connection (ethers.js v6 + MetaMask)
 *  - Network switching
 *  - Template selection & form rendering
 *  - Fee collection
 *  - Gas estimation
 *  - Contract deployment
 */

// ─── Config ──────────────────────────────────────────────────────────────
const FEE_RECIPIENT = "0x0e87A7Ccb9a5FFF3F9Ba7546db1ea356CAD0C510"; // ← your wallet
const FEE_ETH       = "0.00001";                     // ← platform fee (all goes to you)

// ─── Compile via backend ──────────────────────────────────────────────────
// Calls the Vercel serverless function at /api/compile.
// Returns { abi, bytecode } ready for ethers ContractFactory.

async function compileContract(template) {
  const res = await fetch('/api/compile', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ template }),
  });

  const data = await res.json();

  if (!res.ok) throw new Error(data.error || 'Compilation failed');

  return { abi: data.abi, bytecode: data.bytecode };
}

// ─── State ───────────────────────────────────────────────────────────────
let provider    = null;
let signer      = null;
let walletAddr  = null;
let currentTemplate = null;   // key: 'token' | 'nft' | 'storage' | 'custom'
let argCount    = 0;

let selectedNetwork = {
  name:     "Base Mainnet",
  chainId:  8453,
  rpc:      "https://mainnet.base.org",
  explorer: "https://basescan.org",
};

// ─── Network ─────────────────────────────────────────────────────────────
function selectNet(btn, name, chainId, rpc, explorer) {
  document.querySelectorAll('.net-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedNetwork = { name, chainId, rpc, explorer };
}

// ─── Wallet ───────────────────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    document.getElementById('no-wallet').style.display = 'block';
    return;
  }

  const pill  = document.getElementById('wallet-pill');
  const label = document.getElementById('wallet-label');
  label.textContent = 'Connecting…';

  try {
    provider   = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    // Switch / add network
    try {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: "0x" + selectedNetwork.chainId.toString(16) }
      ]);
    } catch (e) {
      if (e.code === 4902) {
        await provider.send("wallet_addEthereumChain", [{
          chainId:         "0x" + selectedNetwork.chainId.toString(16),
          chainName:       selectedNetwork.name,
          rpcUrls:         [selectedNetwork.rpc],
          nativeCurrency:  { name: "ETH", symbol: "ETH", decimals: 18 },
        }]);
      } else throw e;
    }

    signer     = await provider.getSigner();
    walletAddr = await signer.getAddress();
    const bal  = await provider.getBalance(walletAddr);

    document.getElementById('wallet-dot').classList.add('connected');
    label.textContent =
      walletAddr.slice(0, 6) + '…' + walletAddr.slice(-4) +
      '  (' + parseFloat(ethers.formatEther(bal)).toFixed(3) + ' ETH)';

  } catch (e) {
    label.textContent = 'Connect Wallet';
    alert('Could not connect: ' + (e.message || e));
  }
}

// ─── Template picker ─────────────────────────────────────────────────────
function pickTemplate(key) {
  currentTemplate = key;

  // Highlight selected card
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('card-' + key).classList.add('selected');

  // Show the right form
  ['token','nft','storage','custom'].forEach(k => {
    document.getElementById('form-' + k).classList.add('hidden');
  });
  document.getElementById('form-' + key).classList.remove('hidden');

  // Update title
  const titles = {
    token:   'Token details',
    nft:     'NFT Collection details',
    storage: 'Simple Storage',
    custom:  'Custom Contract',
  };
  document.getElementById('form-title').textContent = titles[key];

  // Show form block
  document.getElementById('block-pick').classList.add('hidden');
  document.getElementById('block-form').classList.remove('hidden');
  document.getElementById('block-deploy').classList.remove('hidden');

  buildSummary();
}

function goBack() {
  document.getElementById('block-pick').classList.remove('hidden');
  document.getElementById('block-form').classList.add('hidden');
  document.getElementById('block-deploy').classList.add('hidden');
  document.getElementById('result-box').classList.add('hidden');
  currentTemplate = null;
}

// ─── Summary panel ────────────────────────────────────────────────────────
function buildSummary() {
  if (!currentTemplate) return;
  const tpl  = TEMPLATES[currentTemplate];
  const data = tpl.summary();
  const box  = document.getElementById('summary-box');

  box.innerHTML = Object.entries({
    ...data,
    'Network':      selectedNetwork.name,
    'Platform Fee': FEE_ETH + ' ETH (goes to platform)',
  }).map(([k, v]) => `
    <div class="summary-row">
      <span class="summary-key">${k}</span>
      <span class="summary-val">${v}</span>
    </div>
  `).join('');
}

// ─── Custom contract helpers ───────────────────────────────────────────────
function validateBytecode(el) {
  const v    = el.value.trim();
  const hint = document.getElementById('bc-hint');
  if (!v) { el.className = ''; hint.textContent = 'Must start with 0x'; hint.className = 'hint'; return; }
  if (!/^0x[0-9a-fA-F]+$/.test(v)) {
    el.className = 'error';
    hint.textContent = '✕ Invalid — must be 0x-prefixed hex';
    hint.className   = 'hint danger';
  } else {
    el.className = 'valid';
    hint.textContent = `✓ ${Math.floor((v.length-2)/2)} bytes`;
    hint.className   = 'hint ok';
  }
  buildSummary();
}

function validateABI(el) {
  const v    = el.value.trim();
  const hint = document.getElementById('abi-hint');
  if (!v) { el.className = ''; hint.textContent = 'Paste the ABI JSON array'; hint.className = 'hint'; return; }
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) throw new Error();
    el.className = 'valid';
    hint.textContent = `✓ ${parsed.filter(x=>x.type==='function').length} functions, ${parsed.filter(x=>x.type==='event').length} events`;
    hint.className   = 'hint ok';
    // show constructor args if needed
    autoFillCustomArgs(parsed);
  } catch {
    el.className = 'error';
    hint.textContent = '✕ Not valid JSON';
    hint.className   = 'hint danger';
  }
  buildSummary();
}

function autoFillCustomArgs(abi) {
  const ctor = abi.find(x => x.type === 'constructor');
  const wrap = document.getElementById('custom-args-wrap');
  if (!ctor?.inputs?.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  document.getElementById('custom-args-list').innerHTML = '';
  argCount = 0;
  ctor.inputs.forEach(inp => addArgRow(inp.type, inp.name));
}

function addArgRow(type = '', name = '') {
  argCount++;
  const id  = 'arg-' + argCount;
  const div = document.createElement('div');
  div.className = 'arg-row';
  div.id = id;
  div.innerHTML = `
    <input class="arg-type" type="text" value="${type}" placeholder="uint256" />
    <input class="arg-val"  type="text" placeholder="${name || 'value'}" />
    <button class="remove-arg" onclick="document.getElementById('${id}').remove()" aria-label="Remove">✕</button>
  `;
  document.getElementById('custom-args-list').appendChild(div);
}

// ─── Validation ───────────────────────────────────────────────────────────
function validate() {
  const errors = [];
  if (!signer) errors.push('Connect your wallet first');
  if (FEE_RECIPIENT === '0xYOUR_WALLET_ADDRESS_HERE') errors.push('Set FEE_RECIPIENT in app.js');
  const tpl = TEMPLATES[currentTemplate];
  if (tpl) errors.push(...tpl.validate());
  return errors;
}

// ─── Logging ──────────────────────────────────────────────────────────────
function log(msg, type = '') {
  const div  = document.getElementById('deploy-log');
  const line = document.createElement('div');
  line.className   = 'log-line ' + type;
  line.textContent = '› ' + msg;
  div.appendChild(line);
}

function addResultRow(key, val, mono = false) {
  const div = document.getElementById('result-rows');
  const row = document.createElement('div');
  row.className = 'result-row';
  row.innerHTML = `<span class="result-key">${key}</span><span class="result-val ${mono?'mono':''}">${val}</span>`;
  div.appendChild(row);
}

// ─── Deploy ───────────────────────────────────────────────────────────────
async function runDeploy() {
  buildSummary();

  const errors = validate();
  if (errors.length) {
    alert('Fix these first:\n\n' + errors.map(e => '• ' + e).join('\n'));
    return;
  }

  const btn = document.getElementById('deploy-btn');
  btn.disabled    = true;
  btn.textContent = 'Working…';

  const resultBox = document.getElementById('result-box');
  resultBox.classList.remove('hidden');
  document.getElementById('result-head').innerHTML = '<div class="spinner"></div> Deploying…';
  document.getElementById('result-head').className  = 'result-head';
  document.getElementById('result-rows').innerHTML  = '';
  document.getElementById('deploy-log').innerHTML   = '';

  try {
    const tpl  = TEMPLATES[currentTemplate];
    const args = tpl.getArgs();

    // ── Step 1: compile via backend ────────────────────────────────────
    let abi, bytecode;

    if (currentTemplate === 'custom') {
      bytecode = document.getElementById('custom-bytecode').value.trim();
      abi      = JSON.parse(document.getElementById('custom-abi').value.trim());
      log('Using custom bytecode and ABI', 'info');
    } else {
      log('Compiling contract…', 'info');
      btn.textContent = 'Compiling…';
      const compiled = await compileContract(currentTemplate);
      abi      = compiled.abi;
      bytecode = compiled.bytecode;
      log('Compiled ✓', 'ok');
    }

    // ── Step 1: collect platform fee ──────────────────────────────────
    log('Sending platform fee…', 'info');

    const feeTx = await signer.sendTransaction({
      to:    FEE_RECIPIENT,
      value: ethers.parseEther(FEE_ETH),
    });
    log('Fee tx: ' + feeTx.hash);
    await feeTx.wait(1);
    log('Fee confirmed ✓', 'ok');

    // ── Step 2: deploy — gas is automatic, Base handles it ────────────
    log('Sending deployment transaction…', 'info');

    const factory  = new ethers.ContractFactory(abi, bytecode, signer);
    const contract = await factory.deploy(...args); // no gas override — chain decides
    log('Deploy tx: ' + contract.deploymentTransaction().hash);
    log('Waiting for confirmation…');

    const receipt         = await contract.deploymentTransaction().wait(1);
    const contractAddress = await contract.getAddress();

    // ── Success ────────────────────────────────────────────────────────
    document.getElementById('result-head').innerHTML = 'Deployed successfully!';
    document.getElementById('result-head').className  = 'result-head success';
    log('Live on ' + selectedNetwork.name + ' ✓', 'ok');

    const ex = selectedNetwork.explorer;
    addResultRow('Contract',
      ex ? `<a href="${ex}/address/${contractAddress}" target="_blank">${contractAddress}</a>` : contractAddress,
      true
    );
    addResultRow('Tx Hash',
      ex ? `<a href="${ex}/tx/${receipt.hash}" target="_blank">${receipt.hash.slice(0,22)}…</a>` : receipt.hash.slice(0,22)+'…'
    );
    addResultRow('Block',    receipt.blockNumber.toLocaleString());
    addResultRow('Gas Used', Number(receipt.gasUsed).toLocaleString());
    addResultRow('Network',  selectedNetwork.name);

    btn.textContent = 'Deployed';

  } catch (err) {
    document.getElementById('result-head').innerHTML = 'Deployment failed';
    document.getElementById('result-head').className  = 'result-head error';
    log(err.reason || err.message || String(err), 'err');
    btn.disabled    = false;
    btn.textContent = 'Retry Deploy';
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────
function resetAll() {
  currentTemplate = null;
  document.getElementById('block-pick').classList.remove('hidden');
  document.getElementById('block-form').classList.add('hidden');
  document.getElementById('block-deploy').classList.add('hidden');
  document.getElementById('result-box').classList.add('hidden');
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
  const btn = document.getElementById('deploy-btn');
  btn.disabled    = false;
  btn.textContent = '🚀 Deploy Contract';
  btn.style.cssText = '';
}
