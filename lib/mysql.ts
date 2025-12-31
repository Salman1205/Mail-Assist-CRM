/**
 * MySQL Connection Utility for CRM Database
 * Connects to the company's CRM MySQL database to fetch emails
 */

import mysql from 'mysql2/promise';

// Connection pool for efficient reuse
let pool: mysql.Pool | null = null;

/**
 * Get or create MySQL connection pool
 */
export function getMySQLPool(): mysql.Pool {
    if (!pool) {
        const host = process.env.MYSQL_HOST;
        const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
        const user = process.env.MYSQL_USER;
        const password = process.env.MYSQL_PASSWORD;
        const database = process.env.MYSQL_DATABASE;

        console.log('[MySQL] Attempting to create pool with:', {
            host,
            port,
            user: user ? '***' : undefined,
            database,
            hasPassword: !!password
        });

        if (!host || !user || !password || !database) {
            const missing = [];
            if (!host) missing.push('MYSQL_HOST');
            if (!user) missing.push('MYSQL_USER');
            if (!password) missing.push('MYSQL_PASSWORD');
            if (!database) missing.push('MYSQL_DATABASE');
            throw new Error(`Missing MySQL environment variables: ${missing.join(', ')}`);
        }

        pool = mysql.createPool({
            host,
            port,
            user,
            password,
            database,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000,
            connectTimeout: 10000, // 10 second connection timeout
            // SSL configuration for AWS RDS
            ssl: {
                rejectUnauthorized: false,
            },
        });

        console.log('[MySQL] Connection pool created for', host);
    }

    return pool;
}

/**
 * Execute a query on the MySQL database
 * Uses query() instead of execute() to avoid prepared statement issues
 */
export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
    try {
        console.log('[MySQL] Executing query...');
        const poolInstance = getMySQLPool();

        // Use query() instead of execute() to avoid prepared statement issues
        // Manually substitute parameters for LIMIT clause
        let finalSql = sql;
        if (params && params.length > 0) {
            params.forEach((param, index) => {
                // Replace first ? with the escaped parameter value
                if (typeof param === 'number') {
                    finalSql = finalSql.replace('?', String(param));
                } else if (typeof param === 'string') {
                    // Escape string for SQL
                    const escaped = param.replace(/'/g, "''").replace(/\\/g, '\\\\');
                    finalSql = finalSql.replace('?', `'${escaped}'`);
                } else {
                    finalSql = finalSql.replace('?', String(param));
                }
            });
        }

        const [rows] = await poolInstance.query(finalSql);
        console.log('[MySQL] Query successful, returned', (rows as any[]).length, 'rows');
        return rows as T[];
    } catch (error) {
        console.error('[MySQL] Query error:', {
            message: (error as Error).message,
            code: (error as any).code,
            errno: (error as any).errno,
            sqlState: (error as any).sqlState,
        });
        throw error;
    }
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
    try {
        const poolInstance = getMySQLPool();
        const connection = await poolInstance.getConnection();
        await connection.ping();
        connection.release();
        console.log('[MySQL] Connection test successful');
        return true;
    } catch (error) {
        console.error('[MySQL] Connection test failed:', error);
        return false;
    }
}

/**
 * Close all connections in the pool
 */
export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('[MySQL] Connection pool closed');
    }
}
