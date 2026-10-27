def flatten(data, separator='.'):
    result = {}
    def visit(value, keys):
        children = value.items() if isinstance(value, dict) else enumerate(value) if isinstance(value, list) else []
        if isinstance(value, (dict, list)) and value:
            for key, child in children:
                visit(child, keys + [str(key)])
        else:
            result[separator.join(keys)] = value
    visit(data, [])
    return result
