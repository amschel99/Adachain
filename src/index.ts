import express from "express";
import { PeerManager, Peer, EventHandler } from "mesh-protocol";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Events } from "./events";
import {
  IDENTITY_FEE,
  MASTER_NODE_ADDRESS,
  REQUEST_IBD_TIMEOUT,
} from "./constants";
import { promises as fs } from "fs";
import { Blockchain, Transaction, Block, BlockchainState } from "./blockchain";
import fsPromises from "fs/promises";
import { Request, Response } from "express";
import { ec as EC } from "elliptic";
import { Mempool, Token } from "./types";
import { Server as SocketServer } from "socket.io";
import crypto from "crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8800;

const my_addrr = process.env.MY_ADDRESS;
let manager = new PeerManager(my_addrr);
app.use(cors({ origin: ["http://localhost:3000"] }));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
const httpServer = http.createServer(app);
const wss = manager.getServer();
export const io = new SocketServer(httpServer, {
  path: "/socket.io",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
io.on("connection", (socket) => {
  socket.emit("newConnection", { message: `Hello from ${my_addrr}` });
});

let idbResponses: { chain: any; peer: string }[] = [];

const IBD_COLLECTION_TIMEOUT = 5000;

// Mempool to store pending transactions
let mempool: Mempool = [];
const BLOCK_SIZE = 10; // Number of transactions per block

// Add at the top with other constants
const MINIMUM_TRANSACTION_FEE = 0.001; // Example minimum fee

// Create an instance of the elliptic curve
const ec = new EC("secp256k1");

setInterval(() => {
  console.log(
    `Currently we are connected to ${
      manager.getPeers().length
    } peers which are:`
  );
  manager.getPeers().map((peer: Peer) => {
    console.log(`${peer.url}`);
  });
}, 3000);
wss.on("message", (peer, message) => {
  try {
    const parsed = JSON.parse(message);
    console.log(`Received message from ${peer.url}:`, parsed.event);
  } catch (e) {
    console.log("Could not parse message:", message);
  }
});
manager.registerEvent(Events.NEW_IDENTITY, async (peer: Peer, data: any) => {
  try {
    const { address, timestamp } = data;
    console.log(`Received new identity from ${peer.url}: ${address}`);
    const chain = await loadBlockchainState();
    chain.addVerifiedIdentity(address);
    await saveBlockchainState(chain);
    console.log(`Identity ${address} added to local blockchain`);
  } catch (error) {
    console.error("Error handling new identity:", error);
  }
});

// Add token event handler
manager.registerEvent(Events.NEW_TOKEN, async (peer: Peer, data: any) => {
  try {
    const { token, timestamp } = data;
    console.log(`Received new token from ${peer.url}: ${token.id}`);
    const chain = await loadBlockchainState();

    // Add token to blockchain if it doesn't exist
    if (!Array.from(chain.tokens).find((t) => t.id === token.id)) {
      chain.addToken(token);
      await saveBlockchainState(chain);
      console.log(`Token ${token.id} added to local blockchain`);
    } else {
      console.log(`Token ${token.id} already exists, skipping`);
    }
  } catch (error) {
    console.error("Error handling new token:", error);
  }
});

manager.registerEvent(Events.IBD_REQUEST, async (peer: Peer, data: any) => {
  try {
    console.log(`Received IBD request from ${peer.url}`);
    const blockchainData = await fs.readFile("./blockchain.json", "utf8");
    const state = JSON.parse(blockchainData);

    // Send the complete blockchain state
    peer.send(
      JSON.stringify({
        event: Events.IBD_RESPONSE,
        data: state,
        forceSync: data.forceSync || false,
      })
    );
  } catch (error) {
    console.error("Error handling IBD event:", error);
  }
});
manager.registerEvent(
  Events.SELECTED_PROPOSER,
  async (peer: Peer, data: any) => {
    try {
      const { proposerAddress, wallet_address } = data;
      console.log(`Received proposer selection: ${proposerAddress}`);

      // Check if this node is the selected proposer
      if (proposerAddress === my_addrr) {
        console.log(
          `This node (${my_addrr}) has been selected as the proposer`
        );

        // Find a full block of transactions
        const fullBlock = mempool.find(
          (block) => block.transactions.length === BLOCK_SIZE
        );

        if (fullBlock) {
          // Create and broadcast a new block
          await createAndBroadcastBlock(wallet_address);
        } else {
          console.log("No full blocks in mempool to create a block");
        }
      }
    } catch (error) {
      console.error("Error handling proposer selection:", error);
    }
  }
);

manager.registerEvent(Events.IBD_RESPONSE, async (peer: Peer, data: any) => {
  try {
    console.log(`Received blockchain data from peer: ${peer.url}`);
    const forceSync = data.forceSync || false;

    // If this is a force sync, immediately apply the state
    if (forceSync) {
      console.log("Force sync requested, applying state immediately");
      try {
        const newChain = new Blockchain();
        newChain.loadState(data);

        if (newChain.isChainValid()) {
          console.log(
            "Received blockchain state is valid, replacing local state"
          );
          await saveBlockchainState(newChain);
          console.log(
            `Force synced with ${peer.url}, chain length: ${newChain.chain.length}`
          );
          return;
        } else {
          console.log(
            "Received blockchain state is invalid, rejecting force sync"
          );
        }
      } catch (error) {
        console.error("Error processing force sync:", error);
      }
      return;
    }

    // Add response to collection for normal IBD
    idbResponses.push({
      chain: data,
      peer: peer.url,
    });

    // On first response, start a timer to process all collected responses
    if (idbResponses.length === 1) {
      setTimeout(async () => {
        try {
          let longestChain = null;
          let maxLength = 0;
          let bestState = null;

          // First check local blockchain if it exists
          try {
            const localData = await fsPromises.readFile(
              "./blockchain.json",
              "utf8"
            );
            const localChain = new Blockchain();
            const localState = JSON.parse(localData);

            // Load the complete state, not just the chain
            localChain.loadState(localState);

            if (localChain.isChainValid()) {
              console.log(
                "Local chain is valid with length:",
                localChain.chain.length
              );
              maxLength = localChain.chain.length;
              longestChain = localChain.chain;
              bestState = localState;
            } else {
              console.log("Local chain is invalid, will consider peer chains");
            }
          } catch (err) {
            console.log("No local blockchain.json found or invalid format");
          }

          for (const response of idbResponses) {
            const tempChain = new Blockchain();

            // Load the complete state from the response
            tempChain.loadState(response.chain);

            if (tempChain.isChainValid()) {
              console.log(
                `Valid chain from ${response.peer} with length ${tempChain.chain.length}`
              );

              if (tempChain.chain.length > maxLength) {
                maxLength = tempChain.chain.length;
                bestState = response.chain;
                console.log(
                  `Found longer valid chain from ${response.peer} with length ${maxLength}`
                );
              }
            } else {
              console.log(`Received invalid chain from ${response.peer}`);
            }
          }

          // Save the longest valid chain if it's different from local
          if (bestState) {
            await fsPromises.writeFile(
              "./blockchain.json",
              JSON.stringify(bestState, null, 2)
            );
            console.log(`Saved longest chain with ${maxLength} blocks`);
          } else {
            console.log(
              "Keeping existing local chain as it is the longest valid chain"
            );
          }

          // Clear responses for next IBD
          idbResponses = [];
        } catch (error) {
          console.error("Error processing IBD responses:", error);
        }
      }, IBD_COLLECTION_TIMEOUT);
    }
  } catch (error) {
    console.error("Error handling IBD response:", error);
  }
});

function requestIBD() {
  // Clear any existing responses
  idbResponses = [];

  const payload = {
    requestingAddress: my_addrr,
    timestamp: Date.now(),
    type: "INITIAL_BLOCK_REQUEST",
  };

  const peers = manager.getPeers();
  if (peers.length === 0) {
    console.log("No peers connected, cannot request IBD");
    return;
  }

  manager.broadcast(Events.IBD_REQUEST, payload);
  console.log(`Broadcasted IBD request to ${peers.length} peers`);
}

// Add an endpoint to manually trigger IBD
app.post("/sync", async (req: express.Request, res: express.Response) => {
  try {
    requestIBD();
    res.json({
      success: true,
      message: "IBD request broadcasted to all peers",
      peers: manager.getPeers().length,
    });
  } catch (error) {
    console.error("Error triggering IBD:", error);
    res.status(500).json({
      error: "Failed to trigger IBD",
      details: error.message,
    });
  }
});

// Add an endpoint to force sync with a specific peer
app.post("/force-sync", async (req: express.Request, res: express.Response) => {
  try {
    const { peerUrl } = req.body;

    if (!peerUrl) {
      res.status(400).json({ error: "peerUrl is required" });
      return;
    }

    // Find the peer in our connections
    const peers = manager.getPeers();
    const targetPeer = peers.find((p: Peer) => p.url === peerUrl);

    if (!targetPeer) {
      // Try to connect to the peer if not already connected
      try {
        await manager.addPeer(peerUrl);
        console.log(`Connected to peer ${peerUrl}`);
      } catch (connError) {
        res.status(404).json({
          error: "Peer not found and could not connect",
          details: connError.message,
        });
        return;
      }
    }

    // Clear existing responses
    idbResponses = [];

    // Send IBD request to the specific peer
    const payload = {
      requestingAddress: my_addrr,
      timestamp: Date.now(),
      type: "INITIAL_BLOCK_REQUEST",
      forceSync: true,
    };

    if (targetPeer) {
      targetPeer.send(
        JSON.stringify({
          event: Events.IBD_REQUEST,
          data: payload,
        })
      );

      res.json({
        success: true,
        message: `Force sync request sent to ${peerUrl}`,
      });
    } else {
      // If we just connected, broadcast to all peers
      manager.broadcast(Events.IBD_REQUEST, payload);
      res.json({
        success: true,
        message: `Connected to ${peerUrl} and broadcast sync request`,
      });
    }
  } catch (error) {
    console.error("Error forcing sync:", error);
    res.status(500).json({
      error: "Failed to force sync",
      details: error.message,
    });
  }
});

// Add an endpoint to get blockchain info
app.get("/chain/info", async (req: express.Request, res: express.Response) => {
  try {
    const chain = await loadBlockchainState();
    res.json({
      height: chain.chain.length,
      latestBlockHash: chain.getLatestBlock().hash,
      accounts: chain.accounts.size,
      currentSupply: chain.currentSupply,
      peers: manager.getPeers().length,
      fee: MINIMUM_TRANSACTION_FEE,
    });
  } catch (error) {
    console.error("Error getting chain info:", error);
    res.status(500).json({
      error: "Failed to get chain info",
      details: error.message,
    });
  }
});

httpServer.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

async function loadBlockchainState(): Promise<Blockchain> {
  try {
    const data = await fs.readFile("./blockchain.json", "utf8");
    const state = JSON.parse(data);

    // Validate that the state has the expected structure
    if (!state || !state.chain || !Array.isArray(state.chain)) {
      console.error("Invalid blockchain state format");
      return new Blockchain();
    }

    const blockchain = new Blockchain();

    try {
      blockchain.loadState(state);

      // Verify the loaded chain is valid
      if (!blockchain.isChainValid()) {
        console.error("Loaded blockchain is invalid, creating new one");
        return new Blockchain();
      }

      console.log(`Loaded blockchain with ${blockchain.chain.length} blocks`);
      return blockchain;
    } catch (loadError) {
      console.error("Error loading blockchain state:", loadError.message);
      return new Blockchain();
    }
  } catch (error) {
    console.log("Creating new blockchain");
    return new Blockchain();
  }
}

async function saveBlockchainState(chain: Blockchain) {
  try {
    // Serialize the blockchain state
    const state = chain.serializeState();

    // Create a backup of the current blockchain file if it exists
    try {
      const exists = await fs
        .access("./blockchain.json")
        .then(() => true)
        .catch(() => false);

      if (exists) {
        await fs.copyFile(
          "./blockchain.json",
          `./blockchain_backup_${Date.now()}.json`
        );
      }
    } catch (backupError) {
      console.error("Failed to create blockchain backup:", backupError.message);
    }

    // Write the new state to the blockchain file
    await fs.writeFile("./blockchain.json", JSON.stringify(state, null, 2));

    console.log(`Saved blockchain state with ${chain.chain.length} blocks`);
  } catch (error) {
    console.error("Error saving blockchain state:", error.message);
    throw error; // Re-throw to allow calling code to handle the error
  }
}

// Add this function to handle adding transactions to the mempool
function addTransactionToMempool(tx: Transaction): void {
  // Check if there's an existing block with space for more transactions
  const availableBlock = mempool.find(
    (block) => block.transactions.length < BLOCK_SIZE
  );

  if (availableBlock) {
    // Add transaction to existing block
    availableBlock.transactions.push(tx);
    console.log(
      `Added transaction to existing block, now has ${availableBlock.transactions.length}/${BLOCK_SIZE} transactions`
    );
  } else {
    // Create a new block with this transaction
    const newBlock = {
      id: Date.now().toString(), // Use timestamp as unique ID
      transactions: [tx],
    };
    mempool.push(newBlock);
    console.log(
      `Created new transaction block, now has 1/${BLOCK_SIZE} transactions`
    );
  }
}

// Update transaction handler
manager.registerEvent(
  Events.NEW_TRANSACTION,
  async (peer: Peer, txData: any) => {
    try {
      const chain = await loadBlockchainState();
      console.log(`Received a new transaction`);

      let tx: Transaction;
      if (typeof txData.isValid === "function") {
        tx = txData;
      } else {
        tx = new Transaction(
          txData.fromAddress,
          txData.toAddress,
          txData.amount,
          txData.fee,
          txData.timestamp,
          txData.message
        );
        tx.signature = txData.signature;
      }

      if (tx.toAddress === MASTER_NODE_ADDRESS) {
        if (tx.amount !== IDENTITY_FEE) {
          console.log("Invalid identity transaction amount");
          return;
        }
      }

      // Check if sender is banned
      if (chain.isAddressBanned(tx.fromAddress)) {
        console.log(
          `Rejected transaction from banned address: ${tx.fromAddress}`
        );
        return;
      }

      // Fee validation
      if (!tx.fee || tx.fee < MINIMUM_TRANSACTION_FEE) {
        console.log(`Rejected transaction with insufficient fee: ${tx.fee}`);
        // Ban address for trying to cheat fees
        // chain.banAddress(tx.fromAddress);
        await saveBlockchainState(chain);
        return;
      }

      // Validate signature
      try {
        if (!tx.isValid()) {
          console.log(`Invalid transaction signature from ${tx.fromAddress}`);
          console.log(`Hash used for verification: ${tx.calculateHash()}`);
          // chain.banAddress(tx.fromAddress);
          await saveBlockchainState(chain);
          return;
        }
      } catch (error) {
        console.log(
          `Signature verification failed, ${tx.fromAddress}`,
          error.message
        );
        // chain.banAddress(tx.fromAddress);
        await saveBlockchainState(chain);
        return;
      }

      // Check balance
      const sender = chain.getAccount(tx.fromAddress);
      if (!sender || sender.balance < tx.amount + tx.fee) {
        console.log(`Insufficient funds for address ${tx.fromAddress}`);
        // Optional: Ban for attempting to spend more than they have
        chain.banAddress(tx.fromAddress);
        await saveBlockchainState(chain);
        return;
      }

      // If all validations pass, add to mempool
      // Check if transaction already exists in any block in the mempool
      const txHash = tx.calculateHash();

      // Check if this transaction already exists in any block
      let txExists = false;
      for (const block of mempool) {
        for (const existingTx of block.transactions) {
          if (existingTx.calculateHash() === txHash) {
            txExists = true;
            break;
          }
        }
        if (txExists) break;
      }

      if (!txExists) {
        addTransactionToMempool(tx);
      }
    } catch (error) {
      console.error("Error processing transaction:", error);
    }
  }
);

// Update createAndBroadcastBlock to use the new mempool structure
async function createAndBroadcastBlock(wallet_address: string) {
  try {
    const chain = await loadBlockchainState();

    console.log("We are the current proposer, creating block...");

    // Find a full block of transactions
    const fullBlock = mempool.find(
      (block) => block.transactions.length === BLOCK_SIZE
    );

    if (!fullBlock) {
      console.log("No full blocks available to create a block");
      return;
    }

    const blockTransactions = fullBlock.transactions;

    // Calculate total fees from transactions
    const totalFees = blockTransactions.reduce((sum, tx) => sum + tx.fee, 0);

    const lastBlock = chain.getLatestBlock();
    const newBlock = new Block(
      Date.now(),
      blockTransactions,
      lastBlock.hash,
      wallet_address
    );

    // Process all transactions in the block
    for (const tx of blockTransactions) {
      chain.processTransaction(tx);
    }

    // Update chain with new block
    chain.chain.push(newBlock);

    // Mint block reward and distribute fees to proposer
    chain.mintBlockReward(wallet_address, totalFees);

    await saveBlockchainState(chain);

    // Create a serializable payload for broadcasting
    let payload = {
      block: {
        timestamp: newBlock.timestamp,
        transactions: newBlock.transactions,
        previousHash: newBlock.previousHash,
        proposer: newBlock.proposer,
        hash: newBlock.hash,
      },
      block_id: fullBlock.id,
    };

    console.log(`Broadcasting new block with hash: ${newBlock.hash}`);
    console.log(`Previous hash: ${newBlock.previousHash}`);

    // Broadcast the new block
    manager.broadcast(Events.NEW_BLOCK, payload);

    // Remove used transactions from mempool
    mempool = mempool.filter((block) => block.id !== fullBlock.id);
    console.log("Created and broadcast new block");

    // Also broadcast each wallet individually to ensure they're properly registered
    const createdAccounts = [{ address: wallet_address, amount: totalFees }];

    createdAccounts.forEach((account) => {
      const walletData = {
        address: account.address,
        timestamp: Date.now(),
      };

      manager.broadcast(WALLET_EVENTS.NEW_WALLET, walletData);
      console.log(`Broadcasted genesis wallet: ${account.address}`);
    });
  } catch (error) {
    console.error("Error creating block:", error);
  }
}

// Handle incoming blocks from peers
manager.registerEvent(Events.NEW_BLOCK, async (peer: Peer, payload: any) => {
  try {
    console.log(`Received new block from peer: ${peer.peerUrl}`);
    const chain = await loadBlockchainState();
    const { block, block_id, isGenesis, completeState } = payload;

    // Validate block
    const newBlock = new Block(
      block.timestamp,
      block.transactions,
      block.previousHash,
      block.proposer
    );

    // Copy the hash from the received block to ensure consistency
    newBlock.hash = block.hash;

    // For genesis blocks or special cases
    if (isGenesis) {
      console.log("Received genesis block, validating...");

      // If we received a complete state with the genesis block, use it
      if (completeState) {
        console.log("Received complete blockchain state with genesis block");

        // Create a new blockchain instance and load the complete state
        const newChain = new Blockchain();
        newChain.loadState(completeState);

        // Validate the received state
        if (newChain.isChainValid()) {
          console.log(
            "Received blockchain state is valid, replacing local state"
          );
          await saveBlockchainState(newChain);
          console.log("Genesis block and complete state accepted and saved");
        } else {
          console.log("Received blockchain state is invalid, rejecting");
        }
        return;
      }

      // If we only received the genesis block without state
      if (chain.chain.length <= 1 && chain.chain[0].hash !== newBlock.hash) {
        // Replace the genesis block
        chain.chain = [newBlock];
        await saveBlockchainState(chain);
        console.log("Genesis block accepted and saved (without state)");
      } else {
        console.log("Genesis block rejected - chain already initialized");
      }
      return;
    }

    // Get the latest block in our chain
    const latestBlock = chain.getLatestBlock();
    console.log(`Our latest block hash: ${latestBlock.hash}`);
    console.log(`New block previous hash: ${newBlock.previousHash}`);
    console.log(`New block hash: ${newBlock.hash}`);

    // Verify block is valid and links to our chain
    if (newBlock.previousHash === latestBlock.hash) {
      if (newBlock.isValidBlock()) {
        console.log("Block is valid and links to our chain");

        // Calculate total fees
        const totalFees = newBlock.transactions.reduce(
          (sum, tx) => sum + (tx.fee || 0),
          0
        );

        // Add block to chain
        chain.chain.push(newBlock);

        // Process all transactions in the block
        for (const tx of newBlock.transactions) {
          chain.processTransaction(tx);
        }

        // Mint block reward to the proposer
        chain.mintBlockReward(newBlock.proposer, totalFees);

        await saveBlockchainState(chain);
        console.log(`Added new block #${chain.chain.length - 1} to chain`);

        // Calculate hashes of all transactions in the new block
        const blockTxHashes = newBlock.transactions.map((tx) => {
          // Create a Transaction object only for hash calculation
          const txObj = new Transaction(
            tx.fromAddress,
            tx.toAddress,
            tx.amount,
            tx.fee,
            tx.timestamp // Pass the timestamp to preserve the hash
          );
          return txObj.calculateHash();
        });

        // Remove transactions from mempool that are included in the new block
        // We need to check all transactions in each mempool block
        const updatedMempool = [];

        for (const mempoolBlock of mempool) {
          // Filter out transactions that are in the new block
          const remainingTransactions = mempoolBlock.transactions.filter(
            (tx) => !blockTxHashes.includes(tx.calculateHash())
          );

          // If there are remaining transactions, keep this block with the filtered transactions
          if (remainingTransactions.length > 0) {
            updatedMempool.push({
              id: mempoolBlock.id,
              transactions: remainingTransactions,
            });
          }
          // If no transactions remain, this block is completely removed
        }

        // Update mempool with filtered blocks
        mempool = updatedMempool;

        console.log("Added new block to chain and updated mempool");
      } else {
        console.log("Block validation failed");
      }
    } else {
      console.log("Block does not link to our chain, requesting IBD");
      // If the block doesn't link to our chain, we might be out of sync
      // Request an IBD to get the latest chain
      requestIBD();
    }
  } catch (error) {
    console.error("Error processing new block:", error);
  }
});

app.post(
  "/transaction",
  async (req: express.Request, res: express.Response) => {
    try {
      const { fromAddress, toAddress, amount, fee, privateKey, message } =
        req.body;

      // Debug: Check if the provided private key generates the expected public key
      if (privateKey) {
        const keyPair = ec.keyFromPrivate(privateKey);
        const derivedPublicKey = keyPair.getPublic("hex");

        console.log("Provided fromAddress:", fromAddress);
        console.log("Derived public key:", derivedPublicKey);

        if (fromAddress !== derivedPublicKey) {
          res.status(400).json({
            error: "Private key does not match fromAddress",
            providedAddress: fromAddress,
            derivedAddress: derivedPublicKey,
          });
          return; // Only return if keys don't match
        }
      }

      if (!fee || fee < MINIMUM_TRANSACTION_FEE) {
        res.status(400).json({
          error: `Transaction fee must be at least ${MINIMUM_TRANSACTION_FEE}`,
        });
        return;
      }

      // Create transaction with a fixed timestamp for consistent hashing
      const timestamp = Date.now();
      const transaction = new Transaction(
        fromAddress,
        toAddress,
        amount,
        fee,
        timestamp,
        message
      );

      // Sign the transaction if privateKey is provided
      if (privateKey) {
        try {
          const keyPair = ec.keyFromPrivate(privateKey);
          transaction.sign(keyPair);

          // Verify our own signature before broadcasting
          if (!transaction.isValid()) {
            throw new Error("Transaction verification failed locally");
          }

          console.log(
            "Transaction hash for signing:",
            transaction.calculateHash()
          );
          console.log("Signature created:", transaction.signature);
        } catch (error) {
          res.status(400).json({
            error: "Invalid private key or signing failed",
            details: error.message,
          });
          return;
        }
      } else if (!transaction.signature) {
        res.status(400).json({
          error:
            "Transaction must be signed. Please provide privateKey or signature",
        });
        return;
      }

      // Check if transaction already exists in mempool
      const txHash = transaction.calculateHash();
      let txExists = false;
      for (const block of mempool) {
        for (const existingTx of block.transactions) {
          if (existingTx.calculateHash() === txHash) {
            txExists = true;
            break;
          }
        }
        if (txExists) break;
      }

      if (!txExists) {
        // Add to mempool
        addTransactionToMempool(transaction);

        // Broadcast the transaction as a plain object to ensure consistent serialization
        manager.broadcast(Events.NEW_TRANSACTION, {
          fromAddress: transaction.fromAddress,
          toAddress: transaction.toAddress,
          amount: transaction.amount,
          fee: transaction.fee,
          timestamp: transaction.timestamp,
          signature: transaction.signature,
          message: transaction.message,
        });
      } else {
        console.log("Transaction already exists in mempool, not adding again");
      }

      res.json({
        success: true,
        transaction: {
          fromAddress: transaction.fromAddress,
          toAddress: transaction.toAddress,
          amount: transaction.amount,
          fee: transaction.fee,
          signature: transaction.signature,
          timestamp: transaction.timestamp,
          message: transaction.message,
        },
        message: "Transaction broadcast to network",
        hash: transaction.calculateHash(),
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to process transaction",
        details: error.message,
      });
    }
  }
);

app.post("/choose-proposer", async (req: Request, res: Response) => {
  const { address, wallet_address } = req.body;
  if (!address || !wallet_address) {
    res
      .status(400)
      .json(`Bad request, address  and wallet address is required`);
    return;
  }
  try {
    if (address === my_addrr) {
      const fullBlock = mempool.find(
        (block) => block.transactions.length === BLOCK_SIZE
      );

      if (fullBlock) {
        // Create and broadcast a new block
        await createAndBroadcastBlock(wallet_address);
        res
          .status(200)
          .json(
            `Proposer ${address} has been selected and broadcasted to the network`
          );
        return;
      } else {
        res
          .status(400)
          .json(
            `This node was selected but it has no full blocks in the mempool to create a block`
          );
        console.log("No full blocks in mempool to create a block");
        return;
      }
    } else {
      manager.broadcast(Events.SELECTED_PROPOSER, {
        proposerAddress: address,
        wallet_address: wallet_address,
      });

      console.log(`Broadcast proposer selection: ${address}`);
      res.status(200).json({
        message: `Proposer ${address} has been selected and broadcast to network`,
      });
    }
  } catch (e) {
    console.error("Error selecting proposer:", e);
    res.status(500).json({ error: `Failed to select proposer: ${e.message}` });
  }
});
app.get(
  "/balance/:address",
  async (req: express.Request, res: express.Response) => {
    try {
      const chain = await loadBlockchainState();
      const account = chain.getAccount(req.params.address);

      if (!account) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      res.json({
        address: account.address,
        balance: account.balance,
        nonce: account.nonce,
      });
      return;
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  }
);

// Add a new event for wallet creation
const WALLET_EVENTS = {
  NEW_WALLET: "NEW_WALLET",
};

// Now modify the wallet creation endpoint to broadcast the new wallet
app.post(
  "/wallet/create",
  async (req: express.Request, res: express.Response) => {
    try {
      const chain = await loadBlockchainState();

      // Generate key pair using the instance method, not the class method
      const key = ec.genKeyPair();
      const publicKey = key.getPublic("hex");
      const privateKey = key.getPrivate("hex");

      // Create the account in our local state
      chain.createAccount(publicKey);
      await saveBlockchainState(chain);

      // Broadcast the new wallet to all peers
      const walletData = {
        address: publicKey,
        timestamp: Date.now(),
      };

      manager.broadcast(WALLET_EVENTS.NEW_WALLET, walletData);
      console.log(`Broadcasted new wallet creation: ${publicKey}`);

      res.json({
        address: publicKey,
        privateKey: privateKey,
        balance: 0,
        message: "Wallet created successfully and broadcasted to network",
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error });
    }
  }
);

// Add an event handler for the new wallet event
manager.registerEvent(
  WALLET_EVENTS.NEW_WALLET,
  async (peer: Peer, data: any) => {
    try {
      const { address, timestamp } = data;
      console.log(
        `Received new wallet from peer ${peer.url || peer.peerUrl}: ${address}`
      );

      const chain = await loadBlockchainState();

      // Check if the wallet already exists
      if (chain.getAccount(address)) {
        console.log(`Wallet ${address} already exists, skipping creation`);
        return;
      }

      // Create the account
      chain.createAccount(address);

      // Save the updated blockchain state
      await saveBlockchainState(chain);

      console.log(`Added new wallet from peer: ${address}`);

      // Acknowledge receipt by sending back a confirmation
      try {
        peer.send(
          JSON.stringify({
            event: "WALLET_CONFIRMATION",
            data: {
              address,
              received: true,
              timestamp: Date.now(),
            },
          })
        );
      } catch (ackError) {
        console.log(`Could not send wallet confirmation: ${ackError.message}`);
      }
    } catch (error) {
      console.error("Error handling new wallet event:", error);
    }
  }
);

// Register a confirmation handler to track wallet propagation
manager.registerEvent("WALLET_CONFIRMATION", (peer: Peer, data: any) => {
  console.log(
    `Peer ${peer.url || peer.peerUrl} confirmed wallet ${data.address} receipt`
  );
});

app.get(
  "/address/status/:address",
  async (req: express.Request, res: express.Response) => {
    try {
      const chain = await loadBlockchainState();
      const isBanned = chain.isAddressBanned(req.params.address);

      res.json({
        address: req.params.address,
        status: isBanned ? "banned" : "active",
        message: isBanned
          ? "This address has been banned for malicious behavior"
          : "Address is in good standing",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check address status" });
    }
  }
);

app.get("/supply", async (req: express.Request, res: express.Response) => {
  try {
    const chain = await loadBlockchainState();
    res.json({
      // maxSupply: 21000000,
      currentSupply: chain.getCurrentSupply(),
      blockReward: chain.getCurrentBlockReward(),
      nextHalvingBlock: Math.ceil(chain.chain.length / 210000) * 210000,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch supply info" });
  }
});

app.get(
  "/transaction/:hash",
  async (req: express.Request, res: express.Response) => {
    try {
      const txHash = req.params.hash;
      const chain = await loadBlockchainState();

      // First check the blockchain for the transaction
      let foundTx = null;
      let blockHeight = null;
      let confirmations = 0;

      // Search through all blocks in the chain
      for (let i = 0; i < chain.chain.length; i++) {
        const block = chain.chain[i];

        // Search through transactions in this block
        for (const tx of block.transactions) {
          // Create a Transaction object to calculate the hash
          const txObj = new Transaction(
            tx.fromAddress,
            tx.toAddress,
            tx.amount,
            tx.fee,
            tx.timestamp
          );

          // If signature exists, copy it to ensure hash calculation is accurate
          if (tx.signature) {
            txObj.signature = tx.signature;
          }

          if (txObj.calculateHash() === txHash) {
            foundTx = tx;
            blockHeight = i;
            confirmations = chain.chain.length - i;
            break;
          }
        }

        if (foundTx) break;
      }

      // If not found in blockchain, check mempool
      if (!foundTx) {
        for (const block of mempool) {
          for (const tx of block.transactions) {
            if (tx.calculateHash() === txHash) {
              foundTx = tx;
              confirmations = 0; // 0 confirmations for mempool transactions
              break;
            }
          }
          if (foundTx) break;
        }
      }

      if (foundTx) {
        // Return the transaction with additional metadata
        res.json({
          transaction: {
            fromAddress: foundTx.fromAddress,
            toAddress: foundTx.toAddress,
            amount: foundTx.amount,
            fee: foundTx.fee,
            timestamp: foundTx.timestamp,
            signature: foundTx.signature,
            hash: txHash,
          },
          status: confirmations > 0 ? "confirmed" : "pending",
          confirmations,
          blockHeight,
          inMempool: confirmations === 0,
        });
      } else {
        res.status(404).json({ error: "Transaction not found" });
      }
    } catch (error) {
      console.error("Error fetching transaction:", error);
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  }
);

// Add an endpoint to mint the genesis block
app.post("/genesis", async (req: express.Request, res: express.Response) => {
  try {
    // Check if a genesis lock file exists to prevent multiple genesis creations
    try {
      await fs.access("./genesis.lock");
      res.status(400).json({
        error: "Genesis block has already been created on this node",
        message: "To reset the blockchain, use the /reset endpoint first",
      });
      return;
    } catch (lockError) {
      // Lock file doesn't exist, we can proceed
    }

    // Check if blockchain already exists
    let chain: Blockchain;

    try {
      chain = await loadBlockchainState();

      if (chain.chain.length > 1) {
        res.status(400).json({
          error: "Genesis block already exists",
          currentHeight: chain.chain.length,
        });
        return;
      }
    } catch (error) {
      console.log("Creating new blockchain for genesis block");
      chain = new Blockchain();
      chain.chain = [];
    }

    const ec = new EC("secp256k1");
    const keyPair = ec.genKeyPair();
    const privateKey = keyPair.getPrivate("hex");
    const publicKey = keyPair.getPublic("hex");

    const genesisAddress = publicKey;

    const { initialDistribution, initialSupply = 1000 } = req.body;

    const genesisBlock = new Block(Date.now(), [], "0", genesisAddress);

    chain.chain = [genesisBlock]; // Replace the chain with just the genesis block

    // Create the genesis account
    chain.createAccount(genesisAddress, initialSupply);
    chain.currentSupply = initialSupply;

    // Create accounts for initial distribution
    const createdAccounts = [
      { address: genesisAddress, amount: initialSupply },
    ];

    if (initialDistribution && Array.isArray(initialDistribution)) {
      for (const distribution of initialDistribution) {
        if (distribution.address && distribution.amount) {
          chain.createAccount(distribution.address, distribution.amount);
          chain.currentSupply += distribution.amount;
          createdAccounts.push({
            address: distribution.address,
            amount: distribution.amount,
          });
        }
      }
    }

    chain.addVerifiedIdentity(genesisAddress);

    await saveBlockchainState(chain);

    // Create a lock file to prevent multiple genesis creations
    try {
      await fs.writeFile(
        "./genesis.lock",
        JSON.stringify({
          timestamp: Date.now(),
          genesisHash: genesisBlock.hash,
        })
      );
    } catch (lockError) {
      console.warn("Could not create genesis lock file:", lockError.message);
    }

    // Broadcast the complete blockchain state, not just the genesis block
    const completeState = chain.serializeState();

    manager.broadcast(Events.NEW_BLOCK, {
      block: genesisBlock,
      isGenesis: true,
      completeState: completeState, // Include the complete state
    });

    // Also broadcast each wallet individually to ensure they're properly registered
    createdAccounts.forEach((account) => {
      const walletData = {
        address: account.address,
        timestamp: Date.now(),
      };

      manager.broadcast(WALLET_EVENTS.NEW_WALLET, walletData);
      console.log(`Broadcasted genesis wallet: ${account.address}`);
    });

    try {
      await fs.writeFile(
        "./genesis_credentials.json",
        JSON.stringify(
          {
            privateKey,
            publicKey: genesisAddress,
            timestamp: Date.now(),
          },
          null,
          2
        )
      );
      console.log("Genesis credentials saved to file");
    } catch (error) {
      console.error(
        "Warning: Failed to save genesis credentials to file",
        error
      );
    }

    res.status(201).json({
      message: "Genesis block created successfully",
      block: {
        index: 0,
        timestamp: genesisBlock.timestamp,
        hash: genesisBlock.hash,
        previousHash: genesisBlock.previousHash,
        proposer: genesisAddress,
      },
      genesisProposer: {
        address: genesisAddress,
        privateKey: privateKey, // Include the private key in the response
        initialBalance: initialSupply,
      },
      initialDistribution: createdAccounts,
      totalSupply: chain.currentSupply,
      warning:
        "IMPORTANT: Save the private key securely. It will not be shown again.",
    });
  } catch (error) {
    console.error("Error creating genesis block:", error);
    res.status(500).json({ error: "Failed to create genesis block" });
  }
});
app.post("/identity/add", async (req: Request, res: Response) => {
  const { address, privateKey } = req.body;
  if (!address || !privateKey) {
    res.status(400).json({ error: `Address and privateKey are required` });
    return;
  }

  try {
    const chain = await loadBlockchainState();

    const identityTx = new Transaction(
      address,
      MASTER_NODE_ADDRESS,
      1,
      MINIMUM_TRANSACTION_FEE,
      Date.now()
    );

    try {
      const keyPair = ec.keyFromPrivate(privateKey);
      const publicKey = keyPair.getPublic("hex");

      if (publicKey !== address) {
        res
          .status(400)
          .json({ error: "Private key does not match the provided address" });
        return;
      }

      identityTx.sign(keyPair);
    } catch (error) {
      res.status(400).json({ error: "Invalid private key or signing failed" });
      return;
    }

    const senderAccount = chain.getAccount(address);
    if (!senderAccount || senderAccount.balance < MINIMUM_TRANSACTION_FEE) {
      res.status(400).json({
        error: "Insufficient balance for identity registration fee",
        required: MINIMUM_TRANSACTION_FEE,
        current: senderAccount?.balance || 0,
      });
      return;
    }

    addTransactionToMempool(identityTx);

    chain.addVerifiedIdentity(address);

    // Create a token for the user
    const tokenId = crypto.createHash("sha256").update(address).digest("hex");
    const tokenHash = identityTx.calculateHash();
    const newToken: Token = {
      id: tokenId,
      value: 1,
      hash: tokenHash,
      owner: address,
      createdAt: new Date(),
    };

    // Add token to blockchain
    if (chain.addToken(newToken)) {
      // Broadcast token creation event
      manager.broadcast(Events.NEW_TOKEN, {
        token: newToken,
        timestamp: Date.now(),
      });
    }

    await saveBlockchainState(chain);

    manager.broadcast(Events.NEW_IDENTITY, {
      address,
      timestamp: Date.now(),
      txHash: identityTx.calculateHash(),
    });

    res.json({
      success: true,
      message: `Identity ${address} registration initiated`,
      transaction: {
        hash: identityTx.calculateHash(),
        fee: MINIMUM_TRANSACTION_FEE,
      },
      token: {
        id: crypto.createHash("sha256").update(address).digest("hex"),
        value: 1,
        utility: `Block proposal, 1 token, 1 vote`,
        hash: identityTx.calculateHash(),
      },
    });
  } catch (e) {
    res.status(500).json({ error: `Error adding identity: ${e.message}` });
    return;
  }
});

app.post("/reset", async (req: express.Request, res: express.Response) => {
  try {
    const { confirmation } = req.body;

    if (confirmation !== "CONFIRM_RESET") {
      res.status(400).json({
        error: "Reset requires confirmation",
        message:
          'Include { "confirmation": "CONFIRM_RESET" } in the request body',
      });
      return;
    }

    // Create a new blockchain
    const newChain = new Blockchain();

    // Save it
    await saveBlockchainState(newChain);

    // Clear mempool
    mempool = [];

    // Clear IBD responses
    idbResponses = [];

    // Remove the genesis lock file if it exists
    try {
      await fs.unlink("./genesis.lock");
      console.log("Removed genesis lock file");
    } catch (unlinkError) {
      // File might not exist, that's okay
    }

    res.json({
      success: true,
      message: "Blockchain reset to genesis state",
      newState: newChain.serializeState(),
    });
  } catch (error) {
    console.error("Error resetting blockchain:", error);
    res.status(500).json({
      error: "Failed to reset blockchain",
      details: error.message,
    });
  }
});

// Add an endpoint to manually add an existing wallet
app.post("/wallet/add", async (req: express.Request, res: express.Response) => {
  try {
    const { address, initialBalance = 0, broadcast = true } = req.body;

    if (!address) {
      res.status(400).json({ error: "Wallet address is required" });
      return;
    }

    const chain = await loadBlockchainState();

    // Check if the wallet already exists
    if (chain.getAccount(address)) {
      res.status(409).json({
        error: "Wallet already exists",
        wallet: chain.getAccount(address),
      });
      return;
    }

    // Create the account
    const account = chain.createAccount(address, initialBalance);
    await saveBlockchainState(chain);

    // Broadcast the new wallet to all peers if requested
    if (broadcast) {
      const walletData = {
        address: address,
        timestamp: Date.now(),
      };

      manager.broadcast(WALLET_EVENTS.NEW_WALLET, walletData);
      console.log(`Broadcasted added wallet: ${address}`);
    }

    res.json({
      success: true,
      message:
        "Wallet added successfully" +
        (broadcast ? " and broadcasted to network" : ""),
      wallet: account,
    });
  } catch (error) {
    console.error("Error adding wallet:", error);
    res.status(500).json({
      error: "Failed to add wallet",
      details: error.message,
    });
  }
});

// Add an endpoint to list all wallets
app.get("/wallets", async (req: express.Request, res: express.Response) => {
  try {
    const chain = await loadBlockchainState();

    // Convert the accounts Map to an array
    const wallets = Array.from(chain.accounts.values()).map((account) => ({
      address: account.address,
      balance: account.balance,
      nonce: account.nonce,
    }));

    res.json({
      count: wallets.length,
      wallets: wallets,
    });
  } catch (error) {
    console.error("Error listing wallets:", error);
    res.status(500).json({
      error: "Failed to list wallets",
      details: error.message,
    });
  }
});

// Add an endpoint to check if a wallet exists on all peers
app.get(
  "/wallet/check/:address",
  async (req: express.Request, res: express.Response) => {
    try {
      const { address } = req.params;
      const peers = manager.getPeers();

      if (peers.length === 0) {
        res.json({
          address,
          existsLocally:
            (await loadBlockchainState()).getAccount(address) !== undefined,
          peers: 0,
          message: "No peers connected to check wallet existence",
        });
        return;
      }

      // Check if wallet exists locally
      const localChain = await loadBlockchainState();
      const existsLocally = localChain.getAccount(address) !== undefined;

      // If wallet doesn't exist locally, broadcast it to all peers
      if (!existsLocally) {
        res.json({
          address,
          existsLocally: false,
          peers: peers.length,
          message: "Wallet does not exist locally",
        });
      } else {
        // If wallet exists locally, ensure all peers have it
        const walletData = {
          address,
          timestamp: Date.now(),
        };

        manager.broadcast(WALLET_EVENTS.NEW_WALLET, walletData);

        res.json({
          address,
          existsLocally: true,
          peers: peers.length,
          message: "Wallet exists locally and has been broadcast to all peers",
        });
      }
    } catch (error) {
      console.error("Error checking wallet:", error);
      res.status(500).json({
        error: "Failed to check wallet",
        details: error.message,
      });
    }
  }
);

app.post("/isverified", async (req: Request, res: Response) => {
  const { wallet_address } = req.body;

  if (!wallet_address) {
    res.status(400).json({
      error: "wallet_address is required in request body",
    });
    return;
  }

  try {
    const chain = await loadBlockchainState();
    let isVerified = false;
    isVerified = chain.isIdentityVerified(wallet_address);
    if (wallet_address === MASTER_NODE_ADDRESS) {
      //master node is always verified
      isVerified = true;
    }

    res.json(isVerified);
  } catch (error) {
    console.error("Error checking identity verification:", error);
    res.status(500).json({
      error: "Failed to check identity verification status",
      details: error.message,
    });
  }
});

// Token Management Endpoints
app.get("/tokens", async (req: Request, res: Response) => {
  try {
    const chain = await loadBlockchainState();
    const tokens = Array.from(chain.tokens);

    res.json({
      count: tokens.length,
      tokens: tokens,
    });
  } catch (error) {
    console.error("Error fetching tokens:", error);
    res.status(500).json({
      error: "Failed to fetch tokens",
      details: error.message,
    });
  }
});

app.get("/tokens/:id", async (req: Request, res: Response) => {
  try {
    const chain = await loadBlockchainState();
    const token = Array.from(chain.tokens).find((t) => t.id === req.params.id);

    if (!token) {
      res.status(404).json({ error: "Token not found" });
      return;
    }

    res.json(token);
  } catch (error) {
    console.error("Error fetching token:", error);
    res.status(500).json({
      error: "Failed to fetch token",
      details: error.message,
    });
  }
});

app.get("/tokens/owner/:owner", async (req: Request, res: Response) => {
  try {
    const chain = await loadBlockchainState();
    const owner = req.params.owner;
    const tokens = Array.from(chain.tokens).filter(
      (token) => token.owner === owner
    );
    res.json({ count: tokens.length, tokens });
  } catch (error) {
    console.error("Error fetching tokens by owner:", error);
    res.status(500).json({ error: "Failed to fetch tokens by owner" });
  }
});

// New endpoint to fetch information by hash
app.get("/hash/:hash", async (req: Request, res: Response) => {
  try {
    const chain = await loadBlockchainState();
    const hash = req.params.hash;

    // First check if it's a block hash
    const block = chain.chain.find((b) => b.hash === hash);
    if (block) {
      res.json({
        type: "block",
        data: {
          hash: block.hash,
          previousHash: block.previousHash,
          timestamp: block.timestamp,
          proposer: block.proposer,
          transactionCount: block.transactions.length,
          transactions: block.transactions,
        },
      });
      return;
    }

    // Then check if it's a transaction hash
    for (const block of chain.chain) {
      const transaction = block.transactions.find(
        (tx) => tx.calculateHash() === hash
      );
      if (transaction) {
        res.json({
          type: "transaction",
          data: {
            hash: transaction.calculateHash(),
            fromAddress: transaction.fromAddress,
            toAddress: transaction.toAddress,
            amount: transaction.amount,
            fee: transaction.fee,
            timestamp: transaction.timestamp,
            signature: transaction.signature,
            blockHash: block.hash,
            blockNumber: chain.chain.indexOf(block),
          },
        });
        return;
      }
    }

    // If not found, return 404
    res.status(404).json({ error: "Hash not found in blockchain" });
  } catch (error) {
    console.error("Error fetching hash information:", error);
    res.status(500).json({ error: "Failed to fetch hash information" });
  }
});

httpServer.listen(PORT, async () => {
  console.log(`Node running on port ${PORT}`);
  if (process.env.BOOTSTRAP_PEERS) {
    process.env.BOOTSTRAP_PEERS.split(",").forEach(manager.addPeer);
    //EMIT EVENT TO MASTER NODE
    const key = ec.genKeyPair();
    const publicKey = key.getPublic("hex");
    const privateKey = key.getPrivate("hex");
    console.log(`Your Private key is ${privateKey}, please keep it safe`);
    manager.broadcast(Events.NEW_NODE, {
      address: my_addrr,
      timestamp: Date.now(),
      wallet: {
        address: publicKey,
      },
    });
    setTimeout(requestIBD, REQUEST_IBD_TIMEOUT);
  }
});
