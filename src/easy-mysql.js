/**
 * Created by Pubudu Dodangoda on 3/18/17.
 */

import * as constants from './constants';
import mysql from 'mysql';

/**
 * Base class as wrapper over mysql
 */
export default class EasyMysql {

    /**
     * Constructor
     * @param {object} options - Configuration object
     * @param {object} [options.connPools] - list of available mysql connection pools
     * @param {number} [options.queryCountThreshold] - Initial limit for transaction query count
     * @param {object} [options.dbConfig] - Db config if connPool is not passed in
     */
    constructor(options) {
        if (!Error.appendDetails) {
            EasyMysql.modifyErrorPrototype();
        }

        let {connPools, queryCountThreshold, dbConfig} = options;

        // Bind connection pools to class
        if (connPools) {
            EasyMysql.connectionPools = connPools;
        } else {
            if (dbConfig) {
                let connPool = mysql.createPool(dbConfig);
                EasyMysql.connectionPools = {};
                EasyMysql.connectionPools[constants.MYSQL_CONN_POOL_GENERAL] = connPool;
            } else {
                let err = new Error("Invalid configs for easy-mysql instantiation");
                err.appendDetails("EasyMysql", "constructor", "");
                throw err;
            }
        }

        EasyMysql.queryCountThreshold = queryCountThreshold;
    }

    /**
     * Obtains a connection pool from the corresponding connection pool and executes any given mysql query
     *
     * @param {object} options - options object
     *      @param {string} options.query - Query to be executed
     *      @param {Array} [options.args] - Arguments to the query if it is a prepared statement
     *      @param {string} [options.poolType]  - Mysql connection pool type(General pool is selected if poolType undefined)
     *      @param {boolean} [options.lengthConstraint] - Whether or not the group concat max length constraint should be applied
     *      @param {object} [options.merchantType] ({development, dashboard}) - Append merchantType check query suffix based on sub-params
     *          @param {number} options.merchantType.dashboard - Country of the Merchant
     *          @param {number} options.merchantType.development - Whether the merchant is a QA merchant or not
     *          @param {string|null} options.merchantType.tableAlias - mysql table name to be used by the merchantType-check query
     *      @param {string} [options.querySuffix] - additional suffix query
     * @returns {Promise} - Query result
     */
    static executeQuery(options) {
        let _this = this;

        return new Promise(function (resolve, reject) {
            // Base Parameter validation
            if (!options) {
                let err = new Error("Invalid arguments received");
                err.appendDetails("EasyMysql", "executeQuery", "Invalid arguments received");
                return reject(err);
            }

            let connectionPool = _this.connectionPools[options.poolType || constants.MYSQL_CONN_POOL_GENERAL];

            // Check if the specified poolType is a valid one
            if (!connectionPool) {
                let err = new Error("Invalid poolType");
                err.appendDetails("EasyMysql", "executeQuery", `PoolType: ${options.poolType}`);
                return reject(err);
            }

            let {query, args} = _this._constructQuery(options);

            connectionPool.getConnection(function (err, conn) {
                if (err) {
                    err.appendDetails("EasyMysql", "executeQuery", "[MySQL]Error getting connection from pool");
                    return reject(err);
                }
                if (options.lengthConstraint) {
                    conn.query("SET SESSION group_concat_max_len=55555", function (err) {
                        if (err) {
                            conn.release();
                            err.appendDetails("EasyMysql", "executeQuery", "[MySQL]Error setting group_concat_max_len to 55555");
                            return reject(err);
                        }
                        return _this._execute(conn, query, args).then(resolve).catch(function (err) {
                            err.appendDetails("EasyMysql", "executeQuery", "[MySQL]Error setting group_concat_max_len to 55555");
                            return reject(err);
                        });
                    });
                } else {
                    return _this._execute(conn, query, args).then(resolve).catch(function (err) {
                        err.appendDetails("EasyMysql", "executeQuery", "[MySQL]Error setting group_concat_max_len to 55555");
                        return reject(err);
                    });
                }
            });
        });
    }

    /**
     * Final execution of the query is from here
     * Note - parameters are expected to be validated before calling this method
     *
     * @param {Object} conn - mysql connection
     * @param {String} query - final query to execute
     * @param {Array} args - arguments corresponding to the query
     * @returns {Promise} - Rows and Info
     * @private
     */
    static _execute(conn, query, args) {
        return new Promise(function (resolve, reject) {
            conn.query(query, args, function (err, rows) {
                conn.release();
                if (err) {
                    err.appendDetails("EasyMysql", "_execute", "Query syntax issue or processing issue");
                    return reject(err);
                }
                return resolve(rows);
            });
        });
    }

