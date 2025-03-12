import express from "express";
import { PeerManager, Peer, EventHandler } from "mesh-protocol";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Events } from "./events";
import { REQUEST_IBD_TIMEOUT } from "./constants";
import { promises as fs } from "fs";
import { Blockchain, Transaction, Block, BlockchainState } from "./blockchain";
import fsPromises from "fs/promises";
import { Request, Response } from "express";
import { ec as EC } from "elliptic";

// Create an instance of the elliptic curve
const ec = new EC("secp256k1");

dotenv.config();
const app = express();
const PORT = 8800;

// Node identity and wallet configuration
const my_addrr = process.env.MY_ADDRESS;
const my_private_key = process.env.MY_PRIVATE_KEY;

// Initialize node wallet
let nodeKeyPair: EC.KeyPair;
if (!my_private_key) {
  console.warn(
    "No private key found in .env, generating a new wallet for this node"
  );
  nodeKeyPair = ec.genKeyPair();
  const publicKey = nodeKeyPair.getPublic("hex");
  const privateKey = nodeKeyPair.getPrivate("hex");
  console.log("Generated new node wallet:");
  console.log(`Public key (address): ${publicKey}`);
  console.log(`Private key: ${privateKey}`);
  console.log("Add these to your .env file as:");
  console.log(`MY_ADDRESS=${publicKey}`);
  console.log(`MY_PRIVATE_KEY=${privateKey}`);
} else {
  try {
    nodeKeyPair = ec.keyFromPrivate(my_private_key);
    const derivedPublicKey = nodeKeyPair.getPublic("hex");

    if (my_addrr && my_addrr !== derivedPublicKey) {
      console.error(
        "Warning: MY_ADDRESS in .env doesn't match the public key derived from MY_PRIVATE_KEY"
      );
      console.error(`Derived address: ${derivedPublicKey}`);
      console.error(`Configured address: ${my_addrr}`);
      console.error("Using the derived address for consistency");
    }

    console.log(`Node wallet initialized with address: ${derivedPublicKey}`);
  } catch (error) {
    console.error(
      "Failed to initialize node wallet with provided private key:",
      error
    );
    process.exit(1);
  }
}

// Use the derived public key as the node's address for consistency
const nodeAddress = nodeKeyPair.getPublic("hex");

let manager = new PeerManager(nodeAddress);
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
const httpServer = http.createServer(app);
const wss = manager.getServer();

let idbResponses: { chain: any; peer: string }[] = [];

const IBD_COLLECTION_TIMEOUT = 5000;

// Mempool to store pending transactions
let mempool: Transaction[] = [];
const BLOCK_SIZE = 10; // Number of transactions per block

// Add at the top with other constants
const MINIMUM_TRANSACTION_FEE = 0.001; // Example minimum fee

// Add constants for consensus parameters
const BLOCK_TIME = 30000; // 30 seconds per block (time slot)
const MIN_STAKE_TO_PROPOSE = 10; // Minimum balance to be eligible as proposer

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

manager.registerEvent(Events.IBD_REQUEST, async (peer: Peer, data: any) => {
  try {
    const blockchainData = await fs.readFile("./blockchain.json", "utf8");
    peer.send(
      JSON.stringify({
        event: Events.IBD_RESPONSE,
        data: JSON.parse(blockchainData),
      })
    );
  } catch (error) {
    console.error("Error handling IBD event:", error);
  }
});

