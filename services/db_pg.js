/**
 * PostgreSQL Database Adapter
 * Drop-in replacement for sql.js with auto-conversion
 */

const { Pool, types } = require('pg');

// Fix INT8 returning as string
types.setTypeParser(20, (val) => parseInt(val, 10));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

/**
 * Convert SQLite SQL to PostgreSQL
 * - ? params -> $1, $2, $3
 * - datetime('now') -> NOW()
 */
function convertSql(sql) {
    let i = 1;
    sql = sql.replace(/\?/g, () => `$${i++}`);
    sql = sql.replace(/datetime\('now'\)/gi, 'NOW()');
    return sql;
}

module.exports = {
    /**
     * Execute SELECT query, return rows array
     */
    async exec(sql, params = []) {
        const result = await pool.query(convertSql(sql), params);
        return result.rows;
    },

    /**
     * Execute INSERT/UPDATE/DELETE
     */
    async run(sql, params = []) {
        return pool.query(convertSql(sql), params);
    },

    /**
     * Insert and return the new row (auto-adds RETURNING id)
     */
    async insert(sql, params = []) {
        if (!sql.toLowerCase().includes('returning')) {
            sql = sql.replace(/;\s*$/, '') + ' RETURNING *';
        }
        const result = await pool.query(convertSql(sql), params);
        return result.rows[0];
    },

    /**
     * Get single row or null
     */
    async getOne(sql, params = []) {
        const result = await pool.query(convertSql(sql), params);
        return result.rows[0] || null;
    },

    /**
     * Execute in transaction
     */
    async withTransaction(callback) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback({
                query: (sql, params) => client.query(convertSql(sql), params),
                exec: async (sql, params) => (await client.query(convertSql(sql), params)).rows,
                run: (sql, params) => client.query(convertSql(sql), params),
            });
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    async healthCheck() {
        try {
            await pool.query('SELECT 1');
            return true;
        } catch (e) {
            return false;
        }
    },

    async close() {
        await pool.end();
    },

    pool
};
