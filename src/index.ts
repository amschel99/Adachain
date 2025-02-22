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

const PORT = process.env.PORT || 80;
const NODE_WS_URL = process.env.NODE_URL || `ws://localhost:${PORT}`;
const wss = new WebSocketServer({ noServer: true });

interface CustomPeer extends WebSocket {
  chainLength?: number;
  peerUrl: string;
}

let peers: CustomPeer[] = [];
setInterval(() => {
  console.log(`Connected to ${peers.length} peers`);
  peers.map((peer) => {
    console.log(peer?.url);
  });
}, 2000);

async function readBlockchain(): Promise<Blockchain> {
  try {
    const data = await fs.readFile(CHAIN_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return new Blockchain(); // Create new chain if file doesn't exist
  }
}

async function writeBlockchain(chain: Blockchain): Promise<void> {
  await fs.writeFile(CHAIN_PATH, JSON.stringify(chain, null, 2));
}

function validateChain(chain: Blockchain): boolean {
  return chain.isChainValid();
}

wss.on("connection", (client: CustomPeer) => {
  client.peerUrl = client.url;
  setInterval(() => {
    client.send(
      JSON.stringify({
        event: "REQUEST_KNOWN_PEERS",
        data: { requester: NODE_WS_URL },
      })
    );
  }, 2000);
  // Send initial peer list to new connection
  client.send(
    JSON.stringify({
      event: "KNOWN_PEERS",
      data: {
        value: peers.map((p) => p.peerUrl).concat(NODE_WS_URL),
      },
    })
  );

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
              // Propagate new chain to all peers
              peers.forEach((peer) => {
                peer.send(
                  JSON.stringify({
                    event: "IBD_RESPONSE",
                    data: {
                      chain: data.chain,
                      timestamp: Date.now(),
                      nodeId: NODE_WS_URL,
                    },
                  })
                );
              });
            }
          }
          break;

        case "KNOWN_PEERS":
          data.value.forEach((url: string) => {
            if (url !== NODE_WS_URL) addPeer(url);
          });
          break;

        case "CHAIN_INFO":
          client.chainLength = data.length;
          break;

        case "REQUEST_KNOWN_PEERS":
          client.send(
            JSON.stringify({
              event: "KNOWN_PEERS",
              data: { value: peers.map((p) => p.peerUrl).concat(NODE_WS_URL) },
            })
          );
          break;
      }
    } catch (err) {
      console.error("Message handling error:", err);
    }
  });
});

// Peer Management
function selectBestPeer(): CustomPeer | undefined {
  if (peers.length === 0) return undefined;
  return peers.reduce((best, current) =>
    (current.chainLength || 0) > (best.chainLength || 0) ? current : best
  );
}

function addPeer(peerUrl: string) {
  if (peerUrl === NODE_WS_URL) return;
  if (peers.some((p) => p.peerUrl === peerUrl)) return;

  const peerClient = new WebSocket(peerUrl) as CustomPeer;
  peerClient.peerUrl = peerUrl;

  peerClient.on("open", async () => {
    console.log("Connected to peer:", peerUrl);
    const localChain = await readBlockchain();
    peerClient.send(
      JSON.stringify({
        event: "CHAIN_INFO",
        data: { length: localChain.chain.length },
      })
    );
    peerClient.send(
      JSON.stringify({
        event: "REQUEST_KNOWN_PEERS",
        data: { requester: NODE_WS_URL },
      })
    );
  });

  peerClient.on("message", async (rawData) => {
    try {
      const { event, data } = JSON.parse(rawData.toString());
      if (event === "CHAIN_INFO") {
        peerClient.chainLength = data.length;
      }
      if (event === "KNOWN_PEERS") {
        data.value.forEach((url: string) => addPeer(url));
      }
    } catch (err) {
      console.error("Peer message error:", err);
    }
  });

  peerClient.on("close", () => {
    console.log("Peer disconnected:", peerUrl);
    peers = peers.filter((p) => p.peerUrl !== peerUrl);
    setTimeout(() => addPeer(peerUrl), 5000);
  });

  peerClient.on("error", (err) => {
    console.error("Peer connection error:", peerUrl, err);
    peerClient.terminate();
  });

  peers.push(peerClient);
}

// HTTP Server Setup
const httpServer = http.createServer(app);

// API Endpoints (remain mostly the same as your original code)
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json("Node operational");
});

app.get("/find-peers", async (req: Request, res: Response) => {
  const { address } = req.query;
  if (!address) {
    res.status(400).json("A peer address must be provided");
  } else {
    try {
      addPeer(address as string);
      res.status(201).json("At least connected to one peer");
    } catch (e) {
      console.log(e);
      res.status(500).json("Error while trying to connect to a peer");
    }
  }
});

// ... rest of your API endpoints remain unchanged ...

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
