import { Block, Transaction } from "../../src/blockchain";
import {
  generateTestKeyPair,
  createSignedTransaction,
} from "../utils/test-helpers";

describe("Block", () => {
  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      const timestamp = 1000;
      const transactions: Transaction[] = [];
      const previousHash = "prev-hash";
      const proposer = "proposer-address";

      const block = new Block(timestamp, transactions, previousHash, proposer);

      expect(block.timestamp).toBe(timestamp);
      expect(block.transactions).toBe(transactions);
      expect(block.previousHash).toBe(previousHash);
      expect(block.proposer).toBe(proposer);
      expect(block.signature).toBeUndefined();
      expect(block.hash).toBeDefined();
    });
  });

  describe("calculateHash", () => {
    it("should generate consistent hash for same data", () => {
      const block1 = new Block(1000, [], "prev-hash", "proposer");
      const block2 = new Block(1000, [], "prev-hash", "proposer");

      expect(block1.calculateHash()).toBe(block2.calculateHash());
    });

    it("should generate different hash for different data", () => {
      const block1 = new Block(1000, [], "prev-hash", "proposer");
      const block2 = new Block(1000, [], "different-hash", "proposer");

      expect(block1.calculateHash()).not.toBe(block2.calculateHash());
    });

    it("should generate different hash for different transactions", () => {
      const tx1 = new Transaction("from", "to", 100, 0.2);
      const tx2 = new Transaction("from", "to", 200, 0.2);

      const block1 = new Block(1000, [tx1], "prev-hash", "proposer");
      const block2 = new Block(1000, [tx2], "prev-hash", "proposer");

      expect(block1.calculateHash()).not.toBe(block2.calculateHash());
    });
  });

  describe("signBlock", () => {
    it("should add signature to block", () => {
      const keyPair = generateTestKeyPair();
      const proposer = keyPair.getPublic("hex");

      const block = new Block(1000, [], "prev-hash", proposer);
      block.signBlock(keyPair);

      expect(block.signature).toBeDefined();
      expect(block.signature?.length).toBeGreaterThan(0);
    });

    it("should throw error when signing with wrong key", () => {
      const keyPair = generateTestKeyPair();
      const wrongKeyPair = generateTestKeyPair();
      const proposer = keyPair.getPublic("hex");

      const block = new Block(1000, [], "prev-hash", proposer);

      expect(() => {
        block.signBlock(wrongKeyPair);
      }).toThrow("You cannot sign blocks for other proposers!");
    });
  });

  describe("isValidBlock", () => {
    it("should return true for properly signed block", () => {
      const keyPair = generateTestKeyPair();
      const proposer = keyPair.getPublic("hex");

      const block = new Block(1000, [], "prev-hash", proposer);
      block.signBlock(keyPair);

      expect(block.isValidBlock()).toBe(true);
    });

    it("should throw error for unsigned block", () => {
      const block = new Block(1000, [], "prev-hash", "proposer");

      expect(() => {
        block.isValidBlock();
      }).toThrow("No signature in this block");
    });
  });
});
