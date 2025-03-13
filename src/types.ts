import { Transaction } from "./blockchain";

export interface Wallet {
  private_key: string;
  public_key: string;
  address?: string;
}

export type FixedLengthArray<T, N extends number> = T[] & { length: N };

export interface TxIndex {
  id: string;
  transactions: FixedLengthArray<Transaction, 10>;
}

export type Mempool = Array<TxIndex>;
