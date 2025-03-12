import { ec } from "elliptic";
import { Blockchain, Transaction, Block } from "../../src/blockchain";

// Create a test EC instance
const testEc = new ec("secp256k1");

/**
 * Generate a key pair for testing
 */
export function generateTestKeyPair() {
  return testEc.genKeyPair();
}

/**
 * Create a test blockchain with optional initial accounts
 */
export function createTestBlockchain(
  initialAccounts: Array<{ address: string; balance: number }> = []
) {
  const blockchain = new Blockchain();

  // Add initial accounts if provided
  initialAccounts.forEach((account) => {
    blockchain.createAccount(account.address, account.balance);
  });

  return blockchain;
}

/**
 * Create a signed test transaction
 */
export function createSignedTransaction(
  fromAddress: string,
  toAddress: string,
  amount: number,
  fee: number,
  privateKey: ReturnType<typeof testEc.genKeyPair>
) {
  const tx = new Transaction(fromAddress, toAddress, amount, fee);
  tx.sign(privateKey);
  return tx;
}

/**
 * Create a test block with transactions
 */
export function createTestBlock(
  previousHash: string,
  proposer: string,
  transactions: Transaction[] = []
) {
  return new Block(Date.now(), transactions, previousHash, proposer);
}
