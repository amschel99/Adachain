"use strict";
import * as crypto from "crypto";
import { ec as EC } from "elliptic";
import debug from "debug";
import { Token } from "./types";

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
  message?: string;

  constructor(
    fromAddress: string,
    toAddress: string,
    amount: number,
    fee: number,
    timestamp?: number,
    message?: string
  ) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp || Date.now();
    this.fee = fee;
    this.message = message;
  }

  calculateHash(): string {
    return crypto
      .createHash("sha256")
      .update(
        this.fromAddress +
          this.toAddress +
          this.amount +
          this.timestamp +
          (this.message || "")
      )
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
    // Verify the hash is correct
    const calculatedHash = this.calculateHash();
    if (this.hash !== calculatedHash) {
      console.log(
        `Invalid block hash: ${this.hash} vs calculated ${calculatedHash}`
      );
      return false;
    }

    // Verify all transactions in the block
    for (const tx of this.transactions) {
      try {
        // Skip coinbase transactions (those with null fromAddress)
        if (tx.fromAddress === null) continue;

        // Create a Transaction object to validate
        const txObj = new Transaction(
          tx.fromAddress,
          tx.toAddress,
          tx.amount,
          tx.fee,
          tx.timestamp,
          tx.message
        );

        // Copy the signature for validation
        txObj.signature = tx.signature;

        if (!txObj.isValid()) {
          console.log(`Invalid transaction in block: ${txObj.calculateHash()}`);
          return false;
        }
      } catch (error) {
        console.log(`Error validating transaction: ${error.message}`);
        return false;
      }
    }

    return true;
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
  public currentSupply: number;

  chain_id: string;
  chain: Block[];
  pendingTransactions: Transaction[];
  verifiedIdentities: Set<string>;
  chain_hash: string;
  accounts: Map<string, Account>;
  bannedAddresses: Set<string>;
  tokens: Set<Token>;

  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.pendingTransactions = [];
    this.verifiedIdentities = new Set();
    this.chain_id = generateSecureString();
    this.chain_hash = this.computeChainHash();
    this.accounts = new Map();
    this.bannedAddresses = new Set();
    this.currentSupply = 0;
    this.tokens = new Set();
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
    // Check if chain is empty
    if (this.chain.length === 0) {
      console.log("Chain is empty");
      return false;
    }

    // Check genesis block
    const genesisBlock = this.chain[0];
    if (genesisBlock.previousHash !== "0") {
      console.log("Invalid genesis block: previousHash should be '0'");
      return false;
    }

    // Validate each block in the chain
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Check if the block's previousHash points to the previous block's hash
      if (previousBlock.hash !== currentBlock.previousHash) {
        console.log(`Invalid chain at block ${i}: previousHash mismatch`);
        console.log(`Previous block hash: ${previousBlock.hash}`);
        console.log(`Current block previousHash: ${currentBlock.previousHash}`);
        return false;
      }

      // Validate the block itself
      if (!currentBlock.isValidBlock()) {
        console.log(`Invalid block at position ${i}`);
        return false;
      }
    }

    console.log(
      `Chain validated successfully with ${this.chain.length} blocks`
    );
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
    // Properly reconstruct Block objects to maintain prototype methods
    this.chain = state.chain.map((blockData) => {
      // Create a new Block instance with the data from the state
      const block = new Block(
        blockData.timestamp,
        blockData.transactions.map((txData) => {
          // Reconstruct Transaction objects
          const tx = new Transaction(
            txData.fromAddress,
            txData.toAddress,
            txData.amount,
            txData.fee || 0,
            txData.timestamp,
            txData.message
          );
          tx.signature = txData.signature;
          return tx;
        }),
        blockData.previousHash,
        blockData.proposer
      );

      // Copy the hash to ensure consistency
      block.hash = blockData.hash;
      block.signature = blockData.signature;

      return block;
    });

    this.accounts = new Map(Object.entries(state.accounts));
    this.bannedAddresses = new Set(state.bannedAddresses || []);
    this.currentSupply = state.currentSupply || 0;
  }

  getCurrentSupply(): number {
    return this.currentSupply;
  }

  addToken(token: Token): boolean {
    // Validate token data
    if (!token.id || !token.owner || token.value <= 0) {
      console.log("Invalid token data");
      return false;
    }

    // Check if token ID already exists
    for (const existingToken of this.tokens) {
      if (existingToken.id === token.id) {
        console.log("Token with this ID already exists");
        return false;
      }
    }

    // Add token to the set
    this.tokens.add(token);
    console.log(`Added new token: ${token.id} owned by ${token.owner}`);
    return true;
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
