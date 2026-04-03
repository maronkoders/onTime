require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function runMigration() {
  try {
    // First, run the SQL migration file
    const sqlFile = path.join(__dirname, '..', 'sql', 'migration_subscriptions.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Split by semicolon and filter out empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      if (statement) {
        await db.query(statement);
        console.log('Executed:', statement.substring(0, 50) + '...');
      }
    }
    
    // Seed subscriptions for existing tenants
    console.log('\n🌱 Seeding subscriptions for existing tenants...');
    
    // Get all existing tenants
    const tenantsResult = await db.query('SELECT id, subscription_status, trial_ends_at, subscription_ends_at, created_at FROM tenants');
    const tenants = tenantsResult.rows;
    
    console.log(`Found ${tenants.length} tenants to process...`);
    
    let seededCount = 0;
    let skippedCount = 0;
    
    for (const tenant of tenants) {
      // Check if tenant already has a subscription record
      const existingSub = await db.query(
        'SELECT id FROM subscriptions WHERE tenant_id = $1 LIMIT 1',
        [tenant.id]
      );
      
      if (existingSub.rows.length > 0) {
        console.log(`  ⏭️  Tenant ${tenant.id}: Already has subscription, skipping`);
        skippedCount++;
        continue;
      }
      
      // Determine subscription details based on tenant's current status
      let startDate = tenant.created_at || new Date();
      let expiryDate;
      let status = tenant.subscription_status || 'trial';
      
      if (tenant.subscription_status === 'trial') {
        expiryDate = tenant.trial_ends_at || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      } else if (tenant.subscription_status === 'active' && tenant.subscription_ends_at) {
        expiryDate = tenant.subscription_ends_at;
      } else {
        // Default: 14 days from now for trial
        expiryDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      }
      
      // Insert subscription record
      await db.query(
        `INSERT INTO subscriptions (tenant_id, start_date, expiry_date, subscription_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [tenant.id, startDate, expiryDate, status]
      );
      
      console.log(`  ✅ Tenant ${tenant.id}: Created ${status} subscription (expires: ${new Date(expiryDate).toLocaleDateString()})`);
      seededCount++;
    }
    
    console.log('\n✅ Migration completed successfully!');
    console.log(`   Seeded: ${seededCount} subscriptions`);
    console.log(`   Skipped: ${skippedCount} (already had subscriptions)`);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
