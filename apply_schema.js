const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.sqlite3');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function applySchema() {
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);
  
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  
  // Split by semicolon and run each statement
  const statements = schema.split(';').filter(s => s.trim());
  
  for (const stmt of statements) {
    if (stmt.trim()) {
      try {
        db.run(stmt);
        console.log('✓', stmt.substring(0, 60).replace(/\n/g, ' ') + '...');
      } catch (err) {
        console.error('✗', err.message);
      }
    }
  }
  
  // Save
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  
  // List tables
  console.log('\nTables in database:');
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  if (tables.length) {
    tables[0].values.forEach(t => console.log('  -', t[0]));
  }
  
  db.close();
  console.log('\n✅ Schema applied successfully');
}

applySchema().catch(console.error);
