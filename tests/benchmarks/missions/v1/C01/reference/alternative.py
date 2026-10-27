def flatten(data, separator='.'):
    result, pending = {}, [('', data)]
    while pending:
        prefix, item = pending.pop()
        if isinstance(item, (list, dict)) and item:
            entries = item.items() if isinstance(item, dict) else enumerate(item)
            for key, value in entries:
                name = prefix + separator + str(key) if prefix else str(key)
                pending.append((name, value))
        else:
            result[prefix] = item
    return result
