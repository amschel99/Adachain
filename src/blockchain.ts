"use strict";
import * as crypto from "crypto";
import { ec as EC } from "elliptic";
import debug from "debug";

export const ec = new EC("secp256k1");
const log = debug("savjeecoin:blockchain");
function generateSecureString(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

class Transaction {
  fromAddress: string;
  toAddress: string;
  amount: number;
  timestamp: number;
  signature?: string;

  constructor(fromAddress: string, toAddress: string, amount: number) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = Date.now();
  }

  calculateHash(): string {
    return crypto
      .createHash("sha256")
      .update(this.fromAddress + this.toAddress + this.amount + this.timestamp)
      .digest("hex");
  }

  sign(signingKey: EC.KeyPair) {
    if (signingKey.getPublic("hex") !== this.fromAddress) {
      throw new Error("You cannot sign transactions for other wallets!");
    }

    const hashTx = this.calculateHash();
    const sig = signingKey.sign(hashTx, "base64");
    this.signature = sig.toDER("hex");
  }

  isValid(): boolean {
    if (this.fromAddress === null) return true;
    if (!this.signature || this.signature.length === 0) {
      throw new Error("No signature in this transaction");
    }

    const publicKey = ec.keyFromPublic(this.fromAddress, "hex");
    return publicKey.verify(this.calculateHash(), this.signature);
  }
}

class Block {
  previousHash: string;
  timestamp: number;
  transactions: Transaction[];
  proposer: string;
  signature?: string;
  hash: string;

  constructor(
    timestamp: number,
    transactions: Transaction[],
    previousHash = "",
    proposer: string
  ) {
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.proposer = proposer;
    this.signature = undefined;
    this.hash = this.calculateHash();
  }

  calculateHash(): string {
    return crypto
      .createHash("sha256")
      .update(
        this.previousHash +
          this.timestamp +
          JSON.stringify(this.transactions) +
          this.proposer
      )
      .digest("hex");
  }

  signBlock(signingKey: EC.KeyPair) {
    if (signingKey.getPublic("hex") !== this.proposer) {
      throw new Error("You cannot sign blocks for other proposers!");
    }
    const hashBlock = this.calculateHash();
    const sig = signingKey.sign(hashBlock, "base64");
    this.signature = sig.toDER("hex");
  }

  isValidBlock(): boolean {
    if (!this.signature || this.signature.length === 0) {
      throw new Error("No signature in this block");
    }

    const publicKey = ec.keyFromPublic(this.proposer, "hex");
    return publicKey.verify(this.calculateHash(), this.signature);
  }
}

class Blockchain {
  chain_id: string;
  chain: Block[];
  pendingTransactions: Transaction[];
  verifiedIdentities: Set<string>;

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.pendingTransactions = [];
    this.verifiedIdentities = new Set();
    this.chain_id = generateSecureString();
  }

  createGenesisBlock(): Block {
    return new Block(Date.parse("2017-01-01"), [], "0", "genesis");
  }

  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  addVerifiedIdentity(address: string): void {
    this.verifiedIdentities.add(address);
  }

  isIdentityVerified(address: string): boolean {
    return this.verifiedIdentities.has(address);
  }

  proposeBlock(transactions: Transaction[], proposerKey: EC.KeyPair): void {
    if (!this.isIdentityVerified(proposerKey.getPublic("hex"))) {
      throw new Error("Proposer identity not verified!");
    }

    const newBlock = new Block(
      Date.now(),
      transactions,
      this.getLatestBlock().hash,
      proposerKey.getPublic("hex")
    );
    newBlock.signBlock(proposerKey);

    if (newBlock.isValidBlock()) {
      this.chain.push(newBlock);
    } else {
      throw new Error("Invalid block");
    }
  }

  testUnverifiedIdentity(address: string, transactions: Transaction[]) {
    if (this.isIdentityVerified(address)) {
      console.log("Identity is verified, proposing block...");
      return;
    }

    try {
      console.log(
        "Attempting to propose a block with an unverified identity..."
      );
      this.proposeBlock(transactions, {
        getPublic: () => address,
      } as EC.KeyPair);
    } catch (error: any) {
      console.error(
        "Failed to propose block with unverified identity:",
        error.message
      );
    }
  }

  isChainValid(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (previousBlock.hash !== currentBlock.previousHash) {
        return false;
      }

      if (!currentBlock.isValidBlock()) {
        return false;
      }
    }
    return true;
  }
}

export { Blockchain, Block, Transaction };

// // Testing Functions
// if (require.main === module) {
//   const myKey = ec.genKeyPair();

//   const myWalletAddress = myKey.getPublic("hex");
//   const unverifiedAddress = "unverified-address";
//   const blockchain = new Blockchain();

//   // Add a verified identity
//   blockchain.addVerifiedIdentity(myWalletAddress);

//   // Create a transaction
//   const tx1 = new Transaction(myWalletAddress, "recipient-address", 10);
//   tx1.sign(myKey);

//   // Test unverified identity
//   blockchain.testUnverifiedIdentity(unverifiedAddress, [tx1]);

//   // Propose block with a verified identity
//   blockchain.proposeBlock([tx1], myKey);

//   console.log("Blockchain valid?", blockchain.isChainValid());
//   console.log(JSON.stringify(blockchain, null, 2));
// }
