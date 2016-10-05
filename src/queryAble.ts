import {PgDbLogger} from "./pgdb";
var util = require('util');

const NAMED_PARAMS_REGEXP = /(?:^|[^:]):(!?[a-zA-Z0-9_]+)/g;    // do not convert "::type cast"
export interface QueryOptions {
    limit?:number;
    orderBy?:string;//free text
    groupBy?:string;//free text
    fields?:Array<string>;
    logger?:PgDbLogger;
}

export class QueryAble {
    db;
    schema;
    protected logger:PgDbLogger;

    constructor() {
    }

    public setLogger(logger:PgDbLogger) {
        this.logger = logger;
    }

    protected getLogger(useConsoleAsDefault) {
        return this.logger || this.schema && this.schema.logger || this.db.logger || (useConsoleAsDefault ? console : this.db.defaultLogger);
    }

    public async run(sql:string) {
        return this.query(sql);
    }

    /**
     * Params can be
     * 1) array, then sql should have $1 $2 for placeholders
     * 2) object, then sql should have:
     *    :example -> for params in statements (set/where), will be transformed to $1 $2 ...
     *    :!example -> for DDL names (schema, table, column), will be replaced in the query
     * e.g. query('select * from a.b where id=$1;',['the_stage_is_set']);
     * e.g. query('select * from :!schema.:!table where id=:id;',{schema:'a',table:'b', id:'the_stage_is_set'});
     */
    public async query(sql:string, params?:any[])
    public async query(sql:string, params?:Object)
    public async query(sql:string, params?:any) {
        let connection = this.db.connection;

        try {
            if (params && !Array.isArray(params)) {
                let p = this.processNamedParams(sql, params);
                sql = p.sql;
                params = p.params;
            }

            if (connection) {
                this.getLogger(false).log(sql, util.inspect(params, false, null), connection.processID);
                let res = await connection.query(sql, params);
                return res.rows;
            } else {
                connection = await this.db.pool.connect();
                this.getLogger(false).log(sql, util.inspect(params, false, null), connection.processID);

                try {
                    let res = await connection.query(sql, params);
                    return res.rows;
                } finally {
                    try {
                        connection.release();
                    } catch (e) {
                        connection = null;
                        this.getLogger(true).error('connection error', e.message);
                    }
                }
            }
        } catch (e) {
            this.getLogger(true).error(sql, util.inspect(params, false, null), connection ? connection.processID : null);
            throw e;
        }
    }

    /** @return one record's one field */
    public async getOneField(sql:string, params?:any[])
    public async getOneField(sql:string, params?:Object)
    public async getOneField(sql:string, params?:any) {
        let res = await this.query(sql, params);
        let fieldName = Object.keys(res[0])[0];
        if (res.length>1) {
            throw Error('More then one field exists!');
        }
        return res.length == 1 ? res[0][fieldName] : null;
    }

    /** @return one column for the matching records */
    public async getOneColumn(sql:string, params?:any[])
    public async getOneColumn(sql:string, params?:Object)
    public async getOneColumn(sql:string, params?:any) {
        let res = await this.query(sql, params);
        let fieldName = Object.keys(res[0])[0];
        return res.map(r=>r[fieldName]);
    }

    /**
     * :named -> $1 (not works with DDL (schema, table, column))
     * :!named -> "value" (for DDL (schema, table, column))
     * do not touch ::type cast
     */
    private processNamedParams(sql:string, params:Object) {
        let sql2 = [];
        let params2 = [];

        let p = NAMED_PARAMS_REGEXP.exec(sql);
        let lastIndex = 0;
        while (p) {
            let ddl = false;
            let name = p[1];
            if (name[0] == '!'){
                name = name.slice(1);
                ddl = true;
            }

            if (!(name in params)) {
                throw new Error(`No ${p[1]} in params (keys: ${Object.keys(params)})`);
            }
            sql2.push(sql.slice(lastIndex, NAMED_PARAMS_REGEXP.lastIndex - p[1].length - 1));

            if (ddl) {
                sql2.push('"' + (''+params[name]).replace(/"/g,'""') + '"');
            } else {
                params2.push(params[name]);
                sql2.push('$' + params2.length);
            }
            lastIndex = NAMED_PARAMS_REGEXP.lastIndex;
            p = NAMED_PARAMS_REGEXP.exec(sql);
        }
        sql2.push(sql.substr(lastIndex));

        return {
            sql: sql2.join(''),
            params: params2
        }
    }

    static processQueryOptions(options:QueryOptions) {
        let extra = '';
        if (options.groupBy) {
            extra += 'GROUP BY ' + options.groupBy + ' ';
        }
        if (options.orderBy) {
            extra += 'ORDER BY ' + options.orderBy + ' ';
        }
        if (options.limit) {
            extra += util.format('LIMIT %d ', options.limit);
        }
        return extra;
    }
}