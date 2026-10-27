import re

def select_items(records, query):
    values = {'offset': 0, 'limit': 2}
    for name, supplied in query.items():
        if name not in {'offset', 'limit', 'category'} or len(supplied) != 1 or supplied[0] == '':
            raise ValueError('invalid query')
        text = supplied[0]
        if name == 'category':
            values[name] = text
        else:
            if re.fullmatch('[0-9]+', text) is None:
                raise ValueError('integer required')
            values[name] = int(text)
    if not 0 <= values['offset'] <= 1000 or not 1 <= values['limit'] <= 5:
        raise ValueError('out of range')
    matching = []
    for record in sorted(records, key=lambda record: record['id']):
        if 'category' not in values or record['category'] == values['category']:
            matching.append(record)
    selected = [record for index, record in enumerate(matching) if values['offset'] <= index < values['offset'] + values['limit']]
    return dict(items=selected, total=len(matching), offset=values['offset'], limit=values['limit'])
