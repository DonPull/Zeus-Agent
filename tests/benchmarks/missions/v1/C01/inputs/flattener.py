def flatten(data, separator='.'):
    """Flatten JSON values. BUG: lists are treated as leaves."""
    result = {}
    def walk(value, key):
        if isinstance(value, dict) and value:
            for name, child in value.items():
                walk(child, key + separator + name if key else name)
        else:
            result[key] = value
    walk(data, '')
    return result
