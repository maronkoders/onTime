require('dotenv').config();
const db = require('../config/db');

async function resetDatabase() {
  console.log('⚠️  WARNING: This will drop ALL tables and recreate them!');
  console.log('🔄 Starting database reset...\n');
  
  try {
    // Drop tables in reverse order of dependencies
    const tables = [
      'revenue_records',
      'subscriptions',
      'subscription_fees',
      'appointments',
      'services',
      'tenants'
    ];
    
    for (const table of tables) {
      try {
        await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`   ✅ Dropped table: ${table}`);
      } catch (err) {
        console.log(`   ⏭️  Table ${table} does not exist or already dropped`);
      }
    }
    
    console.log('\n🗑️  All tables dropped');
    console.log('🚀 Running migrations...\n');
    
    // Run the migrate-all script
    const migrateAll = require('./migrate-all');
    
    // Wait for migrations to complete (migrate-all calls process.exit)
    // We need to modify approach since migrate-all exits the process
    
  } catch (err) {
    console.error('\n❌ Database reset failed:', err.message);
    process.exit(1);
  }
}

// Import and run the migration logic inline to avoid process.exit issues
async function runMigrations() {
  const fs = require('fs');
  const path = require('path');
  
  const migrations = [
    { name: 'Base Schema', file: 'schema.sql' },
    { name: 'Tenant Subscription Columns', file: 'migration_add_subscription.sql' },
    { name: 'Subscription Fees', file: 'migration_subscription_fees.sql' },
    { name: 'Subscriptions', file: 'migration_subscriptions.sql' },
    { name: 'Revenue Records', file: 'migration_revenue_records.sql' }
  ];
  
  async function executeSqlFile(filename) {
    const sqlFile = path.join(__dirname, '..', 'sql', filename);
    const sql = fs.readFileSync(sqlFile, 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (const statement of statements) {
      if (statement) {
        await db.query(statement);
      }
    }
  }
  
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i];
    console.log(`${i + 1}/${migrations.length}. ${migration.name}`);
    
    await executeSqlFile(migration.file);
    console.log('   ✅ Created');
  }
  
  // Seed subscriptions for any default tenants
  console.log('\n🌱 Seeding data...');
  
  try {
    const tenantsResult = await db.query('SELECT id FROM tenants');
    const tenants = tenantsResult.rows;
    
    for (const tenant of tenants) {
      await db.query(
        `INSERT INTO subscriptions (tenant_id, start_date, expiry_date, subscription_status, created_at, updated_at)
         VALUES ($1, NOW(), NOW() + INTERVAL '14 days', 'trial', NOW(), NOW())`,
        [tenant.id]
      );
    }
    
    console.log(`   ✅ Seeded ${tenants.length} subscriptions`);
  } catch (err) {
    console.log('   ⏭️  No tenants to seed');
  }
}

async function main() {
  try {
    // Drop all tables
    const tables = [
      'revenue_records',
      'subscriptions',
      'subscription_fees',
      'appointments',
      'services',
      'tenants'
    ];
    
    console.log('🗑️  Dropping tables...');
    for (const table of tables) {
      try {
        await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`   ✅ ${table}`);
      } catch (err) {
        console.log(`   ⏭️  ${table}`);
      }
    }
    
    console.log('\n🚀 Running migrations...');
    await runMigrations();
    
    console.log('\n✅ Database reset completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Database reset failed:', err.message);
    process.exit(1);
  }
}

main();
