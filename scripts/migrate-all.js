require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

// Migration order - dependencies first
const migrations = [
  {
    name: 'Base Schema',
    file: 'schema.sql',
    description: 'Creates tenants, services, appointments tables'
  },
  {
    name: 'Tenant Subscription Columns',
    file: 'migration_add_subscription.sql',
    description: 'Adds subscription columns to tenants table'
  },
  {
    name: 'Subscription Fees',
    file: 'migration_subscription_fees.sql',
    description: 'Creates subscription_fees table with default plans'
  },
  {
    name: 'Subscriptions',
    file: 'migration_subscriptions.sql',
    description: 'Creates subscriptions table for tracking tenant subscriptions',
    seedFunction: seedSubscriptions
  },
  {
    name: 'Revenue Records',
    file: 'migration_revenue_records.sql',
    description: 'Creates revenue_records table for tracking revenue'
  },
  {
    name: 'Clients Table',
    file: 'migration_clients.sql',
    description: 'Creates clients table for returning client recognition'
  },
  {
    name: 'Reschedule Count',
    file: 'migration_reschedule_count.sql',
    description: 'Adds reschedule_count column to appointments table'
  }
];

async function executeSqlFile(filename) {
  const sqlFile = path.join(__dirname, '..', 'sql', filename);
  const sql = fs.readFileSync(sqlFile, 'utf8');
  
  // Split by semicolon and filter out empty statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  for (const statement of statements) {
    if (statement) {
      await db.query(statement);
    }
  }
}

async function seedSubscriptions() {
  console.log('  🌱 Seeding subscriptions for existing tenants...');
  
  // Get all existing tenants
  const tenantsResult = await db.query('SELECT id, is_active, trial_ends_at, subscription_ends_at, created_at FROM tenants');
  const tenants = tenantsResult.rows;
  
  console.log(`     Found ${tenants.length} tenants to process...`);
  
  let seededCount = 0;
  let skippedCount = 0;
  
  for (const tenant of tenants) {
    // Check if tenant already has a subscription record
    const existingSub = await db.query(
      'SELECT id FROM subscriptions WHERE tenant_id = $1 LIMIT 1',
      [tenant.id]
    );
    
    if (existingSub.rows.length > 0) {
      skippedCount++;
      continue;
    }
    
    // Determine subscription details based on tenant's current status
    let startDate = tenant.created_at || new Date();
    let expiryDate;
    let status = 'trial';
    
    if (tenant.trial_ends_at) {
      expiryDate = tenant.trial_ends_at;
    } else if (tenant.subscription_ends_at) {
      expiryDate = tenant.subscription_ends_at;
      status = 'active';
    } else {
      expiryDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }
    
    // Insert subscription record
    await db.query(
      `INSERT INTO subscriptions (tenant_id, start_date, expiry_date, subscription_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [tenant.id, startDate, expiryDate, status]
    );
    
    seededCount++;
  }
  
  console.log(`     ✅ Seeded: ${seededCount}, Skipped: ${skippedCount}`);
}

async function runMigrations() {
  console.log('🚀 Starting database migrations...\n');
  
  try {
    for (let i = 0; i < migrations.length; i++) {
      const migration = migrations[i];
      console.log(`${i + 1}/${migrations.length}. ${migration.name}`);
      console.log(`   ${migration.description}`);
      
      try {
        await executeSqlFile(migration.file);
        console.log('   ✅ Migration successful');
        
        // Run seed function if exists
        if (migration.seedFunction) {
          await migration.seedFunction();
        }
      } catch (err) {
        // Check if error is because table/column already exists
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log('   ⏭️  Already applied, skipping');
        } else {
          throw err;
        }
      }
      
      console.log('');
    }
    
    console.log('✅ All migrations completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigrations();
