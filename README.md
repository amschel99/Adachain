# POU Chain API Documentation

This document provides comprehensive documentation for all REST endpoints in the POU Chain blockchain implementation.

## Base URL

```
http://localhost:8800
```

## Endpoints

### Blockchain Management

#### Create Genesis Block

```http
POST /genesis
```

Creates the genesis block of the blockchain. Can only be called once per node.

**Request Body:**

```json
{
  "initialDistribution": [
    {
      "address": "wallet_address",
      "amount": 100
    }
  ],
  "initialSupply": 1000
}
```

**Response (201 Created):**

```json
{
  "message": "Genesis block created successfully",
  "block": {
    "index": 0,
    "timestamp": 1234567890,
    "hash": "block_hash",
    "previousHash": "0",
    "proposer": "genesis_address"
  },
  "genesisProposer": {
    "address": "genesis_address",
    "privateKey": "private_key",
    "initialBalance": 1000
  },
  "initialDistribution": [
    {
      "address": "wallet_address",
      "amount": 100
    }
  ],
  "totalSupply": 1000,
  "warning": "IMPORTANT: Save the private key securely. It will not be shown again."
}
```

**Error Responses:**

- 400 Bad Request: Genesis block already exists
- 500 Internal Server Error: Failed to create genesis block

#### Reset Blockchain

```http
POST /reset
```

Resets the blockchain to its initial state.

**Request Body:**

```json
{
  "confirmation": "CONFIRM_RESET"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Blockchain reset to genesis state",
  "newState": {
    "chain": [],
    "accounts": {},
    "bannedAddresses": [],
    "currentSupply": 0
  }
}
```

**Error Responses:**

- 400 Bad Request: Missing or invalid confirmation
- 500 Internal Server Error: Failed to reset blockchain

### Transaction Management

#### Create Transaction

```http
POST /transaction
```

Creates and broadcasts a new transaction to the network.

**Request Body:**

```json
{
  "fromAddress": "sender_address",
  "toAddress": "recipient_address",
  "amount": 10,
  "fee": 0.001,
  "privateKey": "sender_private_key",
  "message": "Optional transaction message"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "transaction": {
    "fromAddress": "sender_address",
    "toAddress": "recipient_address",
    "amount": 10,
    "fee": 0.001,
    "signature": "transaction_signature",
    "timestamp": 1234567890,
    "message": "Optional transaction message"
  },
  "message": "Transaction broadcast to network",
  "hash": "transaction_hash"
}
```

**Error Responses:**

- 400 Bad Request: Invalid parameters or insufficient funds
- 500 Internal Server Error: Failed to process transaction

#### Get Transaction by Hash

```http
GET /transaction/:hash
```

Retrieves transaction details by its hash.

**Response (200 OK):**

```json
{
  "transaction": {
    "fromAddress": "sender_address",
    "toAddress": "recipient_address",
    "amount": 10,
    "fee": 0.001,
    "timestamp": 1234567890,
    "signature": "transaction_signature",
    "hash": "transaction_hash"
  },
  "status": "confirmed",
  "confirmations": 5,
  "blockHeight": 123,
  "inMempool": false
}
```

**Error Responses:**

- 404 Not Found: Transaction not found
- 500 Internal Server Error: Failed to fetch transaction

### Wallet Management

#### Create New Wallet

```http
POST /wallet/create
```

Creates a new wallet and broadcasts it to the network.

**Response (200 OK):**

```json
{
  "address": "new_wallet_address",
  "privateKey": "new_wallet_private_key",
  "balance": 0,
  "message": "Wallet created successfully and broadcasted to network"
}
```

**Error Response:**

- 500 Internal Server Error: Failed to create wallet

#### Add Existing Wallet

```http
POST /wallet/add
```

Adds an existing wallet to the blockchain.

**Request Body:**

```json
{
  "address": "wallet_address",
  "initialBalance": 0,
  "broadcast": true
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Wallet added successfully and broadcasted to network",
  "wallet": {
    "address": "wallet_address",
    "balance": 0,
    "nonce": 0
  }
}
```

**Error Responses:**

- 400 Bad Request: Missing wallet address
- 409 Conflict: Wallet already exists
- 500 Internal Server Error: Failed to add wallet

#### List All Wallets

```http
GET /wallets
```

Retrieves a list of all wallets in the blockchain.

**Response (200 OK):**

```json
{
  "count": 10,
  "wallets": [
    {
      "address": "wallet_address",
      "balance": 100,
      "nonce": 0
    }
  ]
}
```

**Error Response:**

- 500 Internal Server Error: Failed to list wallets

#### Check Wallet Balance

```http
GET /balance/:address
```

Retrieves the balance of a specific wallet.