    /**
     * Execute a transaction with any given number of queries
     *
     * @param {Object} options - transaction options.
     *      @param {string} [options.poolType] - Mysql connection pool type.
     *      @param {Object[]} options.queries - Object array of query and args pairs -> [{query: query, args:args}^n].
     *      @param {number} [options.queryCountThreshold] - Value to override the default TRANSACTION_QUERY_COUNT_THRESHOLD
     * @returns {Promise} - Transactions results as an object
     */
    static executeTransaction(options) {
        let _this = this;

        return new Promise(function (resolve, reject) {
            // Base Parameter validation
            if (!options) {
                let err = new Error("Invalid arguments received");
                err.appendDetails("EasyMysql", "executeTransaction", `options:${options}`);
                return reject(err);
            }

            // Parameter destructing
            let {queries, poolType = constants.MYSQL_CONN_POOL_GENERAL} = options;

            let connectionPool = _this.connectionPools[poolType],
                results = [];

            // Currently allow maximum of 5 queries only.
            const QUERY_COUNT_THRESHOLD = options.queryCountThreshold
                || _this.queryCountThreshold
                || constants.TRANSACTION_QUERY_COUNT_THRESHOLD;

            // If at least one query was not sent, we generate a new error
            if (!queries || !queries.length) {
                let err = new Error("Queries parameter is undefined");
                err.appendDetails("EasyMysql", "executeTransaction", `Queries: ${queries}`);
                return reject(err);
            }

            // Check if the specified poolType is a valid one
            if (!connectionPool) {
                let err = new Error("Invalid poolType");
                err.appendDetails("EasyMysql", "executeQuery", `PoolType: ${options.poolType}`);
                return reject(err);
            }

            // Check query count threshold
            // This is just an extra precaution. If test results doesn't show any issues, this constraint can be removed
            if (queries.length > QUERY_COUNT_THRESHOLD) {
                let err = new Error("Query count exceeds threshold");
                err.appendDetails("EasyMysql", "executeTransaction", "Query count exceeds threshold");
                return reject(err);
            }

            connectionPool.getConnection(function (err, conn) {
                if (err) {
                    err.appendDetails("EasyMysql", "executeTransaction", "[MySQL]Error getting connection from pool");
                    return reject(err);
                }
                conn.beginTransaction(function (err) {
                    if (err) {
                        err.appendDetails("EasyMysql", "executeTransaction", "[MySQL]Error starting transaction");
                        conn.release();
                        return reject(err);
                    }

                    _this._executeOrRollbackLoop(conn, queries, 0, results).then(function (results) {
                        conn.release();
                        return resolve(results);
                    }).catch(function (err) {
                        err.appendDetails("EasyMysql", "executeTransaction", "[MySQL]Failed to complete transaction");
                        conn.release();
                        return reject(err);
                    });
                });
            });
        });

    }

    /**
     * Executes cycle of a transaction recursively, one by one.
     * Calls a separate method to commit transaction when iterations are over(i.e. All queries have executed)
     * If an error occurs rollback current query execution and end further processing
     *
     * @param {Object} conn - mysql connection
     * @param {Array} queries - {query,args}
     *      @param {string} queries.query - query
     *      @param {Array} queries.args - arguments
     * @param {number} iteration - current iteration(int)
     * @param {Object[]} resultsArray - Rows returned from the current iteration will be appended to this array
     * @returns {Promise} - Transaction results object
     * @private
     */
    static _executeOrRollbackLoop(conn, queries, iteration, resultsArray) {
        let _this = this;

        return new Promise(function (resolve, reject) {
            if (iteration >= queries.length) {
                return _this._commitTransaction(conn, resultsArray).then(resolve).catch(function (err) {
                    err.appendDetails("EasyMysql", "_executeOrRollbackLoop", `Invalid query detected for iteration:${iteration}`);
                    return reject(err);
                });
            }
            // Check validity of the query corresponding to this iteration
            if (!queries[iteration] || !queries[iteration].query) {
                let err = new Error(`Invalid query detected for iteration:${iteration}`);
                err.appendDetails("EasyMysql", "_executeOrRollbackLoop", `Invalid query detected for iteration:${iteration}`);
                return reject(err);
            }
            return conn.query(queries[iteration].query, queries[iteration].args || [], function (err, rows) {
                if (err) {
                    return conn.rollback(function () {
                        err.appendDetails("EasyMysql", "_executeOrRollbackLoop", "[MySQL]Error executing query");
                        return reject(err);
                    });
                }
                // Append the mysql result of current query to results array
                resultsArray.push({
                    rows: rows
                });
                iteration++;
                return _this._executeOrRollbackLoop(conn, queries, iteration, resultsArray)
                    .then(resolve)
                    .catch(reject);
            });
        });
    }

    /**
     * Commit transaction and call the callback with the results collected
     *
     * @param {Object} conn - mysql connection
     * @param {Array} results - Final result list of all queries (Array of mysql rows objects)
     * @private
     * @returns {Promise} - Transaction results object
     */
    static _commitTransaction(conn, results) {
        return new Promise(function (resolve, reject) {
            conn.commit(function (err) {
                if (err) {
                    return conn.rollback(function () {
                        err.appendDetails("EasyMysql", "_commitTransaction", "Error while rolling-back transaction");
                        return reject(err);
                    });
                }
                return resolve(results);
            });
        });
    }

    /**
     * Build query based on query and query suffix
     *
     * @param {Object} options - Same as the options object received by executeQuery method
     * @private
     * @returns {object} - Processed Query and Args
     */
    static _constructQuery(options) {
        // Parameter destructing
        let {query, args = [], querySuffix} = options;

        // If the query was not sent, we generate a new error
        if (!query) {
            let err = new Error("Query is undefined");
            err.appendDetails("EasyMysql", "_constructQuery", "Query is undefined");
            throw err;
        }

        // If a query suffix was sent, it will be appended
        if (querySuffix) {
            query += querySuffix;
        }

        return {query: query, args: args};
    }

    /**
     * Modify Error prototype
     */
    static modifyErrorPrototype() {
        /**
         * @param {string} className - Name of the module in which the error was detected
         * @param {string} method - Name of the module-method in which the error was detected
         * @param {string} cause - More details about the cause of the error
         */
        Error.prototype.appendDetails = function (className = "*NULL*", method = "*NULL*", cause = "*NULL*") {
            this.path = (this.path || "#") + ` -> [${className}]|(${method})`;
            this.causes = (this.causes || "#") + ` -> (${method})|${cause}`;
        };
    }

}
