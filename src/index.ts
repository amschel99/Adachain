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

const PORT = 8800;
const wss = new WebSocket.Server({ noServer: true });

interface CustomPeer extends WebSocket {
  url: string;
}

let peers: CustomPeer[] = [];

wss.on("connection", (client: WebSocket) => {
  client.on("open", () => {
    client.send(
      JSON.stringify({
        event: "KNOWN_PEERS",
        data: {
          value: peers.map((peer) => peer.url),
        },
      })
    );
  });
});

function addPeer(peerUrl: string) {
  if (!peers.some((peer) => peer.url === peerUrl)) {
    const peerServer = new WebSocket(peerUrl) as CustomPeer;
    peerServer.url = peerUrl;

    peerServer.on("open", () => {
      console.log("Connected to peer", peerUrl);
    });

    peerServer.on("message", (rawData) => {
      try {
        const { event, data } = JSON.parse(rawData.toString());
        if (event === "KNOWN_PEERS") {
          data.value.forEach((url: string) => addPeer(url));
        }
      } catch (err) {
        console.error("Message parse error:", err);
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
const httpServer = http.createServer(app);
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json(`POU is up and running`);
});
app.get("/find-peers", async (req: Request, res: Response) => {
  const { address } = req?.body;
  if (!address) {
    res.status(400).json(`A peer adress must be provided`);
  }
  try {
    addPeer(address);
    res.status(201).json(`Atleast connected to one peer`);
  } catch (e) {
    res.status(500).json(`Error while trying to connect to a peer`);
  }
});
app.post("/create-chain", async (req: Request, res: Response) => {
  try {
    const chain = new Blockchain();
    const data = JSON.stringify(chain, null, 2);
    fs.writeFile(CHAIN_PATH, data, "utf-8");
    res.status(200).json(chain?.chain_id);
  } catch (e) {
    res.status(500).json(`Error while trying to save the blockchain on Disk`);
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
app.post("/signTxn", (req: Request, res: Response) => {
  const { private_key, address, recipient, amount } = req.body;
  if (!private_key || address || recipient || amount) {
    res.status(400).json(`Bad request, provide all txn details`);
  }
  try {
    const tx: Transaction = new Transaction(address, recipient, amount);
    tx.sign(private_key);
    res.status(201).json("TXN Broadcasted succesfully");
  } catch (e) {
    res.status(500).json(`Internal server error while signing txn`);
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

httpServer.on("upgrade", (request, socket, head) => {
  if (request.url.startsWith("/socket.io")) {
  } else {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  }
});

httpServer.listen(process.env.PORT, (error?: Error) => {
  if (error) {
    console.error("Error starting server:", error);
  } else {
    console.log(`Server is running on port ${PORT}`);
  }
});
