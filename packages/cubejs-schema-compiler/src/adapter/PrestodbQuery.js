import { BaseQuery } from './BaseQuery';
import { BaseFilter } from './BaseFilter';

const GRANULARITY_TO_INTERVAL = {
  day: 'day',
  week: 'week',
  hour: 'hour',
  minute: 'minute',
  second: 'second',
  month: 'month',
  quarter: 'quarter',
  year: 'year'
};

class PrestodbFilter extends BaseFilter {
  likeIgnoreCase(column, not, param, type) {
    const p = (!type || type === 'contains' || type === 'ends') ? '%' : '';
    const s = (!type || type === 'contains' || type === 'starts') ? '%' : '';
    return `LOWER(${column})${not ? ' NOT' : ''} LIKE CONCAT('${p}', LOWER(${this.allocateParam(param)}) , '${s}') ESCAPE '\\'`;
  }

  castParameter() {
    if (this.definition().type === 'boolean') {
      return 'CAST(? AS BOOLEAN)';
    } else if (this.measure || this.definition().type === 'number') {
      // TODO here can be measure type of string actually
      return 'CAST(? AS DOUBLE)';
    }

    return '?';
  }
}

export class PrestodbQuery extends BaseQuery {
  newFilter(filter) {
    return new PrestodbFilter(this, filter);
  }

  timeStampParam() {
    return 'from_iso8601_timestamp(?)';
  }

  timeStampCast(value) {
    return `from_iso8601_timestamp(${value})`;
  }

  dateTimeCast(value) {
    return `from_iso8601_timestamp(${value})`;
  }

  convertTz(field) {
    const atTimezone = `${field} AT TIME ZONE '${this.timezone}'`;
    return this.timezone ?
      `CAST(date_add('minute', timezone_minute(${atTimezone}), date_add('hour', timezone_hour(${atTimezone}), ${field})) AS TIMESTAMP)` :
      field;
  }

  timeGroupedColumn(granularity, dimension) {
    return `date_trunc('${GRANULARITY_TO_INTERVAL[granularity]}', ${dimension})`;
  }

  subtractInterval(date, interval) {
    const [intervalValue, intervalUnit] = interval.split(' ');
    return `${date} - interval '${intervalValue}' ${intervalUnit}`;
  }

  addInterval(date, interval) {
    const [intervalValue, intervalUnit] = interval.split(' ');
    return `${date} + interval '${intervalValue}' ${intervalUnit}`;
  }

  seriesSql(timeDimension) {
    const values = timeDimension.timeSeries().map(
      ([from, to]) => `select '${from}' f, '${to}' t`
    ).join(' UNION ALL ');
    return `SELECT from_iso8601_timestamp(dates.f) date_from, from_iso8601_timestamp(dates.t) date_to FROM (${values}) AS dates`;
  }

  unixTimestampSql() {
    return `to_unixtime(${this.nowTimestampSql()})`;
  }

  defaultRefreshKeyRenewalThreshold() {
    return 120;
  }

  defaultEveryRefreshKey() {
    return {
      every: '2 minutes'
    };
  }

  hllInit(sql) {
    return `cast(approx_set(${sql}) as varbinary)`;
  }

  hllMerge(sql) {
    return `cardinality(merge(cast(${sql} as HyperLogLog)))`;
  }

  countDistinctApprox(sql) {
    return `approx_distinct(${sql})`;
  }

  groupByDimensionLimit() {
    const limitClause = this.rowLimit === null ? '' : ` LIMIT ${this.rowLimit && parseInt(this.rowLimit, 10) || 10000}`;
    const offsetClause = this.offset ? ` OFFSET ${parseInt(this.offset, 10)}` : '';

    return `${offsetClause}${limitClause}`;
  }

  sqlTemplates() {
    const templates = super.sqlTemplates();
    templates.functions.DATETRUNC = 'DATE_TRUNC({{ args_concat }})';
    return templates;
  }
}
