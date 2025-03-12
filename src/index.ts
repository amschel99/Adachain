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

dotenv.config();
const app = express();
const PORT = 8800;

const my_addrr = process.env.MY_ADDRESS;
let manager = new PeerManager(my_addrr);
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
manager.registerEvent(
  Events.SELECTED_PROPOSER,
  async (peer: Peer, data: any) => {
    try {
      const { proposerAddress } = data;
      console.log(`Received proposer selection: ${proposerAddress}`);

      // Check if this node is the selected proposer
      if (proposerAddress === my_addrr) {
        console.log(
          `This node (${my_addrr}) has been selected as the proposer`
        );

        // Get 10 transactions from mempool
        const blockTransactions = mempool.slice(0, BLOCK_SIZE);

        if (blockTransactions.length > 0) {
          // Create and broadcast a new block
          await createAndBroadcastBlock();
        } else {
          console.log("No transactions in mempool to create a block");
        }
      }
    } catch (error) {
      console.error("Error handling proposer selection:", error);
    }
  }
);

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
    requestingAddress: my_addrr,
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
          const nextProposer = getNextProposer(chain);
          if (nextProposer === my_addrr) {
            await createAndBroadcastBlock();
          } else {
            console.log(`Waiting for proposer ${nextProposer} to create block`);
          }
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

    console.log("We are the current proposer, creating block...");
    const blockTransactions = mempool.slice(0, BLOCK_SIZE);

    // Calculate total fees from transactions
    const totalFees = blockTransactions.reduce((sum, tx) => sum + tx.fee, 0);

    const lastBlock = chain.getLatestBlock();
    const newBlock = new Block(
      Date.now(),
      blockTransactions,
      lastBlock.hash,
      my_addrr
    );

    // Update chain with new block
    chain.chain.push(newBlock);

    // Mint block reward and distribute fees to proposer
    chain.mintBlockReward(my_addrr, totalFees);

    await saveBlockchainState(chain);

    // Broadcast the new block
    manager.broadcast(Events.NEW_BLOCK, newBlock);

    // Remove used transactions from mempool
    mempool = mempool.slice(BLOCK_SIZE);
    console.log("Created and broadcast new block");
  } catch (error) {
    console.error("Error creating block:", error);
  }
}

// Add this new function for proposer selection
function getNextProposer(chain: Blockchain): string {
  const verifiedProposers = Array.from(chain.verifiedIdentities).sort();
  if (verifiedProposers.length === 0) {
    throw new Error("No verified proposers available");
  }

  const currentHeight = chain.chain.length;
  const proposerIndex = currentHeight % verifiedProposers.length;
  return verifiedProposers[proposerIndex];
}

// Handle incoming blocks from peers
manager.registerEvent(Events.NEW_BLOCK, async (peer: Peer, block: any) => {
  try {
    const chain = await loadBlockchainState();

    // Validate block
    const newBlock = new Block(
      block.timestamp,
      block.transactions,
      block.previousHash,
      block.proposer
    );

    // Verify block is valid and links to our chain
    if (
      newBlock.isValidBlock() &&
      newBlock.previousHash === chain.getLatestBlock().hash
    ) {
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

      console.log("Added new block to chain");
    }
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
app.post("/choose-proposer", async (req: Request, res: Response) => {
  const { address } = req.body;
  if (!address) {
    res.status(400).json(`Bad request, address is required`);
    return;
  }
  try {
    // Broadcast the SELECTED_PROPOSER event with the address to all peers
    manager.broadcast(Events.SELECTED_PROPOSER, { proposerAddress: address });

    console.log(`Broadcast proposer selection: ${address}`);
    res.status(200).json({
      message: `Proposer ${address} has been selected and broadcast to network`,
    });
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

app.post(
  "/wallet/create",
  async (req: express.Request, res: express.Response) => {
    try {
      const chain = await loadBlockchainState();

      // Generate key pair using the instance method, not the class method
      const key = ec.genKeyPair();
      const publicKey = key.getPublic("hex");
      const privateKey = key.getPrivate("hex");

      chain.createAccount(publicKey);
      await saveBlockchainState(chain);

      res.json({
        address: publicKey,
        privateKey: privateKey,
        balance: 0,
        message: "Wallet created successfully",
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

httpServer.listen(PORT, () => {
  console.log(`Node running on port ${PORT}`);
  if (process.env.BOOTSTRAP_PEERS) {
    process.env.BOOTSTRAP_PEERS.split(",").forEach(manager.addPeer);
    setTimeout(requestIBD, REQUEST_IBD_TIMEOUT);
  }
});
