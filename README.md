# crypto-reconciler

transaction reconciliation engine for crypto. built for the assignment.

## what it does

takes two CSVs (user export + exchange export), matches transactions across them, spits out a reconciliation report. handles messy data, timestamp drift, asset name aliases, TRANSFER_IN/OUT perspective flipping.

## setup

need:
- Node.js (v18+)
- MongoDB running locally (or set MONGO_URL env var)

```bash
git clone <repo>
cd crypto-reconciler
npm install
# edit .env if needed (mongo url, port, tolerances)
```

put your CSV files in the project root as `user_transactions.csv` and `exchange_transactions.csv` (or pass paths in the request body).

start mongo:
```bash
mongod --dbpath /your/data/path
```

start server:
```bash
node index.js
```

quick test without mongo (just checks logic):
```bash
node test.js
```

## API

### POST /reconcile
trigger a reconciliation run.

```bash
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{}'
```

optional config overrides:
```json
{
  "timestamp_tolerance_seconds": 60,
  "quantity_tolerance_pct": 0.05,
  "user_file": "./my_user_txns.csv",
  "exchange_file": "./my_exchange_txns.csv"
}
```

returns:
```json
{
  "runId": "some-uuid",
  "summary": {
    "matched": 21,
    "conflicting": 1,
    "unmatched_user": 0,
    "unmatched_exchange": 3,
    "data_quality_issues": 4
  }
}
```

### GET /report/:runId
full report with all rows

### GET /report/:runId/summary
just the counts

### GET /report/:runId/unmatched
only unmatched rows + data quality issues

## config

env vars (or set in .env):

| var | default | description |
|-----|---------|-------------|
| MONGO_URL | mongodb://localhost:27017/crypto_reconciler | mongo connection |
| PORT | 3000 | server port |
| TIMESTAMP_TOLERANCE_SECONDS | 300 | how close timestamps need to be |
| QUANTITY_TOLERANCE_PCT | 0.01 | max quantity diff % to consider matched |

can also override per-request in the POST /reconcile body.

## CSV output

reports are saved to `./reports/<runId>.csv` with columns for both sides of the transaction, the category (MATCHED/CONFLICTING/UNMATCHED_USER_ONLY/UNMATCHED_EXCHANGE_ONLY), and a reason.

## decisions I made (unclear requirements)

**matching algorithm**
went with fuzzy matching on asset + type + timestamp window + quantity tolerance. first filters by asset + compatible type, then finds best candidate by minimizing a combined timestamp/quantity score. didn't implement ID-based cross-matching because the sample data uses completely different ID formats (USR-001 vs EXC-1001) with no correlation.

**TRANSFER_IN vs TRANSFER_OUT**
treated as the same transaction from opposite perspectives. USR-004 (TRANSFER_OUT) matches EXC-1004 (TRANSFER_IN). both are valid - the exchange sees it as receiving ETH, the user sees it as sending.

**bad rows: don't drop, flag**
rows with broken core fields (no timestamp, negative quantity, bad type, duplicates) are flagged and skipped from matching but still logged in the report under data_quality_issues. rows with minor issues (like asset aliases) are still attempted for matching with a warning flag.

**quantity tolerance is % based**
0.01% default means a quantity of 0.3 vs 0.3001 is ~0.033% difference -> conflicting. made sense to me since absolute tolerance doesn't scale across BTC (0.0001 matters) vs USDT (500.00 doesn't need 4 decimal precision).

**duplicate user row**
USR-001 appears twice in user_transactions.csv - second occurrence is dropped (duplicate ID = skip).

**EXC-1018 unmatched**
this is USR-018 which had a malformed timestamp so got dropped during ingestion. the exchange has the tx but user data is too broken to match. flagged in data issues + unmatched exchange.

**no auth on the API**
it's an internal tool, didn't add auth. would add it for prod obviously.

**mongo schema is flexible**
used Mixed type for the arrays since the row shape can vary (matched has both sides, unmatched has one side). probably not ideal for a real prod system but fine for this.

## results on sample data

with default config (300s tolerance, 0.01% qty):
- matched: 21
- conflicting: 1 (USR-012/EXC-1012, qty 0.3 vs 0.3001)
- unmatched user: 0
- unmatched exchange: 3 (EXC-1018 whose user counterpart had bad timestamp, EXC-1024, EXC-1025 have no user equivalent)
- data quality issues: 4 (duplicate USR-001, malformed timestamp USR-018, negative qty USR-019, missing timestamp+type USR-024)
