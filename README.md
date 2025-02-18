### Sol token deployer

## Instructions to run

Run locally using npm run start. The server listens on port 4400.
Use curl to make the request

```bash
 curl -X POST http://localhost:4400/deploy-token \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyToken",
    "symbol": "MTK",
    "supply": 1000000,
    "image": "https://example.com/token-image.png"
     }'
```
