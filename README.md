# Adachain

A peer-to-peer distributed blockchain network built with TypeScript and Express. This document explains the core concepts and functionality of the Guard blockchain.

## Core Components

### Blockchain Architecture

Adachain implements a blockchain with the following key features:

- **Proof of Identity (PoI)**: Instead of Proof of Work or Proof of Stake, Guard uses a Proof of Identity consensus mechanism where only verified identities can propose blocks.
- **Finite Supply**: The blockchain has a maximum supply of 21,000,000 coins.
- **Block Rewards**: Block proposers receive rewards that halve every 210,000 blocks.
- **Transaction Fees**: All transactions require a minimum fee to be included in a block.

### Network Communication

The blockchain uses a peer-to-peer network for node communication with the following event types:

- Initial Block Download (IBD) for syncing new nodes
- Transaction broadcasting
- Block proposal and propagation
- Identity verification

## Data Structures

### Transaction

Each transaction contains:

- `fromAddress`: Sender's public key
- `toAddress`: Recipient's public key
- `amount`: Transaction amount
- `fee`: Transaction fee
- `timestamp`: Time of creation
- `signature`: Digital signature proving ownership

### Block

Each block contains:

- `previousHash`: Hash of the previous block
- `timestamp`: Block creation time
- `transactions`: Array of transactions
- `proposer`: Address of the block proposer
- `hash`: Hash of the block contents

### Blockchain

The blockchain manages:

- Block chain with genesis block
- Account balances and transaction processing
- Verified identities for block proposal
- Banned addresses for security

## Core Functions

### Transaction Processing

1. Transactions are signed using elliptic curve cryptography (secp256k1)
2. Transactions are validated for:
   - Valid signature
   - Sufficient funds
   - Minimum transaction fee
   - Sender not banned
3. Valid transactions are added to the mempool
4. Transactions in the mempool are grouped into blocks of 10

### Block Creation

1. A proposer is selected from verified identities
2. The proposer creates a block with up to 10 transactions
3. The proposer receives block rewards and transaction fees
4. The new block is broadcast to the network

### Identity Verification

1. Users pay a fee to register their identity
2. Verified identities gain the ability to propose blocks
3. This ensures only identified participants can create blocks

### Consensus and Synchronization

1. Nodes validate all incoming blocks and transactions
2. New nodes perform Initial Block Download to sync with the network
3. The longest valid chain is considered the main chain
4. Nodes can force-sync with specific peers if needed

## API Endpoints

The blockchain exposes several REST API endpoints:

- `/transaction`: Create and broadcast a new transaction
- `/wallet/create`: Generate a new wallet (public/private key pair)
- `/balance/:address`: Get the balance of an address
- `/chain/info`: Get information about the blockchain
- `/genesis`: Create the genesis block with initial distribution
- `/identity/add`: Register an identity
- `/choose-proposer`: Select a proposer for the next block
- `/sync`: Trigger manual blockchain synchronization

## Getting Started

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in `.env`:
   - `PORT`: Server port
   - `MY_ADDRESS`: Your node's address
   - `BOOTSTRAP_PEERS`: Comma-separated list of peer URLs

### Running a Node

```bash
npm start
```

### Creating Genesis Block

To initialize a new blockchain:

```bash
curl -X POST http://localhost:8800/genesis -H "Content-Type: application/json" \
  -d '{"initialSupply": 1000}'
```

### Making Transactions

```bash
curl -X POST http://localhost:8800/transaction -H "Content-Type: application/json" \
  -d '{"fromAddress": "YourPublicKey", "toAddress": "RecipientPublicKey", "amount": 10, "fee": 0.001, "privateKey": "YourPrivateKey"}'
```

## Security Considerations

- **Private Key Safety**: Never share your private key.
- **Transaction Validation**: All transactions are cryptographically verified.
- **Address Banning**: Addresses attempting invalid transactions can be banned.
- **Minimum Fees**: Required to prevent spam transactions.

## Technical Details

- Written in TypeScript
- Uses Express.js for the API server
- Uses elliptic for cryptographic functions
- P2P communication via WebSockets
- REST API for client interactions
