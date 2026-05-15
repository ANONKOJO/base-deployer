// api/compile.js
// Vercel serverless function — compiles Solidity and returns ABI + bytecode.
// The frontend calls this. It never touches wallets or private keys.

const solc = require('solc');

// ── Solidity sources ────────────────────────────────────────────────────

const SOURCES = {

  token: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _totalSupply) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        totalSupply = _totalSupply * (10 ** uint256(_decimals));
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        emit Transfer(from, to, value);
        return true;
    }
}`,

  nft: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleNFT {
    string public name;
    string public symbol;
    uint256 public maxSupply;
    uint256 public totalMinted;
    address public owner;
    string private _baseTokenURI;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed _owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed _owner, address indexed operator, bool approved);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(string memory _name, string memory _symbol, string memory baseURI, uint256 _maxSupply) {
        name = _name;
        symbol = _symbol;
        _baseTokenURI = baseURI;
        maxSupply = _maxSupply;
        owner = msg.sender;
    }

    function mint(address to) external onlyOwner {
        require(totalMinted < maxSupply, "Max supply reached");
        totalMinted++;
        _owners[totalMinted] = to;
        _balances[to]++;
        emit Transfer(address(0), to, totalMinted);
    }

    function balanceOf(address _owner) public view returns (uint256) {
        require(_owner != address(0), "Zero address");
        return _balances[_owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address _owner = _owners[tokenId];
        require(_owner != address(0), "Token does not exist");
        return _owner;
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return string(abi.encodePacked(_baseTokenURI, _toString(tokenId)));
    }

    function approve(address to, uint256 tokenId) public {
        address _owner = ownerOf(tokenId);
        require(msg.sender == _owner || isApprovedForAll(_owner, msg.sender), "Not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(_owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) public {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address _owner, address operator) public view returns (bool) {
        return _operatorApprovals[_owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address _owner = ownerOf(tokenId);
        require(
            msg.sender == _owner ||
            msg.sender == getApproved(tokenId) ||
            isApprovedForAll(_owner, msg.sender),
            "Not authorized"
        );
        _balances[from]--;
        _balances[to]++;
        _owners[tokenId] = to;
        delete _tokenApprovals[tokenId];
        emit Transfer(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return
            interfaceId == 0x80ac58cd ||
            interfaceId == 0x5b5e139f ||
            interfaceId == 0x01ffc9a7;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}`,

  storage: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleStorage {
    uint256 private storedValue;
    event ValueChanged(uint256 newValue);

    constructor(uint256 initialValue) {
        storedValue = initialValue;
    }

    function store(uint256 value) public {
        storedValue = value;
        emit ValueChanged(value);
    }

    function retrieve() public view returns (uint256) {
        return storedValue;
    }
}`,

};

const CONTRACT_NAMES = {
  token:   'SimpleToken',
  nft:     'SimpleNFT',
  storage: 'SimpleStorage',
};

// ── Rate limiter (in-memory, resets on cold start) ───────────────────────
// Allows max 10 compile requests per IP per minute.
const MAX_REQUESTS   = 10;
const WINDOW_MS      = 60 * 1000; // 1 minute
const ipRequestLog   = new Map();

function isRateLimited(ip) {
  const now    = Date.now();
  const record = ipRequestLog.get(ip) || { count: 0, start: now };

  // reset window if expired
  if (now - record.start > WINDOW_MS) {
    record.count = 0;
    record.start = now;
  }

  record.count++;
  ipRequestLog.set(ip, record);
  return record.count > MAX_REQUESTS;
}

// Max contract bytecode size — EVM hard limit is 24KB (24576 bytes)
const MAX_BYTECODE_BYTES = 24576;

// ── Handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — locked to your Vercel domain only
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://based-deployahh.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  // Input sanitization — only accept known template strings, nothing else
  const { template } = req.body;
  const ALLOWED_TEMPLATES = ['token', 'nft', 'storage'];

  if (!template || typeof template !== 'string' || !ALLOWED_TEMPLATES.includes(template)) {
    return res.status(400).json({ error: 'Invalid template. Must be one of: token, nft, storage.' });
  }

  try {
    const source       = SOURCES[template];
    const contractName = CONTRACT_NAMES[template];

    const input = JSON.stringify({
      language: 'Solidity',
      sources:  { 'contract.sol': { content: source } },
      settings: {
        optimizer:       { enabled: true, runs: 200 },
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    });

    const outputRaw = solc.compile(input);
    const output    = JSON.parse(outputRaw);

    // Surface compiler errors
    const errors = (output.errors || []).filter(e => e.severity === 'error');
    if (errors.length) {
      return res.status(400).json({
        error: errors.map(e => e.formattedMessage || e.message).join('\n'),
      });
    }

    const compiled = output.contracts?.['contract.sol']?.[contractName];
    if (!compiled) {
      return res.status(500).json({ error: `Contract "${contractName}" not found in output` });
    }

    const bytecode = compiled.evm?.bytecode?.object;
    if (!bytecode) {
      return res.status(500).json({ error: 'Compiler returned empty bytecode' });
    }

    // Contract size check — reject if over EVM 24KB limit
    const byteCount = bytecode.length / 2;
    if (byteCount > MAX_BYTECODE_BYTES) {
      return res.status(400).json({
        error: `Contract is too large (${byteCount} bytes). EVM limit is ${MAX_BYTECODE_BYTES} bytes.`,
      });
    }

    return res.status(200).json({
      abi:          compiled.abi,
      bytecode:     '0x' + bytecode,
      byteCount,
    });

  } catch (err) {
    console.error('Compile error:', err);
    return res.status(500).json({ error: err.message || 'Compilation failed' });
  }
};
