# POU Chain (Proof of Uniqueness)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A next-generation blockchain platform implementing Proof of Uniqueness consensus, focusing on identity verification and sustainable token economics.

## Philosophy & Vision

### Core Principles

1. **Identity-Based Consensus**

   - Replace energy-intensive mining with identity verification
   - Ensure one-person-one-vote through robust identity validation
   - Create a more democratic and sustainable blockchain ecosystem

2. **Economic Sustainability**

   - Fixed maximum supply of 21 million tokens
   - Predictable emission schedule through block rewards
   - Transaction fee model that incentivizes network participation
   - Fair distribution through identity-verified block proposers

3. **Decentralization & Security**
   - Distributed network of identity-verified nodes
   - Protection against Sybil attacks through identity verification
   - Malicious actor prevention through permanent banning
   - Round-robin block proposal system for fair participation

## Technical Architecture

### Consensus Mechanism: Proof of Uniqueness (PoU)

PoU is an innovative consensus mechanism that replaces traditional Proof of Work with identity verification:

1. **Identity Verification**

   - Nodes must verify their identity to participate in block proposal
   - Prevents multiple accounts per individual (Sybil resistance)
   - Creates a democratic one-person-one-vote system

2. **Block Proposal Mechanism**
   ```typescript
   function getNextProposer(chain: Blockchain): string {
     const verifiedProposers = Array.from(chain.verifiedIdentities).sort();
     const currentHeight = chain.chain.length;
     return verifiedProposers[currentHeight % verifiedProposers.length];
   }
   ```
   - Round-robin selection among verified identities
   - Deterministic selection based on block height
   - Equal opportunity for all verified participants

### Economic Model

1. **Token Supply**

   - Maximum supply: 21 million tokens
   - Initial supply: 0 tokens
   - Emission through block rewards

   ```typescript
   private static readonly TOTAL_SUPPLY = 21000000;
   private static readonly BLOCK_REWARD = 50;
   private static readonly HALVING_INTERVAL = 210000;
   ```

2. **Block Rewards**

   - Initial reward: 50 tokens per block
   - Halving every 210,000 blocks
   - Rewards + transaction fees go to block proposer

3. **Transaction Fees**
   - Minimum fee: 0.001 tokens
   - Prevents spam transactions
   - Incentivizes block proposal participation

### Network Architecture

1. **P2P Communication**

   - Mesh protocol for decentralized communication
   - Automatic peer discovery
   - Resilient network topology

2. **Chain Synchronization**
   - Initial Block Download (IBD) protocol
   - Longest chain selection
   - State verification and validation

## Core Components

### 1. Block Structure

```typescript
class Block {
  previousHash: string;
  timestamp: number;
  transactions: Transaction[];
  proposer: string;
  signature?: string;
  hash: string;
}
```

### 2. Transaction Structure

```typescript
class Transaction {
  fromAddress: string;
  toAddress: string;
  amount: number;
  timestamp: number;
  signature?: string;
  fee: number;
}
```

### 3. Account Model

```typescript
interface Account {
  address: string;
  balance: number;
  nonce: number;
}
```

## API Reference

### Wallet Operations

```http
POST /wallet/create
# Creates new wallet with keypair
```

Response:

```json
{
  "address": "public_key_hex",
  "privateKey": "private_key_hex",
  "balance": 0,
  "message": "Wallet created successfully"
}
```

### Transaction Operations

```http
POST /transaction
# Submit new transaction
```

Body:

```json
{
  "fromAddress": "sender_public_key",
  "toAddress": "recipient_public_key",
  "amount": number,
  "signature": "transaction_signature",
  "fee": number
}
```

### Network Information

```http
GET /supply
# Retrieves token supply information
Response: {
  "maxSupply": 21000000,
  "currentSupply": number,
  "blockReward": number,
  "nextHalvingBlock": number
}

GET /address/status/:address
# Checks if an address is banned
Response: {
  "address": "public_key_hex",
  "status": "active" | "banned",
  "message": string
}
```

## Getting Started

### Prerequisites

- Node.js v14+
- TypeScript 4.x
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/POU-chain.git

# Install dependencies
cd POU-chain
npm install

# Create .env file
echo "MY_ADDRESS=your_node_public_key" > .env
echo "BOOTSTRAP_PEERS=ws://peer1:5500,ws://peer2:5500" >> .env

# Start the node
npm start
```

### Running a Network

1. Start the bootstrap node:

```bash
MY_ADDRESS=node1_public_key npm start
```

2. Start additional nodes:

```bash
MY_ADDRESS=node2_public_key BOOTSTRAP_PEERS=ws://localhost:5500 npm start
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## Economic Model

### Token Distribution

- Initial Supply: 0 tokens
- Maximum Supply: 21 million tokens
- Block Reward: Starts at 50 tokens, halves every 210,000 blocks
- Transaction Fees: Minimum 0.001 tokens per transaction

### Consensus

- Round-robin block proposer selection among verified identities
- Block proposers receive:
  - Block rewards (if below max supply)
  - All transaction fees from the block

## Security Considerations

### Identity Verification

- Nodes must be verified to propose blocks
- Verification prevents Sybil attacks
- Malicious actors are permanently banned

### Transaction Security

- ECDSA signatures using secp256k1
- Double-spend prevention through nonce tracking
- Balance verification before processing

## Future Enhancements

1. Web-based block explorer
2. Governance system for parameter updates
3. Smart contract support
4. Cross-chain bridges
5. Advanced identity verification mechanisms

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)
