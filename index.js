// crypto reconciler - built this over like 2 nights lol
// TODO: clean this up later (never)

require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const { v4: uuidv4 } = require('uuid')

const { ingestCSV } = require('./ingest')
const { runMatching } = require('./matcher')
const { buildReport, getReport, getSummary, getUnmatched } = require('./report')

const app = express()
app.use(express.json())

// connect to mongo - if this fails youre on your own lol
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/crypto_reconciler'
mongoose.connect(MONGO_URL)
  .then(() => console.log('mongo connected'))
  .catch(err => {
    console.error('mongo connection failed:', err.message)
    console.error('make sure mongod is running!!!')
    process.exit(1)
  })

// POST /reconcile
// accepts optional config in body: { timestamp_tolerance_seconds, quantity_tolerance_pct }
app.post('/reconcile', async (req, res) => {
  try {
    const runId = uuidv4()
    console.log(`\n=== starting reconciliation run: ${runId} ===`)

    // tolerance config - body overrides env which overrides defaults
    const config = {
      timestampToleranceSec: parseInt(
        req.body.timestamp_tolerance_seconds ||
        process.env.TIMESTAMP_TOLERANCE_SECONDS ||
        300
      ),
      quantityTolerancePct: parseFloat(
        req.body.quantity_tolerance_pct ||
        process.env.QUANTITY_TOLERANCE_PCT ||
        0.01
      ),
    }
    console.log('config:', config)

    // ingest both files
    // hardcoded paths for now, could make this configurable but ehh
    const userFile = req.body.user_file || './user_transactions.csv'
    const exchangeFile = req.body.exchange_file || './exchange_transactions.csv'

    console.log('ingesting user file...')
    const { rows: userRows, issues: userIssues } = await ingestCSV(userFile, 'user')
    console.log(`user: ${userRows.length} good rows, ${userIssues.length} issues`)

    console.log('ingesting exchange file...')
    const { rows: exchangeRows, issues: exchangeIssues } = await ingestCSV(exchangeFile, 'exchange')
    console.log(`exchange: ${exchangeRows.length} good rows, ${exchangeIssues.length} issues`)

    // run matching
    console.log('running matcher...')
    const matchResults = runMatching(userRows, exchangeRows, config)
    console.log(`matched: ${matchResults.matched.length}, conflicting: ${matchResults.conflicting.length}`)
    console.log(`unmatched user: ${matchResults.unmatchedUser.length}, unmatched exchange: ${matchResults.unmatchedExchange.length}`)

    // save report to db
    await buildReport(runId, matchResults, userIssues, exchangeIssues, config)

    res.json({
      runId,
      message: 'reconciliation complete',
      summary: {
        matched: matchResults.matched.length,
        conflicting: matchResults.conflicting.length,
        unmatched_user: matchResults.unmatchedUser.length,
        unmatched_exchange: matchResults.unmatchedExchange.length,
        data_quality_issues: userIssues.length + exchangeIssues.length,
      }
    })
  } catch (err) {
    console.error('reconcile error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /report/:runId
app.get('/report/:runId', async (req, res) => {
  try {
    const report = await getReport(req.params.runId)
    if (!report) return res.status(404).json({ error: 'run not found' })
    res.json(report)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /report/:runId/summary
app.get('/report/:runId/summary', async (req, res) => {
  try {
    const summary = await getSummary(req.params.runId)
    if (!summary) return res.status(404).json({ error: 'run not found' })
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /report/:runId/unmatched
app.get('/report/:runId/unmatched', async (req, res) => {
  try {
    const unmatched = await getUnmatched(req.params.runId)
    if (!unmatched) return res.status(404).json({ error: 'run not found' })
    res.json(unmatched)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`)
  console.log(`try: POST http://localhost:${PORT}/reconcile`)
})
