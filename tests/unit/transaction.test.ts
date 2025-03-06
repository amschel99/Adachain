import { Transaction } from "../../src/blockchain";
import { generateTestKeyPair } from "../utils/test-helpers";

describe("Transaction", () => {
  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      const fromAddress = "sender-address";
      const toAddress = "receiver-address";
      const amount = 100;

      const tx = new Transaction(fromAddress, toAddress, amount);

      expect(tx.fromAddress).toBe(fromAddress);
      expect(tx.toAddress).toBe(toAddress);
      expect(tx.amount).toBe(amount);
      expect(tx.fee).toBe(0);
      expect(tx.signature).toBeUndefined();
      expect(tx.timestamp).toBeDefined();
    });
  });

  describe("calculateHash", () => {
    it("should generate consistent hash for same data", () => {
      const tx1 = new Transaction("from", "to", 100);
      // Force same timestamp for testing
      tx1.timestamp = 1000;

      const tx2 = new Transaction("from", "to", 100);
      tx2.timestamp = 1000;

      expect(tx1.calculateHash()).toBe(tx2.calculateHash());
    });

    it("should generate different hash for different data", () => {
      const tx1 = new Transaction("from", "to", 100);
      tx1.timestamp = 1000;

      const tx2 = new Transaction("from", "to", 200);
      tx2.timestamp = 1000;

      expect(tx1.calculateHash()).not.toBe(tx2.calculateHash());
    });
  });

  describe("sign", () => {
    it("should add signature to transaction", () => {
      const keyPair = generateTestKeyPair();
      const fromAddress = keyPair.getPublic("hex");

      const tx = new Transaction(fromAddress, "to-address", 100);
      tx.sign(keyPair);

      expect(tx.signature).toBeDefined();
      expect(tx.signature?.length).toBeGreaterThan(0);
    });

    it("should throw error when signing with wrong key", () => {
      const keyPair = generateTestKeyPair();
      const wrongKeyPair = generateTestKeyPair();
      const fromAddress = keyPair.getPublic("hex");

      const tx = new Transaction(fromAddress, "to-address", 100);

      expect(() => {
        tx.sign(wrongKeyPair);
      }).toThrow("You cannot sign transactions for other wallets!");
    });
  });

  describe("isValid", () => {
    it("should return true for properly signed transaction", () => {
      const keyPair = generateTestKeyPair();
      const fromAddress = keyPair.getPublic("hex");

      const tx = new Transaction(fromAddress, "to-address", 100);
      tx.sign(keyPair);

      expect(tx.isValid()).toBe(true);
    });

    it("should throw error for unsigned transaction", () => {
      const tx = new Transaction("from-address", "to-address", 100);

      expect(() => {
        tx.isValid();
      }).toThrow("No signature in this transaction");
    });

    it("should return true for null fromAddress (coinbase)", () => {
      const tx = new Transaction(null as any, "to-address", 100);
      expect(tx.isValid()).toBe(true);
    });
  });
});
