def select_items(records, query):
    # TODO: validate, filter, sort and paginate while preserving records.
    return {'items': records, 'total': len(records), 'offset': 0, 'limit': 2}
