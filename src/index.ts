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
import { ec } from "elliptic";

dotenv.config();
const app = express();
const PORT = 5500;

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
  async (peer: Peer, transaction: any) => {
    try {
      const chain = await loadBlockchainState();

      // Check if sender is banned
      if (chain.isAddressBanned(transaction.fromAddress)) {
        console.log(
          `Rejected transaction from banned address: ${transaction.fromAddress}`
        );
        return;
      }

      const tx = new Transaction(
        transaction.fromAddress,
        transaction.toAddress,
        transaction.amount
      );
      tx.signature = transaction.signature;
      tx.fee = transaction.fee;

      // Fee validation
      if (!tx.fee || tx.fee < MINIMUM_TRANSACTION_FEE) {
        console.log(`Rejected transaction with insufficient fee: ${tx.fee}`);
        // Ban address for trying to cheat fees
        chain.banAddress(tx.fromAddress);
        await saveBlockchainState(chain);
        return;
      }

      // Validate signature
      try {
        if (!tx.isValid()) {
          console.log(`Invalid transaction signature from ${tx.fromAddress}`);
          chain.banAddress(tx.fromAddress);
          await saveBlockchainState(chain);
          return;
        }
      } catch (error) {
        console.log(
          `Signature verification failed, banning address ${tx.fromAddress}`
        );
        chain.banAddress(tx.fromAddress);
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

    const nextProposer = getNextProposer(chain);
    if (nextProposer !== my_addrr) {
      console.log(
        `Not our turn to propose block. Current proposer: ${nextProposer}`
      );
      return;
    }

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
    newBlock.signature = block.signature;
    newBlock.hash = block.hash;

    // Verify block is valid and links to our chain
    if (
      newBlock.isValidBlock() &&
      newBlock.previousHash === chain.getLatestBlock().hash
    ) {
      // Calculate total fees
      const totalFees = newBlock.transactions.reduce(
        (sum, tx) => sum + tx.fee,
        0
      );

      // Add block to chain
      chain.chain.push(newBlock);

      // Mint reward and fees to proposer
      chain.mintBlockReward(newBlock.proposer, totalFees);

      await saveBlockchainState(chain);

      // Remove included transactions from mempool
      const blockTxHashes = newBlock.transactions.map((tx) =>
        new Transaction(tx.fromAddress, tx.toAddress, tx.amount).calculateHash()
      );
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
    const { fromAddress, toAddress, amount, signature, fee } =
      req.body as TransactionRequest;

    if (!fee || fee < MINIMUM_TRANSACTION_FEE) {
      res.status(400).json({
        error: `Transaction fee must be at least ${MINIMUM_TRANSACTION_FEE}`,
      });
    }

    const transaction = new Transaction(fromAddress, toAddress, amount);
    transaction.fee = fee;
    transaction.signature = signature;

    manager.broadcast(Events.NEW_TRANSACTION, transaction);
    res.json({ success: true, fee });
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
      }

      res.json({
        address: account.address,
        balance: account.balance,
        nonce: account.nonce,
      });
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
      res.status(500).json({ error: "Failed to create wallet" });
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
