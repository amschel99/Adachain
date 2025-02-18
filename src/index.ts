import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { Wallet } from "./types";
import { ec, Blockchain } from "./blockchain";
const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = 5000;
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json(`POU is up and running`);
});
app.post("/create-chain", (req: Request, res: Response) => {
  const chain = new Blockchain();
  res.status(200).json(chain?.chain_id);
});
app.post("/verify-identity", (req: Request, res: Response) => {
  //
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

app.listen(PORT, (error?: Error) => {
  if (error) {
    console.error("Error starting server:", error);
  } else {
    console.log(`Server is running on port ${PORT}`);
  }
});
