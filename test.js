// test.js - quick sanity check without needing mongo running
// just tests the ingest + matching logic

const { ingestCSV } = require('./ingest')
const { runMatching } = require('./matcher')

async function main() {
  console.log('=== QUICK TEST (no mongo needed) ===\n')

  const config = {
    timestampToleranceSec: 300,
    quantityTolerancePct: 0.01,
  }

  const { rows: userRows, issues: userIssues } = await ingestCSV('./user_transactions.csv', 'user')
  const { rows: exchangeRows, issues: exchangeIssues } = await ingestCSV('./exchange_transactions.csv', 'exchange')

  console.log('\n--- DATA QUALITY ISSUES ---')
  console.log('User file issues:')
  userIssues.forEach(r => console.log(`  ${r.transaction_id}: ${r._issues.join(', ')}`))
  console.log('Exchange file issues:')
  exchangeIssues.forEach(r => console.log(`  ${r.transaction_id}: ${r._issues.join(', ')}`))

  console.log('\n--- RUNNING MATCHER ---')
  const results = runMatching(userRows, exchangeRows, config)

  console.log('\n--- MATCHED ---')
  results.matched.forEach(m => {
    console.log(`  ${m.userRow.transaction_id} <-> ${m.exchangeRow.transaction_id} | ${m.userRow.asset} ${m.userRow.type} | ts_diff=${m.tsDiff} qty_diff=${m.qtyDiffPct}`)
  })

  console.log('\n--- CONFLICTING ---')
  results.conflicting.forEach(m => {
    console.log(`  ${m.userRow.transaction_id} <-> ${m.exchangeRow.transaction_id} | REASON: ${m.reason}`)
  })

  console.log('\n--- UNMATCHED USER ---')
  results.unmatchedUser.forEach(m => {
    console.log(`  ${m.userRow.transaction_id} | ${m.userRow.asset} ${m.userRow.type} | ${m.reason}`)
  })

  console.log('\n--- UNMATCHED EXCHANGE ---')
  results.unmatchedExchange.forEach(m => {
    console.log(`  ${m.exchangeRow.transaction_id} | ${m.exchangeRow.asset} ${m.exchangeRow.type} | ${m.reason}`)
  })

  console.log('\n--- SUMMARY ---')
  console.log(`matched: ${results.matched.length}`)
  console.log(`conflicting: ${results.conflicting.length}`)
  console.log(`unmatched user: ${results.unmatchedUser.length}`)
  console.log(`unmatched exchange: ${results.unmatchedExchange.length}`)
  console.log(`data quality issues: ${userIssues.length + exchangeIssues.length}`)
}

main().catch(console.error)
