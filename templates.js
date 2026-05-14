/**
 * templates.js
 *
 * Raw Solidity sources for each contract type.
 * The browser compiles them on the fly using solc loaded lazily from CDN.
 * No bytecode to paste. No Remix. No server needed.
 */

// ─── Solidity sources ─────────────────────────────────────────────────────

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
        name = _name; symbol = _symbol; _baseTokenURI = baseURI;
        maxSupply = _maxSupply; owner = msg.sender;
    }

    function mint(address to) external onlyOwner {
        require(totalMinted < maxSupply, "Max supply reached");
        totalMinted++;
        _owners[totalMinted] = to;
        _balances[to]++;
        emit Transfer(address(0), to, totalMinted);
    }

    function balanceOf(address _owner) public view returns (uint256) {
        require(_owner != address(0), "Zero address"); return _balances[_owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address _owner = _owners[tokenId];
        require(_owner != address(0), "Token does not exist"); return _owner;
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return string(abi.encodePacked(_baseTokenURI, _toString(tokenId)));
    }

    function approve(address to, uint256 tokenId) public {
        address _owner = ownerOf(tokenId);
        require(msg.sender == _owner || isApprovedForAll(_owner, msg.sender), "Not authorized");
        _tokenApprovals[tokenId] = to; emit Approval(_owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) { return _tokenApprovals[tokenId]; }

    function setApprovalForAll(address operator, bool approved) public {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address _owner, address operator) public view returns (bool) {
        return _operatorApprovals[_owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address _owner = ownerOf(tokenId);
        require(msg.sender == _owner || msg.sender == getApproved(tokenId) || isApprovedForAll(_owner, msg.sender), "Not authorized");
        _balances[from]--; _balances[to]++; _owners[tokenId] = to;
        delete _tokenApprovals[tokenId]; emit Transfer(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0x01ffc9a7;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value; uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + uint256(value % 10))); value /= 10; }
        return string(buffer);
    }
}`,

  storage: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleStorage {
    uint256 private storedValue;
    event ValueChanged(uint256 newValue);

    constructor(uint256 initialValue) { storedValue = initialValue; }

    function store(uint256 value) public { storedValue = value; emit ValueChanged(value); }
    function retrieve() public view returns (uint256) { return storedValue; }
}`,

};

// Contract name must match the contract name inside the Solidity source
const CONTRACT_NAMES = {
  token:   "SimpleToken",
  nft:     "SimpleNFT",
  storage: "SimpleStorage",
};

// ─── Template definitions ─────────────────────────────────────────────────

const TEMPLATES = {

  token: {
    getArgs() {
      return [
        document.getElementById("token-name").value.trim(),
        document.getElementById("token-symbol").value.trim(),
        parseInt(document.getElementById("token-decimals").value || "18"),
        document.getElementById("token-supply").value.trim(),
      ];
    },
    validate() {
      const e = [];
      if (!document.getElementById("token-name").value.trim())   e.push("Token name is required");
      if (!document.getElementById("token-symbol").value.trim()) e.push("Token symbol is required");
      if (!document.getElementById("token-supply").value.trim()) e.push("Total supply is required");
      return e;
    },
    summary() {
      return {
        Type: "ERC-20 Token",
        Name: document.getElementById("token-name").value.trim() || "—",
        Symbol: document.getElementById("token-symbol").value.trim() || "—",
        Decimals: document.getElementById("token-decimals").value || "18",
        "Total Supply": Number(document.getElementById("token-supply").value || 0).toLocaleString(),
      };
    },
  },

  nft: {
    getArgs() {
      return [
        document.getElementById("nft-name").value.trim(),
        document.getElementById("nft-symbol").value.trim(),
        document.getElementById("nft-uri").value.trim(),
        document.getElementById("nft-supply").value.trim(),
      ];
    },
    validate() {
      const e = [];
      if (!document.getElementById("nft-name").value.trim())   e.push("Collection name is required");
      if (!document.getElementById("nft-symbol").value.trim()) e.push("Symbol is required");
      if (!document.getElementById("nft-uri").value.trim())    e.push("Metadata URI is required");
      if (!document.getElementById("nft-supply").value.trim()) e.push("Max supply is required");
      return e;
    },
    summary() {
      return {
        Type: "ERC-721 NFT Collection",
        Name: document.getElementById("nft-name").value.trim() || "—",
        Symbol: document.getElementById("nft-symbol").value.trim() || "—",
        "Base URI": document.getElementById("nft-uri").value.trim() || "—",
        "Max Supply": Number(document.getElementById("nft-supply").value || 0).toLocaleString(),
      };
    },
  },

  storage: {
    getArgs() { return [document.getElementById("storage-value").value || "0"]; },
    validate() { return []; },
    summary() {
      return {
        Type: "Simple Storage",
        "Initial Value": document.getElementById("storage-value").value || "0",
      };
    },
  },

  custom: {
    getArgs() {
      const args = [];
      document.querySelectorAll(".arg-row").forEach(row => {
        args.push(row.querySelector(".arg-val").value.trim());
      });
      return args;
    },
    validate() {
      const e = [];
      const bc = document.getElementById("custom-bytecode").value.trim();
      if (!bc) e.push("Bytecode is required");
      else if (!/^0x[0-9a-fA-F]+$/.test(bc)) e.push("Bytecode must be valid 0x-prefixed hex");
      const abiRaw = document.getElementById("custom-abi").value.trim();
      if (!abiRaw) e.push("ABI is required");
      else { try { JSON.parse(abiRaw); } catch { e.push("ABI is not valid JSON"); } }
      return e;
    },
    summary() {
      const bc = document.getElementById("custom-bytecode").value.trim();
      let fnCount = "—";
      try { fnCount = JSON.parse(document.getElementById("custom-abi").value).filter(x => x.type === "function").length; } catch {}
      return {
        Type: "Custom Contract",
        Bytecode: bc ? Math.floor((bc.length - 2) / 2) + " bytes" : "—",
        Functions: fnCount,
      };
    },
  },

};
