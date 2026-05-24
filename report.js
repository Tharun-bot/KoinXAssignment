// report.js
// builds the report doc in mongo and also generates the CSV output

const fs = require('fs')
const path = require('path')
const { stringify } = require('csv-stringify/sync')
const { ReconciliationRun } = require('./models')

// flatten a match entry into a flat CSV row
function flattenMatchRow(entry, category) {
  const u = entry.userRow || {}
  const e = entry.exchangeRow || {}
  
  return {
    category,
    reason: entry.reason || '',
    // user side
    user_tx_id: u.transaction_id || '',
    user_timestamp: u.raw_timestamp || '',
    user_type: u.type || '',
    user_asset: u.asset || '',
    user_raw_asset: u.raw_asset || '',
    user_quantity: u.quantity ?? '',
    user_price_usd: u.price_usd ?? '',
    user_fee: u.fee ?? '',
    user_note: u.note || '',
    user_had_issues: u._hasIssues ? u._issueReasons.join('; ') : '',
    // exchange side
    exchange_tx_id: e.transaction_id || '',
    exchange_timestamp: e.raw_timestamp || '',
    exchange_type: e.type || '',
    exchange_asset: e.asset || '',
    exchange_quantity: e.quantity ?? '',
    exchange_price_usd: e.price_usd ?? '',
    exchange_fee: e.fee ?? '',
    exchange_note: e.note || '',
    // diff info (only for matched/conflicting)
    ts_diff_seconds: entry.tsDiff || '',
    qty_diff_pct: entry.qtyDiffPct || '',
  }
}

async function buildReport(runId, matchResults, userIssues, exchangeIssues, config) {
  const { matched, conflicting, unmatchedUser, unmatchedExchange } = matchResults

  // build flat CSV rows
  const csvRows = []
  
  for (const entry of matched) {
    csvRows.push(flattenMatchRow(entry, 'MATCHED'))
  }
  for (const entry of conflicting) {
    csvRows.push(flattenMatchRow(entry, 'CONFLICTING'))
  }
  for (const entry of unmatchedUser) {
    csvRows.push(flattenMatchRow({ userRow: entry.userRow, reason: entry.reason }, 'UNMATCHED_USER_ONLY'))
  }
  for (const entry of unmatchedExchange) {
    csvRows.push(flattenMatchRow({ exchangeRow: entry.exchangeRow, reason: entry.reason }, 'UNMATCHED_EXCHANGE_ONLY'))
  }

  // write CSV to disk
  const reportsDir = './reports'
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir)
  
  const csvPath = path.join(reportsDir, `${runId}.csv`)
  const csvContent = stringify(csvRows, { header: true })
  fs.writeFileSync(csvPath, csvContent)
  console.log(`  CSV report written to ${csvPath}`)

  // save to mongo
  const doc = new ReconciliationRun({
    runId,
    config,
    summary: {
      matched: matched.length,
      conflicting: conflicting.length,
      unmatched_user: unmatchedUser.length,
      unmatched_exchange: unmatchedExchange.length,
      data_quality_issues: userIssues.length + exchangeIssues.length,
    },
    matched,
    conflicting,
    unmatchedUser,
    unmatchedExchange,
    dataIssues: [
      ...userIssues.map(r => ({ ...r, _source: 'user' })),
      ...exchangeIssues.map(r => ({ ...r, _source: 'exchange' })),
    ],
  })

  await doc.save()
  console.log(`  run saved to mongo: ${runId}`)
  
  return { csvPath }
}

async function getReport(runId) {
  const doc = await ReconciliationRun.findOne({ runId }).lean()
  if (!doc) return null

  // also include path to CSV if it exists
  const csvPath = `./reports/${runId}.csv`
  doc.csvReportPath = fs.existsSync(csvPath) ? csvPath : null

  return doc
}

async function getSummary(runId) {
  const doc = await ReconciliationRun.findOne({ runId }, 'runId summary config createdAt').lean()
  return doc || null
}

async function getUnmatched(runId) {
  const doc = await ReconciliationRun.findOne({ runId }, 'runId unmatchedUser unmatchedExchange dataIssues').lean()
  if (!doc) return null
  
  return {
    runId: doc.runId,
    unmatched_user: doc.unmatchedUser.map(e => ({
      transaction_id: e.userRow?.transaction_id,
      timestamp: e.userRow?.raw_timestamp,
      type: e.userRow?.type,
      asset: e.userRow?.asset,
      quantity: e.userRow?.quantity,
      reason: e.reason,
    })),
    unmatched_exchange: doc.unmatchedExchange.map(e => ({
      transaction_id: e.exchangeRow?.transaction_id,
      timestamp: e.exchangeRow?.raw_timestamp,
      type: e.exchangeRow?.type,
      asset: e.exchangeRow?.asset,
      quantity: e.exchangeRow?.quantity,
      reason: e.reason,
    })),
    data_quality_issues: doc.dataIssues?.map(r => ({
      transaction_id: r.transaction_id,
      source: r._source,
      issues: r._issues,
    })) || [],
  }
}

module.exports = { buildReport, getReport, getSummary, getUnmatched }