**Response (200 OK):**

```json
{
  "address": "wallet_address",
  "balance": 100,
  "nonce": 0
}
```

**Error Responses:**

- 404 Not Found: Account not found
- 500 Internal Server Error: Failed to fetch balance

### Identity Management

#### Add Identity

```http
POST /identity/add
```

Registers a new identity on the blockchain.

**Request Body:**

```json
{
  "address": "wallet_address",
  "privateKey": "wallet_private_key"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Identity registration initiated",
  "transaction": {
    "hash": "transaction_hash",
    "fee": 0.001
  },
  "token": {
    "id": "token_id",
    "value": 1,
    "utility": "Block proposal, 1 token, 1 vote",
    "hash": "transaction_hash"
  }
}
```

**Error Responses:**

- 400 Bad Request: Missing or invalid parameters
- 500 Internal Server Error: Failed to add identity

#### Check Identity Verification

```http
POST /isverified
```

Checks if a wallet address is verified.

**Request Body:**

```json
{
  "wallet_address": "wallet_address"
}
```

**Response (200 OK):**

```json
true
```

**Error Responses:**

- 400 Bad Request: Missing wallet address
- 500 Internal Server Error: Failed to check verification status

### Token Management

#### List All Tokens

```http
GET /tokens
```

Retrieves all tokens in the blockchain.

**Response (200 OK):**

```json
{
  "count": 5,
  "tokens": [
    {
      "id": "token_id",
      "value": 1,
      "hash": "token_hash",
      "owner": "owner_address",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Error Response:**

- 500 Internal Server Error: Failed to fetch tokens

#### Get Token by ID

```http
GET /tokens/:id
```

Retrieves a specific token by its ID.

**Response (200 OK):**

```json
{
  "id": "token_id",
  "value": 1,
  "hash": "token_hash",
  "owner": "owner_address",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Responses:**

- 404 Not Found: Token not found
- 500 Internal Server Error: Failed to fetch token

#### Get Tokens by Owner

```http
GET /tokens/owner/:owner
```

Retrieves all tokens owned by a specific address.

**Response (200 OK):**

```json
{
  "count": 3,
  "tokens": [
    {
      "id": "token_id",
      "value": 1,
      "hash": "token_hash",
      "owner": "owner_address",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Error Response:**

- 500 Internal Server Error: Failed to fetch tokens by owner

### Blockchain Information

#### Get Chain Info

```http
GET /chain/info
```

Retrieves general information about the blockchain.

**Response (200 OK):**

```json
{
  "height": 100,
  "latestBlockHash": "block_hash",
  "accounts": 50,
  "currentSupply": 1000,
  "peers": 5,
  "fee": 0.001
}
```

**Error Response:**

- 500 Internal Server Error: Failed to get chain info

#### Get Supply Information

```http
GET /supply
```

Retrieves information about the token supply.

**Response (200 OK):**

```json
{
  "currentSupply": 1000,
  "blockReward": 50,
  "nextHalvingBlock": 210000
}
```

**Error Response:**

- 500 Internal Server Error: Failed to fetch supply info

#### Lookup by Hash

```http
GET /hash/:hash
```

Retrieves information about a block or transaction by its hash.

**Response (200 OK):**

```json
{
  "type": "transaction",
  "data": {
    "hash": "transaction_hash",
    "fromAddress": "sender_address",
    "toAddress": "recipient_address",
    "amount": 10,
    "fee": 0.001,
    "timestamp": 1234567890,
    "signature": "transaction_signature",
    "blockHash": "block_hash",
    "blockNumber": 123
  }
}
```

**Error Responses:**

- 404 Not Found: Hash not found in blockchain
- 500 Internal Server Error: Failed to fetch hash information

### Network Management

#### Trigger Initial Block Download (IBD)

```http
POST /sync
```

Triggers the initial block download process.

**Response (200 OK):**

```json
{
  "success": true,
  "message": "IBD request broadcasted to all peers",
  "peers": 5
}
```

**Error Response:**

- 500 Internal Server Error: Failed to trigger IBD

#### Force Sync with Peer

```http
POST /force-sync
```

Forces synchronization with a specific peer.

**Request Body:**

```json
{
  "peerUrl": "peer_url"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Force sync request sent to peer_url"
}
```

**Error Responses:**

- 400 Bad Request: Missing peer URL
- 404 Not Found: Peer not found
- 500 Internal Server Error: Failed to force sync

#### Check Address Status

```http
GET /address/status/:address
```

Checks if an address is banned or active.

**Response (200 OK):**

```json
{
  "address": "wallet_address",
  "status": "active",
  "message": "Address is in good standing"
}
```

**Error Response:**

- 500 Internal Server Error: Failed to check address status
