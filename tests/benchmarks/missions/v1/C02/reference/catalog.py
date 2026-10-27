def select_items(records, query):
    if set(query) - {'category', 'offset', 'limit'} or any(len(values) != 1 or not values[0] for values in query.values()):
        raise ValueError('invalid parameters')
    def integer(name, default, low, high):
        value = query.get(name, [str(default)])[0]
        if not value.isascii() or not value.isdecimal():
            raise ValueError('invalid integer')
        value = int(value)
        if not low <= value <= high:
            raise ValueError('out of range')
        return value
    offset, limit = integer('offset', 0, 0, 1000), integer('limit', 2, 1, 5)
    category = query.get('category', [None])[0]
    items = sorted((r for r in records if category is None or r['category'] == category), key=lambda r: r['id'])
    return {'items': items[offset:offset + limit], 'total': len(items), 'offset': offset, 'limit': limit}
