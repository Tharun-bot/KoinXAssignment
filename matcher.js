// matcher.js
// this is the hard part. spent most of my time here.
// 
// matching strategy:
// 1. try exact ID match first (if IDs happen to correlate - they dont in our data but good to have)
// 2. fuzzy match by: asset + type (with equivalents) + timestamp window + quantity tolerance
// 3. anything leftover = unmatched

// TRANSFER_IN on exchange = TRANSFER_OUT on user (same tx, opposite perspective)
// also need to handle BUY/SELL staying same
const TYPE_EQUIVALENTS = {
  'TRANSFER_OUT': ['TRANSFER_OUT', 'TRANSFER_IN'],
  'TRANSFER_IN': ['TRANSFER_IN', 'TRANSFER_OUT'],
  'BUY': ['BUY'],
  'SELL': ['SELL'],
}

function typesMatch(userType, exchangeType) {
  if (!userType || !exchangeType) return false
  const equivalents = TYPE_EQUIVALENTS[userType] || [userType]
  return equivalents.includes(exchangeType)
}

function timestampDiffSec(t1, t2) {
  if (!t1 || !t2) return Infinity
  return Math.abs(t1.getTime() - t2.getTime()) / 1000
}

function quantityDiffPct(q1, q2) {
  if (q1 === null || q2 === null) return Infinity
  if (q1 === 0 && q2 === 0) return 0
  if (q1 === 0 || q2 === 0) return Infinity
  return Math.abs(q1 - q2) / Math.max(q1, q2)
}

// find best match for a user row from remaining exchange rows
function findBestMatch(userRow, exchangeRows, config) {
  const { timestampToleranceSec, quantityTolerancePct } = config
  
  let bestMatch = null
  let bestScore = Infinity // lower is better (combined diff)
  let bestTsDiff = Infinity
  let bestQtyDiff = Infinity

  for (const exRow of exchangeRows) {
    // asset must match exactly (already normalized)
    if (userRow.asset !== exRow.asset) continue

    // type must be compatible
    if (!typesMatch(userRow.type, exRow.type)) continue

    // timestamp check
    const tsDiff = timestampDiffSec(userRow.timestamp, exRow.timestamp)
    if (tsDiff > timestampToleranceSec) continue

    // quantity check - use tolerance as pct
    const qtyDiffPct = quantityDiffPct(userRow.quantity, exRow.quantity)
    
    // score = normalized timestamp diff + qty diff (hacky but works)
    const score = (tsDiff / timestampToleranceSec) + qtyDiffPct * 100
    
    if (score < bestScore) {
      bestScore = score
      bestMatch = exRow
      bestTsDiff = tsDiff
      bestQtyDiff = qtyDiffPct
    }
  }

  if (!bestMatch) return null

  // now decide: matched or conflicting?
  // conflicting = we found a candidate but something is off beyond tolerance
  const isWithinQtyTolerance = bestQtyDiff <= (quantityTolerancePct / 100)
  const isWithinTsTolerance = bestTsDiff <= timestampToleranceSec

  // they should both be within tolerance since we filtered... but double check qty
  // (we only hard-filtered timestamp, qty we let through to detect conflicts)
  
  return {
    match: bestMatch,
    tsDiff: bestTsDiff,
    qtyDiffPct: bestQtyDiff,
    isConflicting: !isWithinQtyTolerance, // ts was already filtered
  }
}

function runMatching(userRows, exchangeRows, config) {
  const { timestampToleranceSec, quantityTolerancePct } = config
  
  const matched = []
  const conflicting = []
  const unmatchedUser = []
  
  // track which exchange rows have been used
  const usedExchangeIds = new Set()
  
  // make a mutable copy
  let availableExchange = [...exchangeRows]

  for (const userRow of userRows) {
    // filter to only unused exchange rows
    const remaining = availableExchange.filter(r => !usedExchangeIds.has(r.transaction_id))
    
    // pass a slightly relaxed qty tolerance for candidate finding
    // we'll classify as conflicting after
    const relaxedConfig = {
      ...config,
      quantityTolerancePct: 999, // don't filter by qty in findBestMatch, just by ts and type/asset
    }
    
    const result = findBestMatch(userRow, remaining, relaxedConfig)
    
    if (!result) {
      unmatchedUser.push({
        userRow,
        reason: `no exchange row found matching asset=${userRow.asset}, type=${userRow.type} within ${timestampToleranceSec}s`,
      })
      continue
    }

    const { match: exRow, tsDiff, qtyDiffPct, isConflicting } = result
    
    // mark this exchange row as used
    usedExchangeIds.add(exRow.transaction_id)

    const isWithinQtyTol = qtyDiffPct <= (quantityTolerancePct / 100)

    if (!isWithinQtyTol) {
      // found a candidate but quantity is off
      conflicting.push({
        userRow,
        exchangeRow: exRow,
        tsDiff: tsDiff.toFixed(1) + 's',
        qtyDiffPct: (qtyDiffPct * 100).toFixed(4) + '%',
        reason: `quantity mismatch: user=${userRow.quantity} exchange=${exRow.quantity} (diff=${(qtyDiffPct*100).toFixed(4)}%, tolerance=${quantityTolerancePct}%)`,
      })
    } else {
      matched.push({
        userRow,
        exchangeRow: exRow,
        tsDiff: tsDiff.toFixed(1) + 's',
        qtyDiffPct: (qtyDiffPct * 100).toFixed(4) + '%',
        reason: `matched: ts_diff=${tsDiff.toFixed(1)}s, qty_diff=${(qtyDiffPct*100).toFixed(4)}%`,
      })
    }
  }

  // whatever exchange rows are left = unmatched exchange only
  const unmatchedExchange = exchangeRows
    .filter(r => !usedExchangeIds.has(r.transaction_id))
    .map(r => ({
      exchangeRow: r,
      reason: `no user row found matching asset=${r.asset}, type=${r.type} within ${timestampToleranceSec}s`,
    }))

  return { matched, conflicting, unmatchedUser, unmatchedExchange }
}

module.exports = { runMatching }
