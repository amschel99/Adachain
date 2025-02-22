# Blockchain Node Implementation v0

## Overview

This document describes the technical architecture and algorithms implemented in the given Node.js-based blockchain node. The system provides a peer-to-peer (P2P) network for blockchain synchronization and transaction broadcasting. It also includes an HTTP API for managing blockchain interactions.

## Technologies Used

- **Express.js** - REST API server
- **WebSockets (ws)** - P2P communication
- **Node.js** - Backend runtime
- **File System (fs/promises)** - Storing blockchain state
- **dotenv** - Environment variable management

## Core Components

### 1. Blockchain Persistence

- **File Storage**: The blockchain is stored in `blockchain.json`.
- **Read Blockchain**: `readBlockchain()` reads the chain from disk.
- **Write Blockchain**: `writeBlockchain()` saves the chain to disk.
- **Chain Validation**: `validateChain()` ensures the chain’s integrity.

### 2. WebSocket Peer-to-Peer Network

#### WebSocket Server

- Runs on the same port as the HTTP server.
- Listens for connections from peers.
- Manages known peers in an array (`peers`).
- Supports message handling for:
  - **Initial Block Download (IBD)**: Synchronizing new nodes.
  - **Broadcasting transactions**.
  - **Sharing known peers**.

#### WebSocket Client

- Connects to peers on startup.
- Handles peer lifecycle events:
  - **Open**: Requests blockchain info.
  - **Message**: Processes blockchain updates.
  - **Close**: Reconnects to lost peers.

### 3. Blockchain Synchronization (IBD - Initial Block Download)

#### IBD Process

1. A new node requests blockchain data (`IBD_REQUEST`).
2. A peer responds with its blockchain (`IBD_RESPONSE`).
3. The requesting node compares the chains:
   - If the peer’s chain is longer and valid, it replaces its own.

### 4. Peer Management

- **`addPeer(peerUrl)`**: Connects to new peers and maintains the list.
- **`selectBestPeer()`**: Chooses the peer with the longest chain.

### 5. API Endpoints

#### Health Check

- **GET `/health`** - Returns operational status.

#### Blockchain Management

- **POST `/ibd`** - Triggers synchronization with the best peer.
- **POST `/create-chain`** - Initializes a new blockchain.

#### Transaction Handling

- **POST `/signTxn`**
  - Signs a transaction with a private key.
  - Broadcasts it to all connected peers.

### 6. Server Initialization

- HTTP and WebSocket servers start on the specified port.
- On startup, the node connects to predefined bootstrap peers.

## Conclusion

This implementation provides a decentralized blockchain node with networking, synchronization, and transaction handling capabilities using Express.js and WebSockets.
