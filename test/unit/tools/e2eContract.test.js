'use strict';

const { parseMetadata, checkRequest, filterNames } = require('../../e2e/support/contract');

const XML = `<Schema Namespace="S"><EntityContainer Name="C">
  <EntitySet Name="Orders" EntityType="S.Orders"><NavigationPropertyBinding Path="items" Target="Items"/></EntitySet>
  <EntitySet Name="Items" EntityType="S.Items"/></EntityContainer>
  <EntityType Name="Orders"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.String"/><Property Name="Status" Type="Edm.String"/>
    <NavigationProperty Name="items" Type="Collection(S.Items)"/></EntityType>
  <EntityType Name="Items"><Property Name="Id" Type="Edm.String"/><Property Name="Qty" Type="Edm.Decimal"/></EntityType></Schema>`;
const meta = parseMetadata(XML);

describe('E2E API contract check', () => {
    it('parses entity sets with properties and navigation properties', () => {
        expect([...meta.sets.Orders.props]).toEqual(['Id', 'Status']);
        expect([...meta.sets.Orders.navs]).toEqual(['items']);
        expect([...meta.sets.Items.props]).toEqual(['Id', 'Qty']);
    });

    it.each([
        'Orders',
        "Orders('1')",
        'Orders?$select=Id,Status&$orderby=Status desc&$top=20&$count=true',
        "Orders?$filter=Status eq 'A' and contains(Id,'x')",
        "Orders?$filter=items/any(i:i/Qty gt 1)",
        'Orders?$expand=items($select=Qty)',
        "Orders?$filter=Status eq 'Foo Bar eq'",
        'getThing(top=1)',
        'Orders/$count'
    ])('accepts %s', (p) => expect(checkRequest(meta, p)).toEqual([]));

    it('reports an undeclared $select, $orderby, $filter and $expand name', () => {
        expect(checkRequest(meta, 'Orders?$select=Id,Nope')).toEqual(['Orders: $select uses "Nope", not declared by the service']);
        expect(checkRequest(meta, 'Orders?$orderby=Gone asc')).toEqual(['Orders: $orderby uses "Gone", not declared by the service']);
        expect(checkRequest(meta, "Orders?$filter=Status eq 'A' and Missing eq 'x'")).toEqual(['Orders: $filter uses "Missing", not declared by the service']);
        expect(checkRequest(meta, 'Orders?$expand=ghost')).toEqual(['Orders: $expand uses "ghost", not declared by the service']);
    });

    it('reports an unknown entity set but not a function call', () => {
        expect(checkRequest(meta, 'Ghosts?$top=1')).toEqual(['Ghosts: not an entity set of the service']);
        expect(checkRequest(meta, 'doIt()')).toEqual([]);
    });

    it('ignores string literals and functions when reading $filter names', () => {
        expect(filterNames("Status eq 'x y' and startswith(Id,'a')")).toEqual(['Status', 'Id']);
    });
});
