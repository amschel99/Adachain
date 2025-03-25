import { Transaction } from "./blockchain";

export interface Wallet {
  private_key: string;
  public_key: string;
  address?: string;
}

export interface TxIndex {
  id: string;
  transactions: Array<Transaction>;
}

export interface Token {
  id: string;
  value: number;
  hash: string;
  owner: string;
  createdAt: Date;
}

export type Mempool = Array<TxIndex>;
