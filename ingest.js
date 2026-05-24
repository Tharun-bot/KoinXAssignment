// ingest.js - parse CSVs and flag bad rows
// honestly the data quality stuff took forever to figure out

const fs = require('fs')
const { parse } = require('csv-parse/sync')

// asset aliases - BTC has like 50 names apparently
const ASSET_ALIASES = {
  'bitcoin': 'BTC',
  'ethereum': 'ETH',
  'solana': 'SOL',
  'polygon': 'MATIC',
  'tether': 'USDT',
  'chainlink': 'LINK',
}

function normalizeAsset(asset) {
  if (!asset) return null
  const lower = asset.trim().toLowerCase()
  if (ASSET_ALIASES[lower]) return ASSET_ALIASES[lower]
  return asset.trim().toUpperCase()
}

// valid types we care about
const VALID_TYPES = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT']

function parseCSVFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf8')
  // csv-parse handles most edge cases
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true, // some rows might have extra/missing cols
  })
  return records
}

function validateAndClean(row, source) {
  const issues = []

  // check for duplicate transaction IDs - handled at the calling level
  // check timestamp
  let parsedTimestamp = null
  if (!row.timestamp || row.timestamp.trim() === '') {
    issues.push('missing timestamp')
  } else {
    const d = new Date(row.timestamp)
    if (isNaN(d.getTime())) {
      issues.push(`malformed timestamp: "${row.timestamp}"`)
    } else {
      parsedTimestamp = d
    }
  }

  // check type
  if (!row.type || row.type.trim() === '') {
    issues.push('missing type')
  } else if (!VALID_TYPES.includes(row.type.trim().toUpperCase())) {
    issues.push(`unknown type: "${row.type}"`)
  }

  // check asset
  const normalizedAsset = normalizeAsset(row.asset)
  if (!normalizedAsset) {
    issues.push('missing asset')
  }

  // check quantity
  const qty = parseFloat(row.quantity)
  if (isNaN(qty)) {
    issues.push(`invalid quantity: "${row.quantity}"`)
  } else if (qty < 0) {
    issues.push(`negative quantity: ${qty} (probably a data error)`)
  } else if (qty === 0) {
    issues.push('zero quantity (suspicious)')
  }

  // check for duplicate IDs within the same file - we'll do this outside
  
  const cleaned = {
    transaction_id: row.transaction_id ? row.transaction_id.trim() : null,
    timestamp: parsedTimestamp,
    raw_timestamp: row.timestamp,
    type: row.type ? row.type.trim().toUpperCase() : null,
    asset: normalizedAsset,
    raw_asset: row.asset,
    quantity: isNaN(qty) ? null : qty,
    price_usd: row.price_usd ? parseFloat(row.price_usd) : null,
    fee: row.fee ? parseFloat(row.fee) : null,
    note: row.note || '',
    source,
    _raw: row, // keep original for the report
  }

  return { cleaned, issues }
}

async function ingestCSV(filepath, source) {
  console.log(`  reading ${filepath}`)
  
  const rawRows = parseCSVFile(filepath)
  console.log(`  got ${rawRows.length} raw rows`)

  const goodRows = []
  const badRows = []
  const seenIds = new Set()

  for (const row of rawRows) {
    const { cleaned, issues } = validateAndClean(row, source)

    // check duplicate IDs
    if (cleaned.transaction_id && seenIds.has(cleaned.transaction_id)) {
      issues.push(`duplicate transaction_id: ${cleaned.transaction_id}`)
    } else if (cleaned.transaction_id) {
      seenIds.add(cleaned.transaction_id)
    }

    if (issues.length > 0) {
      console.log(`  [DATA ISSUE] ${cleaned.transaction_id || '??'}: ${issues.join(', ')}`)
      badRows.push({
        ...cleaned,
        _issues: issues,
        _flagged: true,
      })
      
      // dont silently drop! if row has some usable data, still try to use it
      // but skip rows where core matching fields are totally broken
      const coreFieldsMissing = !cleaned.timestamp || !cleaned.type || !cleaned.asset || cleaned.quantity === null || cleaned.quantity < 0
      
      if (!coreFieldsMissing && !issues.some(i => i.includes('duplicate'))) {
        // row has issues but is still usable for matching - add with warning
        cleaned._hasIssues = true
        cleaned._issueReasons = issues
        goodRows.push(cleaned)
        console.log(`    ^ row flagged but still usable, will attempt matching`)
      } else {
        console.log(`    ^ row skipped for matching (core fields broken or duplicate)`)
      }
    } else {
      goodRows.push(cleaned)
    }
  }

  return { rows: goodRows, issues: badRows }
}

module.exports = { ingestCSV, normalizeAsset }
