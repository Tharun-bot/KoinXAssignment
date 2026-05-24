// models.js - mongoose schemas
// kept it simple

const mongoose = require('mongoose')

// stores the full reconciliation report per run
const ReconciliationRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  config: {
    timestampToleranceSec: Number,
    quantityTolerancePct: Number,
  },
  summary: {
    matched: Number,
    conflicting: Number,
    unmatched_user: Number,
    unmatched_exchange: Number,
    data_quality_issues: Number,
  },
  matched: [mongoose.Schema.Types.Mixed],
  conflicting: [mongoose.Schema.Types.Mixed],
  unmatchedUser: [mongoose.Schema.Types.Mixed],
  unmatchedExchange: [mongoose.Schema.Types.Mixed],
  dataIssues: [mongoose.Schema.Types.Mixed], // flagged bad rows
})

const ReconciliationRun = mongoose.model('ReconciliationRun', ReconciliationRunSchema)

module.exports = { ReconciliationRun }
