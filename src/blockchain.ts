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
  fee: number;

  constructor(
    fromAddress: string,
    toAddress: string,
    amount: number,
    fee: number,
    timestamp?: number
  ) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp || Date.now();
    this.fee = fee;
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

interface Account {
  address: string;
  balance: number;
  nonce: number;
}

interface BlockchainState {
  chain: Block[];
  accounts: { [address: string]: Account };
  bannedAddresses: string[];
  currentSupply: number;
}

class Blockchain {
  private static readonly TOTAL_SUPPLY = 21000000;
  private static readonly BLOCK_REWARD = 50;
  private static readonly HALVING_INTERVAL = 210000;
  private currentSupply: number;

  chain_id: string;
  chain: Block[];
  pendingTransactions: Transaction[];
  verifiedIdentities: Set<string>;
  chain_hash: string;
  accounts: Map<string, Account>;
  bannedAddresses: Set<string>;

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.pendingTransactions = [];
    this.verifiedIdentities = new Set();
    this.chain_id = generateSecureString();
    this.chain_hash = this.computeChainHash();
    this.accounts = new Map();
    this.bannedAddresses = new Set();
    this.currentSupply = 0;
  }

  createGenesisBlock(): Block {
    return new Block(Date.parse("2017-01-01"), [], "0", "genesis");
  }
  computeChainHash() {
    const chainData = JSON.stringify(this.chain);
    return crypto.createHash("sha256").update(chainData).digest("hex");
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

  createAccount(address: string, initialBalance: number = 0): Account {
    if (!this.accounts.has(address)) {
      const account = {
        address,
        balance: initialBalance,
        nonce: 0,
      };
      this.accounts.set(address, account);
      this.addVerifiedIdentity(address);
      return account;
    }
    return this.accounts.get(address)!;
  }

  getAccount(address: string): Account | undefined {
    return this.accounts.get(address);
  }

  processTransaction(tx: Transaction): boolean {
    const sender = this.accounts.get(tx.fromAddress);
    if (!sender || sender.balance < tx.amount + tx.fee) {
      return false;
    }

    sender.balance -= tx.amount + tx.fee;
    sender.nonce++;

    if (!this.accounts.has(tx.toAddress)) {
      this.createAccount(tx.toAddress);
    }
    const receiver = this.accounts.get(tx.toAddress)!;
    receiver.balance += tx.amount;

    return true;
  }

  banAddress(address: string): void {
    this.bannedAddresses.add(address);
  }

  isAddressBanned(address: string): boolean {
    return this.bannedAddresses.has(address);
  }

  getCurrentBlockReward(): number {
    const halvings = Math.floor(
      this.chain.length / Blockchain.HALVING_INTERVAL
    );
    const reward = Blockchain.BLOCK_REWARD / Math.pow(2, halvings);
    return reward;
  }

  mintBlockReward(proposerAddress: string, fees: number): boolean {
    const reward = this.getCurrentBlockReward();

    if (this.currentSupply + reward > Blockchain.TOTAL_SUPPLY) {
      console.log("Maximum supply reached, only distributing fees");
      if (fees > 0) {
        const proposer =
          this.getAccount(proposerAddress) ||
          this.createAccount(proposerAddress);
        proposer.balance += fees;
      }
      return false;
    }

    const proposer =
      this.getAccount(proposerAddress) || this.createAccount(proposerAddress);
    proposer.balance += reward + fees;
    this.currentSupply += reward;

    console.log(
      `Minted ${reward} tokens to ${proposerAddress}, new supply: ${this.currentSupply}`
    );
    return true;
  }

  serializeState(): BlockchainState {
    return {
      chain: this.chain,
      accounts: Object.fromEntries(this.accounts),
      bannedAddresses: Array.from(this.bannedAddresses),
      currentSupply: this.currentSupply,
    };
  }

  loadState(state: BlockchainState) {
    this.chain = state.chain;
    this.accounts = new Map(Object.entries(state.accounts));
    this.bannedAddresses = new Set(state.bannedAddresses || []);
    this.currentSupply = state.currentSupply || 0;
  }

  getCurrentSupply(): number {
    return this.currentSupply;
  }
}

export { Blockchain, Block, Transaction, BlockchainState };

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
