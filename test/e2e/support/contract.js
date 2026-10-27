'use strict';

/**
 * Request-side API contract check for the browser E2E sessions: every OData V4 GET the UI sends to a CAP service
 * (direct or as a part of a `$batch`) must name only entity sets, properties and navigation properties that the
 * service's own $metadata declares, in $select, $orderby, $filter and $expand. This catches UI/CAP drift (the UI asking
 * for a field the service does not expose) at the boundary, whatever the data returned. $filter with lambdas
 * (any/all), $apply and $search are not analysed.
 */

const OPERATORS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'and', 'or', 'not', 'in', 'has', 'true', 'false', 'null', 'asc', 'desc']);

/** { sets: { SetName: { props:Set, navs:Set } } } from a CAP/OData V4 $metadata document. */
function parseMetadata(xml) {
    const types = {};
    for (const m of xml.matchAll(/<EntityType Name="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/EntityType>)/g)) {
        const body = m[2] || '';
        types[m[1]] = {
            props: new Set([...body.matchAll(/<Property Name="([^"]+)"/g)].map((p) => p[1])),
            navs: new Set([...body.matchAll(/<NavigationProperty Name="([^"]+)"/g)].map((p) => p[1]))
        };
    }
    const sets = {};
    for (const m of xml.matchAll(/<EntitySet Name="([^"]+)" EntityType="[^"]*?\.?([^".]+)"/g)) {
        if (types[m[2]]) sets[m[1]] = types[m[2]];
    }
    return { sets };
}

/** Splits on top-level commas (not inside parentheses or quotes). */
function splitTop(s) {
    const out = [];
    let depth = 0;
    let quote = false;
    let cur = '';
    for (const ch of s) {
        if (ch === "'") quote = !quote;
        if (!quote && ch === '(') depth++;
        if (!quote && ch === ')') depth--;
        if (!quote && depth === 0 && ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    return out.concat(cur).filter(Boolean);
}

/** Property identifiers used by a $filter expression ([] when it uses lambdas, which are not analysed). */
function filterNames(expr) {
    if (/\b(any|all)\s*\(/.test(expr)) return [];
    const bare = expr.replace(/'(?:[^']|'')*'/g, "''");
    return [...bare.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*(?!\w|\s*\()/g)]
        .map((m) => m[0]).filter((n) => !OPERATORS.has(n) && !/^\d/.test(n));
}

/**
 * Violations (strings) of one GET against the service metadata. `path` is relative to the service root
 * (e.g. "SalesOrders?$select=SalesOrder,Foo"); anything that is not a plain entity-set read is not checked.
 */
function checkRequest(meta, path) {
    const [rawPath, rawQuery = ''] = path.split('?');
    const seg = decodeURIComponent(rawPath).replace(/^\/+/, '').split('/')[0].replace(/\(.*\)$/, '');
    const set = meta.sets[seg];
    if (!set) return /^[A-Za-z_]\w*$/.test(seg) && !seg.startsWith('$') && !/\(/.test(rawPath.split('/')[0]) && rawPath.split('/')[0] === seg
        ? [`${seg}: not an entity set of the service`] : [];
    const q = {};
    rawQuery.split('&').filter(Boolean).forEach((kv) => {
        const i = kv.indexOf('=');
        q[decodeURIComponent(kv.slice(0, i < 0 ? kv.length : i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    const errs = [];
    const known = (n) => set.props.has(n) || set.navs.has(n);
    const need = (names, where) => names.forEach((n) => { if (!known(n.split('/')[0])) errs.push(`${seg}: ${where} uses "${n}", not declared by the service`); });
    if (q.$select) need(splitTop(q.$select).map((s) => s.trim()).filter((s) => s !== '*'), '$select');
    if (q.$orderby) need(splitTop(q.$orderby).map((s) => s.trim().split(/\s+/)[0]), '$orderby');
    if (q.$filter) need(filterNames(q.$filter), '$filter');
    if (q.$expand) need(splitTop(q.$expand).map((s) => s.trim().replace(/[(/].*$/, '')), '$expand');
    return errs;
}

module.exports = { parseMetadata, checkRequest, filterNames, splitTop };
