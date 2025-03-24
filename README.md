## Endpoints

### Transaction Operations

| Endpoint            | Method | Description                                |
| ------------------- | ------ | ------------------------------------------ |
| `/transaction`      | POST   | Create and broadcast a new transaction     |
| `/balance/:address` | GET    | Get account balance for a specific address |

#### POST /transaction

Create and broadcast a new transaction to the network.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| fromAddress | string | Yes | Sender's public key |
| toAddress | string | Yes | Recipient's public key |
| amount | number | Yes | Amount to transfer |
| fee | number | Yes | Transaction fee (minimum: 0.001) |
| privateKey | string | Yes | Sender's private key for signing |

**Response:**

```json
{
  "success": true,
  "transaction": {
    "fromAddress": "string",
    "toAddress": "string",
    "amount": number,
    "fee": number,
    "signature": "string",
    "timestamp": number
  },
  "message": "Transaction broadcast to network"
}
```

### Wallet Operations

| Endpoint                   | Method | Description                   |
| -------------------------- | ------ | ----------------------------- |
| `/wallet/create`           | POST   | Create a new wallet           |
| `/address/status/:address` | GET    | Check if an address is banned |

#### POST /wallet/create

Create a new wallet with a key pair.

**Response:**

```json
{
  "address": "string",
  "privateKey": "string",
  "balance": 0,
  "message": "Wallet created successfully"
}
```

### Blockchain Operations

| Endpoint           | Method | Description                       |
| ------------------ | ------ | --------------------------------- |
| `/supply`          | GET    | Get blockchain supply information |
| `/choose-proposer` | POST   | Select a block proposer           |

#### GET /supply

Get current blockchain supply statistics.

**Response:**

```json
{
  "maxSupply": 21000000,
  "currentSupply": number,
  "blockReward": number,
  "nextHalvingBlock": number
}
```

#### POST /choose-proposer

Select a node as the next block proposer.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| address | string | Yes | Address of the node to be selected as proposer |

**Response:**

```json
{
  "message": "Proposer {address} has been selected and broadcast to network"
}
```

### Account Operations

#### GET /balance/:address

Get account balance and information.

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| address | string | The public key of the account |

**Response:**

```json
{
  "address": "string",
  "balance": number,
  "nonce": number
}
```

#### GET /address/status/:address

Check if an address is banned or active.

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| address | string | The public key to check |

**Response:**

```json
{
  "address": "string",
  "status": "banned" | "active",
  "message": "string"
}
```

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "error": "Error message description",
  "details": "Additional error details (optional)"
}
```

Common HTTP Status Codes:
| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request |
| 404 | Not Found |
| 500 | Internal Server Error |

## Notes

- All transactions require a minimum fee of 0.001
- Private keys should never be shared or exposed
- Transactions must be signed with the corresponding private key
- Block proposer selection is broadcast to all nodes in the network
