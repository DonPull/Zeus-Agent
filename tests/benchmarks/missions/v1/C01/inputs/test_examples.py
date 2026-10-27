from flattener import flatten

assert flatten({'name': 'Zeus'}) == {'name': 'Zeus'}
assert flatten({'users': [{'name': 'Ada'}]}) == {'users.0.name': 'Ada'}
