import { ec as EC } from "elliptic";
import * as crypto from "crypto";

const ec = new EC("secp256k1");

// Test data from the user
const testData = {
  fromAddress:
    "049fb701e739e69323046353a1b84a582e6a982ee5baae6c729c685530def4dc64120d6c17fd54eba1b9fc9bb0e95be9fc4533a20e4b96b2976b36b2a5ffcf87de",
  toAddress:
    "044d985e5203b4203fdf6ced80c117c1208062adb87985a5abb3189412ad43ea2f358813e087584f44bb57c131fa24e5ef24f1d0c97070dfb1f496466dfadcfc0f",
  amount: 10,
  fee: 0.2,
  privateKey:
    "bd7d80776e8f28034a9bb49eb51e30686827ce6c00859d9224879b01fbabdb14",
};

// Verify if the private key corresponds to the public key
function checkKeyPair() {
  try {
    const keyPair = ec.keyFromPrivate(testData.privateKey);
    const derivedPublicKey = keyPair.getPublic("hex");

    console.log("Original fromAddress:", testData.fromAddress);
    console.log("Derived public key:", derivedPublicKey);

    if (testData.fromAddress === derivedPublicKey) {
      console.log("✅ Private key matches the provided fromAddress");
    } else {
      console.log("❌ Private key does NOT match the provided fromAddress");
      console.log("This is likely the root cause of the verification failure!");
    }
  } catch (error) {
    console.error("Error checking key pair:", error.message);
  }
}

// Class to simulate the Transaction for testing
class TestTransaction {
  fromAddress: string;
  toAddress: string;
  amount: number;
  timestamp: number;
  fee: number;
  signature?: string;

  constructor(
    fromAddress: string,
    toAddress: string,
    amount: number,
    fee: number
  ) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = Date.now();
    this.fee = fee;
  }

  calculateHash(): string {
    return crypto
      .createHash("sha256")
      .update(this.fromAddress + this.toAddress + this.amount + this.timestamp)
      .digest("hex");
  }

  sign(signingKey: any) {
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

// Test the signature verification
function testSignatureVerification() {
  try {
    // Create transaction
    const tx = new TestTransaction(
      testData.fromAddress,
      testData.toAddress,
      testData.amount,
      testData.fee
    );

    console.log("\n--- Testing transaction signature ---");

    // Initial hash
    const initialHash = tx.calculateHash();
    console.log("Transaction hash:", initialHash);

    // Load private key
    const keyPair = ec.keyFromPrivate(testData.privateKey);

    // Try signing
    try {
      tx.sign(keyPair);
      console.log("Signature created:", tx.signature);
    } catch (error) {
      console.error("❌ Signing failed:", error.message);
      return;
    }

    // Verify signature
    try {
      const isValid = tx.isValid();
      console.log("Is transaction valid?", isValid ? "✅ Yes" : "❌ No");
    } catch (error) {
      console.error("❌ Validation failed:", error.message);
    }
  } catch (error) {
    console.error("Error in signature test:", error.message);
  }
}

// Test what happens in the transaction endpoint more closely
function testTransactionEndpoint() {
  console.log("\n=== Simulating Transaction Endpoint ===");

  try {
    // Step 1: Create a transaction (simulates the server creating a transaction from request)
    const tx = new TestTransaction(
      testData.fromAddress,
      testData.toAddress,
      testData.amount,
      testData.fee
    );
    console.log("Created transaction with timestamp:", tx.timestamp);

    // Step 2: Generate key pair from private key
    const keyPair = ec.keyFromPrivate(testData.privateKey);
    const publicKey = keyPair.getPublic("hex");

    // Check if the public key matches the fromAddress
    if (publicKey !== testData.fromAddress) {
      console.log(
        "❌ WARNING: Public key from private key doesn't match fromAddress"
      );
      console.log(
        "This will cause signature verification to fail on the server!"
      );
      console.log("Actual public key from private key:", publicKey);
    }

    // Step 3: Sign the transaction
    try {
      tx.sign(keyPair);
      console.log("Signature created:", tx.signature);
    } catch (error) {
      console.error("❌ Signing failed:", error.message);
      return;
    }

    // Step 4: Server broadcasts transaction to network
    console.log("Transaction broadcast to network (simulated)");

    // Step 5: Another node receives the transaction and verifies
    console.log("\n--- Simulating reception on another node ---");
    try {
      // Create a copy with same data but potentially different timestamp
      // This is what happens when another node recreates the transaction
      const receivedTx = new TestTransaction(
        tx.fromAddress,
        tx.toAddress,
        tx.amount,
        tx.fee
      );

      // Copy the signature from the original transaction
      receivedTx.signature = tx.signature;

      // Override timestamp to match original
      receivedTx.timestamp = tx.timestamp;
      console.log("Received transaction with timestamp:", receivedTx.timestamp);

      // Verify signature
      const isValid = receivedTx.isValid();
      console.log(
        "Is transaction valid on receiving node?",
        isValid ? "✅ Yes" : "❌ No"
      );

      if (!isValid) {
        console.log(
          "Verification failed likely due to timestamp or data mismatch"
        );

        // For debugging - check hashes
        console.log("Original transaction hash:", tx.calculateHash());
        console.log("Received transaction hash:", receivedTx.calculateHash());
      }
    } catch (error) {
      console.error("❌ Validation on receiving node failed:", error.message);
    }
  } catch (error) {
    console.error("Error in transaction endpoint test:", error.message);
  }
}

// Run the tests
console.log("=== Key Pair Verification ===");
checkKeyPair();

console.log("\n=== Signature Verification ===");
testSignatureVerification();

// Run the transaction endpoint simulation
testTransactionEndpoint();
