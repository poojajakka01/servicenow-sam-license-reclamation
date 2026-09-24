'use strict';
/**
 * Minimal in-memory GlideRecord test double. Supports the subset used by the
 * DAO: addQuery (=, IN, dot-walked fields stored flat), query/next/hasNext,
 * getValue, getUniqueValue, setLimit, initialize/setValue/insert.
 */
function makeGlideRecord(db) {
    function GlideRecord(table) {
        this.table = table;
        this.filters = [];
        this.rows = [];
        this.idx = -1;
        this.limit = Infinity;
        this.current = null;
        if (!db[table]) { db[table] = []; }
    }
    GlideRecord.prototype.addQuery = function (field, opOrValue, maybeValue) {
        const op = maybeValue === undefined ? '=' : opOrValue;
        const value = maybeValue === undefined ? opOrValue : maybeValue;
        this.filters.push({ field, op, value });
    };
    GlideRecord.prototype.setLimit = function (n) { this.limit = n; };
    GlideRecord.prototype.query = function () {
        this.rows = db[this.table].filter((row) => this.filters.every((f) => {
            const v = row[f.field];
            if (f.op === 'IN') { return String(f.value).split(',').includes(String(v)); }
            return String(v) === String(f.value);
        })).slice(0, this.limit);
        this.idx = -1;
    };
    GlideRecord.prototype.hasNext = function () { return this.idx + 1 < this.rows.length; };
    GlideRecord.prototype.next = function () {
        if (!this.hasNext()) { return false; }
        this.idx++;
        this.current = this.rows[this.idx];
        return true;
    };
    GlideRecord.prototype.getValue = function (f) {
        const v = this.current[f];
        return v === undefined || v === null ? null : String(v);
    };
    GlideRecord.prototype.getUniqueValue = function () { return this.current.sys_id; };
    GlideRecord.prototype.initialize = function () { this.current = {}; };
    GlideRecord.prototype.setValue = function (f, v) { this.current[f] = v; };
    GlideRecord.prototype.insert = function () {
        this.current.sys_id = this.table + '_' + (db[this.table].length + 1);
        db[this.table].push(this.current);
        return this.current.sys_id;
    };
    return GlideRecord;
}

module.exports = { makeGlideRecord };
