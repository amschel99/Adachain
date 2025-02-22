import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { Wallet } from "./types";
import { ec, Blockchain, Transaction } from "./blockchain";
import { connectDb } from "./utils/dbconfig";
import dotenv from "dotenv";
import * as fs from "fs/promises";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

const CHAIN_PATH = "blockchain.json";
const app = express();
dotenv.config();

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8800;
const NODE_WS_URL = `ws://localhost:${PORT}`;
const wss = new WebSocketServer({ noServer: true });

interface CustomPeer extends WebSocket {
  latency?: number;
  chainLength?: number;
}

let peers: CustomPeer[] = [];

async function readBlockchain(): Promise<Blockchain> {
  const data = await fs.readFile(CHAIN_PATH, "utf-8");
  return JSON.parse(data);
}

async function writeBlockchain(chain: Blockchain): Promise<void> {
  await fs.writeFile(CHAIN_PATH, JSON.stringify(chain, null, 2));
}

function validateChain(chain: Blockchain): boolean {
  return chain.isChainValid();
}

wss.on("connection", (client: CustomPeer) => {
  client.on("open", () => {
    client.send(
      JSON.stringify({
        event: "KNOWN_PEERS",
        data: { value: peers.map((peer) => peer.url) },
      })
    );
  });

  client.on("message", async (rawData) => {
    try {
      const { event, data } = JSON.parse(rawData.toString());

      switch (event) {
        case "IBD_REQUEST":
          const localChain = await readBlockchain();
          client.send(
            JSON.stringify({
              event: "IBD_RESPONSE",
              data: {
                chain: localChain,
                timestamp: Date.now(),
                nodeId: NODE_WS_URL,
              },
            })
          );
          break;

        case "IBD_RESPONSE":
          if (validateChain(data.chain)) {
            const localChain = await readBlockchain();
            if (data.chain.length > localChain.chain.length) {
              await writeBlockchain(data.chain);
              console.log("Blockchain updated via IBD");
            }
          }
          break;

        case "KNOWN_PEERS":
          data.value.forEach((url: string) => addPeer(url));
          break;
      }
    } catch (err) {
      console.error("Message handling error:", err);
    }
  });
});

// Peer Management
function selectBestPeer(): CustomPeer | undefined {
  return peers.reduce(
    (best, current) =>
      (current.chainLength || 0) > (best.chainLength || 0) ? current : best,
    peers[0]
  );
}

function addPeer(peerUrl: string) {
  if (!peers.some((peer) => peer.url === peerUrl)) {
    const peerServer = new WebSocket(peerUrl) as CustomPeer;
    console.log(peerServer?.url);
    // peerServer.url = peerUrl;

    peerServer.on("open", async () => {
      console.log("Connected to peer", peerUrl);
      // Request chain info for IBD readiness
      const localChain = await readBlockchain();
      peerServer.send(
        JSON.stringify({
          event: "CHAIN_INFO",
          data: { length: localChain.chain.length },
        })
      );
    });

    peerServer.on("message", async (rawData) => {
      try {
        const { event, data } = JSON.parse(rawData.toString());

        if (event === "CHAIN_INFO") {
          peerServer.chainLength = data.length;
        }

        // Handle other events...
      } catch (err) {
        console.error("Peer message error:", err);
      }
    });

    peerServer.on("close", () => {
      console.log("Peer disconnected:", peerUrl);
      peers = peers.filter((p) => p.url !== peerUrl);
      setTimeout(() => addPeer(peerUrl), 5000);
    });

    peerServer.on("error", (err) => {
      console.error("Peer connection error:", peerUrl, err);
    });

    peers.push(peerServer);
  }
}

// HTTP Server Setup
const httpServer = http.createServer(app);

// API Endpoints
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json("Node operational");
});
app.get("/find-peers", async (req: Request, res: Response) => {
  const { address } = req.query;
  if (!address) {
    res.status(400).json(`A peer adress must be provided`);
  } else {
    try {
      addPeer(address as string);
      res.status(201).json(`Atleast connected to one peer`);
    } catch (e) {
      console.log(e);
      res.status(500).json(`Error while trying to connect to a peer`);
    }
  }
});
app.post("/verify-identity", async (req: Request, res: Response) => {
  const { identity } = req?.query;
  if (!identity) {
    res.status(400).json(`Bad request, identity must be specified`);
  }
  try {
    const chain: Blockchain = JSON.parse(
      await fs.readFile(CHAIN_PATH, "utf-8")
    );
    chain.addVerifiedIdentity(identity as string);
    res.status(201).json(`Verified identitiy`);
  } catch (e) {
    res.status(500).json(`Internal server error while trying to add identity`);
  }
});

app.post("/ibd", async (req: Request, res: Response) => {
  try {
    const bestPeer = selectBestPeer();
    if (!bestPeer) throw new Error("No available peers");

    bestPeer.send(
      JSON.stringify({
        event: "IBD_REQUEST",
        data: { requester: NODE_WS_URL },
      })
    );

    res.status(200).json("IBD initiated with best peer");
  } catch (e) {
    res.status(500).json(`IBD failed: ${e.message}`);
  }
});

app.post("/create-chain", async (req: Request, res: Response) => {
  try {
    const chain = new Blockchain();
    await writeBlockchain(chain);
    res.status(200).json(chain.chain_id);
  } catch (e) {
    res.status(500).json("Chain creation failed");
  }
});
app.post("/propose-block", async (req: Request, res: Response) => {
  const { txns, key } = req?.body;

  if (!txns) {
    res.status(400).json(`A list of transactions must be provided`);
  }
  try {
    const chain: Blockchain = JSON.parse(
      await fs.readFile(CHAIN_PATH, "utf-8")
    );
    chain.proposeBlock(txns, key);
    res.status(201).json(`Block proposed`);
  } catch (e) {
    res.status(500).json(`Internal server error while proposing blocks`);
  }
});
app.post("/create-wallet", (req: Request, res: Response) => {
  const key = ec.genKeyPair();
  const publicKey = key.getPublic("hex");
  const privateKey = key.getPrivate("hex");
  let wallet: Wallet = {
    private_key: privateKey,
    public_key: publicKey,
  };
  res.status(201).json(wallet);
});
app.post("/signTxn", (req: Request, res: Response) => {
  const { private_key, address, recipient, amount } = req.body;
  if (!private_key || !address || !recipient || !amount) {
    res.status(400).json("Missing transaction details");
  }

  try {
    const tx = new Transaction(address, recipient, amount);
    tx.sign(private_key);
    // Broadcast transaction to network
    peers.forEach((peer) => {
      peer.send(
        JSON.stringify({
          event: "NEW_TRANSACTION",
          data: { transaction: tx },
        })
      );
    });
    res.status(201).json("Transaction broadcasted");
  } catch (e) {
    res.status(500).json("Transaction failed");
  }
});

// Server Startup
httpServer.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Node running on port ${PORT}`);

  if (process.env.BOOTSTRAP_PEERS) {
    process.env.BOOTSTRAP_PEERS.split(",").forEach(addPeer);
  }
});