manager.registerEvent(Events.IBD_RESPONSE, async (peer: Peer, data: any) => {
  try {
    console.log(`Received blockchain data from peer: ${peer.peerUrl}`);

    // Add response to collection
    idbResponses.push({
      chain: data,
      peer: peer.peerUrl,
    });

    // On first response, start a timer to process all collected responses
    if (idbResponses.length === 1) {
      setTimeout(async () => {
        try {
          let longestChain = null;
          let maxLength = 0;

          // First check local blockchain if it exists
          try {
            const localData = await fsPromises.readFile(
              "./blockchain.json",
              "utf8"
            );
            const localChain = new Blockchain();
            localChain.chain = JSON.parse(localData);

            if (localChain.isChainValid()) {
              console.log(
                "Local chain is valid with length:",
                localChain.chain.length
              );
              maxLength = localChain.chain.length;
              longestChain = localChain.chain;
            } else {
              console.log("Local chain is invalid, will consider peer chains");
            }
          } catch (err) {
            console.log("No local blockchain.json found or invalid format");
          }

          for (const response of idbResponses) {
            const tempChain = new Blockchain();
            tempChain.chain = response.chain;

            if (tempChain.isChainValid()) {
              console.log(
                `Valid chain from ${response.peer} with length ${tempChain.chain.length}`
              );

              if (tempChain.chain.length > maxLength) {
                maxLength = tempChain.chain.length;
                longestChain = response.chain;
                console.log(
                  `Found longer valid chain from ${response.peer} with length ${maxLength}`
                );
              }
            } else {
              console.log(`Received invalid chain from ${response.peer}`);
            }
          }

          // Save the longest valid chain if it's different from local
          if (longestChain) {
            await fsPromises.writeFile(
              "./blockchain.json",
              JSON.stringify(longestChain, null, 2)
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
  const payload = {
    requestingAddress: nodeAddress,
    timestamp: Date.now(),
    type: "INITIAL_BLOCK_REQUEST",
  };

  manager.broadcast(Events.IBD_REQUEST, payload);
  console.log("Broadcasted IBD request to all peers");
}

httpServer.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

async function loadBlockchainState(): Promise<Blockchain> {
  try {
    const data = await fs.readFile("./blockchain.json", "utf8");
    const state = JSON.parse(data) as BlockchainState;
    const blockchain = new Blockchain();
    blockchain.loadState(state);
    return blockchain;
  } catch (error) {
    console.log("Creating new blockchain");
    return new Blockchain();
  }
}

async function saveBlockchainState(chain: Blockchain) {
  await fs.writeFile(
    "./blockchain.json",
    JSON.stringify(chain.serializeState(), null, 2)
  );
}

// Update transaction handler
manager.registerEvent(
  Events.NEW_TRANSACTION,
  async (peer: Peer, txData: any) => {
    try {
      const chain = await loadBlockchainState();
      console.log(`Received a new transaction`);

      // Convert received transaction data to a Transaction object, preserving timestamp
      let tx: Transaction;

      // If txData is already a Transaction object with all methods
      if (typeof txData.isValid === "function") {
        tx = txData;
      } else {
        // If it's raw JSON, reconstruct the Transaction with the original timestamp
        tx = new Transaction(
          txData.fromAddress,
          txData.toAddress,
          txData.amount,
          txData.fee,
          txData.timestamp // Use the original timestamp
        );
        // Also copy the signature
        tx.signature = txData.signature;
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
      if (!mempool.some((t) => t.calculateHash() === tx.calculateHash())) {
        mempool.push(tx);
        console.log(
          "Transaction added to mempool. Current size:",
          mempool.length
        );

        // Check if we can create a block
        if (mempool.length >= BLOCK_SIZE) {
          console.log(
            "Mempool threshold reached, attempting to create block..."
          );
          await createAndBroadcastBlock();
        }
      }
    } catch (error) {
      console.error("Error processing transaction:", error);
    }
  }
);

// Update block creation
async function createAndBroadcastBlock() {
  try {
    const chain = await loadBlockchainState();

    // Get current time slot
    const currentTime = Date.now();
    const currentTimeSlot = Math.floor(currentTime / BLOCK_TIME);
    const timeInSlot = currentTime % BLOCK_TIME; // Time elapsed in current slot

    // Don't allow block creation in the last 5 seconds of a time slot
    // This prevents two nodes from creating blocks for the same slot
    const SAFETY_MARGIN = 5000; // 5 seconds
    if (timeInSlot > BLOCK_TIME - SAFETY_MARGIN) {
      console.log(
        `Too late in time slot ${currentTimeSlot}, waiting for next slot`
      );
      return;
    }

    // Check if this time slot already has a block
    const lastBlock = chain.getLatestBlock();
    const lastBlockTimeSlot = Math.floor(lastBlock.timestamp / BLOCK_TIME);

    if (lastBlockTimeSlot === currentTimeSlot) {
      console.log(`Block already created for time slot ${currentTimeSlot}`);
      return;
    }

    const nextProposer = getNextProposer(chain);
    // Check if we are the proposer
    const isOurTurn = nextProposer === nodeAddress;

    if (!isOurTurn) {
      console.log(
        `Not our turn to propose block. Current proposer: ${nextProposer}`
      );
      return;
    }

    // If mempool is empty, don't create an empty block
    if (mempool.length === 0) {
      console.log("Mempool is empty, not creating block");
      return;
    }

    console.log(
      `We are the proposer for time slot ${currentTimeSlot}, creating block...`
    );
    const blockTransactions = mempool.slice(0, BLOCK_SIZE);

    // Calculate total fees from transactions
    const totalFees = blockTransactions.reduce((sum, tx) => sum + tx.fee, 0);

    // Use exact time slot boundary for consistent timestamps across nodes
    const blockTimestamp = currentTimeSlot * BLOCK_TIME;

    const newBlock = new Block(
      blockTimestamp,
      blockTransactions,
      lastBlock.hash,
      nodeAddress
    );

    // Sign the block with our node's private key
    try {
      newBlock.signBlock(nodeKeyPair);
      console.log("Block signed successfully");
    } catch (error) {
      console.error("Failed to sign block:", error);
      return;
    }

    // Verify block is valid before adding to chain
    if (!newBlock.isValidBlock()) {
      console.error("Block signature validation failed");
      return;
    }

    // Process all transactions in the block
    let allTransactionsValid = true;
    for (const tx of blockTransactions) {
      if (!chain.processTransaction(tx)) {
        console.error(`Failed to process transaction: ${tx.calculateHash()}`);
        allTransactionsValid = false;
        break;
      }
    }

    if (!allTransactionsValid) {
      console.error("Block contains invalid transactions, aborting");
      return;
    }

    // Update chain with new block
    chain.chain.push(newBlock);

    // Mint block reward and distribute fees to proposer
    chain.mintBlockReward(nodeAddress, totalFees);

    await saveBlockchainState(chain);

    // Broadcast the new block
    manager.broadcast(Events.NEW_BLOCK, newBlock);

    // Remove used transactions from mempool
    const usedTxHashes = blockTransactions.map((tx) => tx.calculateHash());
    mempool = mempool.filter(
      (tx) => !usedTxHashes.includes(tx.calculateHash())
    );

    console.log(
      `Created and broadcast new block for time slot ${currentTimeSlot} with ${blockTransactions.length} transactions`
    );
  } catch (error) {
    console.error("Error creating block:", error);
  }
}

// Add this new function for deterministic proposer selection
function getNextProposer(chain: Blockchain): string {
  // Get all eligible proposers (verified identities with minimum stake)
  const eligibleProposers = Array.from(chain.verifiedIdentities)
    .filter((address) => {
      const account = chain.getAccount(address);
      // Require minimum stake to be a proposer
      return account && account.balance >= MIN_STAKE_TO_PROPOSE;
    })
    .sort(); // Sort for deterministic order

  // If we have no eligible proposers with stake, fall back to verified identities
  if (eligibleProposers.length === 0) {
    const verifiedProposers = Array.from(chain.verifiedIdentities).sort();
    if (verifiedProposers.length > 0) {
      // Use time-based rotation among verified identities
      const currentTimeSlot = Math.floor(Date.now() / BLOCK_TIME);
      const proposerIndex = currentTimeSlot % verifiedProposers.length;
      const selectedProposer = verifiedProposers[proposerIndex];

      console.log(
        `Selected proposer ${selectedProposer} for time slot ${currentTimeSlot}`
      );
      return selectedProposer;
    }

    // If still no proposers, use our own address as fallback
    console.log("No eligible proposers available, using own address");
    return nodeAddress;
  }

  // Use time-based rotation to select a proposer
  const currentTimeSlot = Math.floor(Date.now() / BLOCK_TIME);
  const proposerIndex = currentTimeSlot % eligibleProposers.length;
  const selectedProposer = eligibleProposers[proposerIndex];

  console.log(
    `Selected proposer ${selectedProposer} for time slot ${currentTimeSlot} (${eligibleProposers.length} eligible proposers)`
  );
  return selectedProposer;
}

// Handle incoming blocks from peers
manager.registerEvent(Events.NEW_BLOCK, async (peer: Peer, block: any) => {
  try {
    const chain = await loadBlockchainState();
    const lastBlock = chain.getLatestBlock();

    // Validate and reconstruct the block
    const newBlock = new Block(
      block.timestamp,
      block.transactions,
      block.previousHash,
      block.proposer
    );
    newBlock.signature = block.signature;
    newBlock.hash = block.hash;

    // Check if block is for the current or future time slot
    const blockTimeSlot = Math.floor(newBlock.timestamp / BLOCK_TIME);
    const currentTimeSlot = Math.floor(Date.now() / BLOCK_TIME);
    const lastBlockTimeSlot = Math.floor(lastBlock.timestamp / BLOCK_TIME);

    // Reject blocks from past time slots (except if our chain is behind)
    if (blockTimeSlot < currentTimeSlot && blockTimeSlot <= lastBlockTimeSlot) {
      console.log(
        `Rejecting block from past time slot ${blockTimeSlot}. Current slot: ${currentTimeSlot}`
      );
      return;
    }

    // Verify block is valid and links to our chain
    if (!newBlock.isValidBlock() || newBlock.previousHash !== lastBlock.hash) {
      console.log(`Rejecting invalid block from ${block.proposer}`);
      return;
    }

    // Verify the proposer is correct for this time slot
    const expectedProposer = getNextProposer(chain);
    if (newBlock.proposer !== expectedProposer) {
      console.log(
        `Rejecting block: proposer ${newBlock.proposer} is not the expected proposer ${expectedProposer} for time slot ${blockTimeSlot}`
      );
      return;
    }

    // Check for double-block for the same time slot
    if (blockTimeSlot === lastBlockTimeSlot) {
      console.log(
        `Rejecting block: already have a block for time slot ${blockTimeSlot}`
      );
      return;
    }

    console.log(
      `Received valid block for time slot ${blockTimeSlot} from proposer ${newBlock.proposer}`
    );

    // Verify all transactions in the block
    const processedTxHashes = new Set<string>();
    let allTransactionsValid = true;

    for (const tx of newBlock.transactions) {
      // Skip processing if this is a duplicate within the block
      const txHash =
        typeof tx.calculateHash === "function"
          ? tx.calculateHash()
          : new Transaction(
              tx.fromAddress,
              tx.toAddress,
              tx.amount,
              tx.fee,
              tx.timestamp
            ).calculateHash();

      if (processedTxHashes.has(txHash)) {
        console.log(`Skipping duplicate transaction in block: ${txHash}`);
        continue;
      }

      processedTxHashes.add(txHash);

      // Process the transaction
      if (!chain.processTransaction(tx)) {
        console.error(
          `Failed to process transaction in received block: ${txHash}`
        );
        allTransactionsValid = false;
        break;
      }
    }

    if (!allTransactionsValid) {
      console.error("Rejecting block with invalid transactions");
      return;
    }

    // Calculate total fees
    const totalFees = newBlock.transactions.reduce(
      (sum, tx) => sum + (tx.fee || 0),
      0
    );

    // Add block to chain
    chain.chain.push(newBlock);

    // Mint reward and fees to proposer
    chain.mintBlockReward(newBlock.proposer, totalFees);

    await saveBlockchainState(chain);

    // Remove included transactions from mempool
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

    mempool = mempool.filter(
      (tx) => !blockTxHashes.includes(tx.calculateHash())
    );

    console.log(
      `Added new block for time slot ${blockTimeSlot} to chain. Height: ${chain.chain.length}`
    );
  } catch (error) {
    console.error("Error processing new block:", error);
  }
});

interface TransactionRequest {
  fromAddress: string;
  toAddress: string;
  amount: number;
  signature: string;
  fee: number;
}

app.post(
  "/transaction",
  async (req: express.Request, res: express.Response) => {
    try {
      const { fromAddress, toAddress, amount, fee, privateKey } = req.body;

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
        timestamp
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

      // Broadcast the transaction as a plain object to ensure consistent serialization
      manager.broadcast(Events.NEW_TRANSACTION, {
        fromAddress: transaction.fromAddress,
        toAddress: transaction.toAddress,
        amount: transaction.amount,
        fee: transaction.fee,
        timestamp: transaction.timestamp, // Include the timestamp
        signature: transaction.signature,
      });

      res.json({
        success: true,
        transaction: {
          fromAddress: transaction.fromAddress,
          toAddress: transaction.toAddress,
          amount: transaction.amount,
          fee: transaction.fee,
          signature: transaction.signature,
          timestamp: transaction.timestamp,
        },
        message: "Transaction broadcast to network",
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to process transaction",
        details: error.message,
      });
    }
  }
);

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

app.post(
  "/wallet/create",
  async (req: express.Request, res: express.Response) => {
    try {
      const chain = await loadBlockchainState();

      // Generate key pair using the instance method, not the class method
      const key = ec.genKeyPair();
      const publicKey = key.getPublic("hex");
      const privateKey = key.getPrivate("hex");

      // Create the account in the blockchain
      chain.createAccount(publicKey);
      await saveBlockchainState(chain);

      // Check if this was requested for node operation
      const forNodeOperation = req.body.forNodeOperation === true;

      let nodeInstructions = "";
      if (forNodeOperation) {
        nodeInstructions =
          "To use this wallet for your node operation, add these to your .env file:\n" +
          `MY_ADDRESS=${publicKey}\n` +
          `MY_PRIVATE_KEY=${privateKey}\n` +
          "Then restart your node.";
      }

      res.json({
        address: publicKey,
        privateKey: privateKey,
        balance: 0,
        message: "Wallet created successfully",
        nodeInstructions: forNodeOperation ? nodeInstructions : undefined,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error });
    }
  }
);

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
      maxSupply: 21000000,
      currentSupply: chain.getCurrentSupply(),
      blockReward: chain.getCurrentBlockReward(),
      nextHalvingBlock: Math.ceil(chain.chain.length / 210000) * 210000,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch supply info" });
  }
});

// Add a new endpoint to check node status
app.get("/node/status", async (req: express.Request, res: express.Response) => {
  try {
    const chain = await loadBlockchainState();

    // Get node account info
    const nodeAccount = chain.getAccount(nodeAddress) || {
      address: nodeAddress,
      balance: 0,
      nonce: 0,
    };

    // Count blocks proposed by this node
    const blocksProposed = chain.chain.filter(
      (block) => block.proposer === nodeAddress
    ).length;

    // Calculate total rewards earned (all fees + block rewards)
    const totalBlockRewardsEarned = nodeAccount.balance;

    // Get connected peers
    const connectedPeers = manager.getPeers().map((peer) => peer.peerUrl);

    res.json({
      node: {
        address: nodeAddress,
        isProposer: true,
        balance: nodeAccount.balance,
        blocksProposed: blocksProposed,
      },
      network: {
        chainHeight: chain.chain.length,
        connectedPeers: connectedPeers.length,
        peersList: connectedPeers,
        currentBlockReward: chain.getCurrentBlockReward(),
        pendingTransactions: mempool.length,
      },
      rewards: {
        totalEarned: totalBlockRewardsEarned,
        nextBlockIn:
          mempool.length >= BLOCK_SIZE
            ? "Ready to propose"
            : `${BLOCK_SIZE - mempool.length} more transactions needed`,
      },
    });
  } catch (error) {
    console.error("Error fetching node status:", error);
    res.status(500).json({ error: "Failed to get node status" });
  }
});

// Add scheduled block creation based on time slots
setInterval(async () => {
  try {
    // Only try to create blocks if we have transactions in the mempool
    if (mempool.length === 0) {
      return;
    }

    // Check if we should propose a block for the current time slot
    await createAndBroadcastBlock();
  } catch (error) {
    console.error("Error in scheduled block creation:", error);
  }
}, 5000); // Check every 5 seconds

httpServer.listen(PORT, () => {
  console.log(`Node running on port ${PORT}`);
  if (process.env.BOOTSTRAP_PEERS) {
    process.env.BOOTSTRAP_PEERS.split(",").forEach(manager.addPeer);
    setTimeout(requestIBD, REQUEST_IBD_TIMEOUT);
  }
});
