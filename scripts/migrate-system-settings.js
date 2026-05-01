require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function runMigration() {
  try {
    console.log('🚀 Running system_settings migration...\n');

    const sqlFile = path.join(__dirname, '..', 'sql', 'migration_system_settings.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement) {
        await db.query(statement);
        console.log('Executed:', statement.split('\n')[0].trim() + '...');
      }
    }

    console.log('\n✅ system_settings migration completed successfully!');
    console.log('   - Table created (if not exists)');
    console.log('   - Default trial_period_days setting inserted (if not exists)');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
